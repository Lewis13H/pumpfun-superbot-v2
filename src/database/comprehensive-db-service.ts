/**
 * High-performance database service for comprehensive monitoring
 * Handles 100,000+ tokens/week with efficient batching and queuing
 */

import { db } from '../database';
import { v4 as uuidv4 } from 'uuid';

export interface TokenData {
  mintAddress: string;
  symbol?: string;
  name?: string;
  uri?: string;
  firstProgram: 'bonding_curve' | 'amm_pool';
  firstSeenSlot: bigint;
  firstMarketCapUsd: number;
  thresholdPriceSol: number;
  thresholdMarketCapUsd: number;
}

export interface BondingCurveState {
  tokenId: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  progressPercent: number;
  slot: bigint;
  blockTime: Date;
}

export interface BondingCurveTrade {
  tokenId: string;
  signature: string;
  tradeType: 'buy' | 'sell';
  userAddress: string;
  solAmount: bigint;
  tokenAmount: bigint;
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  slot: bigint;
  blockTime: Date;
}

export interface AmmPool {
  tokenId: string;
  poolAddress: string;
  baseMint: string;
  quoteMint: string;
  baseTokenAccount?: string;
  quoteTokenAccount?: string;
  lpMint?: string;
  lpSupply?: bigint;
  createdSlot: bigint;
}

export interface AmmSwap {
  poolId: string;
  signature: string;
  tradeType: 'buy' | 'sell';
  userAddress: string;
  amountIn: bigint;
  amountOut: bigint;
  priceSol?: number;
  priceUsd?: number;
  marketCapUsd?: number;
  slot: bigint;
  blockTime: Date;
}

export class ComprehensiveDbService {
  private tokenCache = new Map<string, string>(); // mint -> tokenId
  private poolCache = new Map<string, string>(); // poolAddress -> poolId
  private batchQueue: any[] = [];
  private batchTimer?: NodeJS.Timeout;
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_INTERVAL_MS = 1000; // 1 second

  constructor() {
    // Start batch processing
    this.startBatchProcessor();
  }

  /**
   * Save or retrieve a token that crossed the $8,888 threshold
   */
  async saveToken(data: TokenData): Promise<string> {
    // Check cache first
    if (this.tokenCache.has(data.mintAddress)) {
      return this.tokenCache.get(data.mintAddress)!;
    }

    try {
      // Try to insert or get existing
      const result = await db.query(`
        INSERT INTO tokens_comprehensive (
          mint_address, symbol, name, uri,
          first_program, first_seen_slot, first_market_cap_usd,
          threshold_price_sol, threshold_market_cap_usd
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (mint_address) 
        DO UPDATE SET updated_at = NOW()
        RETURNING id
      `, [
        data.mintAddress,
        data.symbol,
        data.name,
        data.uri,
        data.firstProgram,
        data.firstSeenSlot.toString(),
        data.firstMarketCapUsd,
        data.thresholdPriceSol,
        data.thresholdMarketCapUsd
      ]);

      const tokenId = result.rows[0].id;
      this.tokenCache.set(data.mintAddress, tokenId);
      return tokenId;
    } catch (error) {
      console.error('Error saving token:', error);
      throw error;
    }
  }

  /**
   * Queue a bonding curve state update
   */
  async queueBondingCurveState(state: BondingCurveState): Promise<void> {
    // Only queue if market cap >= $8,888
    if (state.marketCapUsd < 8888) return;

    this.batchQueue.push({
      type: 'bc_state',
      data: state
    });
  }

  /**
   * Queue a bonding curve trade
   */
  async queueBondingCurveTrade(trade: BondingCurveTrade): Promise<void> {
    // Only queue if market cap >= $8,888
    if (trade.marketCapUsd < 8888) return;

    this.batchQueue.push({
      type: 'bc_trade',
      data: trade
    });
  }

  /**
   * Save or retrieve an AMM pool
   */
  async saveAmmPool(pool: AmmPool): Promise<string> {
    // Check cache first
    if (this.poolCache.has(pool.poolAddress)) {
      return this.poolCache.get(pool.poolAddress)!;
    }

    try {
      const result = await db.query(`
        INSERT INTO amm_pools (
          token_id, pool_address, base_mint, quote_mint,
          base_token_account, quote_token_account,
          lp_mint, lp_supply, created_slot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (pool_address) 
        DO UPDATE SET token_id = EXCLUDED.token_id
        RETURNING id
      `, [
        pool.tokenId,
        pool.poolAddress,
        pool.baseMint,
        pool.quoteMint,
        pool.baseTokenAccount,
        pool.quoteTokenAccount,
        pool.lpMint,
        pool.lpSupply?.toString(),
        pool.createdSlot.toString()
      ]);

      const poolId = result.rows[0].id;
      this.poolCache.set(pool.poolAddress, poolId);
      return poolId;
    } catch (error) {
      console.error('Error saving AMM pool:', error);
      throw error;
    }
  }

  /**
   * Queue an AMM swap
   */
  async queueAmmSwap(swap: AmmSwap): Promise<void> {
    // Only queue if market cap >= $8,888 (if available)
    if (swap.marketCapUsd && swap.marketCapUsd < 8888) return;

    this.batchQueue.push({
      type: 'amm_swap',
      data: swap
    });
  }

  /**
   * Get token by mint address
   */
  async getTokenByMint(mintAddress: string): Promise<string | null> {
    if (this.tokenCache.has(mintAddress)) {
      return this.tokenCache.get(mintAddress)!;
    }

    const result = await db.query(
      'SELECT id FROM tokens_comprehensive WHERE mint_address = $1',
      [mintAddress]
    );

    if (result.rows.length > 0) {
      const tokenId = result.rows[0].id;
      this.tokenCache.set(mintAddress, tokenId);
      return tokenId;
    }

    return null;
  }

  /**
   * Get pool by address
   */
  async getPoolByAddress(poolAddress: string): Promise<string | null> {
    if (this.poolCache.has(poolAddress)) {
      return this.poolCache.get(poolAddress)!;
    }

    const result = await db.query(
      'SELECT id FROM amm_pools WHERE pool_address = $1',
      [poolAddress]
    );

    if (result.rows.length > 0) {
      const poolId = result.rows[0].id;
      this.poolCache.set(poolAddress, poolId);
      return poolId;
    }

    return null;
  }

  /**
   * Mark token as graduated
   */
  async markTokenGraduated(tokenId: string, slot: bigint): Promise<void> {
    await db.query(`
      UPDATE tokens_comprehensive 
      SET graduated_to_amm = TRUE,
          graduation_timestamp = NOW(),
          graduation_slot = $2
      WHERE id = $1
    `, [tokenId, slot.toString()]);
  }

  /**
   * Update hourly statistics
   */
  async updateHourlyStats(tokenId: string, hour: Date, stats: any): Promise<void> {
    await db.query(`
      INSERT INTO token_stats_hourly (
        token_id, hour, 
        open_price_usd, high_price_usd, low_price_usd, close_price_usd,
        volume_sol, volume_usd, buy_count, sell_count, unique_traders,
        bonding_curve_volume_usd, amm_volume_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (token_id, hour) DO UPDATE SET
        high_price_usd = GREATEST(EXCLUDED.high_price_usd, token_stats_hourly.high_price_usd),
        low_price_usd = LEAST(EXCLUDED.low_price_usd, token_stats_hourly.low_price_usd),
        close_price_usd = EXCLUDED.close_price_usd,
        volume_sol = token_stats_hourly.volume_sol + EXCLUDED.volume_sol,
        volume_usd = token_stats_hourly.volume_usd + EXCLUDED.volume_usd,
        buy_count = token_stats_hourly.buy_count + EXCLUDED.buy_count,
        sell_count = token_stats_hourly.sell_count + EXCLUDED.sell_count,
        unique_traders = EXCLUDED.unique_traders,
        bonding_curve_volume_usd = token_stats_hourly.bonding_curve_volume_usd + EXCLUDED.bonding_curve_volume_usd,
        amm_volume_usd = token_stats_hourly.amm_volume_usd + EXCLUDED.amm_volume_usd
    `, [
      tokenId, hour,
      stats.openPriceUsd, stats.highPriceUsd, stats.lowPriceUsd, stats.closePriceUsd,
      stats.volumeSol, stats.volumeUsd, stats.buyCount, stats.sellCount, stats.uniqueTraders,
      stats.bondingCurveVolumeUsd, stats.ammVolumeUsd
    ]);
  }

  /**
   * Record a metric for monitoring
   */
  async recordMetric(name: string, value: number, tags: Record<string, any> = {}): Promise<void> {
    await db.query(`
      INSERT INTO monitoring_metrics (metric_name, metric_value, tags)
      VALUES ($1, $2, $3)
    `, [name, value, JSON.stringify(tags)]);
  }

  /**
   * Start the batch processor
   */
  private startBatchProcessor(): void {
    this.batchTimer = setInterval(() => {
      if (this.batchQueue.length > 0) {
        this.processBatch();
      }
    }, this.BATCH_INTERVAL_MS);
  }

  /**
   * Process queued items in batches
   */
  private async processBatch(): Promise<void> {
    const items = this.batchQueue.splice(0, this.BATCH_SIZE);
    if (items.length === 0) return;

    const bcStates = items.filter(i => i.type === 'bc_state').map(i => i.data);
    const bcTrades = items.filter(i => i.type === 'bc_trade').map(i => i.data);
    const ammSwaps = items.filter(i => i.type === 'amm_swap').map(i => i.data);

    try {
      // Use transactions for atomicity
      await db.query('BEGIN');

      // Batch insert bonding curve states
      if (bcStates.length > 0) {
        await this.batchInsertBondingCurveStates(bcStates);
      }

      // Batch insert bonding curve trades
      if (bcTrades.length > 0) {
        await this.batchInsertBondingCurveTrades(bcTrades);
      }

      // Batch insert AMM swaps
      if (ammSwaps.length > 0) {
        await this.batchInsertAmmSwaps(ammSwaps);
      }

      await db.query('COMMIT');

      // Record metrics
      await this.recordMetric('batch_processed', items.length, {
        bc_states: bcStates.length,
        bc_trades: bcTrades.length,
        amm_swaps: ammSwaps.length
      });

    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Batch processing error:', error);
      
      // Re-queue failed items
      this.batchQueue.unshift(...items);
    }
  }

  /**
   * Batch insert bonding curve states
   */
  private async batchInsertBondingCurveStates(states: BondingCurveState[]): Promise<void> {
    const values = states.map((s, i) => {
      const offset = i * 11;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`;
    }).join(',');

    const params = states.flatMap(s => [
      s.tokenId,
      s.virtualSolReserves.toString(),
      s.virtualTokenReserves.toString(),
      s.realSolReserves.toString(),
      s.realTokenReserves.toString(),
      s.priceSol,
      s.priceUsd,
      s.marketCapUsd,
      s.progressPercent,
      s.slot.toString(),
      s.blockTime
    ]);

    await db.query(`
      INSERT INTO bonding_curve_states (
        token_id, virtual_sol_reserves, virtual_token_reserves,
        real_sol_reserves, real_token_reserves,
        price_sol, price_usd, market_cap_usd, progress_percent,
        slot, block_time
      ) VALUES ${values}
    `, params);
  }

  /**
   * Batch insert bonding curve trades
   */
  private async batchInsertBondingCurveTrades(trades: BondingCurveTrade[]): Promise<void> {
    const values = trades.map((t, i) => {
      const offset = i * 13;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`;
    }).join(',');

    const params = trades.flatMap(t => [
      t.tokenId,
      t.signature,
      t.tradeType,
      t.userAddress,
      t.solAmount.toString(),
      t.tokenAmount.toString(),
      t.priceSol,
      t.priceUsd,
      t.marketCapUsd,
      t.virtualSolReserves.toString(),
      t.virtualTokenReserves.toString(),
      t.slot.toString(),
      t.blockTime
    ]);

    await db.query(`
      INSERT INTO bonding_curve_trades (
        token_id, signature, trade_type, user_address,
        sol_amount, token_amount,
        price_sol, price_usd, market_cap_usd,
        virtual_sol_reserves, virtual_token_reserves,
        slot, block_time
      ) VALUES ${values}
      ON CONFLICT (signature) DO NOTHING
    `, params);
  }

  /**
   * Batch insert AMM swaps
   */
  private async batchInsertAmmSwaps(swaps: AmmSwap[]): Promise<void> {
    const values = swaps.map((s, i) => {
      const offset = i * 10;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`;
    }).join(',');

    const params = swaps.flatMap(s => [
      s.poolId,
      s.signature,
      s.tradeType,
      s.userAddress,
      s.amountIn.toString(),
      s.amountOut.toString(),
      s.priceSol,
      s.priceUsd,
      s.marketCapUsd,
      s.slot.toString(),
      s.blockTime
    ]);

    await db.query(`
      INSERT INTO amm_swaps (
        pool_id, signature, trade_type, user_address,
        amount_in, amount_out,
        price_sol, price_usd, market_cap_usd,
        slot, block_time
      ) VALUES ${values}
      ON CONFLICT (signature) DO NOTHING
    `, params);
  }

  /**
   * Cleanup and close
   */
  async close(): Promise<void> {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    
    // Process any remaining items
    if (this.batchQueue.length > 0) {
      await this.processBatch();
    }
  }
}