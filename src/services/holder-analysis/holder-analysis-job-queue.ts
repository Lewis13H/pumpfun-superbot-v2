/**
 * Holder Analysis Job Queue
 * In-memory job queue with priority processing and retry logic
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../core/logger';
import {
  Job,
  JobOptions,
  JobProcessor,
  JobQueue,
  JobStatus,
  HolderAnalysisJobData,
  QueueStats,
  JobEvent,
  PRIORITY_WEIGHTS,
  DEFAULT_JOB_OPTIONS
} from '../../types/holder-analysis-job.types';

const logger = createLogger('HolderAnalysisJobQueue');

export class HolderAnalysisJobQueue extends EventEmitter implements JobQueue<HolderAnalysisJobData> {
  private jobs: Map<string, Job<HolderAnalysisJobData>> = new Map();
  private pendingJobs: Job<HolderAnalysisJobData>[] = [];
  private activeJobs: Set<string> = new Set();
  private completedCount = 0;
  private failedCount = 0;
  private isProcessing = false;
  private isPaused = false;
  private processors: JobProcessor<HolderAnalysisJobData>[] = [];
  private concurrency = 1;
  private processInterval?: NodeJS.Timeout;
  private startTime = Date.now();

  constructor() {
    super();
    this.startProcessingLoop();
  }

  /**
   * Add a job to the queue
   */
  async add(data: HolderAnalysisJobData, options: JobOptions = {}): Promise<Job<HolderAnalysisJobData>> {
    const jobOptions = { ...DEFAULT_JOB_OPTIONS, ...options };
    const job: Job<HolderAnalysisJobData> = {
      id: uuidv4(),
      type: data.type,
      data,
      status: 'pending',
      priority: jobOptions.priority,
      attempts: 0,
      maxRetries: jobOptions.retries,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: data.metadata
    };

    // Handle delay
    if (jobOptions.delay && jobOptions.delay > 0) {
      job.nextRetryAt = new Date(Date.now() + jobOptions.delay);
    }

    this.jobs.set(job.id, job);
    this.insertJobByPriority(job);

    this.emitJobEvent(job.id, 'added', { job });
    logger.info(`Job added: ${job.id} (${job.type}) with priority ${job.priority}`);

    return job;
  }

  /**
   * Process jobs with specified concurrency
   */
  process(concurrency: number, processor: JobProcessor<HolderAnalysisJobData>): void {
    this.concurrency = concurrency;
    this.processors.push(processor);
    this.isProcessing = true;
    logger.info(`Job processor registered with concurrency: ${concurrency}`);
  }

  /**
   * Pause job processing
   */
  async pause(): Promise<void> {
    this.isPaused = true;
    logger.info('Job queue paused');
  }

  /**
   * Resume job processing
   */
  async resume(): Promise<void> {
    this.isPaused = false;
    logger.info('Job queue resumed');
  }

  /**
   * Get a specific job
   */
  async getJob(id: string): Promise<Job<HolderAnalysisJobData> | null> {
    return this.jobs.get(id) || null;
  }

  /**
   * Get jobs by status
   */
  async getJobs(status?: JobStatus): Promise<Job<HolderAnalysisJobData>[]> {
    const allJobs = Array.from(this.jobs.values());
    return status ? allJobs.filter(job => job.status === status) : allJobs;
  }

  /**
   * Remove a job
   */
  async removeJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;

    // Remove from pending queue
    this.pendingJobs = this.pendingJobs.filter(j => j.id !== id);
    
    // Remove from active set
    this.activeJobs.delete(id);
    
    // Remove from job map
    this.jobs.delete(id);

    this.emitJobEvent(id, 'removed');
    return true;
  }

  /**
   * Clear all jobs
   */
  async clear(): Promise<void> {
    this.jobs.clear();
    this.pendingJobs = [];
    this.activeJobs.clear();
    this.completedCount = 0;
    this.failedCount = 0;
    logger.info('Job queue cleared');
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const jobs = Array.from(this.jobs.values());
    const now = Date.now();

    const stats: QueueStats = {
      waiting: jobs.filter(j => j.status === 'pending').length,
      active: this.activeJobs.size,
      completed: this.completedCount,
      failed: this.failedCount,
      delayed: jobs.filter(j => j.nextRetryAt && j.nextRetryAt > new Date()).length,
      total: jobs.length
    };

    // Calculate oldest job age
    const oldestJob = jobs
      .filter(j => j.status === 'pending')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    
    if (oldestJob) {
      stats.oldestJobAge = now - oldestJob.createdAt.getTime();
    }

    // Calculate average processing time
    const completedJobs = jobs.filter(j => j.status === 'completed' && j.startedAt && j.completedAt);
    if (completedJobs.length > 0) {
      const totalTime = completedJobs.reduce((sum, job) => {
        return sum + (job.completedAt!.getTime() - job.startedAt!.getTime());
      }, 0);
      stats.averageProcessingTime = totalTime / completedJobs.length;
    }

    // Calculate throughput (jobs per minute)
    const runtime = (now - this.startTime) / 60000; // Convert to minutes
    if (runtime > 0) {
      stats.throughput = this.completedCount / runtime;
    }

    return stats;
  }

  /**
   * Get next job to process
   */
  private getNextJob(): Job<HolderAnalysisJobData> | null {
    const now = new Date();
    
    // Find first job that's ready to process
    for (let i = 0; i < this.pendingJobs.length; i++) {
      const job = this.pendingJobs[i];
      
      // Skip if job has a delay that hasn't expired
      if (job.nextRetryAt && job.nextRetryAt > now) {
        continue;
      }

      // Remove from pending queue
      this.pendingJobs.splice(i, 1);
      return job;
    }

    return null;
  }

  /**
   * Insert job into pending queue by priority
   */
  private insertJobByPriority(job: Job<HolderAnalysisJobData>): void {
    const weight = PRIORITY_WEIGHTS[job.priority];
    
    // Find insertion point
    let insertIndex = this.pendingJobs.length;
    for (let i = 0; i < this.pendingJobs.length; i++) {
      const existingWeight = PRIORITY_WEIGHTS[this.pendingJobs[i].priority];
      if (weight > existingWeight) {
        insertIndex = i;
        break;
      }
    }

    // Insert at the found position
    this.pendingJobs.splice(insertIndex, 0, job);
  }

  /**
   * Process a single job
   */
  private async processJob(job: Job<HolderAnalysisJobData>): Promise<void> {
    // Update job status
    job.status = 'running';
    job.startedAt = new Date();
    job.updatedAt = new Date();
    job.attempts++;
    
    this.activeJobs.add(job.id);
    this.emitJobEvent(job.id, 'started', { attempt: job.attempts });

    try {
      // Run the processor
      const processor = this.processors[0]; // Use first processor for now
      if (!processor) {
        throw new Error('No processor registered');
      }

      const result = await processor(job);
      
      // Job completed successfully
      job.status = 'completed';
      job.completedAt = new Date();
      job.updatedAt = new Date();
      job.result = result;
      
      this.completedCount++;
      this.activeJobs.delete(job.id);
      
      this.emitJobEvent(job.id, 'completed', { result });
      logger.info(`Job completed: ${job.id} in ${job.completedAt.getTime() - job.startedAt!.getTime()}ms`);

      // Remove job if configured
      if (job.metadata?.removeOnComplete !== false) {
        await this.removeJob(job.id);
      }

    } catch (error) {
      // Job failed
      job.status = 'failed';
      job.failedAt = new Date();
      job.updatedAt = new Date();
      job.error = error instanceof Error ? error.message : String(error);
      
      this.activeJobs.delete(job.id);
      
      logger.error(`Job failed: ${job.id}`, error);
      
      // Check if we should retry
      if (job.attempts < job.maxRetries) {
        job.status = 'pending';
        job.nextRetryAt = new Date(Date.now() + (job.metadata?.retryDelay || DEFAULT_JOB_OPTIONS.retryDelay));
        this.insertJobByPriority(job);
        
        this.emitJobEvent(job.id, 'retrying', { 
          attempt: job.attempts, 
          nextRetry: job.nextRetryAt 
        });
        
        logger.info(`Job ${job.id} will retry at ${job.nextRetryAt}`);
      } else {
        this.failedCount++;
        this.emitJobEvent(job.id, 'failed', { error: job.error });
        
        // Remove job if configured
        if (job.metadata?.removeOnFail !== false) {
          await this.removeJob(job.id);
        }
      }
    }
  }

  /**
   * Main processing loop
   */
  private startProcessingLoop(): void {
    this.processInterval = setInterval(async () => {
      if (!this.isProcessing || this.isPaused) return;
      
      // Check if we can process more jobs
      while (this.activeJobs.size < this.concurrency) {
        const job = this.getNextJob();
        if (!job) break;
        
        // Process job without blocking the loop
        this.processJob(job).catch(error => {
          logger.error('Unexpected error in job processing:', error);
        });
      }
    }, 100); // Check every 100ms
  }

  /**
   * Emit job event
   */
  private emitJobEvent(jobId: string, type: JobEvent['type'], data?: any): void {
    const event: JobEvent = {
      jobId,
      type,
      timestamp: new Date(),
      data
    };
    
    this.emit('job', event);
    this.emit(`job:${type}`, event);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
    }
    this.removeAllListeners();
    this.jobs.clear();
    this.pendingJobs = [];
    this.activeJobs.clear();
  }
}