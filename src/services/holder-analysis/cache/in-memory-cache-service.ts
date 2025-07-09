import { logger } from '../../../core/logger';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number;
  hits: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

export class InMemoryCacheService {
  private cache = new Map<string, CacheEntry<any>>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0
  };
  
  private readonly TTL = {
    ANALYSIS: 3600 * 1000,      // 1 hour
    HOLDERS: 7200 * 1000,       // 2 hours
    HISTORY: 86400 * 1000,      // 24 hours
    CLASSIFICATION: 604800 * 1000, // 7 days
    SNAPSHOT: 300 * 1000,       // 5 minutes
    COMPARISON: 1800 * 1000     // 30 minutes
  };
  
  private readonly MAX_CACHE_SIZE = 1000; // Maximum number of entries
  private cleanupInterval: NodeJS.Timer;
  
  constructor() {
    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Run every minute
  }
  
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Update stats
    entry.hits++;
    this.stats.hits++;
    
    return entry.data as T;
  }
  
  async set<T>(key: string, data: T, ttlType: keyof typeof this.TTL = 'ANALYSIS'): Promise<void> {
    // Check cache size limit
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictLRU();
    }
    
    const entry: CacheEntry<T> = {
      data,
      cachedAt: Date.now(),
      ttl: this.TTL[ttlType],
      hits: 0
    };
    
    this.cache.set(key, entry);
    this.stats.size = this.cache.size;
  }
  
  async getAnalysis(mintAddress: string): Promise<any | null> {
    return this.get(`analysis:${mintAddress}`);
  }
  
  async setAnalysis(mintAddress: string, analysis: any): Promise<void> {
    await this.set(`analysis:${mintAddress}`, analysis, 'ANALYSIS');
  }
  
  async getHolders(mintAddress: string): Promise<any | null> {
    return this.get(`holders:${mintAddress}`);
  }
  
  async setHolders(mintAddress: string, holders: any): Promise<void> {
    await this.set(`holders:${mintAddress}`, holders, 'HOLDERS');
  }
  
  async getHistory(mintAddress: string, period: string): Promise<any | null> {
    return this.get(`history:${mintAddress}:${period}`);
  }
  
  async setHistory(mintAddress: string, period: string, history: any): Promise<void> {
    await this.set(`history:${mintAddress}:${period}`, history, 'HISTORY');
  }
  
  async getSnapshot(mintAddress: string): Promise<any | null> {
    return this.get(`snapshot:${mintAddress}`);
  }
  
  async setSnapshot(mintAddress: string, snapshot: any): Promise<void> {
    await this.set(`snapshot:${mintAddress}`, snapshot, 'SNAPSHOT');
  }
  
  async getComparison(mintAddress: string): Promise<any | null> {
    return this.get(`comparison:${mintAddress}`);
  }
  
  async setComparison(mintAddress: string, comparison: any): Promise<void> {
    await this.set(`comparison:${mintAddress}`, comparison, 'COMPARISON');
  }
  
  async invalidate(pattern: string): Promise<void> {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      logger.debug(`Invalidated ${count} cache entries matching pattern: ${pattern}`);
    }
  }
  
  async invalidateToken(mintAddress: string): Promise<void> {
    await this.invalidate(mintAddress);
  }
  
  async warmCache(mintAddresses: string[]): Promise<void> {
    // In a real implementation, this would trigger background fetching
    // For now, just log the intent
    logger.info(`Cache warming requested for ${mintAddresses.length} tokens`);
  }
  
  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.cache.size
    };
  }
  
  getCacheInfo(): {
    size: number;
    maxSize: number;
    hitRate: number;
    entries: Array<{ key: string; age: number; hits: number }>;
  } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: Date.now() - entry.cachedAt,
      hits: entry.hits
    }));
    
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      hitRate,
      entries: entries.sort((a, b) => b.hits - a.hits).slice(0, 10) // Top 10 by hits
    };
  }
  
  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.cachedAt > entry.ttl;
  }
  
  private evictLRU(): void {
    // Find least recently used entry (lowest hits)
    let lruKey: string | null = null;
    let lowestHits = Infinity;
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      const score = entry.hits * 1000 + (Date.now() - entry.cachedAt);
      if (score < lowestHits) {
        lowestHits = score;
        lruKey = key;
      }
    }
    
    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
      logger.debug(`Evicted cache entry: ${lruKey}`);
    }
  }
  
  private cleanup(): void {
    let removed = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired cache entries`);
    }
    
    this.stats.size = this.cache.size;
  }
  
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}