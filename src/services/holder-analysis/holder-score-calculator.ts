/**
 * Holder Score Calculator
 * 
 * Implements the 0-300 point scoring algorithm for token holder health
 * Base score: 150 points
 * Maximum positive adjustments: +150 points
 * Maximum negative adjustments: -150 points
 */

import { 
  HolderScoreBreakdown,
  TokenHolderAnalysis,
  HolderCounts,
  HoldingPercentages,
  DistributionMetrics
} from '../../types/holder-analysis';
import { logger } from '../../core/logger';

export interface ScoringWeights {
  distribution: number;      // Weight for holder count score
  decentralization: number;  // Weight for ownership distribution
  organicGrowth: number;     // Weight for organic holder ratio
  developerEthics: number;   // Weight for developer holdings
}

export interface ScoringThresholds {
  // Distribution thresholds
  excellentHolderCount: number;
  goodHolderCount: number;
  fairHolderCount: number;
  minHolderCount: number;

  // Decentralization thresholds
  excellentTop10: number;
  goodTop10: number;
  fairTop10: number;
  poorTop10: number;

  // Organic growth thresholds
  excellentBotRatio: number;
  goodBotRatio: number;
  
  // Developer ethics thresholds
  excellentDevHolding: number;
  goodDevHolding: number;
  fairDevHolding: number;

  // Penalty thresholds
  highSniperHolding: number;
  mediumSniperHolding: number;
  lowSniperHolding: number;
  
  highBotHolding: number;
  mediumBotHolding: number;
  lowBotHolding: number;
  
  highBundlerCount: number;
  mediumBundlerCount: number;
  lowBundlerCount: number;

  // Concentration thresholds
  extremeTop10: number;
  veryHighTop10: number;
  highTop10: number;
  moderateTop10: number;
  slightTop10: number;

  extremeTop25: number;
  veryHighTop25: number;
  highTop25: number;
  moderateTop25: number;
}

export class HolderScoreCalculator {
  private readonly BASE_SCORE = 150;
  private readonly weights: ScoringWeights;
  private readonly thresholds: ScoringThresholds;

  constructor(
    weights?: Partial<ScoringWeights>,
    thresholds?: Partial<ScoringThresholds>
  ) {
    // Default weights
    this.weights = {
      distribution: 1.0,
      decentralization: 1.0,
      organicGrowth: 1.0,
      developerEthics: 1.0,
      ...weights
    };

    // Default thresholds (can be customized)
    this.thresholds = {
      // Distribution
      excellentHolderCount: 1000,
      goodHolderCount: 500,
      fairHolderCount: 100,
      minHolderCount: 50,

      // Decentralization
      excellentTop10: 20,
      goodTop10: 30,
      fairTop10: 40,
      poorTop10: 50,

      // Organic growth
      excellentBotRatio: 5,
      goodBotRatio: 15,

      // Developer ethics
      excellentDevHolding: 5,
      goodDevHolding: 10,
      fairDevHolding: 15,

      // Sniper penalties
      highSniperHolding: 30,
      mediumSniperHolding: 20,
      lowSniperHolding: 10,

      // Bot penalties
      highBotHolding: 25,
      mediumBotHolding: 15,
      lowBotHolding: 5,

      // Bundler penalties
      highBundlerCount: 10,
      mediumBundlerCount: 5,
      lowBundlerCount: 2,

      // Concentration penalties
      extremeTop10: 70,
      veryHighTop10: 60,
      highTop10: 50,
      moderateTop10: 40,
      slightTop10: 35,

      extremeTop25: 85,
      veryHighTop25: 75,
      highTop25: 65,
      moderateTop25: 55,

      ...thresholds
    };
  }

  /**
   * Calculate the complete holder score
   */
  calculateScore(analysis: Partial<TokenHolderAnalysis>): HolderScoreBreakdown {
    const breakdown: HolderScoreBreakdown = {
      base: this.BASE_SCORE,
      distributionScore: 0,
      decentralizationScore: 0,
      organicGrowthScore: 0,
      developerEthicsScore: 0,
      sniperPenalty: 0,
      botPenalty: 0,
      bundlerPenalty: 0,
      concentrationPenalty: 0,
      total: 0
    };

    // Calculate positive scores
    if (analysis.holderCounts) {
      breakdown.distributionScore = this.calculateDistributionScore(analysis.holderCounts);
    }

    if (analysis.distributionMetrics) {
      breakdown.decentralizationScore = this.calculateDecentralizationScore(analysis.distributionMetrics);
    }

    if (analysis.holderCounts) {
      breakdown.organicGrowthScore = this.calculateOrganicGrowthScore(analysis.holderCounts);
    }

    if (analysis.holdingPercentages) {
      breakdown.developerEthicsScore = this.calculateDeveloperEthicsScore(analysis.holdingPercentages);
    }

    // Calculate penalties (negative scores)
    if (analysis.holdingPercentages) {
      breakdown.sniperPenalty = this.calculateSniperPenalty(analysis.holdingPercentages);
      breakdown.botPenalty = this.calculateBotPenalty(analysis.holdingPercentages);
    }

    if (analysis.holderCounts) {
      breakdown.bundlerPenalty = this.calculateBundlerPenalty(analysis.holderCounts);
    }

    if (analysis.distributionMetrics) {
      breakdown.concentrationPenalty = this.calculateConcentrationPenalty(analysis.distributionMetrics);
    }

    // Calculate total with bounds [0, 300]
    breakdown.total = Math.max(0, Math.min(300,
      breakdown.base +
      breakdown.distributionScore +
      breakdown.decentralizationScore +
      breakdown.organicGrowthScore +
      breakdown.developerEthicsScore +
      breakdown.sniperPenalty +
      breakdown.botPenalty +
      breakdown.bundlerPenalty +
      breakdown.concentrationPenalty
    ));

    logger.debug('Calculated holder score', { 
      mintAddress: analysis.mintAddress,
      breakdown 
    });

    return breakdown;
  }

  /**
   * Calculate distribution score based on holder count
   */
  private calculateDistributionScore(counts: HolderCounts): number {
    const holders = counts.total;
    const t = this.thresholds;
    
    let score: number;
    if (holders >= t.excellentHolderCount) score = 50;
    else if (holders >= t.goodHolderCount) score = 35;
    else if (holders >= t.fairHolderCount) score = 20;
    else if (holders >= t.minHolderCount) score = 10;
    else score = 5;

    return Math.round(score * this.weights.distribution);
  }

  /**
   * Calculate decentralization score based on ownership distribution
   */
  private calculateDecentralizationScore(metrics: DistributionMetrics): number {
    const top10Pct = metrics.top10Percentage;
    const t = this.thresholds;
    
    let score: number;
    if (top10Pct < t.excellentTop10) score = 50;
    else if (top10Pct < t.goodTop10) score = 35;
    else if (top10Pct < t.fairTop10) score = 20;
    else if (top10Pct < t.poorTop10) score = 10;
    else score = 0;

    return Math.round(score * this.weights.decentralization);
  }

  /**
   * Calculate organic growth score based on bot/sniper ratio
   */
  private calculateOrganicGrowthScore(counts: HolderCounts): number {
    const botPct = (counts.bots / counts.total) * 100;
    const t = this.thresholds;
    
    let score: number;
    if (botPct < t.excellentBotRatio) score = 30;
    else if (botPct < t.goodBotRatio) score = 15;
    else score = 0;

    return Math.round(score * this.weights.organicGrowth);
  }

  /**
   * Calculate developer ethics score based on team holdings
   */
  private calculateDeveloperEthicsScore(percentages: HoldingPercentages): number {
    const devHoldingPct = percentages.developers;
    const t = this.thresholds;
    
    let score: number;
    if (devHoldingPct < t.excellentDevHolding) score = 20;
    else if (devHoldingPct < t.goodDevHolding) score = 10;
    else if (devHoldingPct < t.fairDevHolding) score = 5;
    else score = 0;

    return Math.round(score * this.weights.developerEthics);
  }

  /**
   * Calculate sniper penalty based on sniper holdings
   */
  private calculateSniperPenalty(percentages: HoldingPercentages): number {
    const sniperHoldingsPct = percentages.snipers;
    const t = this.thresholds;
    
    if (sniperHoldingsPct > t.highSniperHolding) return -50;
    if (sniperHoldingsPct > t.mediumSniperHolding) return -30;
    if (sniperHoldingsPct > t.lowSniperHolding) return -15;
    return 0;
  }

  /**
   * Calculate bot penalty based on bot holdings
   */
  private calculateBotPenalty(percentages: HoldingPercentages): number {
    const botHoldingsPct = percentages.bots;
    const t = this.thresholds;
    
    if (botHoldingsPct > t.highBotHolding) return -30;
    if (botHoldingsPct > t.mediumBotHolding) return -20;
    if (botHoldingsPct > t.lowBotHolding) return -10;
    return 0;
  }

  /**
   * Calculate bundler penalty based on bundler count
   */
  private calculateBundlerPenalty(counts: HolderCounts): number {
    const bundlerCount = counts.bundlers;
    const t = this.thresholds;
    
    if (bundlerCount > t.highBundlerCount) return -20;
    if (bundlerCount > t.mediumBundlerCount) return -10;
    if (bundlerCount > t.lowBundlerCount) return -5;
    return 0;
  }

  /**
   * Calculate concentration penalty based on top holder percentages
   */
  private calculateConcentrationPenalty(metrics: DistributionMetrics): number {
    const top10Pct = metrics.top10Percentage;
    const top25Pct = metrics.top25Percentage;
    const t = this.thresholds;
    
    let penalty = 0;
    
    // Top 10 concentration penalties
    if (top10Pct > t.extremeTop10) penalty -= 50;
    else if (top10Pct > t.veryHighTop10) penalty -= 35;
    else if (top10Pct > t.highTop10) penalty -= 25;
    else if (top10Pct > t.moderateTop10) penalty -= 15;
    else if (top10Pct > t.slightTop10) penalty -= 10;
    
    // Additional penalty for top 25 concentration
    if (top25Pct > t.extremeTop25) penalty -= 20;
    else if (top25Pct > t.veryHighTop25) penalty -= 15;
    else if (top25Pct > t.highTop25) penalty -= 10;
    else if (top25Pct > t.moderateTop25) penalty -= 5;
    
    return penalty;
  }

  /**
   * Get score rating and emoji
   */
  getScoreRating(score: number): {
    rating: string;
    emoji: string;
    description: string;
  } {
    if (score >= 250) return { 
      rating: 'Excellent', 
      emoji: '🟢', 
      description: 'Outstanding holder distribution and health' 
    };
    if (score >= 200) return { 
      rating: 'Good', 
      emoji: '🟢', 
      description: 'Strong holder base with minor concerns' 
    };
    if (score >= 150) return { 
      rating: 'Fair', 
      emoji: '🟡', 
      description: 'Average holder health with room for improvement' 
    };
    if (score >= 100) return { 
      rating: 'Poor', 
      emoji: '🟠', 
      description: 'Significant holder concentration or bot activity' 
    };
    return { 
      rating: 'Critical', 
      emoji: '🔴', 
      description: 'Severe holder issues requiring immediate attention' 
    };
  }

  /**
   * Get detailed recommendations based on score breakdown
   */
  getRecommendations(breakdown: HolderScoreBreakdown): string[] {
    const recommendations: string[] = [];

    // Distribution recommendations
    if (breakdown.distributionScore < 20) {
      recommendations.push('Increase holder count through marketing and community building');
    }

    // Decentralization recommendations  
    if (breakdown.decentralizationScore < 20) {
      recommendations.push('Encourage wider token distribution to reduce concentration');
    }

    // Organic growth recommendations
    if (breakdown.organicGrowthScore < 15) {
      recommendations.push('Focus on attracting organic holders vs. bots/snipers');
    }

    // Developer ethics recommendations
    if (breakdown.developerEthicsScore < 10) {
      recommendations.push('Consider reducing team holdings to improve investor confidence');
    }

    // Penalty-based recommendations
    if (breakdown.sniperPenalty < -20) {
      recommendations.push('High sniper concentration detected - implement anti-sniper measures');
    }

    if (breakdown.botPenalty < -15) {
      recommendations.push('Significant bot activity - consider bot detection and prevention');
    }

    if (breakdown.concentrationPenalty < -20) {
      recommendations.push('Extreme concentration in top holders - encourage distribution');
    }

    return recommendations;
  }
}