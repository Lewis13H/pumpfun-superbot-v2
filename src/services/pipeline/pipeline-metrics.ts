/**
 * Pipeline Metrics - Tracks performance metrics for the data pipeline
 */

import { NormalizedEvent } from './data-pipeline';
import { Logger, loggers } from '../../core/logger';
import * as chalk from 'chalk';

export interface EventTypeMetrics {
  count: number;
  avgProcessingTime: number;
  errorRate: number;
  lastProcessed?: Date;
}

export interface SourceMetrics {
  eventsReceived: number;
  eventsProcessed: number;
  avgLatency: number;
  errorCount: number;
}

export class PipelineMetrics {
  private logger: Logger;
  private startTime: number = Date.now();
  
  // Event type metrics
  private eventTypeMetrics: Map<string, EventTypeMetrics> = new Map();
  
  // Source metrics
  private sourceMetrics: Map<string, SourceMetrics> = new Map();
  
  // Processing time histogram (buckets in ms)
  private processingTimeBuckets = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  private processingTimeHistogram: Map<number, number> = new Map();
  
  // Queue depth tracking
  private queueDepthHistory: Array<{ timestamp: number; depth: number }> = [];
  private maxQueueDepthHistory = 1000;
  
  // Throughput tracking
  private throughputWindow: Array<{ timestamp: number; count: number }> = [];
  private throughputWindowSize = 60; // 60 seconds
  
  constructor() {
    this.logger = loggers.service('PipelineMetrics');
    
    // Initialize histogram buckets
    this.processingTimeBuckets.forEach(bucket => {
      this.processingTimeHistogram.set(bucket, 0);
    });
  }

  /**
   * Record an event
   */
  recordEvent(event: NormalizedEvent): void {
    // Update event type metrics
    const typeMetrics = this.eventTypeMetrics.get(event.type) || {
      count: 0,
      avgProcessingTime: 0,
      errorRate: 0
    };
    
    typeMetrics.count++;
    typeMetrics.lastProcessed = new Date();
    this.eventTypeMetrics.set(event.type, typeMetrics);
    
    // Update source metrics
    const sourceMetrics = this.sourceMetrics.get(event.source) || {
      eventsReceived: 0,
      eventsProcessed: 0,
      avgLatency: 0,
      errorCount: 0
    };
    
    sourceMetrics.eventsReceived++;
    this.sourceMetrics.set(event.source, sourceMetrics);
  }

  /**
   * Record batch processing
   */
  recordBatch(batchSize: number, processingTime: number): void {
    // Update throughput
    const now = Date.now();
    this.throughputWindow.push({ timestamp: now, count: batchSize });
    
    // Clean old entries
    const cutoff = now - (this.throughputWindowSize * 1000);
    this.throughputWindow = this.throughputWindow.filter(entry => entry.timestamp > cutoff);
    
    // Update processing time histogram
    const avgTimePerEvent = processingTime / batchSize;
    const bucket = this.getProcessingTimeBucket(avgTimePerEvent);
    const currentCount = this.processingTimeHistogram.get(bucket) || 0;
    this.processingTimeHistogram.set(bucket, currentCount + batchSize);
  }

  /**
   * Record queue depth
   */
  recordQueueDepth(depth: number): void {
    this.queueDepthHistory.push({
      timestamp: Date.now(),
      depth
    });
    
    // Maintain max history size
    if (this.queueDepthHistory.length > this.maxQueueDepthHistory) {
      this.queueDepthHistory.shift();
    }
  }

  /**
   * Record processing error
   */
  recordError(eventType: string, source: string): void {
    // Update event type error rate
    const typeMetrics = this.eventTypeMetrics.get(eventType);
    if (typeMetrics) {
      const totalProcessed = typeMetrics.count;
      const currentErrors = Math.floor(totalProcessed * (typeMetrics.errorRate / 100));
      typeMetrics.errorRate = ((currentErrors + 1) / totalProcessed) * 100;
    }
    
    // Update source error count
    const sourceMetrics = this.sourceMetrics.get(source);
    if (sourceMetrics) {
      sourceMetrics.errorCount++;
    }
  }

  /**
   * Get processing time bucket
   */
  private getProcessingTimeBucket(time: number): number {
    for (const bucket of this.processingTimeBuckets) {
      if (time <= bucket) return bucket;
    }
    return this.processingTimeBuckets[this.processingTimeBuckets.length - 1];
  }

  /**
   * Calculate current throughput
   */
  getCurrentThroughput(): number {
    if (this.throughputWindow.length === 0) return 0;
    
    const totalEvents = this.throughputWindow.reduce((sum, entry) => sum + entry.count, 0);
    const timeSpan = (Date.now() - this.throughputWindow[0].timestamp) / 1000;
    
    return timeSpan > 0 ? totalEvents / timeSpan : 0;
  }

  /**
   * Get average queue depth
   */
  getAverageQueueDepth(): number {
    if (this.queueDepthHistory.length === 0) return 0;
    
    const sum = this.queueDepthHistory.reduce((total, entry) => total + entry.depth, 0);
    return sum / this.queueDepthHistory.length;
  }

  /**
   * Get max queue depth
   */
  getMaxQueueDepth(): number {
    if (this.queueDepthHistory.length === 0) return 0;
    
    return Math.max(...this.queueDepthHistory.map(entry => entry.depth));
  }

  /**
   * Get processing time percentiles
   */
  getProcessingTimePercentiles(): { p50: number; p90: number; p99: number } {
    const totalEvents = Array.from(this.processingTimeHistogram.values())
      .reduce((sum, count) => sum + count, 0);
    
    if (totalEvents === 0) return { p50: 0, p90: 0, p99: 0 };
    
    const p50Target = totalEvents * 0.5;
    const p90Target = totalEvents * 0.9;
    const p99Target = totalEvents * 0.99;
    
    let cumulativeCount = 0;
    let p50 = 0, p90 = 0, p99 = 0;
    
    for (const [bucket, count] of Array.from(this.processingTimeHistogram.entries()).sort((a, b) => a[0] - b[0])) {
      cumulativeCount += count;
      
      if (p50 === 0 && cumulativeCount >= p50Target) p50 = bucket;
      if (p90 === 0 && cumulativeCount >= p90Target) p90 = bucket;
      if (p99 === 0 && cumulativeCount >= p99Target) p99 = bucket;
      
      if (p50 > 0 && p90 > 0 && p99 > 0) break;
    }
    
    return { p50, p90, p99 };
  }

  /**
   * Get all metrics
   */
  getMetrics(): any {
    const runtime = (Date.now() - this.startTime) / 1000;
    const percentiles = this.getProcessingTimePercentiles();
    
    // Calculate total events
    let totalEvents = 0;
    for (const metrics of this.eventTypeMetrics.values()) {
      totalEvents += metrics.count;
    }
    
    return {
      runtime,
      totalEvents,
      throughput: this.getCurrentThroughput(),
      avgQueueDepth: this.getAverageQueueDepth(),
      maxQueueDepth: this.getMaxQueueDepth(),
      processingTimePercentiles: percentiles,
      eventTypes: Object.fromEntries(this.eventTypeMetrics),
      sources: Object.fromEntries(this.sourceMetrics),
      histogram: Object.fromEntries(this.processingTimeHistogram)
    };
  }

  /**
   * Display metrics summary
   */
  displaySummary(): void {
    const metrics = this.getMetrics();
    
    console.log(chalk.gray('\n📊 Pipeline Metrics Summary:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Runtime: ${metrics.runtime.toFixed(0)}s`);
    console.log(`Total Events: ${metrics.totalEvents}`);
    console.log(`Throughput: ${metrics.throughput.toFixed(2)} events/s`);
    console.log(`Queue Depth: avg=${metrics.avgQueueDepth.toFixed(1)}, max=${metrics.maxQueueDepth}`);
    console.log(chalk.gray('─'.repeat(50)));
    console.log('Processing Time Percentiles:');
    console.log(`  P50: ${metrics.processingTimePercentiles.p50}ms`);
    console.log(`  P90: ${metrics.processingTimePercentiles.p90}ms`);
    console.log(`  P99: ${metrics.processingTimePercentiles.p99}ms`);
    console.log(chalk.gray('─'.repeat(50)));
    console.log('Event Types:');
    for (const [type, stats] of Object.entries(metrics.eventTypes)) {
      const typeMetrics = stats as EventTypeMetrics;
      console.log(`  ${type}: ${typeMetrics.count} events, ${typeMetrics.errorRate.toFixed(2)}% errors`);
    }
    console.log(chalk.gray('─'.repeat(50)));
    console.log('Sources:');
    for (const [source, stats] of Object.entries(metrics.sources)) {
      const sourceMetrics = stats as SourceMetrics;
      console.log(`  ${source}: ${sourceMetrics.eventsReceived} received, ${sourceMetrics.errorCount} errors`);
    }
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.eventTypeMetrics.clear();
    this.sourceMetrics.clear();
    this.processingTimeHistogram.clear();
    this.queueDepthHistory = [];
    this.throughputWindow = [];
    this.startTime = Date.now();
    
    // Re-initialize histogram buckets
    this.processingTimeBuckets.forEach(bucket => {
      this.processingTimeHistogram.set(bucket, 0);
    });
    
    this.logger.info('Metrics reset');
  }
}