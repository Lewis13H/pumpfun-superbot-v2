/**
 * Holder Analysis Integration Service
 * 
 * Integrates holder analysis with the main application lifecycle
 */

import { EventEmitter } from 'events';
import { Pool } from 'pg';
import { createLogger } from '../../core/logger';
import { EventBus, EVENTS } from '../../core/event-bus';
import { HolderAnalysisJobQueue } from './holder-analysis-job-queue';
import { HolderAnalysisJobProcessor } from './holder-analysis-job-processor';
import { HolderAnalysisJobScheduler } from './holder-analysis-job-scheduler';
import { HolderAnalysisJobMonitor } from './holder-analysis-job-monitor';

const logger = createLogger('HolderAnalysisIntegration');

export interface IntegrationConfig {
  marketCapThreshold?: number;
  solThreshold?: number;
  enableAutoAnalysis?: boolean;
  maxConcurrentAnalyses?: number;
  analysisIntervalHours?: number;
  heliusApiKey?: string;
  shyftApiKey?: string;
}

export interface IntegrationStats {
  tokensAnalyzed: number;
  analysesQueued: number;
  analysesCompleted: number;
  analysesFailed: number;
  averageScore: number;
  topScoreToken: { mintAddress: string; score: number; symbol?: string } | null;
  lowestScoreToken: { mintAddress: string; score: number; symbol?: string } | null;
}

export class HolderAnalysisIntegration extends EventEmitter {
  private jobQueue: HolderAnalysisJobQueue;
  private jobProcessor: HolderAnalysisJobProcessor;
  private jobScheduler: HolderAnalysisJobScheduler;
  private jobMonitor: HolderAnalysisJobMonitor;
  private eventBus: EventBus;
  private config: Required<IntegrationConfig>;
  private stats: IntegrationStats;
  private isRunning = false;
  private analyzedTokens = new Set<string>();

  constructor(
    private pool: Pool,
    eventBus: EventBus,
    config: IntegrationConfig = {}
  ) {
    super();
    
    this.eventBus = eventBus;
    this.config = {
      marketCapThreshold: config.marketCapThreshold || 18888,
      solThreshold: config.solThreshold || 125,
      enableAutoAnalysis: config.enableAutoAnalysis ?? true,
      maxConcurrentAnalyses: config.maxConcurrentAnalyses || 3,
      analysisIntervalHours: config.analysisIntervalHours || 6,
      heliusApiKey: config.heliusApiKey || process.env.HELIUS_API_KEY || '',
      shyftApiKey: config.shyftApiKey || process.env.SHYFT_API_KEY || ''
    };

    this.stats = {
      tokensAnalyzed: 0,
      analysesQueued: 0,
      analysesCompleted: 0,
      analysesFailed: 0,
      averageScore: 0,
      topScoreToken: null,
      lowestScoreToken: null
    };

    // Initialize holder analysis components
    this.jobQueue = new HolderAnalysisJobQueue();
    this.jobProcessor = new HolderAnalysisJobProcessor(pool, {
      maxWorkers: this.config.maxConcurrentAnalyses,
      heliusApiKey: this.config.heliusApiKey,
      shyftApiKey: this.config.shyftApiKey
    });
    this.jobScheduler = new HolderAnalysisJobScheduler(this.jobQueue);
    this.jobMonitor = new HolderAnalysisJobMonitor(
      this.jobQueue,
      this.jobProcessor,
      this.jobScheduler
    );
  }

  /**
   * Start the holder analysis integration
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Holder analysis integration already running');
      return;
    }

    logger.info('Starting holder analysis integration...');

    // Start job processing
    this.jobQueue.process(
      this.config.maxConcurrentAnalyses,
      this.jobProcessor.createProcessor()
    );

    // Start job monitor
    this.jobMonitor.start();

    // Setup event listeners
    this.setupEventListeners();

    // Setup scheduled jobs
    await this.setupScheduledJobs();

    // Analyze existing high-value tokens
    if (this.config.enableAutoAnalysis) {
      await this.analyzeExistingTokens();
    }

    this.isRunning = true;
    logger.info('Holder analysis integration started');
    this.emit('started');
  }

  /**
   * Setup event listeners for token events
   */
  private setupEventListeners(): void {
    // Listen for new token discoveries
    this.eventBus.on(EVENTS.TOKEN_DISCOVERED, async (token: any) => {
      await this.handleTokenDiscovered(token);
    });

    // Listen for token graduations
    this.eventBus.on(EVENTS.TOKEN_GRADUATED, async (data: any) => {
      await this.handleTokenGraduated(data);
    });

    // Listen for significant price changes
    this.eventBus.on(EVENTS.PRICE_UPDATED, async (data: any) => {
      await this.handlePriceUpdate(data);
    });

    // Listen for job events
    this.jobQueue.on('job:completed', (job) => {
      this.handleJobCompleted(job);
    });

    this.jobQueue.on('job:failed', (job) => {
      this.handleJobFailed(job);
    });
  }

  /**
   * Handle token discovered event
   */
  private async handleTokenDiscovered(token: any): Promise<void> {
    if (!this.config.enableAutoAnalysis) return;

    const marketCapUsd = token.currentMarketCapUsd || 0;
    const marketCapSol = token.currentMarketCapSol || 0;

    // Check if token meets threshold
    if (marketCapUsd >= this.config.marketCapThreshold || 
        marketCapSol >= this.config.solThreshold) {
      
      // Check if we haven't analyzed this token recently
      if (!this.analyzedTokens.has(token.mintAddress)) {
        logger.info(`Token ${token.symbol || token.mintAddress} meets threshold, queueing analysis`);
        
        await this.queueAnalysis(token.mintAddress, 'high', {
          symbol: token.symbol,
          marketCapUsd,
          marketCapSol,
          trigger: 'discovery'
        });

        this.analyzedTokens.add(token.mintAddress);
      }
    }
  }

  /**
   * Handle token graduated event
   */
  private async handleTokenGraduated(data: any): Promise<void> {
    if (!this.config.enableAutoAnalysis) return;

    const { mintAddress, symbol } = data;
    
    logger.info(`Token ${symbol || mintAddress} graduated, queueing high-priority analysis`);
    
    await this.queueAnalysis(mintAddress, 'critical', {
      symbol,
      trigger: 'graduation'
    });
  }

  /**
   * Handle price update event
   */
  private async handlePriceUpdate(data: any): Promise<void> {
    if (!this.config.enableAutoAnalysis) return;

    const { mintAddress, marketCapUsd, marketCapSol } = data;

    // Check if token crossed threshold
    if ((marketCapUsd >= this.config.marketCapThreshold || 
         marketCapSol >= this.config.solThreshold) &&
        !this.analyzedTokens.has(mintAddress)) {
      
      logger.info(`Token ${mintAddress} crossed threshold, queueing analysis`);
      
      await this.queueAnalysis(mintAddress, 'normal', {
        marketCapUsd,
        marketCapSol,
        trigger: 'threshold_crossed'
      });

      this.analyzedTokens.add(mintAddress);
    }
  }

  /**
   * Queue a holder analysis job
   */
  private async queueAnalysis(
    mintAddress: string,
    priority: 'critical' | 'high' | 'normal' | 'low' = 'normal',
    metadata?: any
  ): Promise<void> {
    try {
      await this.jobQueue.add({
        type: 'single_analysis',
        mintAddress,
        options: {
          forceRefresh: priority === 'critical',
          maxHolders: 1000,
          enableTrends: true,
          classifyWallets: true,
          saveSnapshot: true
        },
        metadata
      }, { priority });

      this.stats.analysesQueued++;
      this.emit('analysis:queued', { mintAddress, priority });
    } catch (error) {
      logger.error(`Failed to queue analysis for ${mintAddress}:`, error);
    }
  }

  /**
   * Analyze existing high-value tokens
   */
  private async analyzeExistingTokens(): Promise<void> {
    try {
      const result = await this.pool.query(`
        SELECT mint_address, symbol, latest_market_cap_usd
        FROM tokens_unified
        WHERE latest_market_cap_usd >= $1
          AND graduated_to_amm = true
        ORDER BY latest_market_cap_usd DESC
        LIMIT 50
      `, [this.config.marketCapThreshold]);

      logger.info(`Found ${result.rows.length} high-value tokens to analyze`);

      // Queue analyses with staggered priority
      for (let i = 0; i < result.rows.length; i++) {
        const token = result.rows[i];
        const priority = i < 10 ? 'high' : 'normal';
        
        await this.queueAnalysis(token.mint_address, priority, {
          symbol: token.symbol,
          marketCapUsd: token.latest_market_cap_usd,
          trigger: 'initial_scan'
        });

        this.analyzedTokens.add(token.mint_address);
      }
    } catch (error) {
      logger.error('Failed to analyze existing tokens:', error);
    }
  }

  /**
   * Setup scheduled jobs
   */
  private async setupScheduledJobs(): Promise<void> {
    // Schedule top tokens analysis every 6 hours
    const intervalMinutes = this.config.analysisIntervalHours * 60;
    await this.jobScheduler.scheduleTopTokensAnalysis(
      intervalMinutes, // Convert hours to minutes
      20 // Top 20 tokens
    );

    // Schedule poor score re-analysis every 12 hours
    await this.jobScheduler.schedulePoorScoreReanalysis(
      150, // Score threshold
      720  // Every 12 hours (in minutes)
    );

    logger.info('Scheduled jobs configured');
  }

  /**
   * Handle job completed
   */
  private handleJobCompleted(job: any): void {
    this.stats.analysesCompleted++;
    
    if (job.returnvalue?.analysis) {
      const analysis = job.returnvalue.analysis;
      const score = analysis.holderScore || 0;
      
      // Update average score
      this.stats.averageScore = 
        (this.stats.averageScore * (this.stats.analysesCompleted - 1) + score) / 
        this.stats.analysesCompleted;

      // Update top/lowest scores
      if (!this.stats.topScoreToken || score > this.stats.topScoreToken.score) {
        this.stats.topScoreToken = {
          mintAddress: job.data.mintAddress,
          score,
          symbol: job.data.metadata?.symbol
        };
      }

      if (!this.stats.lowestScoreToken || score < this.stats.lowestScoreToken.score) {
        this.stats.lowestScoreToken = {
          mintAddress: job.data.mintAddress,
          score,
          symbol: job.data.metadata?.symbol
        };
      }
    }

    this.emit('analysis:completed', {
      mintAddress: job.data.mintAddress,
      score: job.returnvalue?.analysis?.holderScore
    });
  }

  /**
   * Handle job failed
   */
  private handleJobFailed(job: any): void {
    this.stats.analysesFailed++;
    logger.error(`Analysis failed for ${job.data.mintAddress}:`, job.failedReason);
    
    this.emit('analysis:failed', {
      mintAddress: job.data.mintAddress,
      error: job.failedReason
    });
  }

  /**
   * Get integration statistics
   */
  getStats(): IntegrationStats {
    return { ...this.stats };
  }

  /**
   * Get job queue statistics
   */
  async getQueueStats(): Promise<any> {
    return await this.jobQueue.getStats();
  }

  /**
   * Stop the holder analysis integration
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping holder analysis integration...');

    // Stop components
    this.jobMonitor.stop();
    this.jobScheduler.stop();
    await this.jobProcessor.shutdown();
    this.jobQueue.destroy();

    // Remove event listeners
    this.eventBus.off(EVENTS.TOKEN_DISCOVERED);
    this.eventBus.off(EVENTS.TOKEN_GRADUATED);
    this.eventBus.off(EVENTS.PRICE_UPDATED);

    this.isRunning = false;
    logger.info('Holder analysis integration stopped');
    this.emit('stopped');
  }
}