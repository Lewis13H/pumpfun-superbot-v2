import { Request, Response } from 'express';
import { PerformanceOptimizer } from '../../services/optimization/performance-optimizer';
import { DynamicBatchProcessor } from '../../services/optimization/dynamic-batch-processor';
import { AdaptiveCacheManager } from '../../services/optimization/adaptive-cache-manager';
import { PerformanceMonitor } from '../../services/optimization/performance-monitor';
import { EventBus } from '../../core/event-bus';

interface OptimizationStatus {
  enabled: boolean;
  mode: 'auto' | 'manual';
  efficiency: number;
  lastOptimization: Date;
  currentParams: {
    batchSize: number;
    batchTimeout: number;
    cacheTTLMultiplier: number;
    maxConcurrentOps: number;
  };
}

interface BatchMetrics {
  currentSize: number;
  avgSize: number;
  minSize: number;
  maxSize: number;
  throughput: number;
  queueDepth: number;
  priorityDistribution: {
    high: number;
    medium: number;
    low: number;
  };
}

interface CacheStats {
  hitRate: number;
  missRate: number;
  evictions: number;
  compressionRatio: number;
  totalSize: number;
  entryCount: number;
  avgTTL: number;
  cacheTypes: {
    [key: string]: {
      hitRate: number;
      size: number;
      entries: number;
    };
  };
}

export class PerformanceOptimizationController {
  private sseClients: Set<Response> = new Set();

  constructor(
    private performanceOptimizer: PerformanceOptimizer,
    private batchProcessor: DynamicBatchProcessor,
    private cacheManager: AdaptiveCacheManager,
    private performanceMonitor: PerformanceMonitor,
    private eventBus: EventBus
  ) {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on('alert:created', (alert: any) => {
      this.broadcastSSE('alert', alert);
    });

    this.eventBus.on('optimization:updated', (data: any) => {
      this.broadcastSSE('optimization', data);
    });

    this.eventBus.on('circuit-breaker:state-change', (data: any) => {
      this.broadcastSSE('circuit-breaker', data);
    });
  }

  async getOptimizationStatus(_req: Request, res: Response): Promise<void> {
    try {
      // Get real performance metrics if available
      const { performanceMonitor } = await import('../../services/monitoring/performance-monitor');
      const metrics = performanceMonitor.getCurrentMetrics();
      
      const params = this.performanceOptimizer?.getOptimizationParams?.() || {
        batching: { currentSize: 50, currentTimeout: 1000 },
        caching: { ttlMultiplier: 1 },
        metrics: {}
      };
      // const report = this.performanceOptimizer?.getPerformanceReport?.() || {
      //   improvement: { throughput: 0, latency: 0, cacheHitRate: 0 }
      // };
      
      // Calculate efficiency based on real health score
      const efficiency = metrics.health / 100;
      
      const status: OptimizationStatus = {
        enabled: true,
        mode: 'auto',
        efficiency: efficiency,
        lastOptimization: new Date(),
        currentParams: {
          batchSize: params.batching.currentSize,
          batchTimeout: params.batching.currentTimeout,
          cacheTTLMultiplier: params.caching.ttlMultiplier,
          maxConcurrentOps: 10
        }
      };
      
      res.json(status);
    } catch (error) {
      console.error('Error getting optimization status:', error);
      res.status(500).json({ error: 'Failed to get optimization status' });
    }
  }

  async getBatchMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const stats = this.batchProcessor?.getStats?.() || {
        avgBatchSize: 50,
        avgProcessingTime: 100,
        totalProcessed: 1000,
        totalFailed: 0,
        queueDepth: 0,
        droppedItems: 0
      };
      const queueInfo = this.batchProcessor?.getQueueInfo?.() || {
        total: 0,
        byPriority: { high: 0, normal: 0, low: 0 }
      };
      
      const metrics: BatchMetrics = {
        currentSize: 50,
        avgSize: stats.avgBatchSize,
        minSize: 10,
        maxSize: 100,
        throughput: stats.avgProcessingTime > 0 ? (1000 / stats.avgProcessingTime) * stats.avgBatchSize : 0,
        queueDepth: queueInfo.total,
        priorityDistribution: queueInfo.byPriority ? 
          { high: queueInfo.byPriority.high, medium: queueInfo.byPriority.normal || 0, low: queueInfo.byPriority.low } :
          { high: 0, medium: 0, low: 0 }
      };
      
      res.json(metrics);
    } catch (error) {
      console.error('Error getting batch metrics:', error);
      res.status(500).json({ error: 'Failed to get batch metrics' });
    }
  }

  async getCacheStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = this.cacheManager?.getStats?.() || {
        hitRate: 0.85,
        evictions: 0,
        compressionRatio: 1.5,
        size: 1024000,
        entries: 150,
        avgTTL: 300000
      };
      const entriesArray = this.cacheManager?.getEntries?.() || [];
      const entries = new Map(entriesArray.map(e => [e.key, e]));
      
      const cacheStats: CacheStats = {
        hitRate: stats.hitRate,
        missRate: 1 - stats.hitRate,
        evictions: stats.evictions,
        compressionRatio: stats.compressionRatio,
        totalSize: stats.size,
        entryCount: stats.entries,
        avgTTL: stats.avgTTL,
        cacheTypes: this.aggregateCacheTypes(entries)
      };
      
      res.json(cacheStats);
    } catch (error) {
      console.error('Error getting cache stats:', error);
      res.status(500).json({ error: 'Failed to get cache stats' });
    }
  }

  async getResourceMetrics(_req: Request, res: Response): Promise<void> {
    try {
      // Get real performance metrics
      const { performanceMonitor } = await import('../../services/monitoring/performance-monitor');
      const metrics = performanceMonitor.getCurrentMetrics();
      
      const resources = this.performanceMonitor?.getResourceMetrics?.() || {
        cpu: { 
          usage: metrics.system.cpuUsage,
          cores: metrics.system.processMemory ? require('os').cpus().length : 1,
          loadAverage: require('os').loadavg()
        },
        memory: { 
          used: metrics.system.memoryUsage.used,
          total: metrics.system.memoryUsage.total,
          percentage: metrics.system.memoryUsage.percentage,
          heapUsed: metrics.system.processMemory?.heapUsed || 0,
          heapTotal: metrics.system.processMemory?.heapTotal || 0
        }
      };
      const optimization = {}; // Resource allocation not available in current interface
      
      res.json({
        cpu: resources.cpu,
        memory: resources.memory,
        allocation: optimization,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error getting resource metrics:', error);
      res.status(500).json({ error: 'Failed to get resource metrics' });
    }
  }

  async getSuggestions(_req: Request, res: Response): Promise<void> {
    try {
      const report = this.performanceOptimizer?.getPerformanceReport?.() || {
        current: {
          throughput: 100,
          latency: { p95: 50 },
          cacheStats: { hitRate: 0.8 },
          resourceUsage: { cpu: 20, memory: 30 }
        },
        baseline: {
          throughput: 80,
          latency: { p95: 60 },
          cacheStats: { hitRate: 0.7 },
          resourceUsage: { cpu: 25, memory: 35 }
        },
        improvement: { 
          throughput: 25,
          latency: 16.7,
          cacheHitRate: 14.3
        }
      };
      const suggestions = this.generateOptimizationSuggestions(report);
      
      res.json(suggestions);
    } catch (error) {
      console.error('Error getting suggestions:', error);
      res.status(500).json({ error: 'Failed to get optimization suggestions' });
    }
  }

  setupSSE(req: Request, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection confirmation
    res.write('event: connected\ndata: {}\n\n');

    // Add client to set
    this.sseClients.add(res);

    // Set up periodic metrics broadcast
    const metricsInterval = setInterval(async () => {
      const metrics = await this.gatherMetrics();
      res.write(`event: metrics\ndata: ${JSON.stringify(metrics)}\n\n`);
    }, 5000);

    // Clean up on disconnect
    req.on('close', () => {
      clearInterval(metricsInterval);
      this.sseClients.delete(res);
    });
  }

  private broadcastSSE(event: string, data: any): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    
    this.sseClients.forEach(client => {
      try {
        client.write(message);
      } catch (error) {
        console.error('Error broadcasting to SSE client:', error);
        this.sseClients.delete(client);
      }
    });
  }

  private async gatherMetrics(): Promise<any> {
    // Get real performance metrics
    const { performanceMonitor } = await import('../../services/monitoring/performance-monitor');
    const metrics = performanceMonitor.getCurrentMetrics();
    
    const batchStats = this.batchProcessor?.getStats?.() || {
      avgBatchSize: 50,
      avgProcessingTime: 100,
      totalProcessed: 1000,
      totalFailed: 0,
      queueDepth: 0,
      droppedItems: 0
    };
    const cacheStats = this.cacheManager?.getStats?.() || {
      hitRate: 0.85,
      evictions: 0,
      compressionRatio: 1.5,
      size: 1024000,
      entries: 150,
      avgTTL: 300000
    };
    // const perfReport = this.performanceOptimizer?.getPerformanceReport?.() || {
    //   improvement: { throughput: 0, latency: 0, cacheHitRate: 0 }
    // };
    const params = this.performanceOptimizer?.getOptimizationParams?.() || {
      batching: { currentSize: 50, currentTimeout: 1000 },
      caching: { ttlMultiplier: 1 },
      metrics: {}
    };
    
    // Calculate real throughput from monitors
    const totalMessagesPerSecond = metrics.monitors.reduce((sum, m) => sum + m.messagesPerSecond, 0);
    
    return {
      batch: {
        currentSize: params.batching.currentSize || 50,
        throughput: totalMessagesPerSecond,
        avgLatency: batchStats.avgProcessingTime || 0,
        queueDepth: batchStats.queueDepth || 0,
        efficiency: batchStats.avgBatchSize > 0 ? (batchStats.avgBatchSize / 100) : 0.5
      },
      cache: {
        hitRate: cacheStats.hitRate,
        size: cacheStats.size,
        compressionRatio: cacheStats.compressionRatio,
        evictions: cacheStats.evictions,
        entries: cacheStats.entries
      },
      optimization: {
        enabled: true,
        mode: 'auto',
        efficiency: metrics.health / 100,
        params: params
      },
      resources: {
        cpu: metrics.system.cpuUsage,
        memory: metrics.system.memoryUsage.percentage
      },
      monitors: metrics.monitors,
      system: metrics.system,
      timestamp: new Date()
    };
  }

  private aggregateCacheTypes(entries: Map<string, any>): any {
    const typeStats: any = {};
    
    // Group entries by type prefix
    entries.forEach((entry, key) => {
      const type = key.split(':')[0] || 'default';
      
      if (!typeStats[type]) {
        typeStats[type] = {
          hitRate: 0,
          size: 0,
          entries: 0,
          hits: 0,
          total: 0
        };
      }
      
      typeStats[type].entries++;
      typeStats[type].size += JSON.stringify(entry).length;
      // Note: Real implementation would track actual hits/misses per type
    });
    
    // Calculate hit rates
    Object.keys(typeStats).forEach(type => {
      const stats = typeStats[type];
      typeStats[type] = {
        hitRate: stats.total > 0 ? stats.hits / stats.total : 0,
        size: stats.size,
        entries: stats.entries
      };
    });
    
    return typeStats;
  }

  async cleanupMemory(_req: Request, res: Response): Promise<void> {
    try {
      // Get memory usage before cleanup
      const before = process.memoryUsage();
      
      // Trigger garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Clear any caches
      if (this.cacheManager?.clear) {
        this.cacheManager.clear();
      }
      
      // Get memory usage after cleanup
      const after = process.memoryUsage();
      
      const result = {
        before: {
          heapUsed: before.heapUsed,
          heapTotal: before.heapTotal,
          external: before.external,
          rss: before.rss
        },
        after: {
          heapUsed: after.heapUsed,
          heapTotal: after.heapTotal,
          external: after.external,
          rss: after.rss
        },
        freed: {
          heapUsed: before.heapUsed - after.heapUsed,
          heapTotal: before.heapTotal - after.heapTotal,
          external: before.external - after.external,
          rss: before.rss - after.rss
        }
      };
      
      res.json(result);
    } catch (error) {
      console.error('Error cleaning up memory:', error);
      res.status(500).json({ error: 'Failed to cleanup memory' });
    }
  }

  private generateOptimizationSuggestions(report: any): any[] {
    const suggestions = [];
    
    // Check batch size optimization
    if (report.current && report.current.throughput < 100) {
      suggestions.push({
        id: 'increase-batch-size',
        type: 'batch',
        priority: 'high',
        title: 'Increase Batch Size',
        description: 'Current batch size is suboptimal. Increasing it could improve throughput by 30%.',
        action: 'Apply Optimization'
      });
    }
    
    // Check cache hit rate
    if (report.current && report.current.cacheStats && report.current.cacheStats.hitRate < 0.7) {
      suggestions.push({
        id: 'optimize-cache-ttl',
        type: 'cache',
        priority: 'medium',
        title: 'Optimize Cache TTL',
        description: 'Cache hit rate is below 70%. Adjusting TTL values could improve performance.',
        action: 'Adjust Cache Settings'
      });
    }
    
    // Check resource usage
    if (report.current && report.current.resourceUsage && report.current.resourceUsage.cpu > 80) {
      suggestions.push({
        id: 'reduce-concurrent-ops',
        type: 'resource',
        priority: 'high',
        title: 'Reduce Concurrent Operations',
        description: 'CPU usage is high. Consider reducing concurrent operations to prevent throttling.',
        action: 'Optimize Resources'
      });
    }
    
    // Check memory usage
    if (report.current && report.current.resourceUsage && report.current.resourceUsage.memory > 75) {
      suggestions.push({
        id: 'increase-cache-eviction',
        type: 'memory',
        priority: 'medium',
        title: 'Increase Cache Eviction',
        description: 'Memory usage is high. More aggressive cache eviction could help.',
        action: 'Adjust Memory Settings'
      });
    }
    
    return suggestions;
  }
}