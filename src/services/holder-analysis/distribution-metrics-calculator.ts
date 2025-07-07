/**
 * Distribution Metrics Calculator
 * 
 * Calculates various distribution metrics for token holders including
 * Gini coefficient, Herfindahl index, and concentration percentages
 */

import { NormalizedTokenHolder } from '../holder-analysis/holder-data-fetcher';
import { logger } from '../../core/logger';

// Import the actual type from holder-analysis.ts
import { DistributionMetrics } from '../../types/holder-analysis';

export interface DistributionHealth {
  score: number;  // 0-100
  rating: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  insights: string[];
}

export type InsightType = 'positive' | 'negative' | 'neutral';

export class DistributionMetricsCalculator {
  /**
   * Calculate all distribution metrics for a set of holders
   */
  calculateMetrics(holders: NormalizedTokenHolder[]): DistributionMetrics {
    if (!holders || holders.length === 0) {
      return this.getEmptyMetrics();
    }

    // Sort holders by balance descending
    const sortedHolders = [...holders].sort((a, b) => 
      Number(BigInt(b.balance) - BigInt(a.balance))
    );

    const metrics: DistributionMetrics = {
      top10Percentage: this.calculateTopNPercentage(sortedHolders, 10),
      top25Percentage: this.calculateTopNPercentage(sortedHolders, 25),
      top100Percentage: this.calculateTopNPercentage(sortedHolders, 100),
      giniCoefficient: this.calculateGiniCoefficient(sortedHolders),
      herfindahlIndex: this.calculateHerfindahlIndex(sortedHolders),
      averageHoldingDuration: 0, // Will be calculated from transaction history
      medianHoldingDuration: 0  // Will be calculated from transaction history
    };

    logger.debug('Calculated distribution metrics', { 
      holderCount: holders.length,
      metrics 
    });

    return metrics;
  }

  /**
   * Calculate what percentage of supply is held by top N holders
   */
  private calculateTopNPercentage(
    sortedHolders: NormalizedTokenHolder[], 
    n: number
  ): number {
    if (sortedHolders.length === 0) return 0;

    const topN = sortedHolders.slice(0, Math.min(n, sortedHolders.length));
    
    // Calculate total supply from all holders
    const totalSupply = sortedHolders.reduce((sum, holder) => 
      sum + BigInt(holder.balance), BigInt(0)
    );

    if (totalSupply === BigInt(0)) return 0;

    // Calculate holdings of top N
    const topNHoldings = topN.reduce((sum, holder) => 
      sum + BigInt(holder.balance), BigInt(0)
    );

    // Convert to percentage with 2 decimal places
    const percentage = Number((topNHoldings * BigInt(10000)) / totalSupply) / 100;
    
    return Math.round(percentage * 100) / 100;
  }

  /**
   * Calculate Gini coefficient (0 = perfect equality, 1 = perfect inequality)
   */
  private calculateGiniCoefficient(sortedHolders: NormalizedTokenHolder[]): number {
    if (sortedHolders.length === 0) return 0;
    if (sortedHolders.length === 1) return 0; // Perfect equality with one holder

    // Convert balances to numbers for calculation
    const balances = sortedHolders.map(h => Number(BigInt(h.balance)));
    const n = balances.length;
    
    // Calculate total balance
    const totalBalance = balances.reduce((sum, balance) => sum + balance, 0);
    
    if (totalBalance === 0) return 0;

    // Sort balances in ascending order for Gini calculation
    const sortedBalances = [...balances].sort((a, b) => a - b);

    // Calculate Gini coefficient using the formula:
    // G = (2 * sum(i * balance[i])) / (n * totalBalance) - (n + 1) / n
    let weightedSum = 0;
    for (let i = 0; i < n; i++) {
      weightedSum += (i + 1) * sortedBalances[i];
    }

    const gini = (2 * weightedSum) / (n * totalBalance) - (n + 1) / n;
    
    // Ensure result is between 0 and 1
    return Math.max(0, Math.min(1, Math.round(gini * 10000) / 10000));
  }

  /**
   * Calculate Herfindahl-Hirschman Index (HHI)
   * Measures market concentration: 0 = perfect competition, 1 = monopoly
   */
  private calculateHerfindahlIndex(sortedHolders: NormalizedTokenHolder[]): number {
    if (sortedHolders.length === 0) return 0;

    // Calculate total supply
    const totalSupply = sortedHolders.reduce((sum, holder) => 
      sum + BigInt(holder.balance), BigInt(0)
    );

    if (totalSupply === BigInt(0)) return 0;

    // Calculate HHI as sum of squared market shares
    let hhi = 0;
    for (const holder of sortedHolders) {
      const marketShare = Number(BigInt(holder.balance) * BigInt(10000) / totalSupply) / 10000;
      hhi += marketShare * marketShare;
    }

    return Math.round(hhi * 10000) / 10000;
  }

  /**
   * Calculate statistics about holding durations
   * Note: This requires transaction history data
   */
  calculateHoldingDurationStats(
    holders: Array<{
      address: string;
      firstAcquired?: Date;
      lastTransaction?: Date;
    }>,
    currentTime: Date = new Date()
  ): {
    averageDuration: number;
    medianDuration: number;
  } {
    const durations: number[] = [];

    for (const holder of holders) {
      if (holder.firstAcquired) {
        const duration = (currentTime.getTime() - holder.firstAcquired.getTime()) / (1000 * 60 * 60);
        durations.push(duration); // Duration in hours
      }
    }

    if (durations.length === 0) {
      return { averageDuration: 0, medianDuration: 0 };
    }

    // Calculate average
    const averageDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;

    // Calculate median
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const medianDuration = sortedDurations.length % 2 === 0
      ? (sortedDurations[sortedDurations.length / 2 - 1] + sortedDurations[sortedDurations.length / 2]) / 2
      : sortedDurations[Math.floor(sortedDurations.length / 2)];

    return {
      averageDuration: Math.round(averageDuration * 100) / 100,
      medianDuration: Math.round(medianDuration * 100) / 100
    };
  }

  /**
   * Calculate concentration ratio (CR-n)
   * What percentage of supply is held by top n addresses
   */
  calculateConcentrationRatio(
    holders: NormalizedTokenHolder[],
    n: number
  ): number {
    return this.calculateTopNPercentage(holders, n);
  }

  /**
   * Calculate decentralization score (0-100)
   * Higher score = more decentralized
   */
  calculateDecentralizationScore(metrics: DistributionMetrics): number {
    // Weighted scoring based on multiple factors
    const giniScore = (1 - metrics.giniCoefficient) * 40; // 40% weight
    const top10Score = Math.max(0, (100 - metrics.top10Percentage) * 0.3); // 30% weight
    const top25Score = Math.max(0, (100 - metrics.top25Percentage) * 0.2); // 20% weight
    const hhiScore = (1 - metrics.herfindahlIndex) * 10; // 10% weight

    const totalScore = giniScore + top10Score + top25Score + hhiScore;
    
    return Math.round(Math.max(0, Math.min(100, totalScore)));
  }

  /**
   * Get empty metrics object
   */
  private getEmptyMetrics(): DistributionMetrics {
    return {
      top10Percentage: 0,
      top25Percentage: 0,
      top100Percentage: 0,
      giniCoefficient: 0,
      herfindahlIndex: 0,
      averageHoldingDuration: 0,
      medianHoldingDuration: 0
    };
  }

  /**
   * Analyze distribution health and provide insights
   */
  analyzeDistributionHealth(metrics: DistributionMetrics): {
    health: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    insights: string[];
  } {
    const insights: string[] = [];
    let healthScore = 100;

    // Analyze Gini coefficient
    if (metrics.giniCoefficient > 0.9) {
      insights.push('Extreme wealth concentration (Gini > 0.9)');
      healthScore -= 30;
    } else if (metrics.giniCoefficient > 0.8) {
      insights.push('High wealth concentration (Gini > 0.8)');
      healthScore -= 20;
    } else if (metrics.giniCoefficient < 0.5) {
      insights.push('Good wealth distribution (Gini < 0.5)');
    }

    // Analyze top holder concentration
    if (metrics.top10Percentage > 80) {
      insights.push('Top 10 holders control over 80% of supply');
      healthScore -= 40;
    } else if (metrics.top10Percentage > 60) {
      insights.push('Top 10 holders control over 60% of supply');
      healthScore -= 25;
    } else if (metrics.top10Percentage < 30) {
      insights.push('Well distributed among top holders');
    }

    // Analyze Herfindahl index
    if (metrics.herfindahlIndex > 0.25) {
      insights.push('High market concentration (HHI > 0.25)');
      healthScore -= 15;
    } else if (metrics.herfindahlIndex < 0.1) {
      insights.push('Low market concentration indicates good competition');
    }

    // Determine health rating
    let health: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    if (healthScore >= 90) health = 'excellent';
    else if (healthScore >= 75) health = 'good';
    else if (healthScore >= 50) health = 'fair';
    else if (healthScore >= 25) health = 'poor';
    else health = 'critical';

    return { health, insights };
  }
}