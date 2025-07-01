/**
 * Performance Monitor Service
 * Tracks and analyzes system performance metrics
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { db } from '../database';

export interface PerformanceMetrics {
  timestamp: Date;
  parseLatency: number[];
  streamLag: number;
  missedTransactions: number;
  reconnectionCount: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: number;
  networkBandwidth: {
    bytesReceived: number;
    bytesPerSecond: number;
  };
  activeConnections: number;
  queueDepths: {
    trades: number;
    accounts: number;
    recovery: number;
  };
}

export interface PerformanceThresholds {
  parseLatency: number;        // ms
  streamLag: number;          // ms
  missedTxRate: number;       // percentage
  memoryUsage: number;        // bytes
  cpuUsage: number;           // percentage
  queueDepth: number;         // items
}

export interface PerformanceAlert {
  id: string;
  type: 'latency' | 'lag' | 'memory' | 'cpu' | 'missed_tx' | 'queue_depth';
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface PerformanceReport {
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    avgParseLatency: number;
    p95ParseLatency: number;
    p99ParseLatency: number;
    avgStreamLag: number;
    maxStreamLag: number;
    totalTransactions: number;
    missedTransactions: number;
    missedRate: number;
    avgMemoryUsage: number;
    maxMemoryUsage: number;
    avgCpuUsage: number;
    maxCpuUsage: number;
    totalReconnections: number;
    uptime: number;
    healthScore: number;
  };
  recommendations: string[];
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private logger: Logger;
  private eventBus: EventBus;
  
  private thresholds: PerformanceThresholds;
  private currentMetrics: PerformanceMetrics;
  private metricsHistory: PerformanceMetrics[] = [];
  private activeAlerts: Map<string, PerformanceAlert> = new Map();
  
  // Tracking variables
  private startTime: Date = new Date();
  private lastCpuUsage = process.cpuUsage();
  private reconnectionCount = 0;
  private totalTransactions = 0;
  private missedTransactions = 0;
  private bytesReceived = 0;
  private lastBytesCheck = Date.now();
  
  // Performance tracking
  private parseLatencies: number[] = [];
  private streamLagHistory: number[] = [];
  
  private monitoringInterval?: NodeJS.Timeout;

  private constructor(eventBus: EventBus, thresholds?: Partial<PerformanceThresholds>) {
    this.logger = new Logger({ context: 'PerformanceMonitor' });
    this.eventBus = eventBus;
    
    this.thresholds = {
      parseLatency: 50,
      streamLag: 1000,
      missedTxRate: 0.01,
      memoryUsage: 1024 * 1024 * 1024, // 1GB
      cpuUsage: 80,
      queueDepth: 1000,
      ...thresholds
    };
    
    this.currentMetrics = this.createEmptyMetrics();
    this.initialize();
  }

  static async create(
    eventBus: EventBus, 
    thresholds?: Partial<PerformanceThresholds>
  ): Promise<PerformanceMonitor> {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor(eventBus, thresholds);
      await PerformanceMonitor.instance.createTables();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Initialize the monitor
   */
  private initialize(): void {
    this.setupEventListeners();
    this.startMonitoring();
    
    this.logger.info('Performance monitor initialized', {
      thresholds: this.thresholds
    });
  }

  /**
   * Create required database tables
   */
  private async createTables(): Promise<void> {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS performance_metrics (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT NOW(),
          avg_parse_latency DECIMAL(10, 2),
          p95_parse_latency DECIMAL(10, 2),
          p99_parse_latency DECIMAL(10, 2),
          stream_lag INTEGER,
          missed_transactions INTEGER,
          total_transactions INTEGER,
          memory_used BIGINT,
          memory_total BIGINT,
          cpu_usage DECIMAL(5, 2),
          active_connections INTEGER,
          reconnection_count INTEGER,
          bytes_received BIGINT,
          bytes_per_second DECIMAL(10, 2),
          queue_depth_trades INTEGER,
          queue_depth_accounts INTEGER,
          health_score DECIMAL(5, 2)
        );
        
        CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON performance_metrics(timestamp DESC);
        
        CREATE TABLE IF NOT EXISTS performance_alerts (
          id VARCHAR(36) PRIMARY KEY,
          alert_type VARCHAR(20) NOT NULL,
          severity VARCHAR(10) NOT NULL,
          metric VARCHAR(50) NOT NULL,
          value DECIMAL(20, 2) NOT NULL,
          threshold DECIMAL(20, 2) NOT NULL,
          message TEXT,
          resolved BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW(),
          resolved_at TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_alerts_created ON performance_alerts(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON performance_alerts(resolved);
      `);
    } catch (error) {
      this.logger.error('Error creating tables', error as Error);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Parse performance
    this.eventBus.on('parse:complete', this.handleParseComplete.bind(this));
    
    // Stream events
    this.eventBus.on('stream:lag', this.handleStreamLag.bind(this));
    this.eventBus.on('stream:reconnected', this.handleReconnection.bind(this));
    
    // Transaction events
    this.eventBus.on('transaction:processed', this.handleTransactionProcessed.bind(this));
    this.eventBus.on('transaction:missed', this.handleTransactionMissed.bind(this));
    
    // Network events
    this.eventBus.on('network:data', this.handleNetworkData.bind(this));
    
    // Queue events
    this.eventBus.on('queue:depth', this.handleQueueDepth.bind(this));
  }

  /**
   * Start monitoring
   */
  private startMonitoring(): void {
    // Collect metrics every 5 seconds
    this.monitoringInterval = setInterval(() => this.collectMetrics(), 5000);
    
    // Store metrics every minute
    setInterval(() => this.storeMetrics(), 60000);
    
    // Check thresholds every 10 seconds
    setInterval(() => this.checkThresholds(), 10000);
  }

  /**
   * Collect current metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      // CPU usage
      const cpuUsage = this.calculateCpuUsage();
      
      // Memory usage
      const memoryUsage = process.memoryUsage();
      
      // Calculate bandwidth
      const now = Date.now();
      const timeDiff = (now - this.lastBytesCheck) / 1000;
      const bytesPerSecond = timeDiff > 0 ? 
        (this.bytesReceived - (this.currentMetrics.networkBandwidth?.bytesReceived || 0)) / timeDiff : 0;
      
      // Create metrics snapshot
      this.currentMetrics = {
        timestamp: new Date(),
        parseLatency: [...this.parseLatencies],
        streamLag: this.getAverageStreamLag(),
        missedTransactions: this.missedTransactions,
        reconnectionCount: this.reconnectionCount,
        memoryUsage,
        cpuUsage,
        networkBandwidth: {
          bytesReceived: this.bytesReceived,
          bytesPerSecond
        },
        activeConnections: await this.getActiveConnections(),
        queueDepths: await this.getQueueDepths()
      };
      
      // Add to history
      this.metricsHistory.push(this.currentMetrics);
      
      // Keep only recent history (last hour)
      if (this.metricsHistory.length > 720) { // 60 minutes * 12 (every 5 seconds)
        this.metricsHistory = this.metricsHistory.slice(-720);
      }
      
      // Reset collections
      this.parseLatencies = [];
      this.lastBytesCheck = now;
      
    } catch (error) {
      this.logger.error('Error collecting metrics', error as Error);
    }
  }

  /**
   * Calculate CPU usage
   */
  private calculateCpuUsage(): number {
    const currentCpuUsage = process.cpuUsage();
    const userDiff = currentCpuUsage.user - this.lastCpuUsage.user;
    const systemDiff = currentCpuUsage.system - this.lastCpuUsage.system;
    
    const totalDiff = userDiff + systemDiff;
    const timeDiff = 5000000; // 5 seconds in microseconds
    
    this.lastCpuUsage = currentCpuUsage;
    
    return (totalDiff / timeDiff) * 100;
  }

  /**
   * Get average stream lag
   */
  private getAverageStreamLag(): number {
    if (this.streamLagHistory.length === 0) return 0;
    
    const sum = this.streamLagHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.streamLagHistory.length);
  }

  /**
   * Get active connections
   */
  private async getActiveConnections(): Promise<number> {
    // This would check actual connection count
    // For now, return a placeholder
    return 1;
  }

  /**
   * Get queue depths
   */
  private async getQueueDepths(): Promise<PerformanceMetrics['queueDepths']> {
    // This would check actual queue depths
    // For now, return placeholders
    return {
      trades: 0,
      accounts: 0,
      recovery: 0
    };
  }

  /**
   * Store metrics in database
   */
  private async storeMetrics(): Promise<void> {
    if (this.metricsHistory.length === 0) return;
    
    try {
      // Calculate aggregates for the period
      const parseLatencies = this.metricsHistory.flatMap(m => m.parseLatency);
      const avgParseLatency = this.calculateAverage(parseLatencies);
      const p95ParseLatency = this.calculatePercentile(parseLatencies, 0.95);
      const p99ParseLatency = this.calculatePercentile(parseLatencies, 0.99);
      
      const avgStreamLag = this.calculateAverage(
        this.metricsHistory.map(m => m.streamLag)
      );
      
      const avgMemoryUsed = this.calculateAverage(
        this.metricsHistory.map(m => m.memoryUsage.heapUsed)
      );
      
      const avgCpuUsage = this.calculateAverage(
        this.metricsHistory.map(m => m.cpuUsage)
      );
      
      const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1];
      const healthScore = this.calculateHealthScore();
      
      await db.query(`
        INSERT INTO performance_metrics (
          avg_parse_latency, p95_parse_latency, p99_parse_latency,
          stream_lag, missed_transactions, total_transactions,
          memory_used, memory_total, cpu_usage,
          active_connections, reconnection_count,
          bytes_received, bytes_per_second,
          queue_depth_trades, queue_depth_accounts,
          health_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        avgParseLatency,
        p95ParseLatency,
        p99ParseLatency,
        avgStreamLag,
        this.missedTransactions,
        this.totalTransactions,
        avgMemoryUsed,
        latestMetrics.memoryUsage.heapTotal,
        avgCpuUsage,
        latestMetrics.activeConnections,
        this.reconnectionCount,
        latestMetrics.networkBandwidth.bytesReceived,
        latestMetrics.networkBandwidth.bytesPerSecond,
        latestMetrics.queueDepths.trades,
        latestMetrics.queueDepths.accounts,
        healthScore
      ]);
      
    } catch (error) {
      this.logger.error('Error storing metrics', error as Error);
    }
  }

  /**
   * Check thresholds and create alerts
   */
  private async checkThresholds(): Promise<void> {
    const checks = [
      this.checkParseLatency(),
      this.checkStreamLag(),
      this.checkMemoryUsage(),
      this.checkCpuUsage(),
      this.checkMissedTransactions(),
      this.checkQueueDepths()
    ];
    
    await Promise.all(checks);
  }

  /**
   * Check parse latency
   */
  private async checkParseLatency(): Promise<void> {
    if (this.currentMetrics.parseLatency.length === 0) return;
    
    const p95 = this.calculatePercentile(this.currentMetrics.parseLatency, 0.95);
    
    if (p95 > this.thresholds.parseLatency) {
      await this.createAlert({
        type: 'latency',
        metric: 'parse_latency_p95',
        value: p95,
        threshold: this.thresholds.parseLatency,
        severity: p95 > this.thresholds.parseLatency * 2 ? 'high' : 'medium',
        message: `Parse latency P95 (${p95.toFixed(2)}ms) exceeds threshold`
      });
    } else {
      await this.resolveAlert('latency', 'parse_latency_p95');
    }
  }

  /**
   * Check stream lag
   */
  private async checkStreamLag(): Promise<void> {
    const lag = this.currentMetrics.streamLag;
    
    if (lag > this.thresholds.streamLag) {
      await this.createAlert({
        type: 'lag',
        metric: 'stream_lag',
        value: lag,
        threshold: this.thresholds.streamLag,
        severity: lag > this.thresholds.streamLag * 3 ? 'critical' : 'high',
        message: `Stream lag (${lag}ms) exceeds threshold`
      });
    } else {
      await this.resolveAlert('lag', 'stream_lag');
    }
  }

  /**
   * Check memory usage
   */
  private async checkMemoryUsage(): Promise<void> {
    const memoryUsed = this.currentMetrics.memoryUsage.heapUsed;
    
    if (memoryUsed > this.thresholds.memoryUsage) {
      await this.createAlert({
        type: 'memory',
        metric: 'heap_used',
        value: memoryUsed,
        threshold: this.thresholds.memoryUsage,
        severity: memoryUsed > this.thresholds.memoryUsage * 1.5 ? 'critical' : 'high',
        message: `Memory usage (${(memoryUsed / 1024 / 1024).toFixed(2)}MB) exceeds threshold`
      });
    } else {
      await this.resolveAlert('memory', 'heap_used');
    }
  }

  /**
   * Check CPU usage
   */
  private async checkCpuUsage(): Promise<void> {
    const cpuUsage = this.currentMetrics.cpuUsage;
    
    if (cpuUsage > this.thresholds.cpuUsage) {
      await this.createAlert({
        type: 'cpu',
        metric: 'cpu_usage',
        value: cpuUsage,
        threshold: this.thresholds.cpuUsage,
        severity: cpuUsage > 95 ? 'critical' : 'high',
        message: `CPU usage (${cpuUsage.toFixed(2)}%) exceeds threshold`
      });
    } else {
      await this.resolveAlert('cpu', 'cpu_usage');
    }
  }

  /**
   * Check missed transactions
   */
  private async checkMissedTransactions(): Promise<void> {
    if (this.totalTransactions === 0) return;
    
    const missedRate = this.missedTransactions / this.totalTransactions;
    
    if (missedRate > this.thresholds.missedTxRate) {
      await this.createAlert({
        type: 'missed_tx',
        metric: 'missed_transaction_rate',
        value: missedRate * 100,
        threshold: this.thresholds.missedTxRate * 100,
        severity: missedRate > this.thresholds.missedTxRate * 2 ? 'high' : 'medium',
        message: `Missed transaction rate (${(missedRate * 100).toFixed(2)}%) exceeds threshold`
      });
    } else {
      await this.resolveAlert('missed_tx', 'missed_transaction_rate');
    }
  }

  /**
   * Check queue depths
   */
  private async checkQueueDepths(): Promise<void> {
    const maxQueueDepth = Math.max(
      this.currentMetrics.queueDepths.trades,
      this.currentMetrics.queueDepths.accounts,
      this.currentMetrics.queueDepths.recovery
    );
    
    if (maxQueueDepth > this.thresholds.queueDepth) {
      await this.createAlert({
        type: 'queue_depth',
        metric: 'max_queue_depth',
        value: maxQueueDepth,
        threshold: this.thresholds.queueDepth,
        severity: maxQueueDepth > this.thresholds.queueDepth * 2 ? 'high' : 'medium',
        message: `Queue depth (${maxQueueDepth}) exceeds threshold`
      });
    } else {
      await this.resolveAlert('queue_depth', 'max_queue_depth');
    }
  }

  /**
   * Create or update alert
   */
  private async createAlert(alertData: Omit<PerformanceAlert, 'id' | 'timestamp' | 'resolved' | 'resolvedAt'>): Promise<void> {
    const alertKey = `${alertData.type}_${alertData.metric}`;
    const existingAlert = this.activeAlerts.get(alertKey);
    
    if (existingAlert) {
      // Update existing alert
      existingAlert.value = alertData.value;
      existingAlert.timestamp = new Date();
      return;
    }
    
    const alert: PerformanceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...alertData,
      timestamp: new Date(),
      resolved: false
    };
    
    this.activeAlerts.set(alertKey, alert);
    
    // Store in database
    await this.storeAlert(alert);
    
    // Emit alert event
    this.eventBus.emit('performance:alert', alert);
    
    this.logger.warn('Performance alert created', {
      type: alert.type,
      metric: alert.metric,
      value: alert.value,
      severity: alert.severity
    });
  }

  /**
   * Resolve alert
   */
  private async resolveAlert(type: string, metric: string): Promise<void> {
    const alertKey = `${type}_${metric}`;
    const alert = this.activeAlerts.get(alertKey);
    
    if (!alert || alert.resolved) return;
    
    alert.resolved = true;
    alert.resolvedAt = new Date();
    
    this.activeAlerts.delete(alertKey);
    
    // Update in database
    await db.query(`
      UPDATE performance_alerts 
      SET resolved = true, resolved_at = NOW()
      WHERE id = $1
    `, [alert.id]);
    
    // Emit resolution event
    this.eventBus.emit('performance:alert_resolved', alert);
    
    this.logger.info('Performance alert resolved', {
      type: alert.type,
      metric: alert.metric
    });
  }

  /**
   * Store alert in database
   */
  private async storeAlert(alert: PerformanceAlert): Promise<void> {
    try {
      await db.query(`
        INSERT INTO performance_alerts (
          id, alert_type, severity, metric, value,
          threshold, message, resolved
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        alert.id,
        alert.type,
        alert.severity,
        alert.metric,
        alert.value,
        alert.threshold,
        alert.message,
        alert.resolved
      ]);
    } catch (error) {
      this.logger.error('Error storing alert', error as Error);
    }
  }

  /**
   * Handle parse complete event
   */
  private handleParseComplete(event: any): void {
    if (event.latency) {
      this.parseLatencies.push(event.latency);
    }
  }

  /**
   * Handle stream lag event
   */
  private handleStreamLag(event: any): void {
    if (event.lag) {
      this.streamLagHistory.push(event.lag);
      
      // Keep only recent history
      if (this.streamLagHistory.length > 100) {
        this.streamLagHistory = this.streamLagHistory.slice(-100);
      }
    }
  }

  /**
   * Handle reconnection event
   */
  private handleReconnection(): void {
    this.reconnectionCount++;
  }

  /**
   * Handle transaction processed
   */
  private handleTransactionProcessed(): void {
    this.totalTransactions++;
  }

  /**
   * Handle transaction missed
   */
  private handleTransactionMissed(): void {
    this.missedTransactions++;
  }

  /**
   * Handle network data
   */
  private handleNetworkData(event: any): void {
    if (event.bytes) {
      this.bytesReceived += event.bytes;
    }
  }

  /**
   * Handle queue depth update
   */
  private handleQueueDepth(event: any): void {
    if (event.queue && event.depth !== undefined) {
      this.currentMetrics.queueDepths[event.queue as keyof typeof this.currentMetrics.queueDepths] = event.depth;
    }
  }

  /**
   * Calculate average
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[index] || 0;
  }

  /**
   * Calculate health score
   */
  private calculateHealthScore(): number {
    let score = 100;
    
    // Deduct points for active alerts
    for (const alert of this.activeAlerts.values()) {
      switch (alert.severity) {
        case 'critical': score -= 30; break;
        case 'high': score -= 20; break;
        case 'medium': score -= 10; break;
        case 'low': score -= 5; break;
      }
    }
    
    // Deduct points for high resource usage
    if (this.currentMetrics.cpuUsage > 70) score -= 10;
    if (this.currentMetrics.memoryUsage.heapUsed > this.thresholds.memoryUsage * 0.8) score -= 10;
    
    // Deduct points for missed transactions
    const missedRate = this.totalTransactions > 0 ? 
      this.missedTransactions / this.totalTransactions : 0;
    if (missedRate > 0.005) score -= 15;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Create empty metrics
   */
  private createEmptyMetrics(): PerformanceMetrics {
    return {
      timestamp: new Date(),
      parseLatency: [],
      streamLag: 0,
      missedTransactions: 0,
      reconnectionCount: 0,
      memoryUsage: process.memoryUsage(),
      cpuUsage: 0,
      networkBandwidth: {
        bytesReceived: 0,
        bytesPerSecond: 0
      },
      activeConnections: 0,
      queueDepths: {
        trades: 0,
        accounts: 0,
        recovery: 0
      }
    };
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): PerformanceMetrics {
    return { ...this.currentMetrics };
  }

  /**
   * Get health score
   */
  getHealthScore(): number {
    return this.calculateHealthScore();
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): PerformanceAlert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations(): string[] {
    const recommendations: string[] = [];
    
    // Parse latency recommendations
    if (this.currentMetrics.parseLatency.length > 0) {
      const p95 = this.calculatePercentile(this.currentMetrics.parseLatency, 0.95);
      if (p95 > this.thresholds.parseLatency) {
        recommendations.push('Consider optimizing parser logic or increasing worker threads');
      }
    }
    
    // Memory recommendations
    const memoryUsagePercent = (this.currentMetrics.memoryUsage.heapUsed / this.currentMetrics.memoryUsage.heapTotal) * 100;
    if (memoryUsagePercent > 80) {
      recommendations.push('High memory usage detected. Consider increasing heap size or optimizing memory usage');
    }
    
    // CPU recommendations
    if (this.currentMetrics.cpuUsage > 70) {
      recommendations.push('High CPU usage. Consider scaling horizontally or optimizing compute-intensive operations');
    }
    
    // Stream lag recommendations
    if (this.currentMetrics.streamLag > 500) {
      recommendations.push('Stream lag detected. Check network connectivity and processing capacity');
    }
    
    // Missed transactions recommendations
    const missedRate = this.totalTransactions > 0 ? 
      this.missedTransactions / this.totalTransactions : 0;
    if (missedRate > 0.005) {
      recommendations.push('High missed transaction rate. Consider increasing buffer sizes or processing capacity');
    }
    
    return recommendations;
  }

  /**
   * Generate performance report
   */
  async generateReport(hours: number = 24): Promise<PerformanceReport> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
    
    try {
      const result = await db.query(`
        SELECT 
          AVG(avg_parse_latency) as avg_parse_latency,
          AVG(p95_parse_latency) as p95_parse_latency,
          AVG(p99_parse_latency) as p99_parse_latency,
          AVG(stream_lag) as avg_stream_lag,
          MAX(stream_lag) as max_stream_lag,
          SUM(total_transactions) as total_transactions,
          SUM(missed_transactions) as missed_transactions,
          AVG(memory_used) as avg_memory_used,
          MAX(memory_used) as max_memory_used,
          AVG(cpu_usage) as avg_cpu_usage,
          MAX(cpu_usage) as max_cpu_usage,
          SUM(reconnection_count) as total_reconnections,
          AVG(health_score) as avg_health_score
        FROM performance_metrics
        WHERE timestamp BETWEEN $1 AND $2
      `, [startTime, endTime]);
      
      const stats = result.rows[0] || {};
      
      const missedRate = stats.total_transactions > 0 ?
        stats.missed_transactions / stats.total_transactions : 0;
      
      const uptime = Date.now() - this.startTime.getTime();
      
      const report: PerformanceReport = {
        period: { start: startTime, end: endTime },
        summary: {
          avgParseLatency: parseFloat(stats.avg_parse_latency) || 0,
          p95ParseLatency: parseFloat(stats.p95_parse_latency) || 0,
          p99ParseLatency: parseFloat(stats.p99_parse_latency) || 0,
          avgStreamLag: parseFloat(stats.avg_stream_lag) || 0,
          maxStreamLag: parseInt(stats.max_stream_lag) || 0,
          totalTransactions: parseInt(stats.total_transactions) || 0,
          missedTransactions: parseInt(stats.missed_transactions) || 0,
          missedRate: missedRate,
          avgMemoryUsage: parseFloat(stats.avg_memory_used) || 0,
          maxMemoryUsage: parseFloat(stats.max_memory_used) || 0,
          avgCpuUsage: parseFloat(stats.avg_cpu_usage) || 0,
          maxCpuUsage: parseFloat(stats.max_cpu_usage) || 0,
          totalReconnections: parseInt(stats.total_reconnections) || 0,
          uptime: uptime,
          healthScore: parseFloat(stats.avg_health_score) || 0
        },
        recommendations: this.getOptimizationRecommendations()
      };
      
      return report;
    } catch (error) {
      this.logger.error('Error generating report', error as Error);
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.logger.info('Performance monitor stopped');
  }
}