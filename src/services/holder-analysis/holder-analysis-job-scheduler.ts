/**
 * Holder Analysis Job Scheduler
 * Manages recurring analysis jobs and scheduled tasks
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../core/logger';
import { HolderAnalysisJobQueue } from './holder-analysis-job-queue';
import { 
  RecurringJobConfig, 
  JobOptions,
  HolderAnalysisJobData 
} from '../../types/holder-analysis-job.types';

const logger = createLogger('HolderAnalysisJobScheduler');

interface SchedulerOptions {
  defaultInterval?: number;      // Default interval in minutes
  maxConcurrentJobs?: number;
  enableAutoScheduling?: boolean;
}

interface ScheduledJob {
  config: RecurringJobConfig;
  interval?: NodeJS.Timeout;
  customRunner?: () => Promise<void>;
  isRunning: boolean;
  start: () => void;
  stop: () => void;
  getNextRun: () => Date | undefined;
}

export class HolderAnalysisJobScheduler extends EventEmitter {
  private scheduledJobs: Map<string, ScheduledJob> = new Map();
  private queue: HolderAnalysisJobQueue;
  private options: Required<SchedulerOptions>;
  private isRunning = false;

  constructor(
    queue: HolderAnalysisJobQueue,
    options: SchedulerOptions = {}
  ) {
    super();
    
    this.queue = queue;
    this.options = {
      defaultInterval: options.defaultInterval || 60, // 1 hour default
      maxConcurrentJobs: options.maxConcurrentJobs || 5,
      enableAutoScheduling: options.enableAutoScheduling !== false
    };

    // Listen to queue events
    this.queue.on('job:completed', (event) => {
      this.handleJobCompleted(event);
    });
  }

  /**
   * Schedule a recurring analysis job
   */
  scheduleRecurringAnalysis(config: RecurringJobConfig): boolean {
    if (this.scheduledJobs.has(config.id)) {
      logger.warn(`Job ${config.id} already scheduled`);
      return false;
    }

    try {
      const scheduledJob = this.createScheduledJob(config);
      this.scheduledJobs.set(config.id, scheduledJob);
      
      if (config.enabled && this.isRunning) {
        scheduledJob.start();
      }

      logger.info(`Scheduled recurring job: ${config.id} (${config.schedule})`);
      this.emit('job_scheduled', config);
      return true;

    } catch (error) {
      logger.error(`Failed to schedule job ${config.id}:`, error);
      return false;
    }
  }

  /**
   * Schedule analysis for top tokens
   */
  async scheduleTopTokensAnalysis(
    tokenCount: number = 100,
    intervalMinutes: number = 360 // Every 6 hours
  ): Promise<void> {
    const config: RecurringJobConfig = {
      id: 'top-tokens-analysis',
      name: 'Top Tokens Holder Analysis',
      schedule: `${intervalMinutes}m`,
      data: {
        type: 'batch_analysis',
        mintAddresses: [], // Will be populated dynamically
        options: {
          forceRefresh: true,
          maxHolders: 500,
          enableTrends: true,
          classifyWallets: true,
          saveSnapshot: true
        },
        metadata: {
          source: 'top_tokens',
          tokenCount
        }
      },
      options: {
        priority: 'high',
        timeout: 3600000 // 1 hour
      },
      enabled: true
    };

    // Custom job runner that fetches top tokens
    const job = this.createScheduledJob(config);
    job.customRunner = async () => {
      try {
        // Fetch top tokens from database
        const topTokens = await this.fetchTopTokens(tokenCount);
        if (topTokens.length === 0) {
          logger.warn('No top tokens found for analysis');
          return;
        }

        // Update job data with current top tokens
        config.data.mintAddresses = topTokens;
        config.lastRun = new Date();
        
        // Add to queue
        await this.queue.add(config.data, config.options);
        logger.info(`Scheduled analysis for ${topTokens.length} top tokens`);
        
      } catch (error) {
        logger.error('Failed to schedule top tokens analysis:', error);
      }
    };

    this.scheduledJobs.set(config.id, job);
    
    if (this.isRunning) {
      job.start();
    }
  }

  /**
   * Schedule trending tokens analysis
   */
  async scheduleTrendingTokensAnalysis(
    intervalMinutes: number = 120 // Every 2 hours
  ): Promise<void> {
    const config: RecurringJobConfig = {
      id: 'trending-tokens-analysis',
      name: 'Trending Tokens Holder Analysis',
      schedule: `${intervalMinutes}m`,
      data: {
        type: 'batch_analysis',
        mintAddresses: [], // Will be populated dynamically
        options: {
          forceRefresh: true,
          maxHolders: 1000,
          enableTrends: true,
          classifyWallets: true,
          saveSnapshot: true
        },
        metadata: {
          source: 'trending',
          criteria: 'volume_24h'
        }
      },
      options: {
        priority: 'critical',
        timeout: 1800000 // 30 minutes
      },
      enabled: true
    };

    // Custom job runner that fetches trending tokens
    const job = this.createScheduledJob(config);
    job.customRunner = async () => {
      try {
        // Fetch trending tokens
        const trendingTokens = await this.fetchTrendingTokens();
        if (trendingTokens.length === 0) {
          logger.warn('No trending tokens found for analysis');
          return;
        }

        // Update job data
        config.data.mintAddresses = trendingTokens;
        config.lastRun = new Date();
        
        // Add to queue with high priority
        await this.queue.add(config.data, config.options);
        logger.info(`Scheduled analysis for ${trendingTokens.length} trending tokens`);
        
      } catch (error) {
        logger.error('Failed to schedule trending tokens analysis:', error);
      }
    };

    this.scheduledJobs.set(config.id, job);
    
    if (this.isRunning) {
      job.start();
    }
  }

  /**
   * Schedule analysis for tokens with poor scores
   */
  async schedulePoorScoreReanalysis(
    scoreThreshold: number = 100,
    intervalMinutes: number = 720 // Every 12 hours
  ): Promise<void> {
    const config: RecurringJobConfig = {
      id: 'poor-score-reanalysis',
      name: 'Poor Score Token Reanalysis',
      schedule: `${intervalMinutes}m`,
      data: {
        type: 'batch_analysis',
        mintAddresses: [],
        options: {
          forceRefresh: true,
          maxHolders: 1000,
          enableTrends: true,
          classifyWallets: true,
          saveSnapshot: true
        },
        metadata: {
          source: 'poor_score',
          scoreThreshold
        }
      },
      options: {
        priority: 'normal',
        timeout: 3600000
      },
      enabled: true
    };

    const job = this.createScheduledJob(config);
    job.customRunner = async () => {
      try {
        const poorScoreTokens = await this.fetchPoorScoreTokens(scoreThreshold);
        if (poorScoreTokens.length === 0) {
          logger.info('No poor score tokens found for reanalysis');
          return;
        }

        config.data.mintAddresses = poorScoreTokens;
        config.lastRun = new Date();
        
        await this.queue.add(config.data, config.options);
        logger.info(`Scheduled reanalysis for ${poorScoreTokens.length} poor score tokens`);
        
      } catch (error) {
        logger.error('Failed to schedule poor score reanalysis:', error);
      }
    };

    this.scheduledJobs.set(config.id, job);
    
    if (this.isRunning) {
      job.start();
    }
  }

  /**
   * Unschedule a job
   */
  unschedule(jobId: string): boolean {
    const job = this.scheduledJobs.get(jobId);
    if (!job) return false;

    job.stop();
    this.scheduledJobs.delete(jobId);
    
    logger.info(`Unscheduled job: ${jobId}`);
    this.emit('job_unscheduled', jobId);
    return true;
  }

  /**
   * Start all scheduled jobs
   */
  start(): void {
    this.isRunning = true;
    
    for (const [id, job] of this.scheduledJobs) {
      if (job.config.enabled) {
        job.start();
        logger.info(`Started scheduled job: ${id}`);
      }
    }
    
    this.emit('scheduler_started');
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    this.isRunning = false;
    
    for (const [id, job] of this.scheduledJobs) {
      job.stop();
      logger.info(`Stopped scheduled job: ${id}`);
    }
    
    this.emit('scheduler_stopped');
  }

  /**
   * Get scheduled job status
   */
  getScheduledJobs(): RecurringJobConfig[] {
    return Array.from(this.scheduledJobs.values()).map(job => ({
      ...job.config,
      lastRun: job.config.lastRun,
      nextRun: job.getNextRun()
    }));
  }

  /**
   * Create a scheduled job
   */
  private createScheduledJob(config: RecurringJobConfig): ScheduledJob {
    const intervalMs = this.parseInterval(config.schedule) * 1000;
    
    const job: ScheduledJob = {
      config,
      isRunning: false,
      start: function() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        // Run immediately if no lastRun
        if (!this.config.lastRun && this.customRunner) {
          this.customRunner();
        } else if (!this.customRunner) {
          // Regular job
          runScheduledJob(this.config);
        }
        
        // Set up interval
        this.interval = setInterval(() => {
          if (this.customRunner) {
            this.customRunner();
          } else {
            runScheduledJob(this.config);
          }
        }, intervalMs);
      },
      stop: function() {
        if (this.interval) {
          clearInterval(this.interval);
          this.interval = undefined;
        }
        this.isRunning = false;
      },
      getNextRun: function() {
        if (this.config.lastRun) {
          return new Date(this.config.lastRun.getTime() + intervalMs);
        }
        return undefined;
      }
    };

    const runScheduledJob = async (cfg: RecurringJobConfig) => {
      await this.runScheduledJob(cfg);
    };

    return job;
  }

  /**
   * Run a scheduled job
   */
  private async runScheduledJob(config: RecurringJobConfig): Promise<void> {
    try {
      logger.info(`Running scheduled job: ${config.id}`);
      config.lastRun = new Date();
      
      // Add job to queue
      const job = await this.queue.add(config.data, config.options);
      
      this.emit('scheduled_job_run', {
        config,
        jobId: job.id
      });
      
    } catch (error) {
      logger.error(`Failed to run scheduled job ${config.id}:`, error);
      this.emit('scheduled_job_error', {
        config,
        error
      });
    }
  }

  /**
   * Parse interval string to seconds
   */
  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) {
      // Default to minutes if just a number
      const minutes = parseInt(interval);
      return isNaN(minutes) ? this.options.defaultInterval * 60 : minutes * 60;
    }

    const [, value, unit] = match;
    const num = parseInt(value);

    switch (unit) {
      case 's': return num;
      case 'm': return num * 60;
      case 'h': return num * 3600;
      case 'd': return num * 86400;
      default: return this.options.defaultInterval * 60;
    }
  }

  /**
   * Handle job completion for auto-scheduling
   */
  private handleJobCompleted(event: any): void {
    if (!this.options.enableAutoScheduling) return;

    // Check if this was a recurring job that needs rescheduling
    const jobData = event.data?.job?.data;
    if (jobData?.metadata?.reschedule) {
      const interval = jobData.metadata.rescheduleInterval || this.options.defaultInterval;
      
      setTimeout(() => {
        this.queue.add(jobData, {
          priority: 'normal',
          delay: 0
        }).catch(error => {
          logger.error('Failed to auto-reschedule job:', error);
        });
      }, interval * 60 * 1000);
    }
  }

  /**
   * Fetch top tokens from database (placeholder)
   */
  private async fetchTopTokens(limit: number): Promise<string[]> {
    // This would query your database for top tokens by market cap
    // For now, return empty array
    logger.warn('fetchTopTokens not implemented - using placeholder');
    return [];
  }

  /**
   * Fetch trending tokens (placeholder)
   */
  private async fetchTrendingTokens(): Promise<string[]> {
    // This would query your database for trending tokens
    logger.warn('fetchTrendingTokens not implemented - using placeholder');
    return [];
  }

  /**
   * Fetch tokens with poor scores (placeholder)
   */
  private async fetchPoorScoreTokens(threshold: number): Promise<string[]> {
    // This would query your database for tokens with low scores
    logger.warn('fetchPoorScoreTokens not implemented - using placeholder');
    return [];
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    this.scheduledJobs.clear();
    this.removeAllListeners();
  }
}