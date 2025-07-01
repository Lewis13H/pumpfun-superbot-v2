/**
 * Slippage Analyzer Service
 * Analyzes slippage failures and provides insights on price movements
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { FailedTransaction, FailureReason } from './failed-tx-analyzer';

export interface SlippageAnalysis {
  signature: string;
  mintAddress: string;
  userAddress: string;
  intendedAction: 'buy' | 'sell';
  expectedPrice: number;
  actualPrice: number;
  slippagePercent: number;
  priceMovementDirection: 'up' | 'down';
  isHighSlippage: boolean;
  likelyMEV: boolean;
  recommendedSlippage: number;
  slot: bigint;
  blockTime: number;
}

export interface SlippagePattern {
  mintAddress: string;
  avgSlippage: number;
  maxSlippage: number;
  failureCount: number;
  successCount: number;
  failureRate: number;
  volatilityScore: number;
  recommendedSlippage: number;
  timeWindow: {
    start: Date;
    end: Date;
  };
}

export class SlippageAnalyzer {
  private static instance: SlippageAnalyzer;
  private logger: Logger;
  private eventBus: EventBus;
  
  private slippageHistory: Map<string, SlippageAnalysis[]> = new Map(); // mint -> analyses
  private tokenPatterns: Map<string, SlippagePattern> = new Map();
  private recentSlippages: SlippageAnalysis[] = [];

  private readonly HIGH_SLIPPAGE_THRESHOLD = 5; // 5%
  private readonly MEV_SLIPPAGE_THRESHOLD = 10; // 10%

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'SlippageAnalyzer' });
    this.eventBus = eventBus;
    
    // Start periodic pattern analysis
    setInterval(() => this.analyzeSlippagePatterns(), 30000); // Every 30 seconds
    setInterval(() => this.cleanupOldData(), 3600000); // Every hour
  }

  static getInstance(eventBus: EventBus): SlippageAnalyzer {
    if (!SlippageAnalyzer.instance) {
      SlippageAnalyzer.instance = new SlippageAnalyzer(eventBus);
    }
    return SlippageAnalyzer.instance;
  }

  /**
   * Analyze slippage failure
   */
  async analyzeSlippageFailure(failedTx: FailedTransaction): Promise<SlippageAnalysis | null> {
    try {
      if (failedTx.failureReason !== FailureReason.SLIPPAGE_EXCEEDED) {
        return null;
      }

      // Extract slippage details from metadata
      const slippageAmount = failedTx.analysisMetadata.slippageAmount || 0;
      
      // Calculate expected vs actual price
      // In real implementation, would extract from transaction data
      const expectedPrice = this.extractExpectedPrice(failedTx);
      const actualPrice = this.calculateActualPrice(expectedPrice, slippageAmount);
      
      const analysis: SlippageAnalysis = {
        signature: failedTx.signature,
        mintAddress: failedTx.mintAddress || '',
        userAddress: failedTx.userAddress,
        intendedAction: failedTx.intendedAction as 'buy' | 'sell',
        expectedPrice,
        actualPrice,
        slippagePercent: slippageAmount,
        priceMovementDirection: actualPrice > expectedPrice ? 'up' : 'down',
        isHighSlippage: slippageAmount > this.HIGH_SLIPPAGE_THRESHOLD,
        likelyMEV: slippageAmount > this.MEV_SLIPPAGE_THRESHOLD || failedTx.mevSuspected,
        recommendedSlippage: this.calculateRecommendedSlippage(failedTx.mintAddress || '', slippageAmount),
        slot: failedTx.slot,
        blockTime: failedTx.blockTime
      };

      // Store analysis
      this.storeSlippageAnalysis(analysis);
      
      // Emit event if high slippage or MEV suspected
      if (analysis.isHighSlippage || analysis.likelyMEV) {
        this.eventBus.emit('slippage:high_detected', analysis);
      }

      this.logger.debug('Slippage analyzed', {
        signature: failedTx.signature,
        slippage: slippageAmount + '%',
        mev: analysis.likelyMEV
      });

      return analysis;
    } catch (error) {
      this.logger.error('Error analyzing slippage', error as Error);
      return null;
    }
  }

  /**
   * Extract expected price from transaction
   */
  private extractExpectedPrice(_failedTx: FailedTransaction): number {
    // In real implementation, would parse from transaction instruction data
    // For now, return a mock value
    return 0.001; // 0.001 SOL per token
  }

  /**
   * Calculate actual price based on slippage
   */
  private calculateActualPrice(expectedPrice: number, slippagePercent: number): number {
    return expectedPrice * (1 + slippagePercent / 100);
  }

  /**
   * Calculate recommended slippage for a token
   */
  private calculateRecommendedSlippage(mintAddress: string, currentSlippage: number): number {
    const pattern = this.tokenPatterns.get(mintAddress);
    
    if (pattern) {
      // Use historical data to recommend slippage
      const buffer = 1.2; // 20% buffer
      return Math.min(pattern.maxSlippage * buffer, 50); // Cap at 50%
    }
    
    // Default recommendation based on current failure
    return Math.min(currentSlippage * 1.5, 20); // 50% more than failed, cap at 20%
  }

  /**
   * Store slippage analysis
   */
  private storeSlippageAnalysis(analysis: SlippageAnalysis): void {
    // Add to recent slippages
    this.recentSlippages.push(analysis);
    if (this.recentSlippages.length > 1000) {
      this.recentSlippages.shift();
    }

    // Add to token history
    if (!this.slippageHistory.has(analysis.mintAddress)) {
      this.slippageHistory.set(analysis.mintAddress, []);
    }
    this.slippageHistory.get(analysis.mintAddress)!.push(analysis);
  }

  /**
   * Analyze slippage patterns for tokens
   */
  private async analyzeSlippagePatterns(): Promise<void> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      for (const [mintAddress, analyses] of this.slippageHistory) {
        // Get recent analyses
        const recentAnalyses = analyses.filter(a => 
          new Date(a.blockTime * 1000) > oneHourAgo
        );

        if (recentAnalyses.length === 0) continue;

        // Calculate pattern
        const slippages = recentAnalyses.map(a => a.slippagePercent);
        const avgSlippage = slippages.reduce((a, b) => a + b, 0) / slippages.length;
        const maxSlippage = Math.max(...slippages);
        
        // Calculate volatility (standard deviation)
        const variance = slippages.reduce((sum, s) => 
          sum + Math.pow(s - avgSlippage, 2), 0
        ) / slippages.length;
        const volatility = Math.sqrt(variance);

        const pattern: SlippagePattern = {
          mintAddress,
          avgSlippage,
          maxSlippage,
          failureCount: recentAnalyses.length,
          successCount: 0, // Would need successful tx data
          failureRate: 100, // All are failures in this context
          volatilityScore: volatility,
          recommendedSlippage: Math.ceil(maxSlippage * 1.2), // 20% buffer
          timeWindow: {
            start: oneHourAgo,
            end: now
          }
        };

        this.tokenPatterns.set(mintAddress, pattern);

        // Alert if high volatility
        if (volatility > 5) {
          this.eventBus.emit('slippage:high_volatility', {
            mintAddress,
            volatility,
            pattern
          });
        }
      }
    } catch (error) {
      this.logger.error('Error analyzing patterns', error as Error);
    }
  }

  /**
   * Get slippage recommendation for a token
   */
  getSlippageRecommendation(mintAddress: string): number {
    const pattern = this.tokenPatterns.get(mintAddress);
    if (pattern) {
      return pattern.recommendedSlippage;
    }
    
    // Default recommendation
    return 1; // 1% default
  }

  /**
   * Get slippage pattern for a token
   */
  getTokenSlippagePattern(mintAddress: string): SlippagePattern | undefined {
    return this.tokenPatterns.get(mintAddress);
  }

  /**
   * Get recent high slippage events
   */
  getHighSlippageEvents(limit: number = 50): SlippageAnalysis[] {
    return this.recentSlippages
      .filter(s => s.isHighSlippage)
      .sort((a, b) => Number(b.slot - a.slot))
      .slice(0, limit);
  }

  /**
   * Get MEV suspected slippages
   */
  getMEVSuspectedSlippages(limit: number = 50): SlippageAnalysis[] {
    return this.recentSlippages
      .filter(s => s.likelyMEV)
      .sort((a, b) => Number(b.slot - a.slot))
      .slice(0, limit);
  }

  /**
   * Get slippage statistics
   */
  getSlippageStats() {
    const totalAnalyses = this.recentSlippages.length;
    const highSlippageCount = this.recentSlippages.filter(s => s.isHighSlippage).length;
    const mevSuspectedCount = this.recentSlippages.filter(s => s.likelyMEV).length;
    
    const avgSlippage = totalAnalyses > 0
      ? this.recentSlippages.reduce((sum, s) => sum + s.slippagePercent, 0) / totalAnalyses
      : 0;
    
    const maxSlippage = totalAnalyses > 0
      ? Math.max(...this.recentSlippages.map(s => s.slippagePercent))
      : 0;

    return {
      totalAnalyses,
      highSlippageCount,
      highSlippageRate: totalAnalyses > 0 ? (highSlippageCount / totalAnalyses) * 100 : 0,
      mevSuspectedCount,
      mevSuspectedRate: totalAnalyses > 0 ? (mevSuspectedCount / totalAnalyses) * 100 : 0,
      avgSlippage,
      maxSlippage,
      trackedTokens: this.slippageHistory.size,
      patternsAnalyzed: this.tokenPatterns.size
    };
  }

  /**
   * Get top volatile tokens
   */
  getTopVolatileTokens(limit: number = 10): Array<{
    mintAddress: string;
    pattern: SlippagePattern;
  }> {
    return Array.from(this.tokenPatterns.entries())
      .map(([mint, pattern]) => ({ mintAddress: mint, pattern }))
      .sort((a, b) => b.pattern.volatilityScore - a.pattern.volatilityScore)
      .slice(0, limit);
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const oneDayAgo = Date.now() / 1000 - 24 * 60 * 60;
    
    // Clean up slippage history
    for (const [mint, analyses] of this.slippageHistory) {
      const recent = analyses.filter(a => a.blockTime > oneDayAgo);
      if (recent.length === 0) {
        this.slippageHistory.delete(mint);
      } else {
        this.slippageHistory.set(mint, recent);
      }
    }
    
    // Clean up recent slippages
    this.recentSlippages = this.recentSlippages.filter(s => s.blockTime > oneDayAgo);
    
    this.logger.debug('Cleaned up old slippage data', {
      remainingTokens: this.slippageHistory.size,
      remainingAnalyses: this.recentSlippages.length
    });
  }
}