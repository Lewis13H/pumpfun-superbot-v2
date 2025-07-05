/**
 * Adaptive Cache Manager
 * Implements intelligent caching strategies for different data types
 */

import { EventBus } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  size: number;
  hits: number;
  misses: number;
  lastAccess: number;
  created: number;
  ttl: number;
  compressed?: boolean;
}

export interface CacheConfig {
  maxSize: number; // bytes
  defaultTTL: number; // ms
  compressionThreshold: number; // bytes
  compressionEnabled: boolean;
  evictionPolicy: 'lru' | 'lfu' | 'fifo';
  adaptiveTTL: boolean;
  preloadEnabled: boolean;
}

export interface CacheStats {
  size: number;
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  compressionRatio: number;
  avgTTL: number;
}

export class AdaptiveCacheManager<T = any> {
  private logger: Logger;
  private cache: Map<string, CacheEntry<T>> = new Map();
  private accessOrder: string[] = []; // For LRU
  private stats: CacheStats;
  private currentSize = 0;
  private ttlMultiplier = 1;
  
  constructor(
    private name: string,
    private eventBus: EventBus,
    private config: CacheConfig
  ) {
    this.logger = new Logger({ context: `AdaptiveCache:${name}` });
    
    this.stats = {
      size: 0,
      entries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      evictions: 0,
      compressionRatio: 1,
      avgTTL: config.defaultTTL
    };
    
    this.setupEventListeners();
    this.startCleanupInterval();
  }
  
  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for cache configuration updates
    this.eventBus.on('cache:config-updated', (data: any) => {
      const ttlKey = `${this.name}CacheTTL`;
      if (data[ttlKey]) {
        this.ttlMultiplier = data[ttlKey] / this.config.defaultTTL;
        this.logger.debug('TTL multiplier updated', { multiplier: this.ttlMultiplier });
      }
    });
  }
  
  /**
   * Start periodic cleanup
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
  }
  
  /**
   * Get item from cache
   */
  public async get(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      this.eventBus.emit('cache:miss', { cache: this.name, key });
      return null;
    }
    
    // Check TTL
    if (Date.now() > entry.created + entry.ttl) {
      this.remove(key);
      this.stats.misses++;
      this.updateHitRate();
      this.eventBus.emit('cache:miss', { cache: this.name, key, reason: 'expired' });
      return null;
    }
    
    // Update access info
    entry.hits++;
    entry.lastAccess = Date.now();
    this.updateAccessOrder(key);
    
    this.stats.hits++;
    this.updateHitRate();
    this.eventBus.emit('cache:hit', { cache: this.name, key });
    
    // Decompress if needed
    if (entry.compressed && entry.value) {
      try {
        const decompressed = await gunzip(entry.value as any);
        return JSON.parse(decompressed.toString());
      } catch (error) {
        this.logger.error('Failed to decompress cache entry', error as Error);
        return null;
      }
    }
    
    return entry.value;
  }
  
  /**
   * Set item in cache
   */
  public async set(key: string, value: T, ttl?: number): Promise<void> {
    // Calculate size
    let size = this.calculateSize(value);
    let compressed = false;
    let storedValue: any = value;
    
    // Compress if needed
    if (this.config.compressionEnabled && size > this.config.compressionThreshold) {
      try {
        const compressedData = await gzip(JSON.stringify(value));
        const compressedSize = compressedData.length;
        
        if (compressedSize < size * 0.8) { // Only use if >20% compression
          storedValue = compressedData;
          size = compressedSize;
          compressed = true;
          this.stats.compressionRatio = compressedSize / size;
        }
      } catch (error) {
        this.logger.error('Failed to compress value', error as Error);
      }
    }
    
    // Check if we need to evict
    while (this.currentSize + size > this.config.maxSize && this.cache.size > 0) {
      this.evictOne();
    }
    
    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.remove(key);
    }
    
    // Calculate adaptive TTL
    const effectiveTTL = ttl || (this.config.defaultTTL * this.ttlMultiplier);
    
    // Create entry
    const entry: CacheEntry<T> = {
      key,
      value: storedValue,
      size,
      hits: 0,
      misses: 0,
      lastAccess: Date.now(),
      created: Date.now(),
      ttl: effectiveTTL,
      compressed
    };
    
    this.cache.set(key, entry);
    this.currentSize += size;
    this.updateAccessOrder(key);
    
    // Update stats
    this.stats.entries = this.cache.size;
    this.stats.size = this.currentSize;
    this.updateAvgTTL();
    
    this.eventBus.emit('cache:set', { 
      cache: this.name, 
      key, 
      size, 
      compressed,
      ttl: effectiveTTL 
    });
  }
  
  /**
   * Remove item from cache
   */
  public remove(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    this.cache.delete(key);
    this.currentSize -= entry.size;
    
    // Remove from access order
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    
    // Update stats
    this.stats.entries = this.cache.size;
    this.stats.size = this.currentSize;
    
    return true;
  }
  
  /**
   * Clear entire cache
   */
  public clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.currentSize = 0;
    
    this.stats = {
      ...this.stats,
      size: 0,
      entries: 0,
      evictions: 0
    };
    
    this.logger.info('Cache cleared');
  }
  
  /**
   * Evict one entry based on policy
   */
  private evictOne(): void {
    let keyToEvict: string | null = null;
    
    switch (this.config.evictionPolicy) {
      case 'lru':
        keyToEvict = this.accessOrder[0];
        break;
        
      case 'lfu':
        let minHits = Infinity;
        for (const [key, entry] of this.cache) {
          if (entry.hits < minHits) {
            minHits = entry.hits;
            keyToEvict = key;
          }
        }
        break;
        
      case 'fifo':
        let oldest = Infinity;
        for (const [key, entry] of this.cache) {
          if (entry.created < oldest) {
            oldest = entry.created;
            keyToEvict = key;
          }
        }
        break;
    }
    
    if (keyToEvict) {
      this.remove(keyToEvict);
      this.stats.evictions++;
      this.eventBus.emit('cache:eviction', { 
        cache: this.name, 
        key: keyToEvict,
        policy: this.config.evictionPolicy 
      });
    }
  }
  
  /**
   * Update access order for LRU
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }
  
  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.cache) {
      if (now > entry.created + entry.ttl) {
        this.remove(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} expired entries`);
    }
  }
  
  /**
   * Calculate size of value
   */
  private calculateSize(value: any): number {
    if (typeof value === 'string') {
      return value.length * 2; // Rough estimate for UTF-16
    } else if (Buffer.isBuffer(value)) {
      return value.length;
    } else {
      return JSON.stringify(value).length * 2;
    }
  }
  
  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
  
  /**
   * Update average TTL
   */
  private updateAvgTTL(): void {
    if (this.cache.size === 0) {
      this.stats.avgTTL = this.config.defaultTTL;
      return;
    }
    
    let totalTTL = 0;
    for (const entry of this.cache.values()) {
      totalTTL += entry.ttl;
    }
    
    this.stats.avgTTL = totalTTL / this.cache.size;
  }
  
  /**
   * Get cache statistics
   */
  public getStats(): CacheStats {
    return { ...this.stats };
  }
  
  /**
   * Get cache entries for debugging
   */
  public getEntries(): Array<{
    key: string;
    size: number;
    hits: number;
    age: number;
    compressed: boolean;
  }> {
    const now = Date.now();
    return Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      size: entry.size,
      hits: entry.hits,
      age: now - entry.created,
      compressed: entry.compressed || false
    }));
  }
  
  /**
   * Preload cache with predicted hot items
   */
  public async preload(items: Array<{ key: string; value: T }>): Promise<void> {
    if (!this.config.preloadEnabled) return;
    
    this.logger.info(`Preloading ${items.length} items`);
    
    for (const item of items) {
      await this.set(item.key, item.value);
    }
  }
  
  /**
   * Optimize cache based on usage patterns
   */
  public optimize(): void {
    if (!this.config.adaptiveTTL) return;
    
    // Analyze usage patterns
    const entries = Array.from(this.cache.values());
    if (entries.length === 0) return;
    
    // Calculate average hit rate per age
    const ageGroups: { [age: string]: { hits: number; count: number } } = {};
    const now = Date.now();
    
    for (const entry of entries) {
      const ageMinutes = Math.floor((now - entry.created) / 60000);
      const ageGroup = `${ageMinutes}`;
      
      if (!ageGroups[ageGroup]) {
        ageGroups[ageGroup] = { hits: 0, count: 0 };
      }
      
      ageGroups[ageGroup].hits += entry.hits;
      ageGroups[ageGroup].count++;
    }
    
    // Find optimal TTL based on hit rate decay
    let optimalTTL = this.config.defaultTTL;
    let previousHitRate = 0;
    
    for (let age = 0; age < 60; age++) {
      const group = ageGroups[age.toString()];
      if (group) {
        const hitRate = group.hits / group.count;
        
        // If hit rate drops significantly, that's our optimal TTL
        if (previousHitRate > 0 && hitRate < previousHitRate * 0.5) {
          optimalTTL = age * 60000;
          break;
        }
        
        previousHitRate = hitRate;
      }
    }
    
    // Update TTL multiplier
    const newMultiplier = optimalTTL / this.config.defaultTTL;
    if (Math.abs(newMultiplier - this.ttlMultiplier) > 0.1) {
      this.ttlMultiplier = newMultiplier;
      this.logger.info('Cache TTL optimized', {
        cache: this.name,
        optimalTTL,
        multiplier: this.ttlMultiplier
      });
    }
  }
}