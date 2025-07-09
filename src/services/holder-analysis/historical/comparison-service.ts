import { Pool } from 'pg';
import { logger } from '../../../core/logger';

export interface TokenComparison {
  mintAddress: string;
  symbol: string;
  name: string;
  holderScore: number;
  totalHolders: number;
  marketCap: number;
  top10Percentage: number;
  giniCoefficient: number;
}

export interface ComparisonResult {
  token: TokenComparison;
  similarTokens: TokenComparison[];
  percentile: {
    holderScore: number;
    totalHolders: number;
    distribution: number;
  };
  insights: string[];
}

export interface PeerGroupCriteria {
  marketCapRange?: { min: number; max: number };
  holderCountRange?: { min: number; max: number };
  ageRange?: { minDays: number; maxDays: number };
  limit?: number;
}

export class HolderComparisonService {
  constructor(private pool: Pool) {}

  async compareToken(mintAddress: string, criteria?: PeerGroupCriteria): Promise<ComparisonResult> {
    try {
      // Get the target token's data
      const targetToken = await this.getTokenData(mintAddress);
      if (!targetToken) {
        throw new Error('Token not found');
      }

      // Find similar tokens based on criteria
      const similarTokens = await this.findSimilarTokens(targetToken, criteria);

      // Calculate percentiles
      const percentile = await this.calculatePercentiles(targetToken, similarTokens);

      // Generate insights
      const insights = this.generateInsights(targetToken, similarTokens, percentile);

      return {
        token: targetToken,
        similarTokens,
        percentile,
        insights
      };
    } catch (error) {
      logger.error(`Error comparing token ${mintAddress}:`, error);
      throw error;
    }
  }

  private async getTokenData(mintAddress: string): Promise<TokenComparison | null> {
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd as market_cap,
        hs.holder_score,
        hs.total_holders,
        hs.top_10_percentage,
        hs.gini_coefficient
      FROM tokens_unified t
      LEFT JOIN (
        SELECT DISTINCT ON (mint_address) 
          mint_address,
          holder_score,
          total_holders,
          top_10_percentage,
          gini_coefficient
        FROM holder_snapshots
        WHERE mint_address = $1
        ORDER BY mint_address, snapshot_time DESC
      ) hs ON t.mint_address = hs.mint_address
      WHERE t.mint_address = $1
    `;

    const result = await this.pool.query(query, [mintAddress]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      mintAddress: row.mint_address,
      symbol: row.symbol || 'Unknown',
      name: row.name || 'Unknown',
      holderScore: row.holder_score || 0,
      totalHolders: row.total_holders || 0,
      marketCap: parseFloat(row.market_cap) || 0,
      top10Percentage: parseFloat(row.top_10_percentage) || 0,
      giniCoefficient: parseFloat(row.gini_coefficient) || 0
    };
  }

  private async findSimilarTokens(
    targetToken: TokenComparison, 
    criteria?: PeerGroupCriteria
  ): Promise<TokenComparison[]> {
    // Default criteria: tokens with similar market cap (±50%)
    const marketCapMin = criteria?.marketCapRange?.min || targetToken.marketCap * 0.5;
    const marketCapMax = criteria?.marketCapRange?.max || targetToken.marketCap * 1.5;
    const limit = criteria?.limit || 20;

    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd as market_cap,
        hs.holder_score,
        hs.total_holders,
        hs.top_10_percentage,
        hs.gini_coefficient
      FROM tokens_unified t
      INNER JOIN (
        SELECT DISTINCT ON (mint_address) 
          mint_address,
          holder_score,
          total_holders,
          top_10_percentage,
          gini_coefficient
        FROM holder_snapshots
        ORDER BY mint_address, snapshot_time DESC
      ) hs ON t.mint_address = hs.mint_address
      WHERE t.mint_address != $1
        AND t.latest_market_cap_usd BETWEEN $2 AND $3
        AND hs.holder_score IS NOT NULL
      ORDER BY ABS(t.latest_market_cap_usd - $4) ASC
      LIMIT $5
    `;

    const result = await this.pool.query(query, [
      targetToken.mintAddress,
      marketCapMin,
      marketCapMax,
      targetToken.marketCap,
      limit
    ]);

    return result.rows.map(row => ({
      mintAddress: row.mint_address,
      symbol: row.symbol || 'Unknown',
      name: row.name || 'Unknown',
      holderScore: row.holder_score || 0,
      totalHolders: row.total_holders || 0,
      marketCap: parseFloat(row.market_cap) || 0,
      top10Percentage: parseFloat(row.top_10_percentage) || 0,
      giniCoefficient: parseFloat(row.gini_coefficient) || 0
    }));
  }

  private async calculatePercentiles(
    targetToken: TokenComparison,
    peerGroup: TokenComparison[]
  ): Promise<{ holderScore: number; totalHolders: number; distribution: number }> {
    const allTokens = [targetToken, ...peerGroup];

    // Sort by holder score
    const scoresSorted = allTokens
      .map(t => t.holderScore)
      .sort((a, b) => a - b);
    const scorePercentile = this.getPercentile(targetToken.holderScore, scoresSorted);

    // Sort by total holders
    const holdersSorted = allTokens
      .map(t => t.totalHolders)
      .sort((a, b) => a - b);
    const holdersPercentile = this.getPercentile(targetToken.totalHolders, holdersSorted);

    // Sort by distribution (inverse of top10 percentage - lower is better)
    const distributionSorted = allTokens
      .map(t => 100 - t.top10Percentage)
      .sort((a, b) => a - b);
    const distributionPercentile = this.getPercentile(100 - targetToken.top10Percentage, distributionSorted);

    return {
      holderScore: scorePercentile,
      totalHolders: holdersPercentile,
      distribution: distributionPercentile
    };
  }

  private getPercentile(value: number, sortedArray: number[]): number {
    const index = sortedArray.findIndex(v => v >= value);
    if (index === -1) return 100;
    return (index / sortedArray.length) * 100;
  }

  private generateInsights(
    targetToken: TokenComparison,
    peerGroup: TokenComparison[],
    percentile: { holderScore: number; totalHolders: number; distribution: number }
  ): string[] {
    const insights: string[] = [];

    // Score insights
    if (percentile.holderScore >= 80) {
      insights.push('Token has excellent holder health compared to similar tokens');
    } else if (percentile.holderScore >= 60) {
      insights.push('Token has above-average holder health in its peer group');
    } else if (percentile.holderScore <= 20) {
      insights.push('⚠️ Token has poor holder health compared to similar tokens');
    }

    // Holder count insights
    const avgHolders = peerGroup.reduce((sum, t) => sum + t.totalHolders, 0) / peerGroup.length;
    if (targetToken.totalHolders > avgHolders * 1.5) {
      insights.push('Token has significantly more holders than average for its market cap');
    } else if (targetToken.totalHolders < avgHolders * 0.5) {
      insights.push('⚠️ Token has fewer holders than typical for its market cap');
    }

    // Distribution insights
    const avgTop10 = peerGroup.reduce((sum, t) => sum + t.top10Percentage, 0) / peerGroup.length;
    if (targetToken.top10Percentage < avgTop10 * 0.8) {
      insights.push('Token has better distribution than most peers');
    } else if (targetToken.top10Percentage > avgTop10 * 1.2) {
      insights.push('⚠️ Token is more concentrated than typical peers');
    }

    // Best in class comparisons
    const bestScore = Math.max(...peerGroup.map(t => t.holderScore));
    const bestToken = peerGroup.find(t => t.holderScore === bestScore);
    if (bestToken && targetToken.holderScore < bestScore * 0.8) {
      insights.push(`Best-in-class token (${bestToken.symbol}) has ${bestScore} holder score`);
    }

    return insights;
  }

  async getTopTokensByScore(limit: number = 100): Promise<TokenComparison[]> {
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd as market_cap,
        hs.holder_score,
        hs.total_holders,
        hs.top_10_percentage,
        hs.gini_coefficient
      FROM tokens_unified t
      INNER JOIN (
        SELECT DISTINCT ON (mint_address) 
          mint_address,
          holder_score,
          total_holders,
          top_10_percentage,
          gini_coefficient
        FROM holder_snapshots
        WHERE holder_score IS NOT NULL
        ORDER BY mint_address, snapshot_time DESC
      ) hs ON t.mint_address = hs.mint_address
      WHERE t.latest_market_cap_usd > 10000
      ORDER BY hs.holder_score DESC
      LIMIT $1
    `;

    const result = await this.pool.query(query, [limit]);
    
    return result.rows.map(row => ({
      mintAddress: row.mint_address,
      symbol: row.symbol || 'Unknown',
      name: row.name || 'Unknown',
      holderScore: row.holder_score || 0,
      totalHolders: row.total_holders || 0,
      marketCap: parseFloat(row.market_cap) || 0,
      top10Percentage: parseFloat(row.top_10_percentage) || 0,
      giniCoefficient: parseFloat(row.gini_coefficient) || 0
    }));
  }
}