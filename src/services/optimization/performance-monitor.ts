/**
 * Performance Monitor
 * Tracks and reports on system performance metrics
 */

import { EventBus } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import * as os from 'os';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface OperationTrace {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success?: boolean;
  metadata?: Record<string, any>;
  children?: OperationTrace[];
}

export interface ResourceMetrics {
  cpu: {
    usage: number;
    cores: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
    heapUsed: number;
    heapTotal: number;
  };
  network?: {
    bytesIn: number;
    bytesOut: number;
  };
}

export class PerformanceMonitor {
  private logger: Logger;
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private traces: Map<string, OperationTrace> = new Map();
  private activeOperations: Map<string, OperationTrace> = new Map();
  private metricsInterval: NodeJS.Timeout | null = null;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private startTime: number;
  
  constructor(
    private eventBus: EventBus,
    private config: {
      metricsRetention: number; // ms
      samplingInterval: number; // ms
      enableTracing: boolean;
    }
  ) {
    this.logger = new Logger({ context: 'PerformanceMonitor' });
    this.startTime = Date.now();
    
    this.setupEventListeners();
    this.startMetricsCollection();
  }
  
  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Track operation starts
    this.eventBus.on('operation:start', (data: {
      id: string;
      name: string;
      metadata?: Record<string, any>;
    }) => {
      if (this.config.enableTracing) {
        this.startOperation(data.id, data.name, data.metadata);
      }
    });
    
    // Track operation completions
    this.eventBus.on('operation:complete', (data: {
      id: string;
      duration: number;
      success?: boolean;
    }) => {
      if (this.config.enableTracing) {
        this.completeOperation(data.id, data.success);
      }
      
      // Record duration metric
      this.recordMetric({
        name: 'operation.duration',
        value: data.duration,
        unit: 'ms',
        timestamp: Date.now()
      });
    });
    
    // Track custom metrics
    this.eventBus.on('metric:record', (metric: PerformanceMetric) => {
      this.recordMetric(metric);
    });
  }
  
  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.collectResourceMetrics();
    }, this.config.samplingInterval);
    
    // Initial CPU usage
    this.lastCpuUsage = process.cpuUsage();
  }
  
  /**
   * Start tracking an operation
   */
  public startOperation(
    id: string,
    name: string,
    metadata?: Record<string, any>
  ): OperationTrace {
    const trace: OperationTrace = {
      id,
      name,
      startTime: Date.now(),
      metadata
    };
    
    this.activeOperations.set(id, trace);
    return trace;
  }
  
  /**
   * Complete tracking an operation
   */
  public completeOperation(id: string, success: boolean = true): void {
    const trace = this.activeOperations.get(id);
    if (!trace) return;
    
    trace.endTime = Date.now();
    trace.duration = trace.endTime - trace.startTime;
    trace.success = success;
    
    this.activeOperations.delete(id);
    this.traces.set(id, trace);
    
    // Emit completion event
    this.eventBus.emit('operation:complete', {
      id,
      duration: trace.duration,
      success
    });
    
    // Clean up old traces
    this.cleanupTraces();
  }
  
  /**
   * Record a metric
   */
  public recordMetric(metric: PerformanceMetric): void {
    const key = this.getMetricKey(metric);
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    
    const metrics = this.metrics.get(key)!;
    metrics.push(metric);
    
    // Clean up old metrics
    this.cleanupMetrics(key);
  }
  
  /**
   * Collect resource metrics
   */
  private collectResourceMetrics(): void {
    const resources = this.getResourceMetrics();
    
    // Record CPU metric
    this.recordMetric({
      name: 'system.cpu.usage',
      value: resources.cpu.usage,
      unit: 'percentage',
      timestamp: Date.now()
    });
    
    // Record memory metrics
    this.recordMetric({
      name: 'system.memory.usage',
      value: resources.memory.percentage,
      unit: 'percentage',
      timestamp: Date.now()
    });
    
    this.recordMetric({
      name: 'system.memory.heap',
      value: resources.memory.heapUsed,
      unit: 'bytes',
      timestamp: Date.now()
    });
    
    // Emit resource update
    this.eventBus.emit('resources:update', resources);
  }
  
  /**
   * Get current resource metrics
   */
  public getResourceMetrics(): ResourceMetrics {
    const cpuUsage = process.cpuUsage(this.lastCpuUsage || undefined);
    this.lastCpuUsage = process.cpuUsage();
    
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    // Calculate CPU percentage
    const totalCpuTime = cpuUsage.user + cpuUsage.system;
    const elapsedTime = this.config.samplingInterval * 1000; // Convert to microseconds
    const cpuPercentage = (totalCpuTime / elapsedTime) * 100;
    
    return {
      cpu: {
        usage: Math.min(100, cpuPercentage),
        cores: os.cpus().length,
        loadAverage: os.loadavg()
      },
      memory: {
        used: usedMem,
        total: totalMem,
        percentage: (usedMem / totalMem) * 100,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
      }
    };
  }
  
  /**
   * Get metrics for a specific name
   */
  public getMetrics(name: string, duration?: number): PerformanceMetric[] {
    const now = Date.now();
    const since = duration ? now - duration : 0;
    
    const results: PerformanceMetric[] = [];
    
    for (const [metricKey, metrics] of this.metrics) {
      if (metricKey.startsWith(name)) {
        results.push(...metrics.filter(m => m.timestamp >= since));
      }
    }
    
    return results.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  /**
   * Get metric statistics
   */
  public getMetricStats(name: string, duration?: number): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const metrics = this.getMetrics(name, duration);
    if (metrics.length === 0) return null;
    
    const values = metrics.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    
    return {
      count: values.length,
      min: values[0],
      max: values[values.length - 1],
      avg: sum / values.length,
      p50: this.percentile(values, 0.5),
      p95: this.percentile(values, 0.95),
      p99: this.percentile(values, 0.99)
    };
  }
  
  /**
   * Get operation traces
   */
  public getTraces(duration?: number): OperationTrace[] {
    const now = Date.now();
    const since = duration ? now - duration : 0;
    
    return Array.from(this.traces.values())
      .filter(trace => trace.startTime >= since)
      .sort((a, b) => b.startTime - a.startTime);
  }
  
  /**
   * Get performance summary
   */
  public getPerformanceSummary(): {
    uptime: number;
    resources: ResourceMetrics;
    operations: {
      active: number;
      completed: number;
      avgDuration: number;
      successRate: number;
    };
    metrics: Record<string, any>;
  } {
    const traces = Array.from(this.traces.values());
    const successfulTraces = traces.filter(t => t.success);
    const totalDuration = traces.reduce((sum, t) => sum + (t.duration || 0), 0);
    
    return {
      uptime: Date.now() - this.startTime,
      resources: this.getResourceMetrics(),
      operations: {
        active: this.activeOperations.size,
        completed: traces.length,
        avgDuration: traces.length > 0 ? totalDuration / traces.length : 0,
        successRate: traces.length > 0 ? successfulTraces.length / traces.length : 1
      },
      metrics: {
        throughput: this.getMetricStats('operation.duration', 60000),
        cpu: this.getMetricStats('system.cpu.usage', 60000),
        memory: this.getMetricStats('system.memory.usage', 60000)
      }
    };
  }
  
  /**
   * Helper methods
   */
  private getMetricKey(metric: PerformanceMetric): string {
    let key = metric.name;
    
    if (metric.tags) {
      const tagStr = Object.entries(metric.tags)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
      key += `:${tagStr}`;
    }
    
    return key;
  }
  
  private cleanupMetrics(key: string): void {
    const metrics = this.metrics.get(key);
    if (!metrics) return;
    
    const cutoff = Date.now() - this.config.metricsRetention;
    const filtered = metrics.filter(m => m.timestamp > cutoff);
    
    if (filtered.length < metrics.length) {
      this.metrics.set(key, filtered);
    }
  }
  
  private cleanupTraces(): void {
    const cutoff = Date.now() - this.config.metricsRetention;
    
    for (const [id, trace] of this.traces) {
      if (trace.startTime < cutoff) {
        this.traces.delete(id);
      }
    }
  }
  
  private percentile(sortedValues: number[], p: number): number {
    const index = Math.ceil(sortedValues.length * p) - 1;
    return sortedValues[Math.max(0, index)];
  }
  
  /**
   * Export metrics for external monitoring
   */
  public exportMetrics(format: 'prometheus' | 'json' = 'json'): string {
    if (format === 'prometheus') {
      return this.exportPrometheus();
    }
    
    const metrics: Record<string, any> = {};
    
    for (const [key, values] of this.metrics) {
      const latest = values[values.length - 1];
      if (latest) {
        metrics[key] = {
          value: latest.value,
          unit: latest.unit,
          timestamp: latest.timestamp
        };
      }
    }
    
    return JSON.stringify(metrics, null, 2);
  }
  
  private exportPrometheus(): string {
    const lines: string[] = [];
    
    for (const [key, values] of this.metrics) {
      const latest = values[values.length - 1];
      if (latest) {
        const metricName = key.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`# TYPE ${metricName} gauge`);
        lines.push(`${metricName} ${latest.value} ${latest.timestamp}`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Stop monitoring
   */
  public stop(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    this.logger.info('Performance monitor stopped');
  }
}