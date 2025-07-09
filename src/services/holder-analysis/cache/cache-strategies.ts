import { logger } from '../../../core/logger';

export enum CacheStrategy {
  WRITE_THROUGH = 'write_through',
  WRITE_BEHIND = 'write_behind',
  CACHE_ASIDE = 'cache_aside',
  REFRESH_AHEAD = 'refresh_ahead'
}

export interface CacheConfig {
  strategy: CacheStrategy;
  ttl: number;
  refreshThreshold?: number; // For refresh-ahead strategy
  writeDelay?: number; // For write-behind strategy
}

export class CacheStrategyManager {
  private writeQueue = new Map<string, { data: any; timestamp: number }>();
  private refreshQueue = new Set<string>();
  private flushInterval: NodeJS.Timer | null = null;
  
  constructor(
    private cache: any,
    private dataFetcher: (key: string) => Promise<any>,
    private dataWriter?: (key: string, data: any) => Promise<void>
  ) {
    // Start write-behind flush interval if needed
    if (dataWriter) {
      this.flushInterval = setInterval(() => {
        this.flushWriteQueue();
      }, 5000); // Flush every 5 seconds
    }
  }
  
  async get(
    key: string,
    config: CacheConfig
  ): Promise<any> {
    switch (config.strategy) {
      case CacheStrategy.CACHE_ASIDE:
        return this.cacheAside(key, config);
      
      case CacheStrategy.REFRESH_AHEAD:
        return this.refreshAhead(key, config);
      
      default:
        return this.cacheAside(key, config);
    }
  }
  
  async set(
    key: string,
    data: any,
    config: CacheConfig
  ): Promise<void> {
    switch (config.strategy) {
      case CacheStrategy.WRITE_THROUGH:
        await this.writeThrough(key, data, config);
        break;
      
      case CacheStrategy.WRITE_BEHIND:
        await this.writeBehind(key, data, config);
        break;
      
      default:
        await this.cache.set(key, data);
    }
  }
  
  private async cacheAside(
    key: string,
    config: CacheConfig
  ): Promise<any> {
    // Check cache first
    const cached = await this.cache.get(key);
    if (cached !== null) {
      return cached;
    }
    
    // Cache miss - fetch from source
    try {
      const data = await this.dataFetcher(key);
      await this.cache.set(key, data);
      return data;
    } catch (error) {
      logger.error(`Failed to fetch data for key ${key}:`, error);
      throw error;
    }
  }
  
  private async refreshAhead(
    key: string,
    config: CacheConfig
  ): Promise<any> {
    const cached = await this.cache.get(key);
    
    if (cached !== null) {
      // Check if we should refresh
      const entry = await this.cache.getCacheEntry(key);
      if (entry) {
        const age = Date.now() - entry.cachedAt;
        const threshold = config.refreshThreshold || config.ttl * 0.8;
        
        if (age > threshold && !this.refreshQueue.has(key)) {
          // Trigger background refresh
          this.refreshQueue.add(key);
          this.backgroundRefresh(key, config);
        }
      }
      
      return cached;
    }
    
    // Cache miss
    return this.cacheAside(key, config);
  }
  
  private async backgroundRefresh(
    key: string,
    config: CacheConfig
  ): Promise<void> {
    try {
      const data = await this.dataFetcher(key);
      await this.cache.set(key, data);
      logger.debug(`Background refresh completed for key: ${key}`);
    } catch (error) {
      logger.error(`Background refresh failed for key ${key}:`, error);
    } finally {
      this.refreshQueue.delete(key);
    }
  }
  
  private async writeThrough(
    key: string,
    data: any,
    config: CacheConfig
  ): Promise<void> {
    // Write to both cache and backend
    await Promise.all([
      this.cache.set(key, data),
      this.dataWriter?.(key, data)
    ]);
  }
  
  private async writeBehind(
    key: string,
    data: any,
    config: CacheConfig
  ): Promise<void> {
    // Write to cache immediately
    await this.cache.set(key, data);
    
    // Queue write to backend
    this.writeQueue.set(key, {
      data,
      timestamp: Date.now()
    });
  }
  
  private async flushWriteQueue(): Promise<void> {
    if (this.writeQueue.size === 0) return;
    
    const writes: Promise<void>[] = [];
    const toRemove: string[] = [];
    
    for (const [key, entry] of this.writeQueue.entries()) {
      // Write if older than delay threshold or queue is getting large
      if (Date.now() - entry.timestamp > 2000 || this.writeQueue.size > 100) {
        toRemove.push(key);
        if (this.dataWriter) {
          writes.push(
            this.dataWriter(key, entry.data)
              .catch(error => {
                logger.error(`Write-behind failed for key ${key}:`, error);
              })
          );
        }
      }
    }
    
    // Remove written entries
    toRemove.forEach(key => this.writeQueue.delete(key));
    
    // Wait for all writes
    if (writes.length > 0) {
      await Promise.all(writes);
      logger.debug(`Flushed ${writes.length} write-behind entries`);
    }
  }
  
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    // Flush any pending writes
    this.flushWriteQueue();
  }
}

// Cache key builders
export class CacheKeyBuilder {
  static analysis(mintAddress: string): string {
    return `analysis:${mintAddress}`;
  }
  
  static holders(mintAddress: string): string {
    return `holders:${mintAddress}`;
  }
  
  static history(mintAddress: string, period: string): string {
    return `history:${mintAddress}:${period}`;
  }
  
  static snapshot(mintAddress: string): string {
    return `snapshot:${mintAddress}`;
  }
  
  static comparison(mintAddress: string, criteria?: string): string {
    return criteria 
      ? `comparison:${mintAddress}:${criteria}`
      : `comparison:${mintAddress}`;
  }
  
  static walletClass(walletAddress: string): string {
    return `wallet:${walletAddress}`;
  }
  
  static report(mintAddress: string, period: string): string {
    return `report:${mintAddress}:${period}`;
  }
  
  static leaderboard(category: string): string {
    return `leaderboard:${category}`;
  }
}