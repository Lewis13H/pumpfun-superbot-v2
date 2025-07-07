/**
 * Holder Snapshot Model
 * 
 * Model class for managing holder snapshot data in the database
 */

import { Pool } from 'pg';
import { HolderSnapshot, HolderScoreBreakdown } from '../types/holder-analysis';
import { createHash } from 'crypto';

export class HolderSnapshotModel {
  constructor(private pool: Pool) {}

  /**
   * Create a new holder snapshot
   */
  async create(snapshot: Omit<HolderSnapshot, 'id' | 'createdAt'>): Promise<HolderSnapshot> {
    const query = `
      INSERT INTO holder_snapshots (
        mint_address,
        snapshot_time,
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      snapshot.mintAddress,
      snapshot.snapshotTime,
      snapshot.totalHolders,
      snapshot.uniqueHolders,
      snapshot.top10Percentage,
      snapshot.top25Percentage,
      snapshot.top100Percentage,
      snapshot.giniCoefficient,
      snapshot.herfindahlIndex,
      snapshot.holderScore,
      JSON.stringify(snapshot.scoreBreakdown),
      snapshot.rawDataHash
    ];

    const result = await this.pool.query(query, values);
    return this.mapRowToSnapshot(result.rows[0]);
  }

  /**
   * Get the latest snapshot for a token
   */
  async getLatest(mintAddress: string): Promise<HolderSnapshot | null> {
    const query = `
      SELECT * FROM holder_snapshots
      WHERE mint_address = $1
      ORDER BY snapshot_time DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query, [mintAddress]);
    return result.rows.length > 0 ? this.mapRowToSnapshot(result.rows[0]) : null;
  }

  /**
   * Get snapshot history for a token
   */
  async getHistory(
    mintAddress: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<HolderSnapshot[]> {
    const query = `
      SELECT * FROM holder_snapshots
      WHERE mint_address = $1
      ORDER BY snapshot_time DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.pool.query(query, [mintAddress, limit, offset]);
    return result.rows.map(row => this.mapRowToSnapshot(row));
  }

  /**
   * Get snapshots within a time range
   */
  async getByTimeRange(
    mintAddress: string,
    startTime: Date,
    endTime: Date
  ): Promise<HolderSnapshot[]> {
    const query = `
      SELECT * FROM holder_snapshots
      WHERE mint_address = $1
        AND snapshot_time >= $2
        AND snapshot_time <= $3
      ORDER BY snapshot_time DESC
    `;

    const result = await this.pool.query(query, [mintAddress, startTime, endTime]);
    return result.rows.map(row => this.mapRowToSnapshot(row));
  }

  /**
   * Check if snapshot data has changed by comparing hash
   */
  async hasDataChanged(mintAddress: string, newDataHash: string): Promise<boolean> {
    const latest = await this.getLatest(mintAddress);
    return !latest || latest.rawDataHash !== newDataHash;
  }

  /**
   * Calculate data hash for change detection
   */
  calculateDataHash(data: any): string {
    const dataString = JSON.stringify(data, Object.keys(data).sort());
    return createHash('sha256').update(dataString).digest('hex');
  }

  /**
   * Get score change over time
   */
  async getScoreChange(
    mintAddress: string,
    hoursAgo: number
  ): Promise<{ current: number; previous: number; change: number } | null> {
    const query = `
      WITH current_score AS (
        SELECT holder_score
        FROM holder_snapshots
        WHERE mint_address = $1
        ORDER BY snapshot_time DESC
        LIMIT 1
      ),
      previous_score AS (
        SELECT holder_score
        FROM holder_snapshots
        WHERE mint_address = $1
          AND snapshot_time <= NOW() - INTERVAL '${hoursAgo} hours'
        ORDER BY snapshot_time DESC
        LIMIT 1
      )
      SELECT
        COALESCE(c.holder_score, 0) as current,
        COALESCE(p.holder_score, 0) as previous,
        COALESCE(c.holder_score, 0) - COALESCE(p.holder_score, 0) as change
      FROM current_score c
      CROSS JOIN previous_score p
    `;

    const result = await this.pool.query(query, [mintAddress]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get tokens by score range
   */
  async getByScoreRange(
    minScore: number,
    maxScore: number,
    limit: number = 100
  ): Promise<HolderSnapshot[]> {
    const query = `
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (mint_address)
          *
        FROM holder_snapshots
        ORDER BY mint_address, snapshot_time DESC
      )
      SELECT * FROM latest_snapshots
      WHERE holder_score >= $1 AND holder_score <= $2
      ORDER BY holder_score DESC
      LIMIT $3
    `;

    const result = await this.pool.query(query, [minScore, maxScore, limit]);
    return result.rows.map(row => this.mapRowToSnapshot(row));
  }

  /**
   * Delete old snapshots (retention policy)
   */
  async deleteOldSnapshots(retentionDays: number): Promise<number> {
    const query = `
      DELETE FROM holder_snapshots
      WHERE snapshot_time < NOW() - INTERVAL '${retentionDays} days'
      RETURNING id
    `;

    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Map database row to HolderSnapshot interface
   */
  private mapRowToSnapshot(row: any): HolderSnapshot {
    return {
      id: row.id,
      mintAddress: row.mint_address,
      snapshotTime: new Date(row.snapshot_time),
      totalHolders: parseInt(row.total_holders),
      uniqueHolders: parseInt(row.unique_holders),
      top10Percentage: parseFloat(row.top_10_percentage),
      top25Percentage: parseFloat(row.top_25_percentage),
      top100Percentage: parseFloat(row.top_100_percentage),
      giniCoefficient: parseFloat(row.gini_coefficient),
      herfindahlIndex: parseFloat(row.herfindahl_index),
      holderScore: parseInt(row.holder_score),
      scoreBreakdown: row.score_breakdown as HolderScoreBreakdown,
      rawDataHash: row.raw_data_hash,
      createdAt: new Date(row.created_at)
    };
  }
}