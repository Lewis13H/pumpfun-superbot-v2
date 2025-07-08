/**
 * Holder Analysis Job Processor
 * Processes holder analysis jobs with worker pool support
 */

import { EventEmitter } from 'events';
import { Pool } from 'pg';
import { createLogger } from '../../core/logger';
import { HolderAnalysisService } from './holder-analysis-service';
import { 
  Job, 
  JobProcessor, 
  HolderAnalysisJobData,
  WorkerStats 
} from '../../types/holder-analysis-job.types';

const logger = createLogger('HolderAnalysisJobProcessor');

interface ProcessorOptions {
  maxWorkers?: number;
  workerIdleTimeout?: number;
  batchSize?: number;
  heliusApiKey?: string;
  shyftApiKey?: string;
}

export class HolderAnalysisJobProcessor extends EventEmitter {
  private workers: Map<string, Worker> = new Map();
  private options: Required<ProcessorOptions>;
  private analysisService: HolderAnalysisService;
  private _isShuttingDown = false;

  constructor(
    pool: Pool,
    options: ProcessorOptions = {}
  ) {
    super();
    
    this.options = {
      maxWorkers: options.maxWorkers || 3,
      workerIdleTimeout: options.workerIdleTimeout || 300000, // 5 minutes
      batchSize: options.batchSize || 10,
      heliusApiKey: options.heliusApiKey || process.env.HELIUS_API_KEY || '',
      shyftApiKey: options.shyftApiKey || process.env.SHYFT_API_KEY || ''
    };

    // Initialize analysis service
    this.analysisService = new HolderAnalysisService(
      pool,
      this.options.heliusApiKey,
      this.options.shyftApiKey
    );

    // Forward analysis events
    this.analysisService.on('analysis_progress', (data) => {
      this.emit('worker_progress', data);
    });
  }

  /**
   * Create the job processor function
   */
  createProcessor(): JobProcessor<HolderAnalysisJobData> {
    return async (job: Job<HolderAnalysisJobData>) => {
      const workerId = this.assignWorker(job.id);
      logger.debug(`Worker ${workerId} processing job ${job.id} (${job.type})`);

      try {
        // Update worker stats
        const worker = this.workers.get(workerId)!;
        worker.status = 'busy';
        worker.currentJob = job.id;
        worker.lastActivity = new Date();

        // Process based on job type
        let result;
        switch (job.type) {
          case 'single_analysis':
            result = await this.processSingleAnalysis(job);
            break;
          
          case 'batch_analysis':
            result = await this.processBatchAnalysis(job);
            break;
          
          case 'recurring_analysis':
            result = await this.processRecurringAnalysis(job);
            break;
          
          case 'trend_update':
            result = await this.processTrendUpdate(job);
            break;
          
          default:
            throw new Error(`Unknown job type: ${job.type}`);
        }

        // Update worker stats
        worker.status = 'idle';
        worker.currentJob = undefined;
        worker.jobsProcessed++;
        
        const processingTime = Date.now() - job.startedAt!.getTime();
        worker.averageProcessingTime = 
          (worker.averageProcessingTime * (worker.jobsProcessed - 1) + processingTime) / 
          worker.jobsProcessed;

        this.emit('worker_complete', { workerId, jobId: job.id, result });
        return result;

      } catch (error) {
        // Update worker error stats
        const worker = this.workers.get(workerId);
        if (worker) {
          worker.status = 'idle';
          worker.currentJob = undefined;
          worker.errors++;
        }

        logger.error(`Worker ${workerId} failed processing job ${job.id}:`, error);
        throw error;
      }
    };
  }

  /**
   * Process single token analysis
   */
  private async processSingleAnalysis(job: Job<HolderAnalysisJobData>): Promise<any> {
    const { mintAddress, options } = job.data;
    if (!mintAddress) {
      throw new Error('mintAddress is required for single analysis');
    }

    logger.debug(`Analyzing token ${mintAddress}`);
    
    // Report progress
    this.emit('job_progress', { 
      jobId: job.id, 
      progress: 10, 
      message: 'Starting analysis' 
    });

    const result = await this.analysisService.analyzeToken(mintAddress, {
      forceRefresh: options?.forceRefresh || false,
      maxHolders: options?.maxHolders || 1000,
      enableTrends: options?.enableTrends !== false,
      classifyWallets: options?.classifyWallets === true, // Changed: now false by default
      saveSnapshot: options?.saveSnapshot !== false
    });

    if (!result.success) {
      throw new Error(result.error || 'Analysis failed');
    }

    return result.analysis;
  }

  /**
   * Process batch token analysis
   */
  private async processBatchAnalysis(job: Job<HolderAnalysisJobData>): Promise<any> {
    const { mintAddresses, options } = job.data;
    if (!mintAddresses || mintAddresses.length === 0) {
      throw new Error('mintAddresses array is required for batch analysis');
    }

    logger.debug(`Batch analyzing ${mintAddresses.length} tokens`);
    
    const results = [];
    const errors = [];

    for (let i = 0; i < mintAddresses.length; i++) {
      const mintAddress = mintAddresses[i];
      
      // Report progress
      const progress = Math.floor((i / mintAddresses.length) * 100);
      this.emit('job_progress', { 
        jobId: job.id, 
        progress, 
        message: `Analyzing token ${i + 1}/${mintAddresses.length}` 
      });

      try {
        const result = await this.analysisService.analyzeToken(mintAddress, {
          forceRefresh: options?.forceRefresh || false,
          maxHolders: options?.maxHolders || 500, // Lower for batch
          enableTrends: options?.enableTrends || false, // Disable by default for batch
          classifyWallets: options?.classifyWallets === true, // Changed: now false by default
          saveSnapshot: options?.saveSnapshot !== false
        });

        if (result.success) {
          results.push({
            mintAddress,
            analysis: result.analysis,
            success: true
          });
        } else {
          errors.push({
            mintAddress,
            error: result.error,
            success: false
          });
        }

      } catch (error) {
        logger.error(`Failed to analyze ${mintAddress}:`, error);
        errors.push({
          mintAddress,
          error: error instanceof Error ? error.message : String(error),
          success: false
        });
      }

      // Small delay between tokens to avoid rate limits
      if (i < mintAddresses.length - 1) {
        await this.delay(500);
      }
    }

    return {
      total: mintAddresses.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors
    };
  }

  /**
   * Process recurring analysis (update existing analysis)
   */
  private async processRecurringAnalysis(job: Job<HolderAnalysisJobData>): Promise<any> {
    const { mintAddress, options } = job.data;
    if (!mintAddress) {
      throw new Error('mintAddress is required for recurring analysis');
    }

    logger.info(`Recurring analysis for token ${mintAddress}`);
    
    // Always force refresh for recurring analysis
    const result = await this.analysisService.analyzeToken(mintAddress, {
      forceRefresh: true,
      maxHolders: options?.maxHolders || 1000,
      enableTrends: true, // Always enable trends for recurring
      classifyWallets: options?.classifyWallets !== false,
      saveSnapshot: true // Always save snapshots for history
    });

    if (!result.success) {
      throw new Error(result.error || 'Recurring analysis failed');
    }

    // Check if significant changes occurred
    const significantChanges = this.detectSignificantChanges(result.analysis);
    if (significantChanges.length > 0) {
      this.emit('significant_changes', {
        mintAddress,
        changes: significantChanges,
        analysis: result.analysis
      });
    }

    return {
      analysis: result.analysis,
      changes: significantChanges
    };
  }

  /**
   * Process trend update job
   */
  private async processTrendUpdate(job: Job<HolderAnalysisJobData>): Promise<any> {
    const { mintAddress } = job.data;
    if (!mintAddress) {
      throw new Error('mintAddress is required for trend update');
    }

    logger.info(`Updating trends for token ${mintAddress}`);
    
    // This would typically update just the trend data without full re-analysis
    // For now, we'll do a light analysis
    const result = await this.analysisService.analyzeToken(mintAddress, {
      forceRefresh: false, // Use cached data if available
      maxHolders: 100, // Only top holders for trends
      enableTrends: true,
      classifyWallets: false, // Skip classification for speed
      saveSnapshot: false // Don't save, just calculate trends
    });

    if (!result.success) {
      throw new Error(result.error || 'Trend update failed');
    }

    return {
      mintAddress,
      trends: result.analysis?.trends,
      lastUpdated: new Date()
    };
  }

  /**
   * Detect significant changes in analysis
   */
  private detectSignificantChanges(analysis: any): string[] {
    const changes: string[] = [];

    // Check score changes
    if (analysis.trends) {
      const scoreDiff = Math.abs(analysis.trends.scoreChange || 0);
      if (scoreDiff >= 20) {
        changes.push(`Score changed by ${scoreDiff} points`);
      }

      // Check holder count changes
      const holderChange = analysis.trends.holderCountChange || 0;
      if (Math.abs(holderChange) >= 50) {
        changes.push(`Holder count changed by ${holderChange}`);
      }

      // Check concentration changes
      const concentrationChange = analysis.trends.concentrationChange || 0;
      if (Math.abs(concentrationChange) >= 10) {
        changes.push(`Top 10 concentration changed by ${concentrationChange}%`);
      }
    }

    // Check for critical score
    if (analysis.holderScore < 100) {
      changes.push('Score dropped to critical level');
    }

    return changes;
  }

  /**
   * Assign a worker to a job
   */
  private assignWorker(_jobId: string): string {
    // Find idle worker
    for (const [id, worker] of this.workers) {
      if (worker.status === 'idle') {
        return id;
      }
    }

    // Create new worker if under limit
    if (this.workers.size < this.options.maxWorkers) {
      const workerId = `worker-${this.workers.size + 1}`;
      const worker: Worker = {
        id: workerId,
        status: 'idle',
        jobsProcessed: 0,
        errors: 0,
        averageProcessingTime: 0,
        lastActivity: new Date()
      };
      
      this.workers.set(workerId, worker);
      logger.info(`Created new worker: ${workerId}`);
      return workerId;
    }

    // Wait for available worker (shouldn't happen with proper queue management)
    throw new Error('No available workers');
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): WorkerStats[] {
    return Array.from(this.workers.values());
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown workers gracefully
   */
  async shutdown(): Promise<void> {
    this._isShuttingDown = true;
    
    // Wait for busy workers to complete
    const busyWorkers = Array.from(this.workers.values()).filter(w => w.status === 'busy');
    if (busyWorkers.length > 0) {
      logger.info(`Waiting for ${busyWorkers.length} workers to complete...`);
      
      // Wait up to 30 seconds
      const timeout = 30000;
      const start = Date.now();
      
      while (busyWorkers.some(w => w.status === 'busy') && Date.now() - start < timeout) {
        await this.delay(100);
      }
    }

    this.workers.clear();
    this.removeAllListeners();
    logger.info('Job processor shut down');
  }
}

interface Worker extends WorkerStats {
  // Additional internal properties if needed
}