import { Pool } from 'pg';
import { logger } from '../../../core/logger';
import { HolderSnapshot } from '../../../types/holder-analysis';

export interface HolderHistoryOptions {
  mintAddress: string;
  period: '1h' | '6h' | '24h' | '7d' | '30d';
  limit?: number;
}

export interface HistoricalSnapshot {
  timestamp: Date;
  totalHolders: number;
  uniqueHolders: number;
  holderScore: number;
  top10Percentage: number;
  top25Percentage: number;
  giniCoefficient: number;
  herfindahlIndex: number;
}

export interface HolderHistoryResult {
  snapshots: HistoricalSnapshot[];
  trends: {
    holderGrowth: number;
    scoreChange: number;
    concentrationChange: number;
    periodStart: Date;
    periodEnd: Date;
  };
}

export class HolderHistoryService {
  constructor(private pool: Pool) {}

  async getHolderHistory(options: HolderHistoryOptions): Promise<HolderHistoryResult> {
    const { mintAddress, period, limit = 100 } = options;
    const intervalMs = this.getPeriodInMs(period);
    const startTime = new Date(Date.now() - intervalMs);

    try {
      // Fetch historical snapshots
      const query = `
        SELECT 
          snapshot_time as timestamp,
          total_holders as "totalHolders",
          unique_holders as "uniqueHolders",
          holder_score as "holderScore",
          top_10_percentage as "top10Percentage",
          top_25_percentage as "top25Percentage",
          gini_coefficient as "giniCoefficient",
          herfindahl_index as "herfindahlIndex"
        FROM holder_snapshots
        WHERE mint_address = $1
          AND snapshot_time >= $2
        ORDER BY snapshot_time DESC
        LIMIT $3
      `;

      const result = await this.pool.query(query, [mintAddress, startTime, limit]);
      const snapshots = result.rows as HistoricalSnapshot[];

      if (snapshots.length === 0) {
        return {
          snapshots: [],
          trends: {
            holderGrowth: 0,
            scoreChange: 0,
            concentrationChange: 0,
            periodStart: startTime,
            periodEnd: new Date()
          }
        };
      }

      // Calculate trends
      const oldestSnapshot = snapshots[snapshots.length - 1];
      const newestSnapshot = snapshots[0];

      const trends = {
        holderGrowth: this.calculatePercentageChange(
          oldestSnapshot.totalHolders,
          newestSnapshot.totalHolders
        ),
        scoreChange: this.calculatePercentageChange(
          oldestSnapshot.holderScore,
          newestSnapshot.holderScore
        ),
        concentrationChange: newestSnapshot.top10Percentage - oldestSnapshot.top10Percentage,
        periodStart: oldestSnapshot.timestamp,
        periodEnd: newestSnapshot.timestamp
      };

      return { snapshots, trends };
    } catch (error) {
      logger.error('Error fetching holder history:', error);
      throw error;
    }
  }

  async saveSnapshot(snapshot: HolderSnapshot): Promise<void> {
    const query = `
      INSERT INTO holder_snapshots (
        mint_address,
        total_holders,
        unique_holders,
        top_10_percentage,
        top_25_percentage,
        top_100_percentage,
        gini_coefficient,
        herfindahl_index,
        holder_score,
        score_breakdown,
        raw_data_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (mint_address, snapshot_time) DO UPDATE SET
        total_holders = EXCLUDED.total_holders,
        unique_holders = EXCLUDED.unique_holders,
        top_10_percentage = EXCLUDED.top_10_percentage,
        top_25_percentage = EXCLUDED.top_25_percentage,
        top_100_percentage = EXCLUDED.top_100_percentage,
        gini_coefficient = EXCLUDED.gini_coefficient,
        herfindahl_index = EXCLUDED.herfindahl_index,
        holder_score = EXCLUDED.holder_score,
        score_breakdown = EXCLUDED.score_breakdown,
        raw_data_hash = EXCLUDED.raw_data_hash
    `;

    try {
      await this.pool.query(query, [
        snapshot.mintAddress,
        snapshot.totalHolders,
        snapshot.uniqueHolders,
        snapshot.top10Percentage,
        snapshot.top25Percentage,
        snapshot.top100Percentage || null,
        snapshot.giniCoefficient,
        snapshot.herfindahlIndex || null,
        snapshot.holderScore,
        JSON.stringify(snapshot.scoreBreakdown),
        snapshot.rawDataHash || null
      ]);

      logger.debug(`Saved holder snapshot for ${snapshot.mintAddress}`);
    } catch (error) {
      logger.error('Error saving holder snapshot:', error);
      throw error;
    }
  }

  async getLatestSnapshot(mintAddress: string): Promise<HistoricalSnapshot | null> {
    const query = `
      SELECT 
        snapshot_time as timestamp,
        total_holders as "totalHolders",
        unique_holders as "uniqueHolders",
        holder_score as "holderScore",
        top_10_percentage as "top10Percentage",
        top_25_percentage as "top25Percentage",
        gini_coefficient as "giniCoefficient",
        herfindahl_index as "herfindahlIndex"
      FROM holder_snapshots
      WHERE mint_address = $1
      ORDER BY snapshot_time DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query, [mintAddress]);
    return result.rows[0] || null;
  }

  async hasRecentSnapshot(mintAddress: string, maxAgeMs: number): Promise<boolean> {
    const query = `
      SELECT 1
      FROM holder_snapshots
      WHERE mint_address = $1
        AND snapshot_time >= $2
      LIMIT 1
    `;

    const cutoffTime = new Date(Date.now() - maxAgeMs);
    const result = await this.pool.query(query, [mintAddress, cutoffTime]);
    return (result.rowCount ?? 0) > 0;
  }

  async getSnapshotCount(mintAddress: string, period: string): Promise<number> {
    const intervalMs = this.getPeriodInMs(period);
    const startTime = new Date(Date.now() - intervalMs);

    const query = `
      SELECT COUNT(*) as count
      FROM holder_snapshots
      WHERE mint_address = $1
        AND snapshot_time >= $2
    `;

    const result = await this.pool.query(query, [mintAddress, startTime]);
    return parseInt(result.rows[0].count, 10);
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

  private calculatePercentageChange(oldValue: number, newValue: number): number {
    if (oldValue === 0) return newValue > 0 ? 100 : 0;
    return ((newValue - oldValue) / oldValue) * 100;
  }
}