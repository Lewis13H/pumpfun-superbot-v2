/**
 * Enhanced Stale Token Detection Service
 * Implements tier-based thresholds and auto-removal logic
 * Solves the "$44k tokens that are actually $5k" problem
 */

import { db } from '../../database';
import { UnifiedGraphQLPriceRecovery } from '../recovery/unified-graphql-price-recovery';
import { RecoveryQueue } from '../recovery/recovery-queue';
import { 
  StaleToken, 
  StaleDetectionConfig, 
  RecoveryResult,
  StaleDetectionStats 
} from '../../types/stale-detection.types';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';

// Enhanced configuration with tier-based settings
export interface StaleTokenTier {
  name: string;
  thresholdUsd: number;
  staleMinutes: number;
  removeMinutes: number;
  priority: number;
}

export interface EnhancedStaleDetectionConfig extends StaleDetectionConfig {
  // Tier configuration
  tiers: StaleTokenTier[];
  
  // Auto-removal settings
  enableAutoRemoval: boolean;
  removalGracePeriodMinutes: number;
  softDeleteOnly: boolean;
  
  // Recovery settings
  enableDexScreenerFallback: boolean;
  enableDirectRpcFallback: boolean;
  maxRecoveryAttempts: number;
  
  // Monitoring
  enableDetailedLogging: boolean;
  logStaleDetectionRuns: boolean;
}

export class EnhancedStaleTokenDetector {
  private static instance: EnhancedStaleTokenDetector;
  private config: EnhancedStaleDetectionConfig;
  private recoveryQueue: RecoveryQueue;
  private priceRecovery: UnifiedGraphQLPriceRecovery;
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
  
  // Additional stats for enhanced features
  private enhancedStats = {
    tokensMarkedForRemoval: 0,
    tokensRemoved: 0,
    tokensByTier: new Map<string, number>(),
    recoveryAttempts: new Map<string, number>(),
    falsePositives: 0,
  };
  
  private constructor(config?: Partial<EnhancedStaleDetectionConfig>) {
    // Default tier configuration based on TOKEN-ENRICHMENT-PLAN.md
    const defaultTiers: StaleTokenTier[] = [
      { name: 'critical', thresholdUsd: 50000, staleMinutes: 15, removeMinutes: 60, priority: 100 },
      { name: 'high', thresholdUsd: 20000, staleMinutes: 30, removeMinutes: 120, priority: 80 },
      { name: 'medium', thresholdUsd: 10000, staleMinutes: 45, removeMinutes: 180, priority: 60 },
      { name: 'low', thresholdUsd: 5000, staleMinutes: 60, removeMinutes: 240, priority: 40 },
      { name: 'micro', thresholdUsd: 0, staleMinutes: 120, removeMinutes: 360, priority: 20 }
    ];
    
    this.config = {
      // Base config
      staleThresholdMinutes: 30,
      criticalStaleMinutes: 60,
      criticalMarketCap: 50000,
      highMarketCap: 20000,
      mediumMarketCap: 10000,
      lowMarketCap: 5000,
      scanIntervalMinutes: 5,
      batchSize: 50,
      maxConcurrentRecoveries: 3,
      enableStartupRecovery: true,
      startupRecoveryThresholdMinutes: 5,
      
      // Enhanced config
      tiers: defaultTiers,
      enableAutoRemoval: true,
      removalGracePeriodMinutes: 30,
      softDeleteOnly: true,
      enableDexScreenerFallback: true,
      enableDirectRpcFallback: false,
      maxRecoveryAttempts: 3,
      enableDetailedLogging: true,
      logStaleDetectionRuns: true,
      
      ...config,
    };
    
    this.recoveryQueue = new RecoveryQueue();
    this.priceRecovery = UnifiedGraphQLPriceRecovery.getInstance();
  }
  
  static getInstance(config?: Partial<EnhancedStaleDetectionConfig>): EnhancedStaleTokenDetector {
    if (!EnhancedStaleTokenDetector.instance) {
      EnhancedStaleTokenDetector.instance = new EnhancedStaleTokenDetector(config);
    }
    return EnhancedStaleTokenDetector.instance;
  }
  
  /**
   * Start the enhanced stale token detection service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(chalk.yellow('⚠️ Enhanced stale token detector already running'));
      return;
    }
    
    console.log(chalk.green('🚀 Starting enhanced stale token detector...'));
    console.log(chalk.blue('📊 Tier configuration:'));
    this.config.tiers.forEach(tier => {
      console.log(chalk.gray(`   ${tier.name}: $${tier.thresholdUsd}+ | Stale: ${tier.staleMinutes}min | Remove: ${tier.removeMinutes}min`));
    });
    
    this.isRunning = true;
    
    // Initial scan for already stale tokens
    await this.performInitialScan();
    
    // Start periodic scanning
    this.scanInterval = setInterval(
      () => this.scanForStaleTokens(),
      this.config.scanIntervalMinutes * 60 * 1000
    );
    
    // Start recovery workers
    this.startRecoveryWorkers();
    
    // Start removal worker if enabled
    if (this.config.enableAutoRemoval) {
      this.startRemovalWorker();
    }
  }
  
  /**
   * Perform initial scan on startup
   */
  private async performInitialScan(): Promise<void> {
    console.log(chalk.blue('🔍 Performing initial stale token scan...'));
    
    try {
      // Get current stale token stats
      const staleStats = await db.query(`
        SELECT 
          COUNT(*) as total_stale,
          COUNT(CASE WHEN should_remove = true THEN 1 END) as marked_for_removal,
          AVG(EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60)::INT as avg_stale_minutes
        FROM tokens_unified
        WHERE is_stale = true
      `);
      
      const stats = staleStats.rows[0];
      console.log(chalk.yellow(`📊 Found ${stats.total_stale} stale tokens (avg ${stats.avg_stale_minutes} min stale)`));
      console.log(chalk.yellow(`🗑️  ${stats.marked_for_removal} tokens marked for removal`));
      
      // Run initial scan
      await this.scanForStaleTokens();
      
    } catch (error) {
      console.error(chalk.red('❌ Initial scan failed:'), error);
    }
  }
  
  /**
   * Enhanced scan for stale tokens with tier-based detection
   */
  async scanForStaleTokens(): Promise<void> {
    if (!this.isRunning) return;
    
    const runId = uuidv4();
    const startTime = Date.now();
    let runStats = {
      tokensChecked: 0,
      tokensMarkedStale: 0,
      tokensMarkedRemoval: 0,
      tokensRecovered: 0,
    };
    
    try {
      this.stats.lastScanTime = new Date();
      
      // Build tier-based query
      const tierConditions = this.config.tiers.map((tier) => `
        WHEN latest_market_cap_usd >= ${tier.thresholdUsd} THEN 
          CASE 
            WHEN EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 > ${tier.staleMinutes} THEN 'stale'
            WHEN EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 > ${tier.removeMinutes} THEN 'remove'
            ELSE 'fresh'
          END
      `).join('\n');
      
      // Query tokens with tier-based staleness detection
      const result = await db.query(`
        WITH token_tiers AS (
          SELECT 
            mint_address,
            symbol,
            name,
            latest_market_cap_usd,
            last_trade_at,
            is_stale,
            should_remove,
            graduated_to_amm,
            EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 as minutes_since_trade,
            CASE ${tierConditions}
              ELSE 'fresh'
            END as stale_status,
            CASE 
              ${this.config.tiers.map((tier) => 
                `WHEN latest_market_cap_usd >= ${tier.thresholdUsd} THEN '${tier.name}'`
              ).join('\n')}
              ELSE 'micro'
            END as tier
          FROM tokens_unified
          WHERE 
            latest_market_cap_usd > 1000
            AND last_trade_at IS NOT NULL
        )
        SELECT * FROM token_tiers
        WHERE stale_status IN ('stale', 'remove')
        ORDER BY 
          CASE tier
            ${this.config.tiers.map((tier, index) => 
              `WHEN '${tier.name}' THEN ${index}`
            ).join('\n')}
          END,
          latest_market_cap_usd DESC
      `);
      
      runStats.tokensChecked = result.rows.length;
      this.stats.totalTokensScanned += result.rows.length;
      
      if (result.rows.length === 0) {
        console.log(chalk.gray('✓ No stale tokens found'));
        await this.logDetectionRun(runId, runStats, 'completed');
        return;
      }
      
      console.log(chalk.yellow(`🔍 Found ${result.rows.length} stale/removable tokens`));
      
      // Process tokens by tier
      const tokensByTier = new Map<string, StaleToken[]>();
      const tokensForRemoval: string[] = [];
      
      for (const row of result.rows) {
        const token: StaleToken = {
          mintAddress: row.mint_address,
          symbol: row.symbol,
          name: row.name,
          lastTradeTime: row.last_trade_at,
          marketCapUsd: parseFloat(row.latest_market_cap_usd),
          staleDuration: parseFloat(row.minutes_since_trade),
          priority: this.getTierPriority(row.tier),
        };
        
        // Group by tier
        const tierTokens = tokensByTier.get(row.tier) || [];
        tierTokens.push(token);
        tokensByTier.set(row.tier, tierTokens);
        
        // Track removal candidates
        if (row.stale_status === 'remove') {
          tokensForRemoval.push(row.mint_address);
        }
      }
      
      // Update tier statistics
      for (const [tier, tokens] of tokensByTier) {
        this.enhancedStats.tokensByTier.set(tier, tokens.length);
        console.log(chalk.blue(`   ${tier}: ${tokens.length} tokens`));
      }
      
      // Mark tokens as stale in database
      const staleTokens = result.rows.filter((r: any) => r.stale_status === 'stale' && !r.is_stale);
      if (staleTokens.length > 0) {
        await db.query(`
          UPDATE tokens_unified
          SET is_stale = true, updated_at = NOW()
          WHERE mint_address = ANY($1::varchar[])
        `, [staleTokens.map((t: any) => t.mint_address)]);
        
        runStats.tokensMarkedStale = staleTokens.length;
        console.log(chalk.yellow(`📌 Marked ${staleTokens.length} tokens as stale`));
      }
      
      // Mark tokens for removal
      if (tokensForRemoval.length > 0 && this.config.enableAutoRemoval) {
        await db.query(`
          UPDATE tokens_unified
          SET should_remove = true, updated_at = NOW()
          WHERE mint_address = ANY($1::varchar[])
          AND should_remove = false
        `, [tokensForRemoval]);
        
        runStats.tokensMarkedRemoval = tokensForRemoval.length;
        this.enhancedStats.tokensMarkedForRemoval += tokensForRemoval.length;
        console.log(chalk.red(`🗑️  Marked ${tokensForRemoval.length} tokens for removal`));
      }
      
      // Add all stale tokens to recovery queue
      const allStaleTokens: StaleToken[] = [];
      for (const tokens of tokensByTier.values()) {
        allStaleTokens.push(...tokens);
      }
      
      this.stats.staleTokensFound += allStaleTokens.length;
      this.recoveryQueue.add(allStaleTokens);
      
      // Update queue stats
      const queueStats = this.recoveryQueue.getStats();
      this.stats.currentQueueDepth = queueStats.queueDepth;
      
      const duration = Date.now() - startTime;
      console.log(chalk.blue(
        `📊 Scan complete in ${(duration / 1000).toFixed(1)}s. Queue depth: ${queueStats.queueDepth}`
      ));
      
      // Log the run
      await this.logDetectionRun(runId, runStats, 'completed', duration);
      
    } catch (error) {
      console.error(chalk.red('❌ Enhanced stale token scan failed:'), error);
      await this.logDetectionRun(runId, runStats, 'failed', Date.now() - startTime, error as Error);
    }
  }
  
  /**
   * Start recovery workers with multi-source fallback
   */
  private startRecoveryWorkers(): void {
    const processQueue = async () => {
      if (!this.isRunning) return;
      
      const queueStats = this.recoveryQueue.getStats();
      if (queueStats.queueDepth === 0) {
        setTimeout(processQueue, 10000);
        return;
      }
      
      // Get next batch
      const batch = this.recoveryQueue.getNextBatch(this.config.batchSize);
      const tokenBatch = batch as any;
      if (!tokenBatch.tokens || tokenBatch.tokens.length === 0) {
        setTimeout(processQueue, 5000);
        return;
      }
      
      console.log(chalk.blue(`🔄 Processing ${tokenBatch.tokens.length} tokens from recovery queue...`));
      
      try {
        const mintAddresses = tokenBatch.tokens.map((item: StaleToken) => item.mintAddress);
        const startTime = Date.now();
        
        // Try primary recovery (GraphQL)
        let result = await this.priceRecovery.recoverPrices(mintAddresses);
        
        // If some failed and DexScreener is enabled, try fallback for graduated tokens
        if (result.failed.length > 0 && this.config.enableDexScreenerFallback) {
          console.log(chalk.yellow(`🔄 Trying DexScreener fallback for ${result.failed.length} tokens...`));
          
          // Check which failed tokens are graduated
          const graduatedCheck = await db.query(`
            SELECT mint_address 
            FROM tokens_unified 
            WHERE mint_address = ANY($1::varchar[]) 
            AND graduated_to_amm = true
          `, [result.failed.map((f: any) => f.mintAddress)]);
          
          const graduatedMints = graduatedCheck.rows.map((r: any) => r.mint_address);
          
          if (graduatedMints.length > 0) {
            // DexScreener recovery not implemented yet
            const dexResult = { successful: [], failed: [] };
            
            // Merge results
            result.successful.push(...dexResult.successful);
            result.failed = result.failed.filter((f: any) => !graduatedMints.includes(f.mintAddress));
            result.failed.push(...dexResult.failed);
          }
        }
        
        // Update recovery attempts
        for (const mint of mintAddresses) {
          const attempts = this.enhancedStats.recoveryAttempts.get(mint) || 0;
          this.enhancedStats.recoveryAttempts.set(mint, attempts + 1);
        }
        
        // Process results
        const successfulMints = result.successful.map((update: any) => update.mintAddress);
        const failedMints = result.failed.map((fail: any) => fail.mintAddress);
        
        // Update stale flag for recovered tokens
        if (successfulMints.length > 0) {
          await db.query(`
            UPDATE tokens_unified
            SET is_stale = false, should_remove = false, updated_at = NOW()
            WHERE mint_address = ANY($1::varchar[])
          `, [successfulMints]);
        }
        
        // Mark completed in queue
        const results: RecoveryResult[] = [
          ...successfulMints.map(mint => ({ 
            mintAddress: mint, 
            success: true, 
            priceUpdated: true, 
            duration: 0 
          })),
          ...failedMints.map(mint => ({ 
            mintAddress: mint, 
            success: false, 
            priceUpdated: false, 
            duration: 0 
          }))
        ];
        this.recoveryQueue.markCompleted(results);
        
        // Update stats
        this.stats.tokensRecovered += result.successful.length;
        this.stats.graphqlQueriesUsed += result.graphqlQueries || 0;
        
        const duration = Date.now() - startTime;
        const totalRecoveries = this.stats.tokensRecovered;
        if (totalRecoveries > 0) {
          this.stats.averageRecoveryTime = 
            (this.stats.averageRecoveryTime * (totalRecoveries - result.successful.length) + duration) / totalRecoveries;
          this.stats.recoverySuccessRate = this.stats.tokensRecovered / this.stats.staleTokensFound;
        }
        
        console.log(chalk.green(
          `✅ Recovered ${result.successful.length}/${tokenBatch.tokens.length} tokens in ${(duration / 1000).toFixed(1)}s`
        ));
        
      } catch (error) {
        console.error(chalk.red('❌ Recovery batch failed:'), error);
        
        // Mark all as failed
        const mintAddresses = tokenBatch.tokens.map((item: StaleToken) => item.mintAddress);
        const failedResults = mintAddresses.map((mint: any) => ({ 
          mintAddress: mint, 
          success: false, 
          priceUpdated: false, 
          duration: 0,
          error: 'Failed to recover'
        }));
        this.recoveryQueue.markCompleted(failedResults);
      }
      
      // Process next batch
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
   * Start auto-removal worker
   */
  private startRemovalWorker(): void {
    setInterval(async () => {
      if (!this.isRunning || !this.config.enableAutoRemoval) return;
      
      try {
        // Find tokens marked for removal that have passed grace period
        const removalCandidates = await db.query(`
          SELECT 
            mint_address,
            symbol,
            name,
            latest_market_cap_usd,
            last_trade_at,
            EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 as minutes_since_trade
          FROM tokens_unified
          WHERE 
            should_remove = true
            AND last_trade_at < NOW() - INTERVAL '${this.config.removalGracePeriodMinutes} minutes'
          ORDER BY latest_market_cap_usd ASC
          LIMIT 100
        `);
        
        if (removalCandidates.rows.length === 0) return;
        
        console.log(chalk.red(`🗑️  Processing ${removalCandidates.rows.length} tokens for removal...`));
        
        const mintAddresses = removalCandidates.rows.map((r: any) => r.mint_address);
        
        if (this.config.softDeleteOnly) {
          // Soft delete: just mark as removed
          await db.query(`
            UPDATE tokens_unified
            SET 
              should_remove = false,
              is_stale = true,
              threshold_crossed_at = NULL,
              updated_at = NOW()
            WHERE mint_address = ANY($1::varchar[])
          `, [mintAddresses]);
          
          console.log(chalk.red(`🗑️  Soft deleted ${mintAddresses.length} tokens`));
        } else {
          // Hard delete: remove from database
          await db.query(`
            DELETE FROM tokens_unified
            WHERE mint_address = ANY($1::varchar[])
          `, [mintAddresses]);
          
          console.log(chalk.red(`🗑️  Hard deleted ${mintAddresses.length} tokens`));
        }
        
        this.enhancedStats.tokensRemoved += mintAddresses.length;
        
        // Log removals
        for (const row of removalCandidates.rows) {
          console.log(chalk.gray(
            `   - ${row.symbol || 'Unknown'} ($${parseFloat(row.latest_market_cap_usd).toFixed(0)}) - ${Math.round(row.minutes_since_trade)} min stale`
          ));
        }
        
      } catch (error) {
        console.error(chalk.red('❌ Auto-removal failed:'), error);
      }
    }, 60000); // Check every minute
  }
  
  /**
   * Get tier priority
   */
  private getTierPriority(tierName: string): number {
    const tier = this.config.tiers.find(t => t.name === tierName);
    return tier?.priority || 0;
  }
  
  /**
   * Log detection run to database
   */
  private async logDetectionRun(
    _runId: string, 
    stats: any, 
    status: string, 
    duration?: number,
    error?: Error
  ): Promise<void> {
    if (!this.config.logStaleDetectionRuns) return;
    
    try {
      await db.query(`
        INSERT INTO stale_detection_runs (
          run_at,
          tokens_checked,
          tokens_marked_stale,
          tokens_marked_removal,
          tokens_recovered,
          execution_time_ms,
          status,
          error_message
        ) VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7)
      `, [
        stats.tokensChecked,
        stats.tokensMarkedStale,
        stats.tokensMarkedRemoval,
        stats.tokensRecovered,
        duration || 0,
        status,
        error?.message || null
      ]);
    } catch (err) {
      console.error(chalk.red('Failed to log detection run:'), err);
    }
  }
  
  /**
   * Get enhanced statistics
   */
  getEnhancedStats(): any {
    const baseStats = this.getStats();
    return {
      ...baseStats,
      ...this.enhancedStats,
      tokensByTier: Object.fromEntries(this.enhancedStats.tokensByTier),
      topRecoveryAttempts: Array.from(this.enhancedStats.recoveryAttempts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    };
  }
  
  /**
   * Stop the service
   */
  stop(): void {
    if (!this.isRunning) return;
    
    console.log(chalk.yellow('🛑 Stopping enhanced stale token detector...'));
    this.isRunning = false;
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
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
}