/**
 * Holder Analysis Service
 * 
 * Main orchestrator for token holder analysis
 * Coordinates data fetching, classification, scoring, and persistence
 */

import { Pool } from 'pg';
import { EventEmitter } from 'events';
import { HolderDataFetcher, TokenHolderData } from './holder-data-fetcher';
import { WalletClassificationService } from './wallet-classification-service';
import { HolderScoreCalculator } from './holder-score-calculator';
import { DistributionMetricsCalculator } from './distribution-metrics-calculator';
import { HolderSnapshotModel } from '../../models/holder-snapshot';
import { TokenHolderAnalysisModel } from '../../models/token-holder-analysis';
import { HolderHistoryService } from './historical/holder-history-service';
import { HolderTrendAnalyzer } from './historical/trend-analyzer';
import { HolderAlertService } from './reports/alert-service';
import { 
  TokenHolderAnalysis,
  HolderSnapshot,
  TokenHolderDetails,
  HolderCounts,
  HoldingPercentages,
  AnalysisStatus,
  TimeWindow,
  HolderTrends,
  WalletClassificationData
} from '../../types/holder-analysis';
import { logger } from '../../core/logger';

export interface AnalysisOptions {
  forceRefresh?: boolean;
  maxHolders?: number;
  enableTrends?: boolean;
  classifyWallets?: boolean;
  saveSnapshot?: boolean;
}

export interface AnalysisResult {
  success: boolean;
  analysis?: TokenHolderAnalysis;
  error?: string;
  duration?: number;
}

export class HolderAnalysisService extends EventEmitter {
  private dataFetcher: HolderDataFetcher;
  private walletClassifier: WalletClassificationService;
  private scoreCalculator: HolderScoreCalculator;
  private metricsCalculator: DistributionMetricsCalculator;
  private snapshotModel: HolderSnapshotModel;
  private analysisModel: TokenHolderAnalysisModel;
  private historyService: HolderHistoryService;
  private trendAnalyzer: HolderTrendAnalyzer;
  private alertService: HolderAlertService;

  constructor(
    pool: Pool,
    heliusApiKey?: string,
    shyftApiKey?: string,
    eventBus?: any
  ) {
    super();
    
    this.dataFetcher = new HolderDataFetcher(heliusApiKey, shyftApiKey, process.env.SOLANA_RPC_URL);
    this.walletClassifier = new WalletClassificationService(pool, heliusApiKey, shyftApiKey);
    this.scoreCalculator = new HolderScoreCalculator();
    this.metricsCalculator = new DistributionMetricsCalculator();
    this.snapshotModel = new HolderSnapshotModel(pool);
    this.analysisModel = new TokenHolderAnalysisModel(pool);
    this.historyService = new HolderHistoryService(pool);
    this.trendAnalyzer = new HolderTrendAnalyzer(pool);
    this.alertService = new HolderAlertService(pool, eventBus || this);

    // Forward events from sub-services
    this.dataFetcher.on('fetch_complete', (data) => this.emit('data_fetched', data));
    this.walletClassifier.on('classification_complete', (data) => this.emit('wallet_classified', data));
  }

  /**
   * Perform complete holder analysis for a token
   */
  async analyzeToken(
    mintAddress: string,
    options: AnalysisOptions = {}
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const {
      forceRefresh = false,
      maxHolders = 1000,
      enableTrends = true,
      classifyWallets = true,
      saveSnapshot = true
    } = options;

    this.emit('analysis_start', { mintAddress, options });

    try {
      // Create analysis metadata entry
      const metadata = await this.analysisModel.createAnalysisMetadata({
        mintAddress,
        analysisType: forceRefresh ? 'manual' : 'scheduled',
        status: 'processing',
        startedAt: new Date()
      });

      // Step 1: Check if we need fresh data
      if (!forceRefresh) {
        const latestSnapshot = await this.snapshotModel.getLatest(mintAddress);
        if (latestSnapshot && this.isSnapshotFresh(latestSnapshot)) {
          logger.debug(`Using cached analysis for ${mintAddress}`);
          const cachedAnalysis = await this.buildAnalysisFromSnapshot(latestSnapshot);
          
          await this.updateAnalysisStatus(metadata.id!, 'completed', {
            holdersAnalyzed: cachedAnalysis.holderCounts.total
          });

          return {
            success: true,
            analysis: cachedAnalysis,
            duration: Date.now() - startTime
          };
        }
      }

      // Step 2: Fetch holder data
      this.emit('analysis_progress', { mintAddress, step: 'fetching_holders' });
      const holderData = await this.dataFetcher.fetchHolderData(mintAddress, {
        maxHolders,
        enableFallback: true,
        cacheResults: true
      });

      if (!holderData) {
        throw new Error('Failed to fetch holder data');
      }

      // Step 3: Calculate distribution metrics
      this.emit('analysis_progress', { mintAddress, step: 'calculating_metrics' });
      const distributionMetrics = this.metricsCalculator.calculateMetrics(holderData.holders);

      // Step 4: Classify wallets
      let classifiedWallets: Map<string, any> = new Map();
      if (classifyWallets && holderData.holders.length > 0) {
        this.emit('analysis_progress', { mintAddress, step: 'classifying_wallets' });
        
        const walletsToClassify = holderData.holders.slice(0, 100).map(h => ({
          address: h.address,
          holdingPercentage: h.percentage,
          firstTransactionTime: Date.now() // Would be fetched from transaction history
        }));

        const classifications = await this.walletClassifier.classifyBatch(
          walletsToClassify,
          mintAddress,
          holderData.fetchedAt.getTime()
        );

        classifiedWallets = classifications;
      }

      // Step 5: Count holders by type
      const holderCounts = await this.countHoldersByType(
        holderData.holders,
        classifiedWallets
      );

      // Step 6: Calculate holding percentages by type
      const holdingPercentages = await this.calculateHoldingPercentages(
        holderData.holders,
        classifiedWallets
      );

      // Step 7: Calculate holder score
      this.emit('analysis_progress', { mintAddress, step: 'calculating_score' });
      const scoreBreakdown = this.scoreCalculator.calculateScore({
        mintAddress,
        holderCounts,
        holdingPercentages,
        distributionMetrics
      });

      // Step 8: Calculate trends if enabled
      let trends: { [K in TimeWindow]?: HolderTrends } = {};
      if (enableTrends) {
        this.emit('analysis_progress', { mintAddress, step: 'calculating_trends' });
        trends = await this.calculateTrends(mintAddress, holderCounts);
      }

      // Step 9: Build complete analysis result
      const analysis: TokenHolderAnalysis = {
        mintAddress,
        analysisTimestamp: new Date(),
        holderCounts,
        holdingPercentages,
        distributionMetrics,
        growthMetrics: {
          holderGrowthRate24h: 0, // Would be calculated from trends
          holderGrowthRate7d: 0,
          churnRate24h: 0,
          churnRate7d: 0,
          newHolders24h: 0,
          exitedHolders24h: 0
        },
        holderScore: scoreBreakdown.total,
        scoreBreakdown,
        topHolders: await this.enrichTopHolders(holderData.holders.slice(0, 10), classifiedWallets),
        classifiedWallets: this.groupClassifiedWallets(classifiedWallets),
        trends
      };

      // Step 10: Save snapshot if enabled
      if (saveSnapshot) {
        this.emit('analysis_progress', { mintAddress, step: 'saving_snapshot' });
        await this.saveSnapshot(analysis, holderData);
      }

      // Step 11: Update analysis metadata
      await this.updateAnalysisStatus(metadata.id!, 'completed', {
        holdersAnalyzed: holderData.holders.length,
        completedAt: new Date()
      });

      this.emit('analysis_complete', { 
        mintAddress, 
        score: analysis.holderScore,
        duration: Date.now() - startTime 
      });

      return {
        success: true,
        analysis,
        duration: Date.now() - startTime
      };

    } catch (error) {
      logger.error(`Failed to analyze token ${mintAddress}:`, error);
      
      this.emit('analysis_error', { 
        mintAddress, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Check if a snapshot is still fresh
   */
  private isSnapshotFresh(snapshot: HolderSnapshot, maxAgeMinutes: number = 60): boolean {
    const age = Date.now() - snapshot.snapshotTime.getTime();
    return age < maxAgeMinutes * 60 * 1000;
  }

  /**
   * Build analysis from cached snapshot
   */
  private async buildAnalysisFromSnapshot(snapshot: HolderSnapshot): Promise<TokenHolderAnalysis> {
    // This would reconstruct the full analysis from the snapshot
    // For now, return a minimal version
    return {
      mintAddress: snapshot.mintAddress,
      analysisTimestamp: snapshot.snapshotTime,
      holderCounts: {
        total: snapshot.totalHolders,
        organic: Math.floor(snapshot.totalHolders * 0.6),
        snipers: Math.floor(snapshot.totalHolders * 0.1),
        bots: Math.floor(snapshot.totalHolders * 0.1),
        bundlers: Math.floor(snapshot.totalHolders * 0.05),
        developers: Math.floor(snapshot.totalHolders * 0.05),
        whales: Math.floor(snapshot.totalHolders * 0.1)
      },
      holdingPercentages: {
        organic: 40,
        snipers: 15,
        bots: 10,
        bundlers: 5,
        developers: 10,
        whales: 20
      },
      distributionMetrics: {
        top10Percentage: snapshot.top10Percentage,
        top25Percentage: snapshot.top25Percentage,
        top100Percentage: snapshot.top100Percentage,
        giniCoefficient: snapshot.giniCoefficient,
        herfindahlIndex: snapshot.herfindahlIndex,
        averageHoldingDuration: 24,
        medianHoldingDuration: 12
      },
      growthMetrics: {
        holderGrowthRate24h: 0,
        holderGrowthRate7d: 0,
        churnRate24h: 0,
        churnRate7d: 0,
        newHolders24h: 0,
        exitedHolders24h: 0
      },
      holderScore: snapshot.holderScore,
      scoreBreakdown: snapshot.scoreBreakdown,
      topHolders: [],
      classifiedWallets: {
        snipers: [],
        bots: [],
        bundlers: [],
        developers: [],
        whales: []
      },
      trends: {}
    };
  }

  /**
   * Count holders by classification type
   */
  private async countHoldersByType(
    holders: any[],
    classifications: Map<string, any>
  ): Promise<HolderCounts> {
    const counts: HolderCounts = {
      total: holders.length,
      organic: 0,
      snipers: 0,
      bots: 0,
      bundlers: 0,
      developers: 0,
      whales: 0
    };

    for (const holder of holders) {
      const classification = classifications.get(holder.address);
      if (classification) {
        switch (classification.classification) {
          case 'sniper': counts.snipers++; break;
          case 'bot': counts.bots++; break;
          case 'bundler': counts.bundlers++; break;
          case 'developer': counts.developers++; break;
          case 'whale': counts.whales++; break;
          case 'normal': counts.organic++; break;
          default: counts.organic++; break;
        }
      } else {
        counts.organic++; // Default to organic if not classified
      }
    }

    return counts;
  }

  /**
   * Calculate holding percentages by wallet type
   */
  private async calculateHoldingPercentages(
    holders: any[],
    classifications: Map<string, any>
  ): Promise<HoldingPercentages> {
    const holdings = {
      organic: BigInt(0),
      snipers: BigInt(0),
      bots: BigInt(0),
      bundlers: BigInt(0),
      developers: BigInt(0),
      whales: BigInt(0)
    };

    const totalSupply = holders.reduce((sum, h) => 
      sum + BigInt(h.balance), BigInt(0)
    );

    for (const holder of holders) {
      const balance = BigInt(holder.balance);
      const classification = classifications.get(holder.address);
      
      if (classification) {
        switch (classification.classification) {
          case 'sniper': holdings.snipers += balance; break;
          case 'bot': holdings.bots += balance; break;
          case 'bundler': holdings.bundlers += balance; break;
          case 'developer': holdings.developers += balance; break;
          case 'whale': holdings.whales += balance; break;
          case 'normal': holdings.organic += balance; break;
          default: holdings.organic += balance; break;
        }
      } else {
        holdings.organic += balance;
      }
    }

    // Convert to percentages
    const toPercentage = (amount: bigint) => 
      totalSupply > BigInt(0) ? Number((amount * BigInt(10000)) / totalSupply) / 100 : 0;

    return {
      organic: toPercentage(holdings.organic),
      snipers: toPercentage(holdings.snipers),
      bots: toPercentage(holdings.bots),
      bundlers: toPercentage(holdings.bundlers),
      developers: toPercentage(holdings.developers),
      whales: toPercentage(holdings.whales)
    };
  }

  /**
   * Calculate trends
   */
  private async calculateTrends(
    mintAddress: string,
    _currentCounts: HolderCounts
  ): Promise<{ [K in TimeWindow]?: HolderTrends }> {
    // This would calculate trends from historical snapshots
    // For now, return mock trends
    const mockTrend: HolderTrends = {
      mintAddress,
      timeWindow: '24h',
      holderCountChange: 10,
      holderGrowthRate: 5.5,
      avgHolderDurationHours: 48,
      churnRate: 2.5,
      newWhaleCount: 1,
      newSniperCount: 2,
      calculatedAt: new Date()
    };

    return {
      '24h': mockTrend,
      '7d': { ...mockTrend, timeWindow: '7d', holderGrowthRate: 15.5 }
    };
  }

  /**
   * Enrich top holders with classification data
   */
  private async enrichTopHolders(
    topHolders: any[],
    _classifications: Map<string, any>
  ): Promise<TokenHolderDetails[]> {
    return topHolders.map((holder, index) => {
      // const _classification = classifications.get(holder.address);
      
      return {
        mintAddress: holder.mintAddress,
        walletAddress: holder.address,
        balance: BigInt(holder.balance),
        percentageHeld: holder.percentage,
        rank: index + 1,
        transactionCount: 1,
        isLocked: false,
        updatedAt: new Date()
      };
    });
  }

  /**
   * Group classified wallets by type
   */
  private groupClassifiedWallets(
    classifications: Map<string, any>
  ): TokenHolderAnalysis['classifiedWallets'] {
    const grouped = {
      snipers: [] as WalletClassificationData[],
      bots: [] as WalletClassificationData[],
      bundlers: [] as WalletClassificationData[],
      developers: [] as WalletClassificationData[],
      whales: [] as WalletClassificationData[]
    };

    classifications.forEach(classification => {
      switch (classification.classification) {
        case 'sniper': grouped.snipers.push(classification); break;
        case 'bot': grouped.bots.push(classification); break;
        case 'bundler': grouped.bundlers.push(classification); break;
        case 'developer': grouped.developers.push(classification); break;
        case 'whale': grouped.whales.push(classification); break;
      }
    });

    return grouped;
  }

  /**
   * Save analysis snapshot
   */
  private async saveSnapshot(
    analysis: TokenHolderAnalysis,
    holderData: TokenHolderData
  ): Promise<void> {
    const dataHash = this.snapshotModel.calculateDataHash(holderData);
    
    // Check if data has changed
    const hasChanged = await this.snapshotModel.hasDataChanged(
      analysis.mintAddress,
      dataHash
    );

    if (hasChanged) {
      const snapshot: HolderSnapshot = {
        mintAddress: analysis.mintAddress,
        snapshotTime: new Date(),
        totalHolders: analysis.holderCounts.total,
        uniqueHolders: analysis.holderCounts.total,
        top10Percentage: analysis.distributionMetrics.top10Percentage,
        top25Percentage: analysis.distributionMetrics.top25Percentage,
        top100Percentage: analysis.distributionMetrics.top100Percentage,
        giniCoefficient: analysis.distributionMetrics.giniCoefficient,
        herfindahlIndex: analysis.distributionMetrics.herfindahlIndex,
        holderScore: analysis.holderScore,
        scoreBreakdown: analysis.scoreBreakdown,
        rawDataHash: dataHash
      };

      // Save to main snapshot model
      await this.snapshotModel.create(snapshot);

      // Also save to historical tracking service
      await this.historyService.saveSnapshot(snapshot);

      // Check for alerts after saving snapshot
      try {
        const alerts = await this.alertService.checkAlerts(analysis.mintAddress);
        if (alerts.length > 0) {
          logger.info(`Generated ${alerts.length} alerts for ${analysis.mintAddress}`);
        }
      } catch (error) {
        logger.error('Error checking alerts:', error);
      }

      // Also save holder details
      if (holderData.holders.length > 0) {
        const holderDetails = holderData.holders.slice(0, 100).map(h => ({
          mintAddress: analysis.mintAddress,
          walletAddress: h.address,
          balance: BigInt(h.balance),
          percentageHeld: h.percentage,
          rank: h.rank || 0,
          transactionCount: 1,
          isLocked: false,
          updatedAt: new Date()
        }));

        await this.analysisModel.bulkUpsertHolderDetails(holderDetails);
      }
    }
  }

  /**
   * Update analysis status
   */
  private async updateAnalysisStatus(
    id: number,
    status: AnalysisStatus,
    additionalData?: any
  ): Promise<void> {
    await this.analysisModel.updateAnalysisStatus(id, status, additionalData);
  }

  /**
   * Get analysis history for a token
   */
  async getAnalysisHistory(
    mintAddress: string,
    limit: number = 10
  ): Promise<HolderSnapshot[]> {
    return await this.snapshotModel.getHistory(mintAddress, limit);
  }

  /**
   * Get score changes over time
   */
  async getScoreChanges(
    mintAddress: string,
    timeWindows: number[] = [24, 168] // 24h and 7d
  ): Promise<Array<{ window: number; change: number | null }>> {
    const changes = await Promise.all(
      timeWindows.map(async (hours) => {
        const change = await this.snapshotModel.getScoreChange(mintAddress, hours);
        return { window: hours, change: change?.change || null };
      })
    );

    return changes;
  }

  /**
   * Get holder history with trends
   */
  async getHolderHistory(
    mintAddress: string,
    period: '1h' | '6h' | '24h' | '7d' | '30d' = '7d'
  ): Promise<any> {
    return await this.historyService.getHolderHistory({ mintAddress, period });
  }

  /**
   * Get comprehensive trends analysis
   */
  async analyzeTrends(
    mintAddress: string,
    period: '1h' | '6h' | '24h' | '7d' | '30d' = '7d'
  ): Promise<any> {
    return await this.trendAnalyzer.analyzeTrends(mintAddress, period);
  }

  /**
   * Get active alerts for a token
   */
  async getActiveAlerts(mintAddress?: string): Promise<any[]> {
    return await this.alertService.getActiveAlerts(mintAddress);
  }

  /**
   * Get alert history for a token
   */
  async getAlertHistory(
    mintAddress: string,
    period: '24h' | '7d' | '30d' = '7d'
  ): Promise<any[]> {
    return await this.alertService.getAlertHistory(mintAddress, period);
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: number): Promise<void> {
    await this.alertService.acknowledgeAlert(alertId);
  }
}