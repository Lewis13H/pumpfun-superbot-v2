import { logger } from '../../../core/logger';

export interface CoalescerStats {
  totalRequests: number;
  coalescedRequests: number;
  activeRequests: number;
  avgWaitTime: number;
}

export class RequestCoalescer {
  private pendingRequests = new Map<string, {
    promise: Promise<any>;
    requestCount: number;
    startTime: number;
  }>();
  
  private stats: CoalescerStats = {
    totalRequests: 0,
    coalescedRequests: 0,
    activeRequests: 0,
    avgWaitTime: 0
  };
  
  private waitTimes: number[] = [];
  
  async coalesce<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: {
      ttl?: number; // How long to keep the promise active
      maxCoalesce?: number; // Max number of requests to coalesce
    }
  ): Promise<T> {
    this.stats.totalRequests++;
    
    // Check if request is already in flight
    const pending = this.pendingRequests.get(key);
    if (pending) {
      // Update request count
      pending.requestCount++;
      this.stats.coalescedRequests++;
      
      // Check if we've hit max coalesce limit
      if (options?.maxCoalesce && pending.requestCount >= options.maxCoalesce) {
        logger.debug(`Max coalesce limit reached for key: ${key}`);
      }
      
      // Track wait time
      const waitTime = Date.now() - pending.startTime;
      this.waitTimes.push(waitTime);
      this.updateAvgWaitTime();
      
      return pending.promise as Promise<T>;
    }
    
    // Create new request
    this.stats.activeRequests++;
    const startTime = Date.now();
    
    const promise = fetcher()
      .finally(() => {
        // Clean up after completion
        const entry = this.pendingRequests.get(key);
        if (entry) {
          const duration = Date.now() - entry.startTime;
          logger.debug(`Request completed for ${key}: ${entry.requestCount} coalesced, ${duration}ms`);
        }
        
        this.pendingRequests.delete(key);
        this.stats.activeRequests--;
        
        // If TTL is specified, keep the promise cached for a while
        if (options?.ttl && options.ttl > 0) {
          setTimeout(() => {
            this.pendingRequests.delete(key);
          }, options.ttl);
        }
      });
    
    this.pendingRequests.set(key, {
      promise,
      requestCount: 1,
      startTime
    });
    
    return promise;
  }
  
  async coalesceMultiple<T>(
    requests: Array<{ key: string; fetcher: () => Promise<T> }>,
    options?: {
      parallel?: boolean;
      maxConcurrency?: number;
    }
  ): Promise<T[]> {
    if (options?.parallel === false) {
      // Sequential processing
      const results: T[] = [];
      
      for (const request of requests) {
        const result = await this.coalesce(request.key, request.fetcher);
        results.push(result);
      }
      
      return results;
    }
    
    // Parallel processing with optional concurrency limit
    if (options?.maxConcurrency) {
      const results: T[] = [];
      
      for (let i = 0; i < requests.length; i += options.maxConcurrency) {
        const batch = requests.slice(i, i + options.maxConcurrency);
        const batchResults = await Promise.all(
          batch.map(req => this.coalesce(req.key, req.fetcher))
        );
        results.push(...batchResults);
      }
      
      return results;
    }
    
    // Full parallel processing
    return Promise.all(
      requests.map(req => this.coalesce(req.key, req.fetcher))
    );
  }
  
  private updateAvgWaitTime(): void {
    if (this.waitTimes.length === 0) {
      this.stats.avgWaitTime = 0;
      return;
    }
    
    // Keep only last 100 wait times
    if (this.waitTimes.length > 100) {
      this.waitTimes = this.waitTimes.slice(-100);
    }
    
    const sum = this.waitTimes.reduce((a, b) => a + b, 0);
    this.stats.avgWaitTime = sum / this.waitTimes.length;
  }
  
  getStats(): CoalescerStats {
    return { ...this.stats };
  }
  
  getActiveRequests(): Array<{ key: string; requestCount: number; duration: number }> {
    const active: Array<{ key: string; requestCount: number; duration: number }> = [];
    
    for (const [key, entry] of this.pendingRequests.entries()) {
      active.push({
        key,
        requestCount: entry.requestCount,
        duration: Date.now() - entry.startTime
      });
    }
    
    return active.sort((a, b) => b.requestCount - a.requestCount);
  }
  
  clear(): void {
    this.pendingRequests.clear();
    this.stats = {
      totalRequests: 0,
      coalescedRequests: 0,
      activeRequests: 0,
      avgWaitTime: 0
    };
    this.waitTimes = [];
  }
}

// Specialized coalescers

export class HolderDataCoalescer extends RequestCoalescer {
  constructor(private dataFetcher: any) {
    super();
  }
  
  async fetchHolders(mintAddress: string): Promise<any> {
    return this.coalesce(
      `holders:${mintAddress}`,
      () => this.dataFetcher.fetchHolders(mintAddress),
      { ttl: 60000 } // Cache for 1 minute
    );
  }
}

export class AnalysisCoalescer extends RequestCoalescer {
  constructor(private analysisService: any) {
    super();
  }
  
  async analyzeToken(mintAddress: string): Promise<any> {
    return this.coalesce(
      `analysis:${mintAddress}`,
      () => this.analysisService.analyzeToken(mintAddress),
      { ttl: 300000 } // Cache for 5 minutes
    );
  }
}

export class ClassificationCoalescer extends RequestCoalescer {
  constructor(private classificationService: any) {
    super();
  }
  
  async classifyWallet(walletAddress: string): Promise<any> {
    return this.coalesce(
      `wallet:${walletAddress}`,
      () => this.classificationService.classifyWallet(walletAddress),
      { ttl: 3600000 } // Cache for 1 hour
    );
  }
}