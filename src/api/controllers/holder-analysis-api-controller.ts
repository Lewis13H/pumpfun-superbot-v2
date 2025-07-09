/**
 * Holder Analysis API Controller
 * REST API endpoints for holder analysis dashboard
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { createLogger } from '../../core/logger';
import { HolderAnalysisService } from '../../services/holder-analysis/holder-analysis-service';
import { HolderAnalysisJobQueue } from '../../services/holder-analysis/holder-analysis-job-queue';
import { HolderAnalysisJobProcessor } from '../../services/holder-analysis/holder-analysis-job-processor';
import { HolderAnalysisJobScheduler } from '../../services/holder-analysis/holder-analysis-job-scheduler';
import { HolderAnalysisJobMonitor } from '../../services/holder-analysis/holder-analysis-job-monitor';

const logger = createLogger('HolderAnalysisAPI');

export class HolderAnalysisApiController {
  private _analysisService: HolderAnalysisService;
  private jobQueue: HolderAnalysisJobQueue;
  private jobProcessor: HolderAnalysisJobProcessor;
  private jobScheduler: HolderAnalysisJobScheduler;
  private jobMonitor: HolderAnalysisJobMonitor;

  constructor(
    private pool: Pool,
    heliusApiKey?: string,
    shyftApiKey?: string
  ) {
    // Initialize services
    this._analysisService = new HolderAnalysisService(
      pool,
      heliusApiKey || process.env.HELIUS_API_KEY || '',
      shyftApiKey || process.env.SHYFT_API_KEY || ''
    );

    // Initialize job queue system
    this.jobQueue = new HolderAnalysisJobQueue();
    this.jobProcessor = new HolderAnalysisJobProcessor(pool, {
      maxWorkers: 3,
      heliusApiKey,
      shyftApiKey
    });
    this.jobScheduler = new HolderAnalysisJobScheduler(this.jobQueue);
    this.jobMonitor = new HolderAnalysisJobMonitor(
      this.jobQueue,
      this.jobProcessor,
      this.jobScheduler
    );

    // Start processing
    this.jobQueue.process(3, this.jobProcessor.createProcessor());
    this.jobMonitor.start();
  }

  /**
   * GET /api/holder-analysis/:mintAddress
   * Get holder analysis for a specific token
   */
  async getTokenAnalysis(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress } = req.params;
      const { forceRefresh } = req.query;

      // Check if analysis exists in database
      const existingAnalysis = await this.getAnalysisFromDB(mintAddress);
      
      if (existingAnalysis && !forceRefresh) {
        res.json({
          success: true,
          data: existingAnalysis,
          source: 'database'
        });
        return;
      }

      // Queue new analysis job
      const job = await this.jobQueue.add({
        type: 'single_analysis',
        mintAddress,
        options: {
          forceRefresh: true,
          maxHolders: 1000,
          enableTrends: true,
          classifyWallets: true,
          saveSnapshot: true
        }
      }, {
        priority: 'high'
      });

      res.json({
        success: true,
        message: 'Analysis queued',
        jobId: job.id,
        status: job.status
      });

    } catch (error) {
      logger.error('Failed to get token analysis:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/holder-analysis/batch
   * Get analysis for multiple tokens
   */
  async getBatchAnalysis(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddresses } = req.body;
      
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        res.status(400).json({
          success: false,
          error: 'mintAddresses array is required'
        });
        return;
      }

      // Get existing analyses
      const analyses = await this.getBatchAnalysisFromDB(mintAddresses);
      
      res.json({
        success: true,
        data: analyses,
        total: analyses.length
      });

    } catch (error) {
      logger.error('Failed to get batch analysis:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * POST /api/holder-analysis/analyze
   * Queue a new analysis job
   */
  async queueAnalysis(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress, mintAddresses, options, priority = 'normal' } = req.body;

      let job;
      if (mintAddress) {
        // Single analysis
        job = await this.jobQueue.add({
          type: 'single_analysis',
          mintAddress,
          options: options || {
            forceRefresh: true,
            maxHolders: 1000,
            enableTrends: true,
            classifyWallets: true,
            saveSnapshot: true
          }
        }, { priority });
      } else if (mintAddresses) {
        // Batch analysis
        job = await this.jobQueue.add({
          type: 'batch_analysis',
          mintAddresses,
          options: options || {
            forceRefresh: false,
            maxHolders: 500,
            enableTrends: false,
            classifyWallets: true,
            saveSnapshot: true
          }
        }, { priority });
      } else {
        res.status(400).json({
          success: false,
          error: 'Either mintAddress or mintAddresses is required'
        });
        return;
      }

      res.json({
        success: true,
        jobId: job.id,
        status: job.status,
        priority: job.priority
      });

    } catch (error) {
      logger.error('Failed to queue analysis:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/holder-analysis/jobs
   * Get job queue status
   */
  async getJobs(req: Request, res: Response): Promise<void> {
    try {
      const { status } = req.query;
      const jobs = await this.jobQueue.getJobs(status as any);
      const stats = await this.jobQueue.getStats();

      res.json({
        success: true,
        jobs: jobs.map(job => ({
          id: job.id,
          type: job.type,
          status: job.status,
          priority: job.priority,
          attempts: job.attempts,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          error: job.error,
          progress: job.progress
        })),
        stats
      });

    } catch (error) {
      logger.error('Failed to get jobs:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/holder-analysis/jobs/:jobId
   * Get specific job details
   */
  async getJob(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const job = await this.jobQueue.getJob(jobId);

      if (!job) {
        res.status(404).json({
          success: false,
          error: 'Job not found'
        });
        return;
      }

      res.json({
        success: true,
        job
      });

    } catch (error) {
      logger.error('Failed to get job:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * DELETE /api/holder-analysis/jobs/:jobId
   * Cancel a job
   */
  async cancelJob(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const removed = await this.jobQueue.removeJob(jobId);

      res.json({
        success: removed,
        message: removed ? 'Job cancelled' : 'Job not found'
      });

    } catch (error) {
      logger.error('Failed to cancel job:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/holder-analysis/schedules
   * Get scheduled jobs
   */
  async getSchedules(_req: Request, res: Response): Promise<void> {
    try {
      const schedules = this.jobScheduler.getScheduledJobs();

      res.json({
        success: true,
        schedules
      });

    } catch (error) {
      logger.error('Failed to get schedules:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/holder-analysis/metrics
   * Get system metrics
   */
  async getMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const dashboardData = await this.jobMonitor.getDashboardData();

      res.json({
        success: true,
        ...dashboardData
      });

    } catch (error) {
      logger.error('Failed to get metrics:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/holder-analysis/top-tokens
   * Get tokens with best holder scores
   */
  async getTopTokens(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      
      const result = await this.pool.query(`
        SELECT 
          t.mint_address,
          t.symbol,
          t.name,
          t.image_uri,
          t.latest_market_cap_usd,
          ham.holder_score,
          ham.holder_count,
          ham.top_10_percentage,
          ham.bot_percentage,
          ham.sniper_percentage,
          ham.developer_percentage,
          ham.created_at as analysis_date
        FROM holder_analysis_metadata ham
        JOIN tokens_unified t ON ham.mint_address = t.mint_address
        WHERE ham.holder_score IS NOT NULL
        ORDER BY ham.holder_score DESC, t.latest_market_cap_usd DESC
        LIMIT $1
      `, [limit]);

      res.json({
        success: true,
        tokens: result.rows
      });

    } catch (error) {
      logger.error('Failed to get top tokens:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/holder-analysis/distribution/:mintAddress
   * Get detailed holder distribution data
   */
  async getDistribution(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress } = req.params;
      
      // Get holder details
      const holdersResult = await this.pool.query(`
        SELECT 
          wallet_address,
          balance,
          percentage,
          rank
        FROM token_holder_details
        WHERE mint_address = $1
        ORDER BY rank
        LIMIT 100
      `, [mintAddress]);

      // Get wallet classifications
      const walletAddresses = holdersResult.rows.map(h => h.wallet_address);
      const classificationsResult = await this.pool.query(`
        SELECT 
          wallet_address,
          classification,
          sub_classification,
          confidence_score
        FROM wallet_classifications
        WHERE wallet_address = ANY($1)
      `, [walletAddresses]);

      const classificationMap = new Map(
        classificationsResult.rows.map(c => [c.wallet_address, c])
      );

      // Combine data
      const holders = holdersResult.rows.map(holder => ({
        ...holder,
        classification: classificationMap.get(holder.wallet_address)
      }));

      res.json({
        success: true,
        holders,
        total: holders.length
      });

    } catch (error) {
      logger.error('Failed to get distribution:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Helper: Get analysis from database
   */
  private async getAnalysisFromDB(mintAddress: string): Promise<any> {
    const result = await this.pool.query(`
      SELECT 
        ham.*,
        t.symbol,
        t.name,
        t.image_uri,
        t.latest_market_cap_usd
      FROM holder_analysis_metadata ham
      LEFT JOIN tokens_unified t ON ham.mint_address = t.mint_address
      WHERE ham.mint_address = $1
      ORDER BY ham.created_at DESC
      LIMIT 1
    `, [mintAddress]);

    return result.rows[0] || null;
  }

  /**
   * Helper: Get batch analysis from database
   */
  private async getBatchAnalysisFromDB(mintAddresses: string[]): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT 
        ham.*,
        t.symbol,
        t.name,
        t.image_uri,
        t.latest_market_cap_usd
      FROM holder_analysis_metadata ham
      LEFT JOIN tokens_unified t ON ham.mint_address = t.mint_address
      WHERE ham.mint_address = ANY($1)
      ORDER BY ham.created_at DESC
    `, [mintAddresses]);

    return result.rows;
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    this.jobMonitor.stop();
    this.jobScheduler.stop();
    await this.jobProcessor.shutdown();
    this.jobQueue.destroy();
    this.jobMonitor.destroy();
  }
}