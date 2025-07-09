/**
 * Optimized Holder Analysis Service
 * 
 * Extends the base holder analysis service with performance optimizations:
 * - In-memory caching
 * - Request coalescing
 * - Batch processing
 * - Query optimization
 */

import { Pool } from 'pg';
import { HolderAnalysisService, AnalysisOptions, AnalysisResult } from './holder-analysis-service';
import { InMemoryCacheService } from './cache/in-memory-cache-service';
import { CacheWarmer } from './cache/cache-warmer';
import { CacheStrategyManager, CacheStrategy, CacheConfig } from './cache/cache-strategies';
import { QueryOptimizer } from './optimization/query-optimizer';
import { BatchProcessor } from './optimization/batch-processor';
import { RequestCoalescer } from './optimization/request-coalescer';
import { logger } from '../../core/logger';
export class OptimizedHolderAnalysisService extends HolderAnalysisService {
  private cache: InMemoryCacheService;
  private cacheWarmer: CacheWarmer;
  private cacheStrategy: CacheStrategyManager;
  private queryOptimizer: QueryOptimizer;
  private requestCoalescer: RequestCoalescer;
  private analysisBatchProcessor: BatchProcessor<string, any>;
  
  constructor(
    pool: Pool,
    heliusApiKey?: string,
    shyftApiKey?: string
  ) {
    super(pool, heliusApiKey, shyftApiKey);
    
    // Initialize performance components
    this.cache = new InMemoryCacheService();
    this.queryOptimizer = new QueryOptimizer(pool);
    this.requestCoalescer = new RequestCoalescer();
    
    // Initialize cache strategy manager
    this.cacheStrategy = new CacheStrategyManager(
      this.cache,
      (key: string) => this.fetchFromDatabase(key),
      (key: string, data: any) => this.writeToDatabase(key, data)
    );
    
    // Initialize batch processor for analysis
    this.analysisBatchProcessor = new BatchProcessor(
      async (mintAddresses: string[]) => {
        const results = [];
        for (const mintAddress of mintAddresses) {
          const result = await super.analyzeToken(mintAddress);
          results.push(result);
        }
        return results;
      },
      {
        maxBatchSize: 10,
        maxWaitTime: 2000,
        concurrency: 3
      }
    );
    
    // Initialize cache warmer (but don't start it yet)
    this.cacheWarmer = new CacheWarmer(pool, this.cache, this);
    
    // Create database indexes on startup
    this.initializeOptimizations();
  }
  
  private async initializeOptimizations(): Promise<void> {
    try {
      // Create optimized indexes
      await this.queryOptimizer.createIndexes();
      logger.info('Database indexes created/verified');
      
      // Start cache warmer after a delay
      setTimeout(() => {
        this.cacheWarmer.start();
      }, 10000); // Start after 10 seconds
      
    } catch (error) {
      logger.error('Failed to initialize optimizations:', error);
    }
  }
  
  async analyzeToken(
    mintAddress: string,
    options: AnalysisOptions = {}
  ): Promise<AnalysisResult> {
    // Use request coalescer to prevent duplicate requests
    return this.requestCoalescer.coalesce(
      `analysis:${mintAddress}`,
      async () => {
        // Check cache first unless force refresh
        if (!options.forceRefresh) {
          const cached = await this.cache.getAnalysis(mintAddress);
          if (cached) {
            logger.debug(`Cache hit for analysis: ${mintAddress}`);
            return {
              success: true,
              analysis: cached,
              duration: 0
            };
          }
        }
        
        // Perform analysis
        const startTime = Date.now();
        const result = await super.analyzeToken(mintAddress, options);
        
        // Cache successful results
        if (result.success && result.analysis) {
          await this.cache.setAnalysis(mintAddress, result.analysis);
          
          // Also cache the snapshot
          if (result.analysis.snapshot) {
            await this.cache.setSnapshot(mintAddress, result.analysis.snapshot);
          }
        }
        
        return result;
      }
    );
  }
  
  async analyzeTokenBatch(
    mintAddresses: string[],
    options: AnalysisOptions = {}
  ): Promise<AnalysisResult[]> {
    logger.info(`Batch analysis requested for ${mintAddresses.length} tokens`);
    
    const results: AnalysisResult[] = [];
    
    // Process in batches using the batch processor
    for (const mintAddress of mintAddresses) {
      await this.analysisBatchProcessor.add(mintAddress, mintAddress);
    }
    
    // Wait for batch processing to complete
    const batchResult = await this.analysisBatchProcessor.flush();
    
    // Map results
    for (const item of batchResult.successful) {
      results.push({
        success: true,
        analysis: item.data
      });
    }
    
    for (const failed of batchResult.failed) {
      results.push({
        success: false,
        error: failed.error.message
      });
    }
    
    return results;
  }
  
  async getHolderHistory(
    mintAddress: string,
    period: '1h' | '6h' | '24h' | '7d' | '30d' = '7d'
  ): Promise<any> {
    // Check cache first
    const cached = await this.cache.getHistory(mintAddress, period);
    if (cached) {
      return cached;
    }
    
    // Use parent method
    const history = await super.getHolderHistory(mintAddress, period);
    
    // Cache the result
    if (history) {
      await this.cache.setHistory(mintAddress, period, history);
    }
    
    return history;
  }
  
  async compareToken(mintAddress: string, criteria?: any): Promise<any> {
    const cacheKey = criteria ? `${mintAddress}:${JSON.stringify(criteria)}` : mintAddress;
    
    // Check cache
    const cached = await this.cache.getComparison(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Use parent method
    const comparison = await super.compareToken(mintAddress, criteria);
    
    // Cache the result
    if (comparison) {
      await this.cache.setComparison(cacheKey, comparison);
    }
    
    return comparison;
  }
  
  private async fetchFromDatabase(key: string): Promise<any> {
    // Parse the key to determine what to fetch
    const [type, ...params] = key.split(':');
    
    switch (type) {
      case 'analysis':
        return super.analyzeToken(params[0]);
      
      case 'holders':
        // Fetch holder data using optimized query
        const plan = await this.queryOptimizer.optimizeHolderQuery(params[0]);
        const result = await this.queryOptimizer.executeWithStats(plan, key);
        return result.rows;
      
      case 'snapshot':
        return super.getLatestSnapshot(params[0]);
      
      default:
        return null;
    }
  }
  
  private async writeToDatabase(key: string, data: any): Promise<void> {
    // Parse the key to determine what to write
    const [type, ...params] = key.split(':');
    
    switch (type) {
      case 'snapshot':
        // Write snapshot to database
        await super.saveSnapshot(data);
        break;
      
      default:
        logger.warn(`Unknown write type: ${type}`);
    }
  }
  
  async warmCache(mintAddresses: string[]): Promise<void> {
    await this.cacheWarmer.warmSpecificTokens(mintAddresses);
  }
  
  getCacheStats(): any {
    return {
      cache: this.cache.getCacheInfo(),
      warmer: this.cacheWarmer.getStats(),
      coalescer: this.requestCoalescer.getStats(),
      batchProcessor: this.analysisBatchProcessor.getQueueInfo()
    };
  }
  
  async getPerformanceMetrics(): Promise<any> {
    const queryPerformance = await this.queryOptimizer.analyzePerformance();
    const cacheStats = this.cache.getStats();
    const coalescerStats = this.requestCoalescer.getStats();
    
    return {
      cache: {
        ...cacheStats,
        hitRate: cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100
      },
      coalescer: {
        ...coalescerStats,
        coalescingRate: coalescerStats.coalescedRequests / coalescerStats.totalRequests * 100
      },
      queries: queryPerformance,
      recommendations: [
        ...queryPerformance.recommendations,
        cacheStats.hits < cacheStats.misses ? 'Consider increasing cache TTL' : null,
        coalescerStats.avgWaitTime > 1000 ? 'High coalescing wait time detected' : null
      ].filter(Boolean)
    };
  }
  
  async invalidateCache(mintAddress: string): Promise<void> {
    await this.cache.invalidateToken(mintAddress);
    logger.info(`Cache invalidated for token: ${mintAddress}`);
  }
  
  destroy(): void {
    // Clean up resources
    this.cache.destroy();
    this.cacheWarmer.stop();
    this.cacheStrategy.destroy();
    this.requestCoalescer.clear();
    this.analysisBatchProcessor.clear();
  }
}