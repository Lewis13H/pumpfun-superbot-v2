/**
 * Token Holder Analysis Model
 * 
 * Model class for managing token holder details and analysis in the database
 */

import { Pool } from 'pg';
import { 
  TokenHolderDetails,
  HolderAnalysisMetadata,
  HolderTrends,
  TimeWindow,
  AnalysisStatus,
  AnalysisType
} from '../types/holder-analysis';

export class TokenHolderAnalysisModel {
  constructor(private pool: Pool) {}

  /**
   * Upsert token holder details
   */
  async upsertHolderDetails(details: TokenHolderDetails): Promise<TokenHolderDetails> {
    const query = `
      INSERT INTO token_holder_details (
        mint_address,
        wallet_address,
        balance,
        percentage_held,
        rank,
        first_acquired,
        last_transaction,
        transaction_count,
        realized_profit_sol,
        unrealized_profit_sol,
        is_locked,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (mint_address, wallet_address) DO UPDATE SET
        balance = EXCLUDED.balance,
        percentage_held = EXCLUDED.percentage_held,
        rank = EXCLUDED.rank,
        last_transaction = EXCLUDED.last_transaction,
        transaction_count = EXCLUDED.transaction_count,
        realized_profit_sol = EXCLUDED.realized_profit_sol,
        unrealized_profit_sol = EXCLUDED.unrealized_profit_sol,
        is_locked = EXCLUDED.is_locked,
        updated_at = NOW()
      RETURNING *
    `;

    const values = [
      details.mintAddress,
      details.walletAddress,
      details.balance.toString(),
      details.percentageHeld,
      details.rank,
      details.firstAcquired,
      details.lastTransaction,
      details.transactionCount,
      details.realizedProfitSol,
      details.unrealizedProfitSol,
      details.isLocked
    ];

    const result = await this.pool.query(query, values);
    return this.mapRowToHolderDetails(result.rows[0]);
  }

  /**
   * Bulk upsert holder details
   */
  async bulkUpsertHolderDetails(detailsList: TokenHolderDetails[]): Promise<number> {
    if (detailsList.length === 0) return 0;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let upsertedCount = 0;
      for (const details of detailsList) {
        await this.upsertHolderDetails(details);
        upsertedCount++;
      }

      await client.query('COMMIT');
      return upsertedCount;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get holder details for a token
   */
  async getHolderDetails(
    mintAddress: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<TokenHolderDetails[]> {
    const query = `
      SELECT * FROM token_holder_details
      WHERE mint_address = $1
      ORDER BY rank ASC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.pool.query(query, [mintAddress, limit, offset]);
    return result.rows.map(row => this.mapRowToHolderDetails(row));
  }

  /**
   * Get top holders for a token
   */
  async getTopHolders(mintAddress: string, topN: number = 10): Promise<TokenHolderDetails[]> {
    const query = `
      SELECT * FROM token_holder_details
      WHERE mint_address = $1
      ORDER BY balance DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [mintAddress, topN]);
    return result.rows.map(row => this.mapRowToHolderDetails(row));
  }

  /**
   * Get holder by wallet address
   */
  async getHolderByWallet(
    mintAddress: string,
    walletAddress: string
  ): Promise<TokenHolderDetails | null> {
    const query = `
      SELECT * FROM token_holder_details
      WHERE mint_address = $1 AND wallet_address = $2
    `;

    const result = await this.pool.query(query, [mintAddress, walletAddress]);
    return result.rows.length > 0 ? this.mapRowToHolderDetails(result.rows[0]) : null;
  }

  /**
   * Remove holders with zero balance
   */
  async removeZeroBalanceHolders(mintAddress: string): Promise<number> {
    const query = `
      DELETE FROM token_holder_details
      WHERE mint_address = $1 AND balance = 0
    `;

    const result = await this.pool.query(query, [mintAddress]);
    return result.rowCount || 0;
  }

  /**
   * Create analysis metadata entry
   */
  async createAnalysisMetadata(metadata: Omit<HolderAnalysisMetadata, 'id' | 'createdAt'>): Promise<HolderAnalysisMetadata> {
    const query = `
      INSERT INTO holder_analysis_metadata (
        mint_address,
        analysis_type,
        status,
        started_at,
        completed_at,
        holders_analyzed,
        error_message,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      metadata.mintAddress,
      metadata.analysisType,
      metadata.status,
      metadata.startedAt,
      metadata.completedAt,
      metadata.holdersAnalyzed,
      metadata.errorMessage,
      metadata.metadata ? JSON.stringify(metadata.metadata) : null
    ];

    const result = await this.pool.query(query, values);
    return this.mapRowToAnalysisMetadata(result.rows[0]);
  }

  /**
   * Update analysis metadata status
   */
  async updateAnalysisStatus(
    id: number,
    status: AnalysisStatus,
    additionalData?: {
      completedAt?: Date;
      holdersAnalyzed?: number;
      errorMessage?: string;
    }
  ): Promise<void> {
    const setClauses = ['status = $2'];
    const values: any[] = [id, status];
    let paramCount = 2;

    if (additionalData?.completedAt) {
      paramCount++;
      setClauses.push(`completed_at = $${paramCount}`);
      values.push(additionalData.completedAt);
    }

    if (additionalData?.holdersAnalyzed !== undefined) {
      paramCount++;
      setClauses.push(`holders_analyzed = $${paramCount}`);
      values.push(additionalData.holdersAnalyzed);
    }

    if (additionalData?.errorMessage) {
      paramCount++;
      setClauses.push(`error_message = $${paramCount}`);
      values.push(additionalData.errorMessage);
    }

    const query = `
      UPDATE holder_analysis_metadata
      SET ${setClauses.join(', ')}
      WHERE id = $1
    `;

    await this.pool.query(query, values);
  }

  /**
   * Get latest analysis metadata for a token
   */
  async getLatestAnalysis(mintAddress: string): Promise<HolderAnalysisMetadata | null> {
    const query = `
      SELECT * FROM holder_analysis_metadata
      WHERE mint_address = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query, [mintAddress]);
    return result.rows.length > 0 ? this.mapRowToAnalysisMetadata(result.rows[0]) : null;
  }

  /**
   * Create or update holder trends
   */
  async upsertTrends(trends: HolderTrends): Promise<HolderTrends> {
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (mint_address, time_window, calculated_at) DO UPDATE SET
        holder_count_change = EXCLUDED.holder_count_change,
        holder_growth_rate = EXCLUDED.holder_growth_rate,
        avg_holder_duration_hours = EXCLUDED.avg_holder_duration_hours,
        churn_rate = EXCLUDED.churn_rate,
        new_whale_count = EXCLUDED.new_whale_count,
        new_sniper_count = EXCLUDED.new_sniper_count
      RETURNING *
    `;

    const values = [
      trends.mintAddress,
      trends.timeWindow,
      trends.holderCountChange,
      trends.holderGrowthRate,
      trends.avgHolderDurationHours,
      trends.churnRate,
      trends.newWhaleCount,
      trends.newSniperCount,
      trends.calculatedAt
    ];

    const result = await this.pool.query(query, values);
    return this.mapRowToTrends(result.rows[0]);
  }

  /**
   * Get trends for a token
   */
  async getTrends(
    mintAddress: string,
    timeWindow?: TimeWindow
  ): Promise<HolderTrends[]> {
    let query = `
      SELECT * FROM holder_trends
      WHERE mint_address = $1
    `;
    const values: any[] = [mintAddress];

    if (timeWindow) {
      query += ` AND time_window = $2`;
      values.push(timeWindow);
    }

    query += ` ORDER BY calculated_at DESC`;

    const result = await this.pool.query(query, values);
    return result.rows.map(row => this.mapRowToTrends(row));
  }

  /**
   * Get holder statistics for a token
   */
  async getHolderStatistics(mintAddress: string): Promise<{
    totalHolders: number;
    totalSupplyHeld: bigint;
    avgBalance: bigint;
    medianBalance: bigint;
    lockedSupply: bigint;
  } | null> {
    const query = `
      WITH holder_stats AS (
        SELECT
          COUNT(*) as total_holders,
          SUM(balance) as total_supply_held,
          AVG(balance) as avg_balance,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY balance) as median_balance,
          SUM(CASE WHEN is_locked THEN balance ELSE 0 END) as locked_supply
        FROM token_holder_details
        WHERE mint_address = $1 AND balance > 0
      )
      SELECT * FROM holder_stats
    `;

    const result = await this.pool.query(query, [mintAddress]);
    if (result.rows.length === 0 || !result.rows[0].total_holders) return null;

    const row = result.rows[0];
    return {
      totalHolders: parseInt(row.total_holders),
      totalSupplyHeld: BigInt(Math.floor(Number(row.total_supply_held || 0))),
      avgBalance: BigInt(Math.floor(Number(row.avg_balance || 0))),
      medianBalance: BigInt(Math.floor(Number(row.median_balance || 0))),
      lockedSupply: BigInt(Math.floor(Number(row.locked_supply || 0)))
    };
  }

  /**
   * Clean up old analysis metadata
   */
  async cleanupOldAnalyses(daysOld: number = 90): Promise<number> {
    const query = `
      DELETE FROM holder_analysis_metadata
      WHERE created_at < NOW() - INTERVAL '${daysOld} days'
        AND status = 'completed'
    `;

    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Map database row to TokenHolderDetails
   */
  private mapRowToHolderDetails(row: any): TokenHolderDetails {
    return {
      id: row.id,
      mintAddress: row.mint_address,
      walletAddress: row.wallet_address,
      balance: BigInt(row.balance),
      percentageHeld: parseFloat(row.percentage_held),
      rank: parseInt(row.rank),
      firstAcquired: row.first_acquired ? new Date(row.first_acquired) : undefined,
      lastTransaction: row.last_transaction ? new Date(row.last_transaction) : undefined,
      transactionCount: parseInt(row.transaction_count),
      realizedProfitSol: row.realized_profit_sol ? parseFloat(row.realized_profit_sol) : undefined,
      unrealizedProfitSol: row.unrealized_profit_sol ? parseFloat(row.unrealized_profit_sol) : undefined,
      isLocked: row.is_locked,
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Map database row to HolderAnalysisMetadata
   */
  private mapRowToAnalysisMetadata(row: any): HolderAnalysisMetadata {
    return {
      id: row.id,
      mintAddress: row.mint_address,
      analysisType: row.analysis_type as AnalysisType,
      status: row.status as AnalysisStatus,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      holdersAnalyzed: row.holders_analyzed ? parseInt(row.holders_analyzed) : undefined,
      errorMessage: row.error_message,
      metadata: row.metadata,
      createdAt: new Date(row.created_at)
    };
  }

  /**
   * Map database row to HolderTrends
   */
  private mapRowToTrends(row: any): HolderTrends {
    return {
      id: row.id,
      mintAddress: row.mint_address,
      timeWindow: row.time_window as TimeWindow,
      holderCountChange: parseInt(row.holder_count_change),
      holderGrowthRate: parseFloat(row.holder_growth_rate),
      avgHolderDurationHours: parseFloat(row.avg_holder_duration_hours),
      churnRate: parseFloat(row.churn_rate),
      newWhaleCount: parseInt(row.new_whale_count),
      newSniperCount: parseInt(row.new_sniper_count),
      calculatedAt: new Date(row.calculated_at)
    };
  }
}