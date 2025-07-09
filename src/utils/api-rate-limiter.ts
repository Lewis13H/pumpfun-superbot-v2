/**
 * Generic API Rate Limiter
 * Ensures API calls don't exceed rate limits
 */

import { Logger } from '../core/logger';

const logger = new Logger({ context: 'ApiRateLimiter' });

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
  name: string;
}

export class ApiRateLimiter {
  private requests: number[] = [];
  protected config: RateLimiterConfig;
  
  constructor(config: RateLimiterConfig) {
    this.config = config;
    
    // Clean up old entries periodically
    setInterval(() => this.cleanup(), 10000);
  }
  
  /**
   * Clean up old request timestamps
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.config.windowMs;
    this.requests = this.requests.filter(timestamp => timestamp > cutoff);
  }
  
  /**
   * Check if we can make a request
   */
  canRequest(): boolean {
    this.cleanup();
    return this.requests.length < this.config.maxRequests;
  }
  
  /**
   * Get time until next available slot (in ms)
   */
  getTimeUntilNextSlot(): number {
    this.cleanup();
    
    if (this.canRequest()) {
      return 0;
    }
    
    // Find the oldest request that's still in the window
    const oldestRequest = this.requests[0];
    if (!oldestRequest) {
      return 0;
    }
    
    const timeUntilExpiry = (oldestRequest + this.config.windowMs) - Date.now();
    return Math.max(0, timeUntilExpiry);
  }
  
  /**
   * Wait until we can make a request
   */
  async waitForSlot(): Promise<void> {
    while (!this.canRequest()) {
      const waitTime = this.getTimeUntilNextSlot();
      
      if (waitTime > 0) {
        logger.debug(`[${this.config.name}] Rate limit reached (${this.requests.length}/${this.config.maxRequests}). Waiting ${(waitTime / 1000).toFixed(1)}s`);
        await new Promise(resolve => setTimeout(resolve, Math.min(waitTime + 100, 1000)));
      }
    }
  }
  
  /**
   * Record a request
   */
  recordRequest(): void {
    this.requests.push(Date.now());
  }
  
  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot();
    this.recordRequest();
    return fn();
  }
  
  /**
   * Get current usage stats
   */
  getStats(): { current: number; max: number; percentage: number } {
    this.cleanup();
    const current = this.requests.length;
    const max = this.config.maxRequests;
    const percentage = (current / max) * 100;
    
    return { current, max, percentage };
  }
}

/**
 * Batch rate limiter for processing multiple items
 */
export class BatchRateLimiter extends ApiRateLimiter {
  private batchSize: number;
  private batchDelayMs: number;
  
  constructor(config: RateLimiterConfig & { batchSize?: number; batchDelayMs?: number }) {
    super(config);
    this.batchSize = config.batchSize || 10;
    this.batchDelayMs = config.batchDelayMs || 1000;
  }
  
  /**
   * Process items in batches with rate limiting
   */
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: {
      onProgress?: (processed: number, total: number) => void;
      onError?: (item: T, error: any) => void;
    } = {}
  ): Promise<R[]> {
    const results: R[] = [];
    const errors: Array<{ item: T; error: any }> = [];
    
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      
      // Process batch items in parallel
      const batchPromises = batch.map(async (item) => {
        try {
          const result = await this.execute(() => processor(item));
          return { success: true as const, result };
        } catch (error) {
          logger.error(`[${this.config.name}] Error processing item:`, error);
          if (options.onError) {
            options.onError(item, error);
          }
          errors.push({ item, error });
          return { success: false as const, error };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Collect successful results
      batchResults.forEach(res => {
        if (res.success && 'result' in res) {
          results.push(res.result);
        }
      });
      
      // Report progress
      if (options.onProgress) {
        options.onProgress(Math.min(i + this.batchSize, items.length), items.length);
      }
      
      // Add delay between batches (except for last batch)
      if (i + this.batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, this.batchDelayMs));
      }
    }
    
    if (errors.length > 0) {
      logger.warn(`[${this.config.name}] Batch processing completed with ${errors.length} errors`);
    }
    
    return results;
  }
}

// Pre-configured rate limiters for common APIs
export const API_RATE_LIMITERS = {
  helius: new ApiRateLimiter({
    name: 'Helius',
    maxRequests: 4, // Further reduced to 4 requests per second for safety margin
    windowMs: 1000
  }),
  
  shyft: new ApiRateLimiter({
    name: 'Shyft',
    maxRequests: 10, // Conservative limit
    windowMs: 1000
  }),
  
  heliusBatch: new BatchRateLimiter({
    name: 'HeliusBatch',
    maxRequests: 5, // Reduced from 10 to 5
    windowMs: 1000,
    batchSize: 3, // Reduced from 5 to 3
    batchDelayMs: 1000 // Increased from 500ms to 1000ms
  }),
  
  shyftBatch: new BatchRateLimiter({
    name: 'ShyftBatch',
    maxRequests: 10,
    windowMs: 1000,
    batchSize: 5,
    batchDelayMs: 500
  })
};