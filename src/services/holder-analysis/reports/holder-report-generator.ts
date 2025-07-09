import { Pool } from 'pg';
import { logger } from '../../../core/logger';
import { HolderHistoryService } from '../historical/holder-history-service';
import { HolderTrendAnalyzer } from '../historical/trend-analyzer';
import { HolderComparisonService } from '../historical/comparison-service';

export interface HolderReport {
  mintAddress: string;
  symbol: string;
  name: string;
  generatedAt: Date;
  summary: {
    currentScore: number;
    scoreRating: string;
    totalHolders: number;
    uniqueHolders: number;
    marketCap: number;
    lastAnalyzed: Date;
  };
  trends: {
    period: string;
    holderGrowth: string;
    scoreChange: string;
    healthTrajectory: string;
    alerts: Array<{
      type: string;
      message: string;
    }>;
  };
  distribution: {
    top10Percentage: number;
    top25Percentage: number;
    giniCoefficient: number;
    concentrationLevel: string;
  };
  comparison: {
    percentileRank: number;
    peerGroupSize: number;
    insights: string[];
  };
  recommendations: string[];
}

export class HolderReportGenerator {
  private historyService: HolderHistoryService;
  private trendAnalyzer: HolderTrendAnalyzer;
  private comparisonService: HolderComparisonService;

  constructor(private pool: Pool) {
    this.historyService = new HolderHistoryService(pool);
    this.trendAnalyzer = new HolderTrendAnalyzer(pool);
    this.comparisonService = new HolderComparisonService(pool);
  }

  async generateReport(
    mintAddress: string, 
    period: '24h' | '7d' | '30d' = '7d'
  ): Promise<HolderReport> {
    try {
      // Fetch basic token info
      const tokenInfo = await this.getTokenInfo(mintAddress);
      if (!tokenInfo) {
        throw new Error('Token not found');
      }

      // Get latest snapshot
      const latestSnapshot = await this.historyService.getLatestSnapshot(mintAddress);
      if (!latestSnapshot) {
        throw new Error('No holder analysis data available');
      }

      // Analyze trends
      const trends = await this.trendAnalyzer.analyzeTrends(mintAddress, period);

      // Compare with peers
      const comparison = await this.comparisonService.compareToken(mintAddress);

      // Generate recommendations
      const recommendations = this.generateRecommendations(
        latestSnapshot,
        trends,
        comparison
      );

      return {
        mintAddress,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        generatedAt: new Date(),
        summary: {
          currentScore: latestSnapshot.holderScore,
          scoreRating: this.getScoreRating(latestSnapshot.holderScore),
          totalHolders: latestSnapshot.totalHolders,
          uniqueHolders: latestSnapshot.uniqueHolders,
          marketCap: tokenInfo.marketCap,
          lastAnalyzed: latestSnapshot.timestamp
        },
        trends: {
          period,
          holderGrowth: `${trends.holderGrowth.percentage.toFixed(1)}% (${trends.holderGrowth.absolute > 0 ? '+' : ''}${trends.holderGrowth.absolute} holders)`,
          scoreChange: `${trends.scoreMovement.percentage.toFixed(1)}% (${trends.scoreMovement.absolute > 0 ? '+' : ''}${trends.scoreMovement.absolute} points)`,
          healthTrajectory: trends.healthTrajectory,
          alerts: trends.alerts.map(alert => ({
            type: alert.type,
            message: alert.message
          }))
        },
        distribution: {
          top10Percentage: latestSnapshot.top10Percentage,
          top25Percentage: latestSnapshot.top25Percentage,
          giniCoefficient: latestSnapshot.giniCoefficient,
          concentrationLevel: this.getConcentrationLevel(latestSnapshot.top10Percentage)
        },
        comparison: {
          percentileRank: comparison.percentile.holderScore,
          peerGroupSize: comparison.similarTokens.length,
          insights: comparison.insights
        },
        recommendations
      };
    } catch (error) {
      logger.error(`Error generating report for ${mintAddress}:`, error);
      throw error;
    }
  }

  async generateBatchReports(
    mintAddresses: string[],
    period: '24h' | '7d' | '30d' = '7d'
  ): Promise<HolderReport[]> {
    const reports: HolderReport[] = [];
    
    for (const mintAddress of mintAddresses) {
      try {
        const report = await this.generateReport(mintAddress, period);
        reports.push(report);
      } catch (error) {
        logger.error(`Failed to generate report for ${mintAddress}:`, error);
      }
    }

    return reports;
  }

  private async getTokenInfo(mintAddress: string) {
    const query = `
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd as market_cap
      FROM tokens_unified
      WHERE mint_address = $1
    `;

    const result = await this.pool.query(query, [mintAddress]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      symbol: row.symbol || 'Unknown',
      name: row.name || 'Unknown',
      marketCap: parseFloat(row.market_cap) || 0
    };
  }

  private generateRecommendations(
    snapshot: any,
    trends: any,
    comparison: any
  ): string[] {
    const recommendations: string[] = [];

    // Score-based recommendations
    if (snapshot.holderScore < 100) {
      recommendations.push('Critical: Holder health needs immediate attention');
      if (snapshot.top10Percentage > 60) {
        recommendations.push('Reduce concentration by encouraging broader distribution');
      }
      if (snapshot.totalHolders < 50) {
        recommendations.push('Focus on attracting more holders through marketing');
      }
    } else if (snapshot.holderScore < 150) {
      recommendations.push('Warning: Holder health is below average');
      if (trends.healthTrajectory === 'declining') {
        recommendations.push('Address declining health metrics urgently');
      }
    }

    // Trend-based recommendations
    if (trends.holderGrowth.dailyRate > 100) {
      recommendations.push('Monitor for potential bot activity due to rapid growth');
    }
    if (trends.concentrationChange.top10Change > 5) {
      recommendations.push('Concentration is increasing - consider incentives for smaller holders');
    }
    if (trends.walletChurn.rate > 20) {
      recommendations.push('High churn rate detected - investigate reasons for holder exits');
    }

    // Comparison-based recommendations
    if (comparison.percentile.holderScore < 30) {
      recommendations.push('Token ranks in bottom 30% of peer group - study top performers');
    }
    if (comparison.percentile.distribution < 50) {
      recommendations.push('Distribution is worse than half of similar tokens');
    }

    // Positive recommendations
    if (snapshot.holderScore >= 250) {
      recommendations.push('Excellent holder health - maintain current strategies');
    }
    if (trends.healthTrajectory === 'improving' && trends.holderGrowth.percentage > 10) {
      recommendations.push('Positive momentum - continue current growth initiatives');
    }

    return recommendations;
  }

  private getScoreRating(score: number): string {
    if (score >= 250) return 'Excellent';
    if (score >= 200) return 'Good';
    if (score >= 150) return 'Fair';
    if (score >= 100) return 'Poor';
    return 'Critical';
  }

  private getConcentrationLevel(top10Percentage: number): string {
    if (top10Percentage < 25) return 'Low';
    if (top10Percentage < 40) return 'Moderate';
    if (top10Percentage < 60) return 'High';
    return 'Very High';
  }

  async generateMarkdownReport(mintAddress: string, period: '24h' | '7d' | '30d' = '7d'): Promise<string> {
    const report = await this.generateReport(mintAddress, period);
    
    return `# Holder Analysis Report

## Token: ${report.symbol} (${report.name})
**Generated:** ${report.generatedAt.toISOString()}

---

## Summary
- **Current Score:** ${report.summary.currentScore}/300 (${report.summary.scoreRating})
- **Total Holders:** ${report.summary.totalHolders.toLocaleString()}
- **Unique Holders:** ${report.summary.uniqueHolders.toLocaleString()}
- **Market Cap:** $${report.summary.marketCap.toLocaleString()}
- **Last Analyzed:** ${report.summary.lastAnalyzed.toISOString()}

## Trends (${report.trends.period})
- **Holder Growth:** ${report.trends.holderGrowth}
- **Score Change:** ${report.trends.scoreChange}
- **Health Trajectory:** ${report.trends.healthTrajectory}

${report.trends.alerts.length > 0 ? '### Alerts\n' + report.trends.alerts.map(a => `- **${a.type}:** ${a.message}`).join('\n') : ''}

## Distribution
- **Top 10 Holdings:** ${report.distribution.top10Percentage.toFixed(1)}%
- **Top 25 Holdings:** ${report.distribution.top25Percentage.toFixed(1)}%
- **Gini Coefficient:** ${report.distribution.giniCoefficient.toFixed(3)}
- **Concentration Level:** ${report.distribution.concentrationLevel}

## Peer Comparison
- **Percentile Rank:** ${report.comparison.percentileRank.toFixed(0)}th percentile
- **Peer Group Size:** ${report.comparison.peerGroupSize} similar tokens

### Insights
${report.comparison.insights.map(i => `- ${i}`).join('\n')}

## Recommendations
${report.recommendations.map(r => `- ${r}`).join('\n')}

---
*This report is generated automatically based on on-chain data and statistical analysis.*
`;
  }
}