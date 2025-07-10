import { EventEmitter } from 'events';
import { createLogger } from '../../core/logger';

interface ParseMetric {
  strategy: string;
  programId: string;
  attempts: number;
  successes: number;
  failures: number;
  avgParseTime: number;
  totalParseTime: number;
  errors: Map<string, number>;
  lastUpdated: Date;
}

interface StrategyMetric {
  strategy: string;
  successRate: number;
  attempts: number;
  avgParseTime: number;
  topErrors: Array<[string, number]>;
}

interface ParseMetricsSummary {
  totalAttempts: number;
  totalSuccesses: number;
  overallParseRate: number;
  byStrategy: StrategyMetric[];
}

interface ProgramMetrics {
  programId: string;
  parseRate: number;
  totalTransactions: number;
  successfullyParsed: number;
  avgParseTime: number;
  recentFailures: RecentFailure[];
}

interface RecentFailure {
  signature: string;
  strategy: string;
  error: string;
  timestamp: Date;
  programId: string;
}

interface DataQualityMetrics {
  ammTradesWithReserves: number;
  reserveDataSources: {
    virtualCalculator: number;
    poolState: number;
    innerInstructions: number;
  };
  crossVenueCorrelation: number;
  marketCapAccuracy: number;
}

interface SystemMetrics {
  parseQueueDepth: number;
  memoryUsage: NodeJS.MemoryUsage;
  eventBusMessagesPerSec: number;
  dbWriteThroughput: number;
}

interface Alert {
  type: 'parse_rate' | 'memory' | 'queue_depth' | 'strategy_failure';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
}

export class ParsingMetricsService extends EventEmitter {
  private static instance: ParsingMetricsService;
  private metrics = new Map<string, ParseMetric>();
  private recentFailures: RecentFailure[] = [];
  private logger = createLogger('ParsingMetricsService');
  
  // Performance tracking
  private eventBusMessages = 0;
  private dbWrites = 0;
  private lastMetricsReset = Date.now();
  
  // Alert thresholds
  private readonly PARSE_RATE_WARNING = 0.9;
  private readonly PARSE_RATE_CRITICAL = 0.8;
  private readonly STRATEGY_FAILURE_THRESHOLD = 0.5;
  private readonly MEMORY_WARNING_PERCENT = 0.8;
  private readonly QUEUE_DEPTH_WARNING = 800;
  
  private constructor() {
    super();
    this.startMetricsCollection();
  }
  
  static getInstance(): ParsingMetricsService {
    if (!ParsingMetricsService.instance) {
      ParsingMetricsService.instance = new ParsingMetricsService();
    }
    return ParsingMetricsService.instance;
  }
  
  trackParseAttempt(params: {
    strategy: string;
    programId: string;
    success: boolean;
    error?: Error;
    signature?: string;
    parseTime?: number;
  }): void {
    const key = `${params.programId}-${params.strategy}`;
    const metric = this.metrics.get(key) || {
      strategy: params.strategy,
      programId: params.programId,
      attempts: 0,
      successes: 0,
      failures: 0,
      avgParseTime: 0,
      totalParseTime: 0,
      errors: new Map<string, number>(),
      lastUpdated: new Date()
    };
    
    metric.attempts++;
    if (params.success) {
      metric.successes++;
    } else {
      metric.failures++;
      if (params.error) {
        const errorKey = params.error.message || 'Unknown error';
        metric.errors.set(errorKey, (metric.errors.get(errorKey) || 0) + 1);
        
        // Track recent failure
        this.recentFailures.unshift({
          signature: params.signature || 'unknown',
          strategy: params.strategy,
          error: errorKey,
          timestamp: new Date(),
          programId: params.programId
        });
        
        // Keep only last 100 failures
        if (this.recentFailures.length > 100) {
          this.recentFailures = this.recentFailures.slice(0, 100);
        }
        
        // Emit failure event for real-time updates
        this.emit('parse_failure', {
          signature: params.signature,
          strategy: params.strategy,
          error: errorKey,
          programId: params.programId
        });
      }
    }
    
    // Update parse time metrics
    if (params.parseTime !== undefined) {
      metric.totalParseTime += params.parseTime;
      metric.avgParseTime = metric.totalParseTime / metric.attempts;
    }
    
    metric.lastUpdated = new Date();
    this.metrics.set(key, metric);
    
    // Log failures for debugging
    if (!params.success) {
      this.logger.debug('Parse failure', {
        strategy: params.strategy,
        signature: params.signature,
        error: params.error?.message,
        programId: params.programId
      });
    }
    
    // Check alert thresholds
    this.checkAlerts(metric);
  }
  
  getMetrics(): ParseMetricsSummary {
    const summary: ParseMetricsSummary = {
      totalAttempts: 0,
      totalSuccesses: 0,
      overallParseRate: 0,
      byStrategy: []
    };
    
    const strategyMap = new Map<string, {
      attempts: number;
      successes: number;
      totalParseTime: number;
      errors: Map<string, number>;
    }>();
    
    // Aggregate by strategy across all programs
    for (const [key, metric] of this.metrics) {
      summary.totalAttempts += metric.attempts;
      summary.totalSuccesses += metric.successes;
      
      const existing = strategyMap.get(metric.strategy) || {
        attempts: 0,
        successes: 0,
        totalParseTime: 0,
        errors: new Map<string, number>()
      };
      
      existing.attempts += metric.attempts;
      existing.successes += metric.successes;
      existing.totalParseTime += metric.totalParseTime;
      
      // Merge errors
      for (const [error, count] of metric.errors) {
        existing.errors.set(error, (existing.errors.get(error) || 0) + count);
      }
      
      strategyMap.set(metric.strategy, existing);
    }
    
    // Calculate overall parse rate
    summary.overallParseRate = summary.totalAttempts > 0 
      ? summary.totalSuccesses / summary.totalAttempts 
      : 0;
    
    // Build strategy metrics
    for (const [strategy, data] of strategyMap) {
      summary.byStrategy.push({
        strategy,
        successRate: data.attempts > 0 ? data.successes / data.attempts : 0,
        attempts: data.attempts,
        avgParseTime: data.attempts > 0 ? data.totalParseTime / data.attempts : 0,
        topErrors: Array.from(data.errors.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
      });
    }
    
    // Sort strategies by success rate
    summary.byStrategy.sort((a, b) => b.successRate - a.successRate);
    
    return summary;
  }
  
  getOverviewMetrics(): {
    overallParseRate: number;
    totalTransactions: number;
    successfullyParsed: number;
    avgParseTime: number;
    tps: number;
    failedCount: number;
  } {
    let totalAttempts = 0;
    let totalSuccesses = 0;
    let totalParseTime = 0;
    let failedCount = 0;
    
    for (const metric of this.metrics.values()) {
      totalAttempts += metric.attempts;
      totalSuccesses += metric.successes;
      totalParseTime += metric.totalParseTime;
      failedCount += metric.failures;
    }
    
    const timeDiff = (Date.now() - this.lastMetricsReset) / 1000; // seconds
    
    return {
      overallParseRate: totalAttempts > 0 ? totalSuccesses / totalAttempts : 0,
      totalTransactions: totalAttempts,
      successfullyParsed: totalSuccesses,
      avgParseTime: totalAttempts > 0 ? totalParseTime / totalAttempts : 0,
      tps: totalAttempts / Math.max(timeDiff, 1),
      failedCount
    };
  }
  
  getProgramMetrics(programId: string): ProgramMetrics {
    const programMetrics: ParseMetric[] = [];
    
    for (const [key, metric] of this.metrics) {
      if (metric.programId === programId) {
        programMetrics.push(metric);
      }
    }
    
    const totalAttempts = programMetrics.reduce((sum, m) => sum + m.attempts, 0);
    const totalSuccesses = programMetrics.reduce((sum, m) => sum + m.successes, 0);
    const totalParseTime = programMetrics.reduce((sum, m) => sum + m.totalParseTime, 0);
    
    const recentFailures = this.recentFailures
      .filter(f => f.programId === programId)
      .slice(0, 10);
    
    return {
      programId,
      parseRate: totalAttempts > 0 ? totalSuccesses / totalAttempts : 0,
      totalTransactions: totalAttempts,
      successfullyParsed: totalSuccesses,
      avgParseTime: totalAttempts > 0 ? totalParseTime / totalAttempts : 0,
      recentFailures
    };
  }
  
  getStrategyMetrics(): StrategyMetric[] {
    return this.getMetrics().byStrategy;
  }
  
  getRecentFailures(limit: number = 10): RecentFailure[] {
    return this.recentFailures.slice(0, limit);
  }
  
  getReserveDataQuality(): number {
    // This would be calculated from actual AMM trade data
    // For now, return a placeholder
    return 0.876;
  }
  
  getReserveDataSources(): {
    virtualCalculator: number;
    poolState: number;
    innerInstructions: number;
  } {
    // This would be calculated from actual source tracking
    // For now, return placeholders
    return {
      virtualCalculator: 0.62,
      poolState: 0.25,
      innerInstructions: 0.13
    };
  }
  
  getCrossVenueMetrics(): number {
    // This would track graduation to pool correlations
    // For now, return a placeholder
    return 0.942;
  }
  
  getMarketCapAccuracy(): number {
    // This would compare calculated vs actual market caps
    // For now, return a placeholder
    return 0.98;
  }
  
  getQueueDepth(): number {
    // This would track actual parse queue depth
    // For now, return a placeholder based on TPS
    const overview = this.getOverviewMetrics();
    return Math.floor(overview.tps * 6.1); // Simulate queue depth
  }
  
  getEventBusRate(): number {
    const timeDiff = (Date.now() - this.lastMetricsReset) / 1000;
    return this.eventBusMessages / Math.max(timeDiff, 1);
  }
  
  getDbWriteRate(): number {
    const timeDiff = (Date.now() - this.lastMetricsReset) / 1000;
    return this.dbWrites / Math.max(timeDiff, 1);
  }
  
  trackEventBusMessage(): void {
    this.eventBusMessages++;
  }
  
  trackDbWrite(): void {
    this.dbWrites++;
  }
  
  checkAlertThresholds(): Alert[] {
    const alerts: Alert[] = [];
    const overview = this.getOverviewMetrics();
    
    // Check overall parse rate
    if (overview.overallParseRate < this.PARSE_RATE_CRITICAL) {
      alerts.push({
        type: 'parse_rate',
        severity: 'critical',
        message: `Overall parse rate critically low: ${(overview.overallParseRate * 100).toFixed(1)}%`,
        value: overview.overallParseRate,
        threshold: this.PARSE_RATE_CRITICAL,
        timestamp: new Date()
      });
    } else if (overview.overallParseRate < this.PARSE_RATE_WARNING) {
      alerts.push({
        type: 'parse_rate',
        severity: 'warning',
        message: `Overall parse rate below warning threshold: ${(overview.overallParseRate * 100).toFixed(1)}%`,
        value: overview.overallParseRate,
        threshold: this.PARSE_RATE_WARNING,
        timestamp: new Date()
      });
    }
    
    // Check strategy-specific failures
    const strategies = this.getStrategyMetrics();
    for (const strategy of strategies) {
      if (strategy.successRate < this.STRATEGY_FAILURE_THRESHOLD && strategy.attempts > 10) {
        alerts.push({
          type: 'strategy_failure',
          severity: 'critical',
          message: `Strategy ${strategy.strategy} has low success rate: ${(strategy.successRate * 100).toFixed(1)}%`,
          value: strategy.successRate,
          threshold: this.STRATEGY_FAILURE_THRESHOLD,
          timestamp: new Date()
        });
      }
    }
    
    // Check memory usage
    const memUsage = process.memoryUsage();
    const memPercent = memUsage.heapUsed / memUsage.heapTotal;
    if (memPercent > this.MEMORY_WARNING_PERCENT) {
      alerts.push({
        type: 'memory',
        severity: 'warning',
        message: `Memory usage high: ${(memPercent * 100).toFixed(1)}%`,
        value: memPercent,
        threshold: this.MEMORY_WARNING_PERCENT,
        timestamp: new Date()
      });
    }
    
    // Check queue depth
    const queueDepth = this.getQueueDepth();
    if (queueDepth > this.QUEUE_DEPTH_WARNING) {
      alerts.push({
        type: 'queue_depth',
        severity: 'warning',
        message: `Parse queue depth high: ${queueDepth} items`,
        value: queueDepth,
        threshold: this.QUEUE_DEPTH_WARNING,
        timestamp: new Date()
      });
    }
    
    return alerts;
  }
  
  private checkAlerts(metric: ParseMetric): void {
    const successRate = metric.attempts > 0 ? metric.successes / metric.attempts : 0;
    
    if (successRate < this.STRATEGY_FAILURE_THRESHOLD && metric.attempts > 10) {
      this.emit('alert', {
        type: 'strategy_failure',
        strategy: metric.strategy,
        programId: metric.programId,
        successRate,
        message: `Strategy ${metric.strategy} for ${metric.programId} has low success rate: ${(successRate * 100).toFixed(1)}%`
      });
    }
  }
  
  private startMetricsCollection(): void {
    // Reset counters every hour
    setInterval(() => {
      this.eventBusMessages = 0;
      this.dbWrites = 0;
      this.lastMetricsReset = Date.now();
    }, 60 * 60 * 1000);
  }
  
  // Utility method for tests
  reset(): void {
    this.metrics.clear();
    this.recentFailures = [];
    this.eventBusMessages = 0;
    this.dbWrites = 0;
    this.lastMetricsReset = Date.now();
  }
}