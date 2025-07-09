import { Pool } from 'pg';
import { logger } from '../../../core/logger';
import { InMemoryCacheService } from './in-memory-cache-service';
import { HolderAnalysisService } from '../holder-analysis-service';

export interface WarmingConfig {
  batchSize: number;
  concurrency: number;
  interval: number; // milliseconds
  priorities: {
    highMarketCap: number;  // > $1M
    mediumMarketCap: number; // > $100k
    lowMarketCap: number;   // > $10k
  };
}

export class CacheWarmer {
  private warmingInterval: NodeJS.Timer | null = null;
  private isWarming = false;
  private warmingQueue: Array<{ mintAddress: string; priority: number }> = [];
  
  private readonly defaultConfig: WarmingConfig = {
    batchSize: 10,
    concurrency: 3,
    interval: 300000, // 5 minutes
    priorities: {
      highMarketCap: 1000000,
      mediumMarketCap: 100000,
      lowMarketCap: 10000
    }
  };
  
  constructor(
    private pool: Pool,
    private cache: InMemoryCacheService,
    private analysisService: HolderAnalysisService,
    private config: WarmingConfig = {} as WarmingConfig
  ) {
    this.config = { ...this.defaultConfig, ...config };
  }
  
  start(): void {
    if (this.warmingInterval) {
      logger.warn('Cache warmer already running');
      return;
    }
    
    logger.info('Starting cache warmer');
    
    // Initial warming
    this.warmCache();
    
    // Schedule periodic warming
    this.warmingInterval = setInterval(() => {
      this.warmCache();
    }, this.config.interval);
  }
  
  stop(): void {
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval);
      this.warmingInterval = null;
      logger.info('Cache warmer stopped');
    }
  }
  
  async warmCache(): Promise<void> {
    if (this.isWarming) {
      logger.debug('Cache warming already in progress');
      return;
    }
    
    this.isWarming = true;
    
    try {
      // Get tokens to warm
      const tokens = await this.getTokensToWarm();
      
      if (tokens.length === 0) {
        logger.debug('No tokens to warm');
        return;
      }
      
      logger.info(`Starting cache warming for ${tokens.length} tokens`);
      
      // Process in batches
      for (let i = 0; i < tokens.length; i += this.config.batchSize) {
        const batch = tokens.slice(i, i + this.config.batchSize);
        await this.warmBatch(batch);
      }
      
      logger.info(`Cache warming completed for ${tokens.length} tokens`);
      
    } catch (error) {
      logger.error('Cache warming failed:', error);
    } finally {
      this.isWarming = false;
    }
  }
  
  private async getTokensToWarm(): Promise<string[]> {
    try {
      // Get active tokens sorted by market cap
      const query = `
        SELECT DISTINCT 
          t.mint_address,
          t.latest_market_cap_usd
        FROM tokens_unified t
        WHERE t.latest_market_cap_usd > $1
          AND t.created_at > NOW() - INTERVAL '7 days'
        ORDER BY t.latest_market_cap_usd DESC
        LIMIT 100
      `;
      
      const result = await this.pool.query(query, [this.config.priorities.lowMarketCap]);
      
      // Prioritize by market cap
      const prioritized = result.rows.map(row => {
        let priority = 1;
        const marketCap = parseFloat(row.latest_market_cap_usd);
        
        if (marketCap >= this.config.priorities.highMarketCap) {
          priority = 3;
        } else if (marketCap >= this.config.priorities.mediumMarketCap) {
          priority = 2;
        }
        
        return {
          mintAddress: row.mint_address,
          priority
        };
      });
      
      // Sort by priority
      prioritized.sort((a, b) => b.priority - a.priority);
      
      return prioritized.map(t => t.mintAddress);
      
    } catch (error) {
      logger.error('Failed to get tokens for warming:', error);
      return [];
    }
  }
  
  private async warmBatch(mintAddresses: string[]): Promise<void> {
    const promises = mintAddresses.map(async (mintAddress) => {
      try {
        // Check if already cached
        const cached = await this.cache.getAnalysis(mintAddress);
        if (cached) {
          logger.debug(`Token ${mintAddress} already cached`);
          return;
        }
        
        // Analyze and cache
        logger.debug(`Warming cache for token ${mintAddress}`);
        const analysis = await this.analysisService.analyzeToken(mintAddress);
        
        if (analysis) {
          // Cache will be populated automatically by the service
          logger.debug(`Successfully warmed cache for token ${mintAddress}`);
        }
        
      } catch (error) {
        logger.error(`Failed to warm cache for token ${mintAddress}:`, error);
      }
    });
    
    // Process with concurrency limit
    const chunks = [];
    for (let i = 0; i < promises.length; i += this.config.concurrency) {
      chunks.push(promises.slice(i, i + this.config.concurrency));
    }
    
    for (const chunk of chunks) {
      await Promise.all(chunk);
    }
  }
  
  async warmSpecificTokens(mintAddresses: string[]): Promise<void> {
    logger.info(`Manual cache warming for ${mintAddresses.length} tokens`);
    
    for (const mintAddress of mintAddresses) {
      this.warmingQueue.push({
        mintAddress,
        priority: 3 // High priority for manual warming
      });
    }
    
    // Process queue if not already warming
    if (!this.isWarming) {
      await this.processWarmingQueue();
    }
  }
  
  private async processWarmingQueue(): Promise<void> {
    if (this.warmingQueue.length === 0) return;
    
    // Sort by priority
    this.warmingQueue.sort((a, b) => b.priority - a.priority);
    
    // Process queue
    while (this.warmingQueue.length > 0) {
      const batch = this.warmingQueue.splice(0, this.config.batchSize);
      await this.warmBatch(batch.map(item => item.mintAddress));
    }
  }
  
  getStats(): {
    isWarming: boolean;
    queueSize: number;
    nextWarmingIn: number;
  } {
    let nextWarmingIn = -1;
    
    if (this.warmingInterval) {
      // Estimate based on interval (not precise but good enough)
      nextWarmingIn = this.config.interval;
    }
    
    return {
      isWarming: this.isWarming,
      queueSize: this.warmingQueue.length,
      nextWarmingIn
    };
  }
}