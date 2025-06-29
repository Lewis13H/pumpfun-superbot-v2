/**
 * Stale Token Detection Service
 * Automatically detects and recovers tokens with outdated prices
 */

import { db } from '../database';
import { UnifiedGraphQLPriceRecovery } from './unified-graphql-price-recovery';
import { DexScreenerPriceRecovery } from './dexscreener-price-recovery';
import { RecoveryQueue } from './recovery-queue';
import { 
  StaleToken, 
  StaleDetectionConfig, 
  RecoveryBatch,
  RecoveryResult,
  StaleDetectionStats 
} from '../types/stale-detection.types';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';

export class StaleTokenDetector {
  private static instance: StaleTokenDetector;
  private config: StaleDetectionConfig;
  private recoveryQueue: RecoveryQueue;
  private priceRecovery: UnifiedGraphQLPriceRecovery;
  private dexScreenerRecovery: DexScreenerPriceRecovery;
  private isRunning = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private stats: StaleDetectionStats = {
    totalTokensScanned: 0,
    staleTokensFound: 0,
    tokensRecovered: 0,
    recoverySuccessRate: 0,
    averageRecoveryTime: 0,
    graphqlQueriesUsed: 0,
    currentQueueDepth: 0,
  };
  
  private constructor(config?: Partial<StaleDetectionConfig>) {
    this.config = {
      staleThresholdMinutes: 30,
      criticalStaleMinutes: 60,
      criticalMarketCap: 50000,
      highMarketCap: 20000,
      mediumMarketCap: 10000,
      lowMarketCap: 5000,
      scanIntervalMinutes: 5,
      batchSize: 100,
      maxConcurrentRecoveries: 3,
      enableStartupRecovery: true,
      startupRecoveryThresholdMinutes: 5,
      ...config,
    };
    
    this.recoveryQueue = new RecoveryQueue();
    this.priceRecovery = UnifiedGraphQLPriceRecovery.getInstance();
    this.dexScreenerRecovery = DexScreenerPriceRecovery.getInstance();
  }
  
  static getInstance(config?: Partial<StaleDetectionConfig>): StaleTokenDetector {
    if (!StaleTokenDetector.instance) {
      StaleTokenDetector.instance = new StaleTokenDetector(config);
    }
    return StaleTokenDetector.instance;
  }
  
  /**
   * Start the stale token detection service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(chalk.yellow('⚠️ Stale token detector already running'));
      return;
    }
    
    console.log(chalk.green('🚀 Starting stale token detector...'));
    this.isRunning = true;
    
    // Check for startup recovery
    if (this.config.enableStartupRecovery) {
      await this.performStartupRecovery();
    }
    
    // Start periodic scanning
    this.scanInterval = setInterval(
      () => this.scanForStaleTokens(),
      this.config.scanIntervalMinutes * 60 * 1000
    );
    
    // Run first scan immediately
    await this.scanForStaleTokens();
    
    // Start recovery workers
    this.startRecoveryWorkers();
  }
  
  /**
   * Stop the service
   */
  stop(): void {
    if (!this.isRunning) return;
    
    console.log(chalk.yellow('🛑 Stopping stale token detector...'));
    this.isRunning = false;
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }
  
  /**
   * Perform startup recovery after downtime
   */
  async performStartupRecovery(): Promise<void> {
    try {
      console.log(chalk.blue('🔄 Checking for startup recovery...'));
      
      // Get last recovery time
      const lastRecovery = await db.query(`
        SELECT MAX(created_at) as last_recovery
        FROM stale_token_recovery
        WHERE status = 'completed'
      `);
      
      const lastRecoveryTime = lastRecovery.rows[0]?.last_recovery;
      const downtimeMinutes = lastRecoveryTime 
        ? Math.floor((Date.now() - new Date(lastRecoveryTime).getTime()) / 1000 / 60)
        : 999;
      
      if (downtimeMinutes >= this.config.startupRecoveryThresholdMinutes) {
        console.log(chalk.yellow(`⏰ Detected ${downtimeMinutes} minutes of downtime. Starting recovery...`));
        
        // Get all tokens sorted by market cap (both graduated and non-graduated)
        const tokens = await db.query(`
          SELECT 
            mint_address,
            symbol,
            name,
            latest_market_cap_usd,
            updated_at,
            graduated_to_amm
          FROM tokens_unified
          WHERE 
            latest_market_cap_usd > 1000
          ORDER BY latest_market_cap_usd DESC
        `);
        
        if (tokens.rows.length > 0) {
          console.log(chalk.blue(`📊 Recovering ${tokens.rows.length} tokens...`));
          
          const batch: RecoveryBatch = {
            batchId: uuidv4(),
            startTime: new Date(),
            tokensChecked: tokens.rows.length,
            tokensRecovered: 0,
            tokensFailed: 0,
            graphqlQueries: 0,
            status: 'running',
          };
          
          // Process in batches
          const tokenMints = tokens.rows.map(r => r.mint_address);
          const startTime = Date.now();
          
          const result = await this.priceRecovery.recoverPrices(tokenMints);
          
          batch.tokensRecovered = result.successful.length;
          batch.tokensFailed = result.failed.length;
          batch.graphqlQueries = result.graphqlQueries;
          batch.totalDuration = Date.now() - startTime;
          batch.status = 'completed';
          batch.endTime = new Date();
          
          // Save recovery log
          await this.saveRecoveryBatch(batch);
          
          console.log(chalk.green(
            `✅ Startup recovery complete: ${batch.tokensRecovered} tokens in ${(batch.totalDuration / 1000).toFixed(1)}s`
          ));
        }
      } else {
        console.log(chalk.gray(`✓ System was down for only ${downtimeMinutes} minutes. No recovery needed.`));
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Startup recovery failed:'), error);
    }
  }
  
  /**
   * Scan for stale tokens
   */
  async scanForStaleTokens(): Promise<void> {
    if (!this.isRunning) return;
    
    try {
      const startTime = Date.now();
      this.stats.lastScanTime = new Date();
      
      // Query for potentially stale tokens (both graduated and non-graduated)
      const result = await db.query(`
        SELECT 
          mint_address,
          symbol,
          name,
          latest_market_cap_usd,
          updated_at,
          graduated_to_amm,
          EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 as minutes_since_update
        FROM tokens_unified
        WHERE 
          latest_market_cap_usd > 1000
          AND updated_at < NOW() - INTERVAL '${this.config.staleThresholdMinutes} minutes'
        ORDER BY latest_market_cap_usd DESC
      `);
      
      this.stats.totalTokensScanned = result.rows.length;
      
      if (result.rows.length === 0) {
        console.log(chalk.gray('✓ No stale tokens found'));
        return;
      }
      
      console.log(chalk.yellow(`🔍 Found ${result.rows.length} potentially stale tokens`));
      
      // Convert to StaleToken objects with priority
      const staleTokens: StaleToken[] = result.rows.map(row => {
        const token: StaleToken = {
          mintAddress: row.mint_address,
          symbol: row.symbol,
          name: row.name,
          lastUpdateTime: row.updated_at,
          marketCapUsd: parseFloat(row.latest_market_cap_usd),
          staleDuration: parseFloat(row.minutes_since_update),
          priority: 0, // Will be calculated
        };
        
        token.priority = RecoveryQueue.calculatePriority(token);
        return token;
      });
      
      this.stats.staleTokensFound = staleTokens.length;
      
      // Add to recovery queue
      await this.recoveryQueue.addTokens(staleTokens);
      
      // Update stats
      const queueStats = this.recoveryQueue.getStats();
      this.stats.currentQueueDepth = queueStats.queueDepth;
      
      const duration = Date.now() - startTime;
      console.log(chalk.blue(
        `📊 Scan complete in ${(duration / 1000).toFixed(1)}s. Queue depth: ${queueStats.queueDepth}`
      ));
      
    } catch (error) {
      console.error(chalk.red('❌ Stale token scan failed:'), error);
    }
  }
  
  /**
   * Start recovery workers
   */
  private startRecoveryWorkers(): void {
    // Process recovery queue continuously
    const processQueue = async () => {
      if (!this.isRunning) return;
      
      const queueStats = this.recoveryQueue.getStats();
      if (queueStats.queueDepth === 0) {
        // Check again in 10 seconds
        setTimeout(processQueue, 10000);
        return;
      }
      
      // Get next batch
      const batch = this.recoveryQueue.getNextBatch(this.config.batchSize);
      if (batch.length === 0) {
        setTimeout(processQueue, 5000);
        return;
      }
      
      console.log(chalk.blue(`🔄 Processing ${batch.length} tokens from recovery queue...`));
      
      try {
        const mintAddresses = batch.map(item => item.mintAddress);
        const startTime = Date.now();
        
        // Recover prices
        const result = await this.priceRecovery.recoverPrices(mintAddresses);
        
        // Update database for successful recoveries
        const successfulMints = result.successful.map(update => update.mintAddress);
        const failedMints = result.failed.map(fail => fail.mintAddress);
        
        // Mark completed in queue
        this.recoveryQueue.markCompleted(successfulMints, true);
        this.recoveryQueue.markCompleted(failedMints, false);
        
        // Update stats
        this.stats.tokensRecovered += result.successful.length;
        this.stats.graphqlQueriesUsed += result.graphqlQueries;
        
        const duration = Date.now() - startTime;
        const totalRecoveries = this.stats.tokensRecovered;
        if (totalRecoveries > 0) {
          this.stats.averageRecoveryTime = 
            (this.stats.averageRecoveryTime * (totalRecoveries - result.successful.length) + duration) / totalRecoveries;
          this.stats.recoverySuccessRate = this.stats.tokensRecovered / this.stats.staleTokensFound;
        }
        
        console.log(chalk.green(
          `✅ Recovered ${result.successful.length}/${batch.length} tokens in ${(duration / 1000).toFixed(1)}s`
        ));
        
      } catch (error) {
        console.error(chalk.red('❌ Recovery batch failed:'), error);
        
        // Mark all as failed
        const mintAddresses = batch.map(item => item.mintAddress);
        this.recoveryQueue.markCompleted(mintAddresses, false);
      }
      
      // Process next batch immediately if queue is large
      const newQueueStats = this.recoveryQueue.getStats();
      const delay = newQueueStats.queueDepth > this.config.batchSize ? 100 : 5000;
      setTimeout(processQueue, delay);
    };
    
    // Start multiple workers
    for (let i = 0; i < this.config.maxConcurrentRecoveries; i++) {
      setTimeout(() => processQueue(), i * 1000);
    }
  }
  
  /**
   * Save recovery batch to database
   */
  private async saveRecoveryBatch(batch: RecoveryBatch): Promise<void> {
    try {
      await db.query(`
        INSERT INTO stale_token_recovery (
          recovery_batch_id,
          tokens_checked,
          tokens_recovered,
          tokens_failed,
          graphql_queries,
          total_duration_ms,
          status,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        batch.batchId,
        batch.tokensChecked,
        batch.tokensRecovered,
        batch.tokensFailed,
        batch.graphqlQueries,
        batch.totalDuration,
        batch.status,
        batch.startTime,
      ]);
    } catch (error) {
      console.error(chalk.red('Failed to save recovery batch:'), error);
    }
  }
  
  /**
   * Get current statistics
   */
  getStats(): StaleDetectionStats {
    const queueStats = this.recoveryQueue.getStats();
    return {
      ...this.stats,
      currentQueueDepth: queueStats.queueDepth,
    };
  }
  
  /**
   * Manually trigger recovery for specific tokens
   */
  async recoverTokens(mintAddresses: string[]): Promise<RecoveryResult[]> {
    console.log(chalk.blue(`🔧 Manually recovering ${mintAddresses.length} tokens...`));
    
    const startTime = Date.now();
    const result = await this.priceRecovery.recoverPrices(mintAddresses);
    
    const recoveryResults: RecoveryResult[] = [];
    
    // Process successful updates
    result.successful.forEach(update => {
      recoveryResults.push({
        mintAddress: update.mintAddress,
        success: true,
        priceUpdated: true,
        newPriceUsd: update.priceInUsd,
        newMarketCapUsd: update.marketCapUsd,
        duration: result.queryTime,
      });
    });
    
    // Process failed updates
    result.failed.forEach(fail => {
      recoveryResults.push({
        mintAddress: fail.mintAddress,
        success: false,
        priceUpdated: false,
        error: fail.reason,
        duration: result.queryTime,
      });
    });
    
    const totalDuration = Date.now() - startTime;
    console.log(chalk.green(
      `✅ Manual recovery complete: ${result.successful.length}/${mintAddresses.length} successful in ${(totalDuration / 1000).toFixed(1)}s`
    ));
    
    return recoveryResults;
  }
}