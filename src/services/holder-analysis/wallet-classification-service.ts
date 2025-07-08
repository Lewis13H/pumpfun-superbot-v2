/**
 * Wallet Classification Service
 * 
 * Analyzes wallet behavior and classifies wallets into categories:
 * - Snipers: Early buyers with specific patterns
 * - Bots: Automated trading with consistent patterns
 * - Bundlers: MEV/Jito bundle users
 * - Developers: Token creators and team wallets
 * - Whales: Large holders
 * - Normal: Regular traders
 */

import { HeliusApiClient } from './helius-api-client';
import { ShyftDasApiClient } from './shyft-das-api-client';
import { WalletClassificationModel } from '../../models/wallet-classification';
import { Pool } from 'pg';
import { 
  WalletClassification,
  WalletDetectionMetadata 
} from '../../types/holder-analysis';
import { logger } from '../../core/logger';
import { EventEmitter } from 'events';

export interface ClassificationCriteria {
  sniperTimeWindowSeconds: number;
  botMinTransactions: number;
  botMaxTimeDiffSeconds: number;
  whaleMinPercentage: number;
  developerTokenCreations: number;
}

export interface ClassificationResult {
  classification: WalletClassification;
  confidence: number;
  subClassification?: string;
  metadata: WalletDetectionMetadata;
}

export class WalletClassificationService extends EventEmitter {
  private heliusClient: HeliusApiClient;
  private shyftClient: ShyftDasApiClient;
  private walletModel: WalletClassificationModel;
  private criteria: ClassificationCriteria;

  constructor(
    pool: Pool,
    heliusApiKey?: string,
    shyftApiKey?: string,
    criteria?: Partial<ClassificationCriteria>
  ) {
    super();
    this.heliusClient = new HeliusApiClient(heliusApiKey);
    this.shyftClient = new ShyftDasApiClient(shyftApiKey);
    this.walletModel = new WalletClassificationModel(pool);
    
    this.criteria = {
      sniperTimeWindowSeconds: 300, // 5 minutes
      botMinTransactions: 20,
      botMaxTimeDiffSeconds: 30,
      whaleMinPercentage: 1.0,
      developerTokenCreations: 1,
      ...criteria
    };
  }

  /**
   * Classify a single wallet
   */
  async classifyWallet(
    walletAddress: string,
    _tokenMintAddress?: string,
    additionalContext?: {
      holdingPercentage?: number;
      firstTransactionTime?: number;
      tokenCreationTime?: number;
    }
  ): Promise<ClassificationResult> {
    this.emit('classification_start', { walletAddress });

    try {
      // Check if already classified
      const existing = await this.walletModel.get(walletAddress);
      if (existing && existing.confidenceScore > 0.8) {
        logger.debug(`Using existing classification for ${walletAddress}`);
        return {
          classification: existing.classification,
          confidence: existing.confidenceScore,
          subClassification: existing.subClassification,
          metadata: existing.detectionMetadata
        };
      }

      // Gather data from multiple sources
      const [heliusData, shyftData] = await Promise.allSettled([
        this.gatherHeliusData(walletAddress),
        this.gatherShyftData(walletAddress)
      ]);

      const helius = heliusData.status === 'fulfilled' ? heliusData.value : null;
      const shyft = shyftData.status === 'fulfilled' ? shyftData.value : null;

      // Analyze patterns
      const analysis = this.analyzeWalletBehavior(
        walletAddress,
        helius,
        shyft,
        additionalContext
      );

      // Determine classification
      const result = this.determineClassification(analysis);

      // Save to database
      await this.walletModel.upsert({
        walletAddress,
        classification: result.classification,
        subClassification: result.subClassification as any,
        confidenceScore: result.confidence,
        detectionMetadata: result.metadata,
        firstSeen: new Date(),
        lastActivity: new Date(),
        totalTokensTraded: analysis.totalTokensTraded || 0,
        suspiciousActivityCount: analysis.suspiciousPatterns || 0,
        updatedAt: new Date()
      });

      this.emit('classification_complete', { 
        walletAddress, 
        classification: result.classification,
        confidence: result.confidence 
      });

      return result;
    } catch (error) {
      logger.error(`Failed to classify wallet ${walletAddress}:`, error);
      
      // Return unknown classification on error
      return {
        classification: 'unknown',
        confidence: 0,
        metadata: {
          detectionMethod: ['error'],
          confidenceFactors: {}
        }
      };
    }
  }

  /**
   * Classify multiple wallets in batch
   */
  async classifyBatch(
    wallets: Array<{
      address: string;
      holdingPercentage?: number;
      firstTransactionTime?: number;
    }>,
    tokenMintAddress?: string,
    tokenCreationTime?: number
  ): Promise<Map<string, ClassificationResult>> {
    const results = new Map<string, ClassificationResult>();
    
    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(wallet => 
          this.classifyWallet(wallet.address, tokenMintAddress, {
            holdingPercentage: wallet.holdingPercentage,
            firstTransactionTime: wallet.firstTransactionTime,
            tokenCreationTime
          })
        )
      );

      batchResults.forEach((result, index) => {
        const wallet = batch[index];
        if (result.status === 'fulfilled') {
          results.set(wallet.address, result.value);
        } else {
          results.set(wallet.address, {
            classification: 'unknown',
            confidence: 0,
            metadata: {
              detectionMethod: ['error'],
              confidenceFactors: {}
            }
          });
        }
      });

      // Rate limit protection
      if (i + batchSize < wallets.length) {
        await this.delay(1000);
      }
    }

    return results;
  }

  /**
   * Gather data from Helius
   */
  private async gatherHeliusData(walletAddress: string): Promise<any> {
    const [walletInfo, patterns] = await Promise.allSettled([
      this.heliusClient.getWalletInfo(walletAddress),
      this.heliusClient.analyzeWalletPatterns(walletAddress)
    ]);

    return {
      walletInfo: walletInfo.status === 'fulfilled' ? walletInfo.value : null,
      patterns: patterns.status === 'fulfilled' ? patterns.value : null
    };
  }

  /**
   * Gather data from Shyft
   */
  private async gatherShyftData(walletAddress: string): Promise<any> {
    const [assets, analysis] = await Promise.allSettled([
      this.shyftClient.getWalletAssets(walletAddress),
      this.shyftClient.analyzeWalletForClassification(walletAddress)
    ]);

    return {
      assets: assets.status === 'fulfilled' ? assets.value : null,
      analysis: analysis.status === 'fulfilled' ? analysis.value : null
    };
  }

  /**
   * Analyze wallet behavior from all data sources
   */
  private analyzeWalletBehavior(
    _walletAddress: string,
    heliusData: any,
    shyftData: any,
    additionalContext?: any
  ): any {
    const analysis = {
      isSniper: false,
      isBot: false,
      isBundler: false,
      isDeveloper: false,
      isWhale: false,
      totalTokensTraded: 0,
      suspiciousPatterns: 0,
      confidenceFactors: {} as any
    };

    // Sniper detection
    if (additionalContext?.firstTransactionTime && additionalContext?.tokenCreationTime) {
      const timeDiff = additionalContext.firstTransactionTime - additionalContext.tokenCreationTime;
      if (timeDiff < this.criteria.sniperTimeWindowSeconds) {
        analysis.isSniper = true;
        analysis.confidenceFactors.sniperTiming = Math.max(0, 1 - (timeDiff / this.criteria.sniperTimeWindowSeconds));
      }
    }

    // Bot detection from Helius
    if (heliusData?.patterns) {
      analysis.isBot = heliusData.patterns.is_bot;
      analysis.isBundler = heliusData.patterns.bundler_usage;
      if (heliusData.patterns.mev_activity) {
        analysis.suspiciousPatterns++;
      }
    }

    // Bot detection from Shyft
    if (shyftData?.analysis) {
      // Combine bot signals
      analysis.isBot = analysis.isBot || shyftData.analysis.isBot;
      analysis.isDeveloper = shyftData.analysis.isDeveloper;
      
      if (shyftData.analysis.tradingPatterns) {
        analysis.totalTokensTraded = shyftData.analysis.tradingPatterns.tokenCount || 0;
      }
    }

    // Whale detection
    if (additionalContext?.holdingPercentage) {
      if (additionalContext.holdingPercentage >= this.criteria.whaleMinPercentage) {
        analysis.isWhale = true;
        analysis.confidenceFactors.whaleHolding = 
          Math.min(1, additionalContext.holdingPercentage / (this.criteria.whaleMinPercentage * 2));
      }
    }

    // Additional pattern detection
    if (heliusData?.walletInfo) {
      // High token count might indicate bot or active trader
      if (heliusData.walletInfo.token_count > 100) {
        analysis.suspiciousPatterns++;
      }
      
      // Very high transaction count
      if (heliusData.walletInfo.transaction_count > 1000) {
        analysis.confidenceFactors.highActivity = true;
      }
    }

    return analysis;
  }

  /**
   * Determine final classification based on analysis
   */
  private determineClassification(analysis: any): ClassificationResult {
    const detectionMethods: string[] = [];
    let classification: WalletClassification = 'normal';
    let confidence = 0.5;
    let subClassification: string | undefined;

    // Priority order for classification
    if (analysis.isDeveloper) {
      classification = 'developer';
      confidence = 0.9;
      detectionMethods.push('token_creation');
      subClassification = 'team_wallet';
    } else if (analysis.isSniper) {
      classification = 'sniper';
      confidence = analysis.confidenceFactors.sniperTiming || 0.8;
      detectionMethods.push('timing_analysis');
      subClassification = confidence > 0.9 ? 'early_sniper' : 'late_sniper';
    } else if (analysis.isBundler) {
      classification = 'bundler';
      confidence = 0.85;
      detectionMethods.push('bundle_detection');
      subClassification = 'jito_bundler';
    } else if (analysis.isBot) {
      classification = 'bot';
      confidence = 0.8;
      detectionMethods.push('pattern_analysis');
      subClassification = 'pump_bot';
    } else if (analysis.isWhale) {
      classification = 'whale';
      confidence = analysis.confidenceFactors.whaleHolding || 0.9;
      detectionMethods.push('holding_analysis');
    }

    // Adjust confidence based on data quality
    if (analysis.suspiciousPatterns > 0) {
      confidence = Math.min(0.95, confidence + (analysis.suspiciousPatterns * 0.05));
    }

    const metadata: WalletDetectionMetadata = {
      detectionMethod: detectionMethods,
      confidenceFactors: {
        ...analysis.confidenceFactors,
        overall: confidence
      }
    };

    return {
      classification,
      confidence,
      subClassification,
      metadata
    };
  }

  /**
   * Update classification based on new evidence
   */
  async updateClassification(
    walletAddress: string,
    newEvidence: {
      classification?: WalletClassification;
      additionalPatterns?: string[];
      confidenceAdjustment?: number;
    }
  ): Promise<void> {
    const existing = await this.walletModel.get(walletAddress);
    if (!existing) return;

    const updatedMetadata = { ...existing.detectionMetadata };
    
    if (newEvidence.additionalPatterns) {
      updatedMetadata.detectedPatterns = [
        ...(updatedMetadata.detectedPatterns || []),
        ...newEvidence.additionalPatterns
      ];
    }

    let newConfidence = existing.confidenceScore;
    if (newEvidence.confidenceAdjustment) {
      newConfidence = Math.max(0, Math.min(1, 
        existing.confidenceScore + newEvidence.confidenceAdjustment
      ));
    }

    if (newEvidence.classification && newEvidence.classification !== existing.classification) {
      // Reclassify with higher confidence if we have new evidence
      await this.walletModel.upsert({
        ...existing,
        classification: newEvidence.classification,
        confidenceScore: Math.max(newConfidence, 0.7),
        detectionMetadata: updatedMetadata,
        updatedAt: new Date()
      });
    } else {
      // Just update confidence and metadata
      await this.walletModel.updateConfidence(
        walletAddress,
        newConfidence,
        updatedMetadata
      );
    }
  }

  /**
   * Get classification statistics
   */
  async getClassificationStats(): Promise<any> {
    return await this.walletModel.getStatistics();
  }

  /**
   * Helper: Delay for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}