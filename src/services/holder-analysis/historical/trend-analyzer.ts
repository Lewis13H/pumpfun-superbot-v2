import { Pool } from 'pg';
import { logger } from '../../../core/logger';

export interface TrendWindow {
  period: '1h' | '6h' | '24h' | '7d' | '30d';
  startTime: Date;
  endTime: Date;
}

export interface HolderTrend {
  mintAddress: string;
  timeWindow: string;
  holderCountChange: number;
  holderGrowthRate: number;
  avgHolderDurationHours: number;
  churnRate: number;
  newWhaleCount: number;
  newSniperCount: number;
  calculatedAt: Date;
}

export interface GrowthTrend {
  absolute: number;
  percentage: number;
  dailyRate: number;
  direction: 'up' | 'down' | 'stable';
  isAccelerating: boolean;
  projection7d: number;
}

export interface ConcentrationTrend {
  top10Change: number;
  top25Change: number;
  giniChange: number;
  isIncreasing: boolean;
}

export interface HealthAlert {
  type: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: Date;
}

export interface ComprehensiveTrends {
  holderGrowth: GrowthTrend;
  scoreMovement: {
    absolute: number;
    percentage: number;
    direction: 'improving' | 'declining' | 'stable';
  };
  concentrationChange: ConcentrationTrend;
  walletChurn: {
    rate: number;
    newHolders: number;
    exitedHolders: number;
  };
  healthTrajectory: 'improving' | 'stable' | 'declining';
  alerts: HealthAlert[];
}

export class HolderTrendAnalyzer {
  constructor(private pool: Pool) {}

  async analyzeTrends(
    mintAddress: string,
    period: '1h' | '6h' | '24h' | '7d' | '30d' = '7d'
  ): Promise<ComprehensiveTrends> {
    try {
      // Fetch snapshots for the period
      const snapshots = await this.fetchSnapshots(mintAddress, period);
      
      if (snapshots.length < 2) {
        return this.getEmptyTrends();
      }

      // Calculate various trends
      const trends: ComprehensiveTrends = {
        holderGrowth: await this.calculateGrowthTrend(snapshots),
        scoreMovement: this.calculateScoreTrend(snapshots),
        concentrationChange: this.calculateConcentrationTrend(snapshots),
        walletChurn: await this.calculateChurnRate(mintAddress, period),
        healthTrajectory: this.calculateHealthTrajectory(snapshots),
        alerts: []
      };

      // Generate alerts for significant changes
      trends.alerts = this.generateAlerts(trends);

      // Store the calculated trends
      await this.storeTrends(mintAddress, period, trends);

      return trends;
    } catch (error) {
      logger.error(`Error analyzing trends for ${mintAddress}:`, error);
      throw error;
    }
  }

  private async fetchSnapshots(mintAddress: string, period: string): Promise<any[]> {
    const periodMs = this.getPeriodInMs(period);
    const startTime = new Date(Date.now() - periodMs);

    const query = `
      SELECT 
        snapshot_time,
        total_holders,
        unique_holders,
        holder_score,
        top_10_percentage,
        top_25_percentage,
        gini_coefficient,
        score_breakdown
      FROM holder_snapshots
      WHERE mint_address = $1
        AND snapshot_time >= $2
      ORDER BY snapshot_time ASC
    `;

    const result = await this.pool.query(query, [mintAddress, startTime]);
    return result.rows;
  }

  private async calculateGrowthTrend(snapshots: any[]): Promise<GrowthTrend> {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    
    const absoluteGrowth = last.total_holders - first.total_holders;
    const percentGrowth = first.total_holders > 0 
      ? ((absoluteGrowth / first.total_holders) * 100)
      : 0;
    
    // Calculate growth rate (holders per day)
    const daysDiff = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / (1000 * 60 * 60 * 24);
    const dailyGrowthRate = daysDiff > 0 ? absoluteGrowth / daysDiff : 0;
    
    // Determine if growth is accelerating
    const recentSnapshots = snapshots.slice(-Math.min(5, snapshots.length));
    const isAccelerating = this.isGrowthAccelerating(recentSnapshots);
    
    return {
      absolute: absoluteGrowth,
      percentage: percentGrowth,
      dailyRate: dailyGrowthRate,
      direction: absoluteGrowth > 5 ? 'up' : absoluteGrowth < -5 ? 'down' : 'stable',
      isAccelerating,
      projection7d: Math.round(last.total_holders + (dailyGrowthRate * 7))
    };
  }

  private calculateScoreTrend(snapshots: any[]) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    
    const absoluteChange = last.holder_score - first.holder_score;
    const percentageChange = first.holder_score > 0 
      ? ((absoluteChange / first.holder_score) * 100)
      : 0;
    
    return {
      absolute: absoluteChange,
      percentage: percentageChange,
      direction: (absoluteChange > 5 ? 'improving' : absoluteChange < -5 ? 'declining' : 'stable') as 'improving' | 'declining' | 'stable'
    };
  }

  private calculateConcentrationTrend(snapshots: any[]): ConcentrationTrend {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    
    return {
      top10Change: last.top_10_percentage - first.top_10_percentage,
      top25Change: last.top_25_percentage - first.top_25_percentage,
      giniChange: last.gini_coefficient - first.gini_coefficient,
      isIncreasing: last.top_10_percentage > first.top_10_percentage
    };
  }

  private async calculateChurnRate(mintAddress: string, period: string) {
    // This would require tracking individual holder changes
    // For now, we'll estimate based on holder count changes
    const periodMs = this.getPeriodInMs(period);
    const midPoint = new Date(Date.now() - periodMs / 2);
    const startTime = new Date(Date.now() - periodMs);

    const query = `
      SELECT 
        COUNT(DISTINCT wallet_address) as holder_count
      FROM token_holder_details
      WHERE mint_address = $1
        AND updated_at >= $2
        AND updated_at < $3
    `;

    const beforeResult = await this.pool.query(query, [mintAddress, startTime, midPoint]);
    const afterResult = await this.pool.query(query, [mintAddress, midPoint, new Date()]);

    const beforeCount = parseInt(beforeResult.rows[0]?.holder_count || '0');
    const afterCount = parseInt(afterResult.rows[0]?.holder_count || '0');

    const newHolders = Math.max(0, afterCount - beforeCount);
    const exitedHolders = Math.max(0, beforeCount - afterCount);
    const avgCount = (beforeCount + afterCount) / 2;
    const churnRate = avgCount > 0 ? ((newHolders + exitedHolders) / avgCount) * 100 : 0;

    return {
      rate: churnRate,
      newHolders,
      exitedHolders
    };
  }

  private calculateHealthTrajectory(snapshots: any[]): 'improving' | 'stable' | 'declining' {
    if (snapshots.length < 3) return 'stable';

    // Look at the last 3 snapshots
    const recent = snapshots.slice(-3);
    const scoreChanges = [];
    
    for (let i = 1; i < recent.length; i++) {
      scoreChanges.push(recent[i].holder_score - recent[i-1].holder_score);
    }

    const avgChange = scoreChanges.reduce((a, b) => a + b, 0) / scoreChanges.length;
    
    if (avgChange > 5) return 'improving';
    if (avgChange < -5) return 'declining';
    return 'stable';
  }

  private isGrowthAccelerating(snapshots: any[]): boolean {
    if (snapshots.length < 3) return false;

    const growthRates = [];
    for (let i = 1; i < snapshots.length; i++) {
      const timeDiff = (new Date(snapshots[i].snapshot_time).getTime() - 
                       new Date(snapshots[i-1].snapshot_time).getTime()) / (1000 * 60 * 60);
      const holderDiff = snapshots[i].total_holders - snapshots[i-1].total_holders;
      growthRates.push(holderDiff / timeDiff);
    }

    // Check if growth rate is increasing
    let increasing = 0;
    for (let i = 1; i < growthRates.length; i++) {
      if (growthRates[i] > growthRates[i-1]) increasing++;
    }

    return increasing > growthRates.length / 2;
  }

  private generateAlerts(trends: ComprehensiveTrends): HealthAlert[] {
    const alerts: HealthAlert[] = [];
    
    // Score deterioration alert
    if (trends.scoreMovement.percentage < -10) {
      alerts.push({
        type: 'warning',
        title: 'Holder Score Declining',
        message: `Score decreased by ${Math.abs(trends.scoreMovement.percentage).toFixed(1)}% in the period`,
        severity: 'medium',
        timestamp: new Date()
      });
    }
    
    // High concentration alert
    if (trends.concentrationChange.top10Change > 5) {
      alerts.push({
        type: 'warning',
        title: 'Increasing Concentration',
        message: `Top 10 holders increased their share by ${trends.concentrationChange.top10Change.toFixed(1)}%`,
        severity: 'high',
        timestamp: new Date()
      });
    }
    
    // Rapid growth alert (possible bot activity)
    if (trends.holderGrowth.dailyRate > 100) {
      alerts.push({
        type: 'info',
        title: 'Rapid Holder Growth',
        message: `Growing at ${trends.holderGrowth.dailyRate.toFixed(0)} holders/day - verify for bot activity`,
        severity: 'medium',
        timestamp: new Date()
      });
    }

    // High churn alert
    if (trends.walletChurn.rate > 20) {
      alerts.push({
        type: 'warning',
        title: 'High Wallet Churn',
        message: `${trends.walletChurn.rate.toFixed(1)}% churn rate detected`,
        severity: 'medium',
        timestamp: new Date()
      });
    }

    // Critical score alert
    if (trends.scoreMovement.absolute < 0 && trends.healthTrajectory === 'declining') {
      alerts.push({
        type: 'critical',
        title: 'Deteriorating Health',
        message: 'Holder score and health metrics are consistently declining',
        severity: 'high',
        timestamp: new Date()
      });
    }
    
    return alerts;
  }

  private async storeTrends(mintAddress: string, period: string, trends: ComprehensiveTrends): Promise<void> {
    const query = `
      INSERT INTO holder_trends (
        mint_address,
        time_window,
        holder_count_change,
        holder_growth_rate,
        avg_holder_duration_hours,
        churn_rate,
        new_whale_count,
        new_sniper_count,
        calculated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (mint_address, time_window, calculated_at) DO UPDATE SET
        holder_count_change = EXCLUDED.holder_count_change,
        holder_growth_rate = EXCLUDED.holder_growth_rate,
        churn_rate = EXCLUDED.churn_rate
    `;

    try {
      await this.pool.query(query, [
        mintAddress,
        period,
        trends.holderGrowth.absolute,
        trends.holderGrowth.dailyRate,
        0, // avg_holder_duration_hours - would need more complex calculation
        trends.walletChurn.rate,
        0, // new_whale_count - would need to track wallet classifications
        0  // new_sniper_count - would need to track wallet classifications
      ]);
    } catch (error) {
      logger.error('Error storing trends:', error);
    }
  }

  private getPeriodInMs(period: string): number {
    const periods: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    return periods[period] || periods['24h'];
  }

  private getEmptyTrends(): ComprehensiveTrends {
    return {
      holderGrowth: {
        absolute: 0,
        percentage: 0,
        dailyRate: 0,
        direction: 'stable',
        isAccelerating: false,
        projection7d: 0
      },
      scoreMovement: {
        absolute: 0,
        percentage: 0,
        direction: 'stable'
      },
      concentrationChange: {
        top10Change: 0,
        top25Change: 0,
        giniChange: 0,
        isIncreasing: false
      },
      walletChurn: {
        rate: 0,
        newHolders: 0,
        exitedHolders: 0
      },
      healthTrajectory: 'stable',
      alerts: []
    };
  }
}