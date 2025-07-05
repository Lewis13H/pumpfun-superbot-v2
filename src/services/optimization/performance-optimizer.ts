/**
 * Performance Optimizer
 * Implements adaptive performance optimization strategies
 */

import { EventBus } from '../../core/event-bus';
import { Logger } from '../../core/logger';

export interface PerformanceConfig {
  // Batching configuration
  batching: {
    minBatchSize: number;
    maxBatchSize: number;
    batchTimeout: number;
    adaptiveEnabled: boolean;
  };
  
  // Caching configuration
  caching: {
    priceCache: {
      ttl: number;
      maxSize: number;
      preloadEnabled: boolean;
    };
    metadataCache: {
      ttl: number;
      maxSize: number;
      compressionEnabled: boolean;
    };
    poolStateCache: {
      ttl: number;
      maxSize: number;
      updateInterval: number;
    };
  };
  
  // Resource allocation
  resources: {
    maxConcurrentOperations: number;
    memoryLimit: number; // MB
    cpuThreshold: number; // percentage
  };
  
  // Monitoring
  monitoring: {
    sampleInterval: number;
    metricsRetention: number;
    alertThresholds: {
      latency: number;
      throughput: number;
      errorRate: number;
    };
  };
}

interface PerformanceMetrics {
  throughput: number;
  latency: {
    p50: number;
    p95: number;
    p99: number;
  };
  resourceUsage: {
    cpu: number;
    memory: number;
    connections: number;
  };
  cacheStats: {
    hitRate: number;
    evictions: number;
    size: number;
  };
  batchingStats: {
    avgBatchSize: number;
    batchesPerSecond: number;
    queueDepth: number;
  };
}

export class PerformanceOptimizer {
  private logger: Logger;
  private metrics: PerformanceMetrics;
  private historicalMetrics: PerformanceMetrics[] = [];
  private optimizationInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  
  // Adaptive parameters
  private currentBatchSize: number;
  private currentBatchTimeout: number;
  private cacheTTLMultiplier: number = 1;
  
  constructor(
    private eventBus: EventBus,
    private config: PerformanceConfig
  ) {
    this.logger = new Logger({ context: 'PerformanceOptimizer' });
    this.currentBatchSize = config.batching.minBatchSize;
    this.currentBatchTimeout = config.batching.batchTimeout;
    
    this.metrics = this.createEmptyMetrics();
    
    this.setupEventListeners();
    this.startOptimizationLoop();
    this.startMetricsCollection();
  }
  
  /**
   * Setup event listeners for performance tracking
   */
  private setupEventListeners(): void {
    // Track throughput
    this.eventBus.on('message:processed', () => {
      this.metrics.throughput++;
    });
    
    // Track latency
    this.eventBus.on('operation:complete', (data: { duration: number }) => {
      this.updateLatencyMetrics(data.duration);
    });
    
    // Track cache performance
    this.eventBus.on('cache:hit', () => {
      this.metrics.cacheStats.hitRate++;
    });
    
    this.eventBus.on('cache:miss', () => {
      this.metrics.cacheStats.hitRate = 
        this.metrics.cacheStats.hitRate / (this.metrics.cacheStats.hitRate + 1);
    });
    
    // Track batch processing
    this.eventBus.on('batch:processed', (data: { size: number }) => {
      this.updateBatchingMetrics(data.size);
    });
  }
  
  /**
   * Start optimization loop
   */
  private startOptimizationLoop(): void {
    this.optimizationInterval = setInterval(() => {
      this.performOptimization();
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoring.sampleInterval);
  }
  
  /**
   * Perform adaptive optimization based on current metrics
   */
  private performOptimization(): void {
    if (!this.config.batching.adaptiveEnabled) return;
    
    const avgMetrics = this.calculateAverageMetrics();
    
    // Optimize batching
    this.optimizeBatching(avgMetrics);
    
    // Optimize caching
    this.optimizeCaching(avgMetrics);
    
    // Optimize resource allocation
    this.optimizeResources(avgMetrics);
    
    // Emit optimization event
    this.eventBus.emit('optimization:performed', {
      batchSize: this.currentBatchSize,
      batchTimeout: this.currentBatchTimeout,
      cacheTTLMultiplier: this.cacheTTLMultiplier,
      metrics: avgMetrics
    });
    
    this.logger.info('Optimization performed', {
      batchSize: this.currentBatchSize,
      throughput: avgMetrics.throughput,
      latencyP95: avgMetrics.latency.p95
    });
  }
  
  /**
   * Optimize batching parameters
   */
  private optimizeBatching(metrics: PerformanceMetrics): void {
    const { minBatchSize, maxBatchSize } = this.config.batching;
    
    // If latency is high, reduce batch size
    if (metrics.latency.p95 > this.config.monitoring.alertThresholds.latency) {
      this.currentBatchSize = Math.max(
        minBatchSize,
        Math.floor(this.currentBatchSize * 0.8)
      );
      this.currentBatchTimeout = Math.max(
        50,
        Math.floor(this.currentBatchTimeout * 0.8)
      );
    }
    // If throughput is low and latency is good, increase batch size
    else if (
      metrics.throughput < this.config.monitoring.alertThresholds.throughput &&
      metrics.latency.p95 < this.config.monitoring.alertThresholds.latency * 0.7
    ) {
      this.currentBatchSize = Math.min(
        maxBatchSize,
        Math.floor(this.currentBatchSize * 1.2)
      );
      this.currentBatchTimeout = Math.min(
        1000,
        Math.floor(this.currentBatchTimeout * 1.1)
      );
    }
    
    // Emit new batching config
    this.eventBus.emit('batching:config-updated', {
      batchSize: this.currentBatchSize,
      batchTimeout: this.currentBatchTimeout
    });
  }
  
  /**
   * Optimize caching parameters
   */
  private optimizeCaching(metrics: PerformanceMetrics): void {
    // If cache hit rate is low, increase TTL
    if (metrics.cacheStats.hitRate < 0.7) {
      this.cacheTTLMultiplier = Math.min(2, this.cacheTTLMultiplier * 1.1);
    }
    // If memory usage is high, reduce TTL
    else if (metrics.resourceUsage.memory > this.config.resources.memoryLimit * 0.8) {
      this.cacheTTLMultiplier = Math.max(0.5, this.cacheTTLMultiplier * 0.9);
    }
    
    // Update cache configurations
    this.eventBus.emit('cache:config-updated', {
      priceCacheTTL: this.config.caching.priceCache.ttl * this.cacheTTLMultiplier,
      metadataCacheTTL: this.config.caching.metadataCache.ttl * this.cacheTTLMultiplier,
      poolStateCacheTTL: this.config.caching.poolStateCache.ttl * this.cacheTTLMultiplier
    });
  }
  
  /**
   * Optimize resource allocation
   */
  private optimizeResources(metrics: PerformanceMetrics): void {
    // If CPU usage is high, reduce concurrent operations
    if (metrics.resourceUsage.cpu > this.config.resources.cpuThreshold) {
      const newLimit = Math.max(
        10,
        Math.floor(this.config.resources.maxConcurrentOperations * 0.8)
      );
      
      this.eventBus.emit('resources:limit-updated', {
        maxConcurrentOperations: newLimit
      });
    }
  }
  
  /**
   * Collect current metrics
   */
  private collectMetrics(): void {
    // Get resource usage
    const usage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    this.metrics.resourceUsage = {
      cpu: this.calculateCPUPercentage(cpuUsage),
      memory: usage.heapUsed / 1024 / 1024, // MB
      connections: 0 // Would be populated from connection pool
    };
    
    // Store in history
    this.historicalMetrics.push({ ...this.metrics });
    
    // Keep only recent metrics
    const maxHistory = Math.floor(
      this.config.monitoring.metricsRetention / this.config.monitoring.sampleInterval
    );
    if (this.historicalMetrics.length > maxHistory) {
      this.historicalMetrics = this.historicalMetrics.slice(-maxHistory);
    }
    
    // Reset counters
    this.metrics.throughput = 0;
  }
  
  /**
   * Calculate average metrics over recent history
   */
  private calculateAverageMetrics(): PerformanceMetrics {
    if (this.historicalMetrics.length === 0) {
      return this.createEmptyMetrics();
    }
    
    const sum = this.historicalMetrics.reduce((acc, m) => ({
      throughput: acc.throughput + m.throughput,
      latency: {
        p50: acc.latency.p50 + m.latency.p50,
        p95: acc.latency.p95 + m.latency.p95,
        p99: acc.latency.p99 + m.latency.p99
      },
      resourceUsage: {
        cpu: acc.resourceUsage.cpu + m.resourceUsage.cpu,
        memory: acc.resourceUsage.memory + m.resourceUsage.memory,
        connections: acc.resourceUsage.connections + m.resourceUsage.connections
      },
      cacheStats: {
        hitRate: acc.cacheStats.hitRate + m.cacheStats.hitRate,
        evictions: acc.cacheStats.evictions + m.cacheStats.evictions,
        size: acc.cacheStats.size + m.cacheStats.size
      },
      batchingStats: {
        avgBatchSize: acc.batchingStats.avgBatchSize + m.batchingStats.avgBatchSize,
        batchesPerSecond: acc.batchingStats.batchesPerSecond + m.batchingStats.batchesPerSecond,
        queueDepth: acc.batchingStats.queueDepth + m.batchingStats.queueDepth
      }
    }), this.createEmptyMetrics());
    
    const count = this.historicalMetrics.length;
    
    return {
      throughput: sum.throughput / count,
      latency: {
        p50: sum.latency.p50 / count,
        p95: sum.latency.p95 / count,
        p99: sum.latency.p99 / count
      },
      resourceUsage: {
        cpu: sum.resourceUsage.cpu / count,
        memory: sum.resourceUsage.memory / count,
        connections: sum.resourceUsage.connections / count
      },
      cacheStats: {
        hitRate: sum.cacheStats.hitRate / count,
        evictions: sum.cacheStats.evictions / count,
        size: sum.cacheStats.size / count
      },
      batchingStats: {
        avgBatchSize: sum.batchingStats.avgBatchSize / count,
        batchesPerSecond: sum.batchingStats.batchesPerSecond / count,
        queueDepth: sum.batchingStats.queueDepth / count
      }
    };
  }
  
  /**
   * Update latency metrics with new sample
   */
  private updateLatencyMetrics(duration: number): void {
    // Simple percentile tracking (would use proper histogram in production)
    if (!this.metrics.latency.p50 || duration < this.metrics.latency.p50) {
      this.metrics.latency.p50 = duration;
    }
    if (!this.metrics.latency.p95 || duration > this.metrics.latency.p95 * 0.95) {
      this.metrics.latency.p95 = duration;
    }
    if (!this.metrics.latency.p99 || duration > this.metrics.latency.p99 * 0.99) {
      this.metrics.latency.p99 = duration;
    }
  }
  
  /**
   * Update batching metrics
   */
  private updateBatchingMetrics(batchSize: number): void {
    const current = this.metrics.batchingStats;
    current.avgBatchSize = (current.avgBatchSize + batchSize) / 2;
    current.batchesPerSecond++;
  }
  
  /**
   * Calculate CPU percentage
   */
  private calculateCPUPercentage(cpuUsage: NodeJS.CpuUsage): number {
    // Simplified CPU calculation
    const totalUsage = cpuUsage.user + cpuUsage.system;
    return (totalUsage / 1000000) * 100; // Convert to percentage
  }
  
  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): PerformanceMetrics {
    return {
      throughput: 0,
      latency: { p50: 0, p95: 0, p99: 0 },
      resourceUsage: { cpu: 0, memory: 0, connections: 0 },
      cacheStats: { hitRate: 0, evictions: 0, size: 0 },
      batchingStats: { avgBatchSize: 0, batchesPerSecond: 0, queueDepth: 0 }
    };
  }
  
  /**
   * Get current optimization parameters
   */
  public getOptimizationParams() {
    return {
      batching: {
        currentSize: this.currentBatchSize,
        currentTimeout: this.currentBatchTimeout
      },
      caching: {
        ttlMultiplier: this.cacheTTLMultiplier
      },
      metrics: this.calculateAverageMetrics()
    };
  }
  
  /**
   * Get performance report
   */
  public getPerformanceReport() {
    const current = this.calculateAverageMetrics();
    const baseline = this.historicalMetrics[0] || this.createEmptyMetrics();
    
    return {
      current,
      baseline,
      improvement: {
        throughput: baseline.throughput > 0 
          ? ((current.throughput - baseline.throughput) / baseline.throughput) * 100 
          : 0,
        latency: baseline.latency.p95 > 0
          ? ((baseline.latency.p95 - current.latency.p95) / baseline.latency.p95) * 100
          : 0,
        cacheHitRate: current.cacheStats.hitRate - baseline.cacheStats.hitRate
      }
    };
  }
  
  /**
   * Force optimization run
   */
  public forceOptimization(): void {
    this.logger.info('Forcing optimization run');
    this.performOptimization();
  }
  
  /**
   * Stop optimizer
   */
  public stop(): void {
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = null;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    this.logger.info('Performance optimizer stopped');
  }
}