/**
 * Holder Analysis Job Monitor
 * Monitors job queue performance and health
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../core/logger';
import { HolderAnalysisJobQueue } from './holder-analysis-job-queue';
import { HolderAnalysisJobProcessor } from './holder-analysis-job-processor';
import { HolderAnalysisJobScheduler } from './holder-analysis-job-scheduler';
import { 
  QueueStats, 
  WorkerStats,
  JobEvent 
} from '../../types/holder-analysis-job.types';

const logger = createLogger('HolderAnalysisJobMonitor');

interface MonitorOptions {
  metricsInterval?: number;      // Interval for metrics collection in ms
  alertThresholds?: AlertThresholds;
  enableAlerts?: boolean;
}

interface AlertThresholds {
  queueDepth?: number;          // Max pending jobs
  processingTime?: number;      // Max average processing time in ms
  errorRate?: number;           // Max error rate percentage
  workerIdleTime?: number;      // Max idle time in ms
}

interface Metrics {
  timestamp: Date;
  queue: QueueStats;
  workers: WorkerStats[];
  performance: PerformanceMetrics;
  alerts: Alert[];
}

interface PerformanceMetrics {
  throughput: number;           // Jobs per minute
  averageWaitTime: number;      // Average time in queue
  successRate: number;          // Success percentage
  errorRate: number;            // Error percentage
  jobsPerWorker: number;        // Average jobs per worker
}

interface Alert {
  type: 'queue_depth' | 'slow_processing' | 'high_error_rate' | 'worker_idle';
  severity: 'warning' | 'error' | 'critical';
  message: string;
  timestamp: Date;
  data?: any;
}

export class HolderAnalysisJobMonitor extends EventEmitter {
  private queue: HolderAnalysisJobQueue;
  private processor: HolderAnalysisJobProcessor;
  private scheduler?: HolderAnalysisJobScheduler;
  private options: Required<MonitorOptions>;
  private metricsInterval?: NodeJS.Timeout;
  private metrics: Metrics[] = [];
  private jobEvents: JobEvent[] = [];
  private startTime = Date.now();
  private jobTimings: Map<string, number> = new Map();

  constructor(
    queue: HolderAnalysisJobQueue,
    processor: HolderAnalysisJobProcessor,
    scheduler?: HolderAnalysisJobScheduler,
    options: MonitorOptions = {}
  ) {
    super();

    this.queue = queue;
    this.processor = processor;
    this.scheduler = scheduler;
    
    this.options = {
      metricsInterval: options.metricsInterval || 30000, // 30 seconds
      enableAlerts: options.enableAlerts !== false,
      alertThresholds: {
        queueDepth: options.alertThresholds?.queueDepth || 100,
        processingTime: options.alertThresholds?.processingTime || 300000, // 5 minutes
        errorRate: options.alertThresholds?.errorRate || 10, // 10%
        workerIdleTime: options.alertThresholds?.workerIdleTime || 600000 // 10 minutes
      }
    };

    this.setupEventListeners();
  }

  /**
   * Start monitoring
   */
  start(): void {
    logger.info('Starting job monitor');
    
    // Collect initial metrics
    this.collectMetrics();
    
    // Start periodic metrics collection
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.options.metricsInterval);
    
    this.emit('monitor_started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }
    
    logger.info('Stopped job monitor');
    this.emit('monitor_stopped');
  }

  /**
   * Get current metrics
   */
  async getCurrentMetrics(): Promise<Metrics> {
    const queueStats = await this.queue.getStats();
    const workerStats = this.processor.getWorkerStats();
    const performance = this.calculatePerformanceMetrics(queueStats, workerStats);
    const alerts = this.checkAlerts(queueStats, workerStats, performance);

    return {
      timestamp: new Date(),
      queue: queueStats,
      workers: workerStats,
      performance,
      alerts
    };
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(limit?: number): Metrics[] {
    if (limit) {
      return this.metrics.slice(-limit);
    }
    return [...this.metrics];
  }

  /**
   * Get job events
   */
  getJobEvents(limit?: number): JobEvent[] {
    if (limit) {
      return this.jobEvents.slice(-limit);
    }
    return [...this.jobEvents];
  }

  /**
   * Get dashboard data
   */
  async getDashboardData(): Promise<{
    current: Metrics;
    history: Metrics[];
    scheduledJobs: any[];
    summary: {
      totalProcessed: number;
      totalFailed: number;
      averageProcessingTime: number;
      uptime: number;
      healthScore: number;
    };
  }> {
    const current = await this.getCurrentMetrics();
    const history = this.getMetricsHistory(20); // Last 20 data points
    const scheduledJobs = this.scheduler ? this.scheduler.getScheduledJobs() : [];
    
    // Calculate summary
    const totalProcessed = current.queue.completed;
    const totalFailed = current.queue.failed;
    const averageProcessingTime = current.queue.averageProcessingTime || 0;
    const uptime = Date.now() - this.startTime;
    
    // Calculate health score (0-100)
    const healthScore = this.calculateHealthScore(current);

    return {
      current,
      history,
      scheduledJobs,
      summary: {
        totalProcessed,
        totalFailed,
        averageProcessingTime,
        uptime,
        healthScore
      }
    };
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Queue events
    this.queue.on('job', (event: JobEvent) => {
      this.jobEvents.push(event);
      
      // Keep only last 1000 events
      if (this.jobEvents.length > 1000) {
        this.jobEvents = this.jobEvents.slice(-1000);
      }

      // Track job timings
      if (event.type === 'started') {
        this.jobTimings.set(event.jobId, Date.now());
      } else if (event.type === 'completed' || event.type === 'failed') {
        const startTime = this.jobTimings.get(event.jobId);
        if (startTime) {
          const duration = Date.now() - startTime;
          this.emit('job_duration', { jobId: event.jobId, duration });
          this.jobTimings.delete(event.jobId);
        }
      }
    });

    // Worker events
    this.processor.on('worker_progress', (data) => {
      this.emit('worker_activity', data);
    });

    this.processor.on('significant_changes', (data) => {
      logger.warn('Significant changes detected:', data);
      this.emit('significant_changes', data);
    });

    // Scheduler events
    if (this.scheduler) {
      this.scheduler.on('scheduled_job_error', (data) => {
        logger.error('Scheduled job error:', data.error);
        this.emit('scheduled_job_error', data);
      });
    }
  }

  /**
   * Collect metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const metrics = await this.getCurrentMetrics();
      this.metrics.push(metrics);
      
      // Keep only last 1440 metrics (24 hours at 1 minute intervals)
      if (this.metrics.length > 1440) {
        this.metrics = this.metrics.slice(-1440);
      }

      // Emit metrics
      this.emit('metrics_collected', metrics);
      
      // Check for alerts
      if (this.options.enableAlerts && metrics.alerts.length > 0) {
        metrics.alerts.forEach(alert => {
          this.emit('alert', alert);
          logger.warn(`Alert: ${alert.message}`);
        });
      }

    } catch (error) {
      logger.error('Failed to collect metrics:', error);
    }
  }

  /**
   * Calculate performance metrics
   */
  private calculatePerformanceMetrics(
    queueStats: QueueStats,
    workerStats: WorkerStats[]
  ): PerformanceMetrics {
    const runtime = (Date.now() - this.startTime) / 60000; // minutes
    const throughput = runtime > 0 ? (queueStats.completed / runtime) : 0;
    
    const totalJobs = queueStats.completed + queueStats.failed;
    const successRate = totalJobs > 0 ? (queueStats.completed / totalJobs) * 100 : 100;
    const errorRate = totalJobs > 0 ? (queueStats.failed / totalJobs) * 100 : 0;
    
    const activeWorkers = workerStats.filter(w => w.jobsProcessed > 0).length;
    const jobsPerWorker = activeWorkers > 0 ? queueStats.completed / activeWorkers : 0;
    
    // Calculate average wait time from recent job events
    const recentStarts = this.jobEvents
      .filter(e => e.type === 'started')
      .slice(-50); // Last 50 jobs
    
    let averageWaitTime = 0;
    if (recentStarts.length > 0) {
      // This is simplified - in production you'd track actual wait times
      averageWaitTime = queueStats.waiting > 10 ? 60000 : 5000; // Estimate based on queue depth
    }

    return {
      throughput,
      averageWaitTime,
      successRate,
      errorRate,
      jobsPerWorker
    };
  }

  /**
   * Check for alerts
   */
  private checkAlerts(
    queueStats: QueueStats,
    workerStats: WorkerStats[],
    performance: PerformanceMetrics
  ): Alert[] {
    const alerts: Alert[] = [];
    const thresholds = this.options.alertThresholds;

    // Queue depth alert
    if (queueStats.waiting > thresholds.queueDepth!) {
      alerts.push({
        type: 'queue_depth',
        severity: queueStats.waiting > thresholds.queueDepth! * 2 ? 'critical' : 'warning',
        message: `Queue depth (${queueStats.waiting}) exceeds threshold (${thresholds.queueDepth})`,
        timestamp: new Date(),
        data: { queueDepth: queueStats.waiting }
      });
    }

    // Processing time alert
    if (queueStats.averageProcessingTime && queueStats.averageProcessingTime > thresholds.processingTime!) {
      alerts.push({
        type: 'slow_processing',
        severity: 'warning',
        message: `Average processing time (${Math.round(queueStats.averageProcessingTime / 1000)}s) exceeds threshold`,
        timestamp: new Date(),
        data: { averageProcessingTime: queueStats.averageProcessingTime }
      });
    }

    // Error rate alert
    if (performance.errorRate > thresholds.errorRate!) {
      alerts.push({
        type: 'high_error_rate',
        severity: performance.errorRate > thresholds.errorRate! * 2 ? 'critical' : 'error',
        message: `Error rate (${performance.errorRate.toFixed(1)}%) exceeds threshold`,
        timestamp: new Date(),
        data: { errorRate: performance.errorRate }
      });
    }

    // Worker idle alert
    const now = Date.now();
    workerStats.forEach(worker => {
      if (worker.status === 'idle') {
        const idleTime = now - worker.lastActivity.getTime();
        if (idleTime > thresholds.workerIdleTime!) {
          alerts.push({
            type: 'worker_idle',
            severity: 'warning',
            message: `Worker ${worker.id} has been idle for ${Math.round(idleTime / 60000)} minutes`,
            timestamp: new Date(),
            data: { workerId: worker.id, idleTime }
          });
        }
      }
    });

    return alerts;
  }

  /**
   * Calculate health score (0-100)
   */
  private calculateHealthScore(metrics: Metrics): number {
    let score = 100;
    
    // Deduct for queue depth
    if (metrics.queue.waiting > 50) {
      score -= Math.min(20, metrics.queue.waiting / 10);
    }
    
    // Deduct for error rate
    if (metrics.performance.errorRate > 5) {
      score -= Math.min(30, metrics.performance.errorRate * 2);
    }
    
    // Deduct for slow processing
    if (metrics.queue.averageProcessingTime && metrics.queue.averageProcessingTime > 120000) {
      score -= 20;
    }
    
    // Deduct for alerts
    score -= metrics.alerts.length * 5;
    
    // Bonus for good throughput
    if (metrics.performance.throughput > 10) {
      score += 10;
    }
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    this.removeAllListeners();
    this.metrics = [];
    this.jobEvents = [];
    this.jobTimings.clear();
  }
}