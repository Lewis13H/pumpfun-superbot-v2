/**
 * AMM Fee Service
 * Tracks and analyzes AMM pool fees
 */

import { Logger } from '../../core/logger';
import { db } from '../../database';
import { SolPriceService } from '../pricing/sol-price-service';

export interface FeeMetrics {
  totalFeesUSD: number;
  protocolFeesUSD: number;
  lpFeesUSD: number;
  creatorFeesUSD: number;
  feeAPY: number;
  avgDailyFees: number;
  topFeeGenerators: UserFeeContribution[];
  last24hFees: number;
  last7dFees: number;
}

export interface UserFeeContribution {
  userAddress: string;
  totalFeesGenerated: number;
  tradeCount: number;
  avgFeePerTrade: number;
}

export interface PoolFeeAccumulator {
  totalCoinFees: bigint;
  totalPcFees: bigint;
  protocolCoinFees: bigint;
  protocolPcFees: bigint;
  lpCoinFees: bigint;
  lpPcFees: bigint;
  creatorCoinFees: bigint;
  creatorPcFees: bigint;
  lastUpdate: Date;
}

export class AmmFeeService {
  private static instance: AmmFeeService;
  private logger: Logger;
  private feeAccumulator: Map<string, PoolFeeAccumulator>;
  private solPriceService: SolPriceService;
  
  private constructor() {
    this.logger = new Logger({ context: 'AmmFeeService' });
    this.feeAccumulator = new Map();
    this.solPriceService = SolPriceService.getInstance();
  }
  
  static getInstance(): AmmFeeService {
    if (!AmmFeeService.instance) {
      AmmFeeService.instance = new AmmFeeService();
    }
    return AmmFeeService.instance;
  }

  /**
   * Process fee event and accumulate
   */
  async processFeeEvent(
    feeType: 'lp' | 'protocol' | 'creator',
    poolAddress: string,
    coinAmount: string,
    pcAmount: string,
    signature: string,
    slot: number,
    blockTime: Date
  ): Promise<void> {
    try {
      // Get or create accumulator for pool
      let accumulator = this.feeAccumulator.get(poolAddress);
      if (!accumulator) {
        accumulator = {
          totalCoinFees: 0n,
          totalPcFees: 0n,
          protocolCoinFees: 0n,
          protocolPcFees: 0n,
          lpCoinFees: 0n,
          lpPcFees: 0n,
          creatorCoinFees: 0n,
          creatorPcFees: 0n,
          lastUpdate: new Date()
        };
        this.feeAccumulator.set(poolAddress, accumulator);
      }

      // Update accumulator based on fee type
      const coinAmountBn = BigInt(coinAmount);
      const pcAmountBn = BigInt(pcAmount);
      
      accumulator.totalCoinFees += coinAmountBn;
      accumulator.totalPcFees += pcAmountBn;
      
      switch (feeType) {
        case 'lp':
          accumulator.lpCoinFees += coinAmountBn;
          accumulator.lpPcFees += pcAmountBn;
          break;
        case 'protocol':
          accumulator.protocolCoinFees += coinAmountBn;
          accumulator.protocolPcFees += pcAmountBn;
          break;
        case 'creator':
          accumulator.creatorCoinFees += coinAmountBn;
          accumulator.creatorPcFees += pcAmountBn;
          break;
      }
      
      accumulator.lastUpdate = blockTime;

      // Calculate USD values
      const solPrice = await this.solPriceService.getPrice();
      const coinValueUsd = Number(coinAmountBn) / 1e9 * solPrice; // Assuming coin is SOL
      
      // Store fee event in database
      await this.storeFeeEvent({
        signature,
        feeType,
        poolAddress,
        coinAmount: coinAmountBn,
        pcAmount: pcAmountBn,
        coinValueUsd,
        pcValueUsd: 0, // Token value calculation would require token price
        totalValueUsd: coinValueUsd,
        slot,
        blockTime
      });

      this.logger.debug('Fee event processed', {
        feeType,
        pool: poolAddress.slice(0, 8) + '...',
        coinAmount: coinAmount,
        valueUsd: coinValueUsd.toFixed(2)
      });

    } catch (error) {
      this.logger.error('Failed to process fee event', error as Error);
    }
  }

  /**
   * Calculate fee metrics for a pool
   */
  async calculateFeeMetrics(poolAddress: string): Promise<FeeMetrics> {
    try {
      // Get fee data from database
      const feesQuery = `
        SELECT 
          SUM(total_value_usd) as total_fees_usd,
          SUM(CASE WHEN event_type = 'protocol' THEN total_value_usd ELSE 0 END) as protocol_fees_usd,
          SUM(CASE WHEN event_type = 'lp' THEN total_value_usd ELSE 0 END) as lp_fees_usd,
          SUM(CASE WHEN event_type = 'creator' THEN total_value_usd ELSE 0 END) as creator_fees_usd,
          COUNT(*) as fee_event_count
        FROM amm_fee_events
        WHERE pool_address = $1
      `;
      
      const dailyFeesQuery = `
        SELECT 
          date_trunc('day', block_time) as day,
          SUM(total_value_usd) as daily_fees
        FROM amm_fee_events
        WHERE pool_address = $1
          AND block_time > NOW() - INTERVAL '30 days'
        GROUP BY day
        ORDER BY day DESC
      `;
      
      const topGeneratorsQuery = `
        SELECT 
          t.user_address,
          SUM(f.total_value_usd) as total_fees_generated,
          COUNT(DISTINCT t.signature) as trade_count
        FROM trades_unified t
        JOIN amm_fee_events f ON f.signature = t.signature
        WHERE f.pool_address = $1
          AND t.block_time > NOW() - INTERVAL '7 days'
        GROUP BY t.user_address
        ORDER BY total_fees_generated DESC
        LIMIT 10
      `;

      const [feesResult, dailyFeesResult, topGeneratorsResult] = await Promise.all([
        db.query(feesQuery, [poolAddress]),
        db.query(dailyFeesQuery, [poolAddress]),
        db.query(topGeneratorsQuery, [poolAddress])
      ]);

      // Calculate metrics
      const totalFeesUSD = Number(feesResult.rows[0]?.total_fees_usd || 0);
      const protocolFeesUSD = Number(feesResult.rows[0]?.protocol_fees_usd || 0);
      const lpFeesUSD = Number(feesResult.rows[0]?.lp_fees_usd || 0);
      const creatorFeesUSD = Number(feesResult.rows[0]?.creator_fees_usd || 0);

      // Calculate average daily fees
      const dailyFees = dailyFeesResult.rows.map((r: any) => Number(r.daily_fees));
      const avgDailyFees = dailyFees.length > 0 
        ? dailyFees.reduce((a: number, b: number) => a + b, 0) / dailyFees.length 
        : 0;

      // Calculate 24h and 7d fees
      const last24hFees = dailyFees[0] || 0;
      const last7dFees = dailyFees.slice(0, 7).reduce((a: number, b: number) => a + b, 0);

      // Calculate fee APY (simplified - would need TVL for accurate calculation)
      const feeAPY = avgDailyFees * 365; // Placeholder calculation

      // Format top fee generators
      const topFeeGenerators: UserFeeContribution[] = topGeneratorsResult.rows.map((row: any) => ({
        userAddress: row.user_address,
        totalFeesGenerated: Number(row.total_fees_generated),
        tradeCount: Number(row.trade_count),
        avgFeePerTrade: Number(row.total_fees_generated) / Number(row.trade_count)
      }));

      return {
        totalFeesUSD,
        protocolFeesUSD,
        lpFeesUSD,
        creatorFeesUSD,
        feeAPY,
        avgDailyFees,
        topFeeGenerators,
        last24hFees,
        last7dFees
      };

    } catch (error) {
      this.logger.error('Failed to calculate fee metrics', error as Error);
      return {
        totalFeesUSD: 0,
        protocolFeesUSD: 0,
        lpFeesUSD: 0,
        creatorFeesUSD: 0,
        feeAPY: 0,
        avgDailyFees: 0,
        topFeeGenerators: [],
        last24hFees: 0,
        last7dFees: 0
      };
    }
  }

  /**
   * Store fee event in database
   */
  private async storeFeeEvent(event: {
    signature: string;
    feeType: string;
    poolAddress: string;
    coinAmount: bigint;
    pcAmount: bigint;
    coinValueUsd: number;
    pcValueUsd: number;
    totalValueUsd: number;
    slot: number;
    blockTime: Date;
  }): Promise<void> {
    try {
      const query = `
        INSERT INTO amm_fee_events (
          signature, event_type, pool_address, recipient,
          coin_amount, pc_amount, coin_value_usd, pc_value_usd,
          total_value_usd, slot, block_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (signature, event_type) DO NOTHING
      `;

      const values = [
        event.signature,
        event.feeType,
        event.poolAddress,
        event.poolAddress, // Using pool as recipient for now
        event.coinAmount.toString(),
        event.pcAmount.toString(),
        event.coinValueUsd,
        event.pcValueUsd,
        event.totalValueUsd,
        event.slot,
        event.blockTime
      ];

      await db.query(query, values);
    } catch (error) {
      this.logger.error('Failed to store fee event', error as Error);
    }
  }

  /**
   * Update daily fee metrics
   */
  async updateDailyMetrics(poolAddress: string): Promise<void> {
    try {
      const query = `
        INSERT INTO amm_fee_metrics_daily (
          pool_address, date, total_fees_usd, protocol_fees_usd,
          lp_fees_usd, volume_usd, fee_apy, trade_count, unique_traders
        )
        SELECT 
          $1,
          CURRENT_DATE,
          COALESCE(SUM(f.total_value_usd), 0),
          COALESCE(SUM(CASE WHEN f.event_type = 'protocol' THEN f.total_value_usd ELSE 0 END), 0),
          COALESCE(SUM(CASE WHEN f.event_type = 'lp' THEN f.total_value_usd ELSE 0 END), 0),
          COALESCE(SUM(t.volume_usd), 0),
          0, -- Fee APY calculation would go here
          COUNT(DISTINCT t.signature),
          COUNT(DISTINCT t.user_address)
        FROM amm_fee_events f
        LEFT JOIN trades_unified t ON t.signature = f.signature
        WHERE f.pool_address = $1
          AND DATE(f.block_time) = CURRENT_DATE
        ON CONFLICT (pool_address, date) DO UPDATE SET
          total_fees_usd = EXCLUDED.total_fees_usd,
          protocol_fees_usd = EXCLUDED.protocol_fees_usd,
          lp_fees_usd = EXCLUDED.lp_fees_usd,
          volume_usd = EXCLUDED.volume_usd,
          trade_count = EXCLUDED.trade_count,
          unique_traders = EXCLUDED.unique_traders
      `;

      await db.query(query, [poolAddress]);
    } catch (error) {
      this.logger.error('Failed to update daily metrics', error as Error);
    }
  }

  /**
   * Get accumulated fees for a pool
   */
  getAccumulatedFees(poolAddress: string): PoolFeeAccumulator | null {
    return this.feeAccumulator.get(poolAddress) || null;
  }

  /**
   * Clear accumulated fees (after storing)
   */
  clearAccumulatedFees(poolAddress: string): void {
    this.feeAccumulator.delete(poolAddress);
  }
}