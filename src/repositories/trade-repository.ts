/**
 * Trade Repository
 * Handles trade data persistence
 */

import { Pool } from 'pg';
import { BaseRepository } from './base-repository';
import { TradeType } from '../utils/parsers/types';

export interface Trade {
  signature: string;
  mintAddress: string;
  program: 'bonding_curve' | 'amm_pool';
  tradeType: TradeType;
  userAddress: string;
  solAmount: bigint;
  tokenAmount: bigint;
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  volumeUsd?: number;
  virtualSolReserves?: bigint;
  virtualTokenReserves?: bigint;
  bondingCurveKey?: string;
  bondingCurveProgress?: number;
  slot: bigint;
  blockTime: Date;
  createdAt?: Date;
}

export interface TradeFilter {
  mintAddress?: string;
  userAddress?: string;
  program?: 'bonding_curve' | 'amm_pool';
  tradeType?: TradeType;
  blockTimeGte?: Date;
  blockTimeLte?: Date;
  marketCapUsdGte?: number;
  limit?: number;
  offset?: number;
}

export interface TradeStats {
  totalTrades: number;
  totalVolumeUsd: number;
  uniqueTraders: number;
  buyCount: number;
  sellCount: number;
  avgTradeSize: number;
}

export class TradeRepository extends BaseRepository<Trade> {
  constructor(pool: Pool) {
    super(pool, 'trades_unified', 'TradeRepository');
  }

  /**
   * Save trade
   */
  async save(trade: Trade): Promise<Trade> {
    const query = `
      INSERT INTO trades_unified (
        signature, mint_address, program, trade_type, user_address,
        sol_amount, token_amount, price_sol, price_usd, market_cap_usd,
        volume_usd, virtual_sol_reserves, virtual_token_reserves,
        bonding_curve_key, bonding_curve_progress, slot, block_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (signature) DO NOTHING
      RETURNING *
    `;

    const values = [
      trade.signature,
      trade.mintAddress,
      trade.program,
      trade.tradeType,
      trade.userAddress,
      trade.solAmount.toString(),  // Keep as bigint string
      trade.tokenAmount.toString(),   // Keep as bigint string
      trade.priceSol,
      trade.priceUsd,
      trade.marketCapUsd,
      trade.volumeUsd,
      trade.virtualSolReserves ? trade.virtualSolReserves.toString() : null,
      trade.virtualTokenReserves ? trade.virtualTokenReserves.toString() : null,
      trade.bondingCurveKey,
      trade.bondingCurveProgress,
      trade.slot.toString(),
      trade.blockTime
    ];

    const result = await this.queryOne<Trade>(query, values);
    return result || trade;
  }

  /**
   * Batch save trades
   */
  async batchSave(trades: Trade[]): Promise<number> {
    if (trades.length === 0) return 0;

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const trade of trades) {
      const tradePlaceholders: string[] = [];
      
      // Add values in order - keep bigints as strings
      values.push(
        trade.signature,
        trade.mintAddress,
        trade.program,
        trade.tradeType,
        trade.userAddress,
        trade.solAmount.toString(),  // Keep as bigint string
        trade.tokenAmount.toString(),   // Keep as bigint string
        trade.priceSol,
        trade.priceUsd,
        trade.marketCapUsd,
        trade.volumeUsd,
        trade.virtualSolReserves ? trade.virtualSolReserves.toString() : null,
        trade.virtualTokenReserves ? trade.virtualTokenReserves.toString() : null,
        trade.bondingCurveKey,
        trade.bondingCurveProgress,
        trade.slot.toString(),
        trade.blockTime
      );

      // Create placeholders
      for (let i = 0; i < 17; i++) {
        tradePlaceholders.push(`$${paramIndex++}`);
      }
      
      placeholders.push(`(${tradePlaceholders.join(', ')})`);
    }

    const query = `
      INSERT INTO trades_unified (
        signature, mint_address, program, trade_type, user_address,
        sol_amount, token_amount, price_sol, price_usd, market_cap_usd,
        volume_usd, virtual_sol_reserves, virtual_token_reserves,
        bonding_curve_key, bonding_curve_progress, slot, block_time
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (signature) DO NOTHING
    `;

    const result = await this.pool.query(query, values);
    return result.rowCount || 0;
  }

  /**
   * Find trades by filter
   */
  async findByFilter(filter: TradeFilter): Promise<Trade[]> {
    let query = 'SELECT * FROM trades_unified WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.mintAddress) {
      query += ` AND mint_address = $${paramIndex++}`;
      params.push(filter.mintAddress);
    }

    if (filter.userAddress) {
      query += ` AND user_address = $${paramIndex++}`;
      params.push(filter.userAddress);
    }

    if (filter.program) {
      query += ` AND program = $${paramIndex++}`;
      params.push(filter.program);
    }

    if (filter.tradeType) {
      query += ` AND trade_type = $${paramIndex++}`;
      params.push(filter.tradeType);
    }

    if (filter.blockTimeGte) {
      query += ` AND block_time >= $${paramIndex++}`;
      params.push(filter.blockTimeGte);
    }

    if (filter.blockTimeLte) {
      query += ` AND block_time <= $${paramIndex++}`;
      params.push(filter.blockTimeLte);
    }

    if (filter.marketCapUsdGte) {
      query += ` AND market_cap_usd >= $${paramIndex++}`;
      params.push(filter.marketCapUsdGte);
    }

    query += ' ORDER BY block_time DESC';

    if (filter.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filter.limit);
    }

    if (filter.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filter.offset);
    }

    return this.query<Trade>(query, params);
  }

  /**
   * Get recent trades
   */
  async getRecentTrades(limit: number = 100): Promise<Trade[]> {
    return this.findByFilter({ limit });
  }

  /**
   * Get trades for token
   */
  async getTradesForToken(
    mintAddress: string, 
    limit: number = 100
  ): Promise<Trade[]> {
    return this.findByFilter({ mintAddress, limit });
  }

  /**
   * Get trades by user
   */
  async getTradesByUser(
    userAddress: string,
    limit: number = 100
  ): Promise<Trade[]> {
    return this.findByFilter({ userAddress, limit });
  }

  /**
   * Get trade statistics for token
   */
  async getTokenStats(mintAddress: string): Promise<TradeStats> {
    const query = `
      SELECT 
        COUNT(*) as total_trades,
        COALESCE(SUM(volume_usd), 0) as total_volume_usd,
        COUNT(DISTINCT user_address) as unique_traders,
        COUNT(*) FILTER (WHERE trade_type = 'buy') as buy_count,
        COUNT(*) FILTER (WHERE trade_type = 'sell') as sell_count,
        COALESCE(AVG(volume_usd), 0) as avg_trade_size
      FROM trades_unified
      WHERE mint_address = $1
    `;

    const result = await this.queryOne<any>(query, [mintAddress]);
    
    return {
      totalTrades: parseInt(result.total_trades, 10),
      totalVolumeUsd: parseFloat(result.total_volume_usd),
      uniqueTraders: parseInt(result.unique_traders, 10),
      buyCount: parseInt(result.buy_count, 10),
      sellCount: parseInt(result.sell_count, 10),
      avgTradeSize: parseFloat(result.avg_trade_size)
    };
  }

  /**
   * Get top traders by volume
   */
  async getTopTraders(limit: number = 10): Promise<Array<{
    userAddress: string;
    totalVolumeUsd: number;
    tradeCount: number;
  }>> {
    const query = `
      SELECT 
        user_address,
        COALESCE(SUM(volume_usd), 0) as total_volume_usd,
        COUNT(*) as trade_count
      FROM trades_unified
      WHERE volume_usd IS NOT NULL
      GROUP BY user_address
      ORDER BY total_volume_usd DESC
      LIMIT $1
    `;

    const results = await this.query<any>(query, [limit]);
    
    return results.map(r => ({
      userAddress: r.user_address,
      totalVolumeUsd: parseFloat(r.total_volume_usd),
      tradeCount: parseInt(r.trade_count, 10)
    }));
  }

  /**
   * Get high value trades
   */
  async getHighValueTrades(
    minVolumeUsd: number,
    limit: number = 100
  ): Promise<Trade[]> {
    const query = `
      SELECT * FROM trades_unified
      WHERE volume_usd >= $1
      ORDER BY volume_usd DESC
      LIMIT $2
    `;

    return this.query<Trade>(query, [minVolumeUsd, limit]);
  }

  /**
   * Get trade volume by time period
   */
  async getVolumeByPeriod(
    startTime: Date,
    endTime: Date,
    groupBy: 'hour' | 'day' = 'hour'
  ): Promise<Array<{ period: Date; volume: number; trades: number }>> {
    const dateTrunc = groupBy === 'hour' ? 'hour' : 'day';
    
    const query = `
      SELECT 
        DATE_TRUNC('${dateTrunc}', block_time) as period,
        COALESCE(SUM(volume_usd), 0) as volume,
        COUNT(*) as trades
      FROM trades_unified
      WHERE block_time >= $1 AND block_time <= $2
      GROUP BY period
      ORDER BY period
    `;

    const results = await this.query<any>(query, [startTime, endTime]);
    
    return results.map(r => ({
      period: new Date(r.period),
      volume: parseFloat(r.volume),
      trades: parseInt(r.trades, 10)
    }));
  }
}