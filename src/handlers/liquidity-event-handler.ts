/**
 * Liquidity Event Handler
 * Handles AMM liquidity add/remove events
 */

import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedDbServiceV2 } from '../database/unified-db-service';
import { AmmPoolStateService } from '../services/amm/amm-pool-state-service';
import { SolPriceService } from '../services/pricing/sol-price-service';
import { AmmDepositEvent, AmmWithdrawEvent } from '../services/core/event-parser-service';
import { db } from '../database';

interface LiquidityEventData {
  signature: string;
  event_type: 'deposit' | 'withdraw';
  pool_address: string;
  user_address: string;
  lp_amount: bigint;
  base_amount: bigint;
  quote_amount: bigint;
  base_price_usd: number;
  quote_price_usd: number;
  total_value_usd: number;
  impermanent_loss?: number;
  slot: bigint;
  block_time: Date;
}

export class LiquidityEventHandler {
  private logger: Logger;
  private solPriceService: SolPriceService;

  constructor(
    private eventBus: EventBus,
    _dbService: UnifiedDbServiceV2,
    private poolStateService: AmmPoolStateService
  ) {
    // _dbService is required for DI but we use db directly
    this.logger = new Logger({ context: 'LiquidityEventHandler' });
    this.solPriceService = SolPriceService.getInstance();
    
    // Subscribe to liquidity events
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.eventBus.on(EVENTS.LIQUIDITY_ADDED, async (data: any) => {
      await this.handleDepositEvent(data.event, data.signature, data.slot, data.blockTime);
    });

    this.eventBus.on(EVENTS.LIQUIDITY_REMOVED, async (data: any) => {
      await this.handleWithdrawEvent(data.event, data.signature, data.slot, data.blockTime);
    });
  }

  /**
   * Handle deposit event
   */
  async handleDepositEvent(
    event: AmmDepositEvent, 
    signature: string,
    slot: number,
    blockTime: Date
  ): Promise<void> {
    try {
      // Update pool reserves
      const poolBaseReserves = BigInt(event.poolBaseReserves);
      const poolQuoteReserves = BigInt(event.poolQuoteReserves);
      
      // Get mint address from pool
      const poolState = await this.poolStateService.getPoolState(event.pool);
      if (!poolState) {
        this.logger.warn('Pool state not found for deposit event', { pool: event.pool });
        return;
      }

      // Update pool reserves
      await this.poolStateService.updatePoolReserves(
        poolState.reserves.mintAddress,
        Number(poolBaseReserves),
        Number(poolQuoteReserves),
        slot
      );

      // Calculate LP token value
      const solPrice = await this.solPriceService.getPrice();
      const baseAmountSol = Number(event.baseAmountIn) / 1e9;
      const quoteAmountTokens = Number(event.quoteAmountIn) / 1e6;
      
      // Calculate token price from pool reserves  
      const baseReservesNum = Number(poolBaseReserves);
      const quoteReservesNum = Number(poolQuoteReserves);
      const tokenPriceInSol = baseReservesNum > 0 && quoteReservesNum > 0 
        ? baseReservesNum / quoteReservesNum
        : 0;
      const tokenPriceUsd = tokenPriceInSol * solPrice;
      
      const totalValueUsd = (baseAmountSol * solPrice) + (quoteAmountTokens * tokenPriceUsd);

      // Store liquidity event
      const eventData: LiquidityEventData = {
        signature,
        event_type: 'deposit',
        pool_address: event.pool,
        user_address: event.user,
        lp_amount: BigInt(event.lpTokenAmountOut),
        base_amount: BigInt(event.baseAmountIn),
        quote_amount: BigInt(event.quoteAmountIn),
        base_price_usd: solPrice,
        quote_price_usd: tokenPriceUsd,
        total_value_usd: totalValueUsd,
        slot: BigInt(slot),
        block_time: blockTime
      };

      await this.storeLiquidityEvent(eventData);

      // Emit enhanced event
      this.eventBus.emit(EVENTS.LIQUIDITY_PROCESSED, {
        type: 'deposit',
        pool: event.pool,
        mint: poolState.reserves.mintAddress,
        user: event.user,
        valueUsd: totalValueUsd,
        lpTokens: event.lpTokenAmountOut,
        baseAmount: event.baseAmountIn,
        quoteAmount: event.quoteAmountIn
      });

      this.logger.info('Deposit event processed', {
        pool: event.pool.slice(0, 8) + '...',
        user: event.user.slice(0, 8) + '...',
        valueUsd: totalValueUsd.toFixed(2),
        lpTokens: event.lpTokenAmountOut
      });

    } catch (error) {
      this.logger.error('Failed to handle deposit event', error as Error);
    }
  }

  /**
   * Handle withdraw event
   */
  async handleWithdrawEvent(
    event: AmmWithdrawEvent,
    signature: string,
    slot: number,
    blockTime: Date
  ): Promise<void> {
    try {
      // Update pool reserves
      const poolBaseReserves = BigInt(event.poolBaseReserves);
      const poolQuoteReserves = BigInt(event.poolQuoteReserves);
      
      // Get mint address from pool
      const poolState = await this.poolStateService.getPoolState(event.pool);
      if (!poolState) {
        this.logger.warn('Pool state not found for withdraw event', { pool: event.pool });
        return;
      }

      // Update pool reserves
      await this.poolStateService.updatePoolReserves(
        poolState.reserves.mintAddress,
        Number(poolBaseReserves),
        Number(poolQuoteReserves),
        slot
      );

      // Calculate withdrawn value
      const solPrice = await this.solPriceService.getPrice();
      const baseAmountSol = Number(event.baseAmountOut) / 1e9;
      const quoteAmountTokens = Number(event.quoteAmountOut) / 1e6;
      
      // Calculate token price from pool reserves  
      const baseReservesNum = Number(poolBaseReserves);
      const quoteReservesNum = Number(poolQuoteReserves);
      const tokenPriceInSol = baseReservesNum > 0 && quoteReservesNum > 0 
        ? baseReservesNum / quoteReservesNum
        : 0;
      const tokenPriceUsd = tokenPriceInSol * solPrice;
      
      const totalValueUsd = (baseAmountSol * solPrice) + (quoteAmountTokens * tokenPriceUsd);

      // TODO: Calculate impermanent loss based on initial deposit
      // This would require tracking deposit history

      // Store liquidity event
      const eventData: LiquidityEventData = {
        signature,
        event_type: 'withdraw',
        pool_address: event.pool,
        user_address: event.user,
        lp_amount: BigInt(event.lpTokenAmountIn),
        base_amount: BigInt(event.baseAmountOut),
        quote_amount: BigInt(event.quoteAmountOut),
        base_price_usd: solPrice,
        quote_price_usd: tokenPriceUsd,
        total_value_usd: totalValueUsd,
        slot: BigInt(slot),
        block_time: blockTime
      };

      await this.storeLiquidityEvent(eventData);

      // Emit enhanced event
      this.eventBus.emit(EVENTS.LIQUIDITY_PROCESSED, {
        type: 'withdraw',
        pool: event.pool,
        mint: poolState.reserves.mintAddress,
        user: event.user,
        valueUsd: totalValueUsd,
        lpTokens: event.lpTokenAmountIn,
        baseAmount: event.baseAmountOut,
        quoteAmount: event.quoteAmountOut
      });

      this.logger.info('Withdraw event processed', {
        pool: event.pool.slice(0, 8) + '...',
        user: event.user.slice(0, 8) + '...',
        valueUsd: totalValueUsd.toFixed(2),
        lpTokens: event.lpTokenAmountIn
      });

    } catch (error) {
      this.logger.error('Failed to handle withdraw event', error as Error);
    }
  }

  /**
   * Store liquidity event in database
   */
  private async storeLiquidityEvent(eventData: LiquidityEventData): Promise<void> {
    try {
      const query = `
        INSERT INTO liquidity_events (
          signature, event_type, pool_address, user_address,
          lp_amount, base_amount, quote_amount,
          base_price_usd, quote_price_usd, total_value_usd,
          impermanent_loss, slot, block_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (signature) DO NOTHING
      `;

      const values = [
        eventData.signature,
        eventData.event_type,
        eventData.pool_address,
        eventData.user_address,
        eventData.lp_amount.toString(),
        eventData.base_amount.toString(),
        eventData.quote_amount.toString(),
        eventData.base_price_usd,
        eventData.quote_price_usd,
        eventData.total_value_usd,
        eventData.impermanent_loss || null,
        eventData.slot.toString(),
        eventData.block_time
      ];

      await db.query(query, values);
    } catch (error) {
      this.logger.error('Failed to store liquidity event', error as Error);
    }
  }

  /**
   * Get user's liquidity positions
   */
  async getUserLiquidityPositions(userAddress: string): Promise<any[]> {
    const query = `
      SELECT 
        pool_address,
        SUM(CASE WHEN event_type = 'deposit' THEN lp_amount ELSE -lp_amount END) as net_lp_amount,
        SUM(CASE WHEN event_type = 'deposit' THEN total_value_usd ELSE 0 END) as total_deposited_usd,
        SUM(CASE WHEN event_type = 'withdraw' THEN total_value_usd ELSE 0 END) as total_withdrawn_usd,
        COUNT(CASE WHEN event_type = 'deposit' THEN 1 END) as deposit_count,
        COUNT(CASE WHEN event_type = 'withdraw' THEN 1 END) as withdraw_count,
        MAX(block_time) as last_activity
      FROM liquidity_events
      WHERE user_address = $1
      GROUP BY pool_address
      HAVING SUM(CASE WHEN event_type = 'deposit' THEN lp_amount ELSE -lp_amount END) > 0
    `;

    const result = await db.query(query, [userAddress]);
    return result.rows;
  }

  /**
   * Get pool liquidity history
   */
  async getPoolLiquidityHistory(poolAddress: string, _hours: number = 24): Promise<any[]> {
    const query = `
      SELECT 
        date_trunc('hour', block_time) as hour,
        SUM(CASE WHEN event_type = 'deposit' THEN total_value_usd ELSE 0 END) as deposits_usd,
        SUM(CASE WHEN event_type = 'withdraw' THEN total_value_usd ELSE 0 END) as withdrawals_usd,
        COUNT(CASE WHEN event_type = 'deposit' THEN 1 END) as deposit_count,
        COUNT(CASE WHEN event_type = 'withdraw' THEN 1 END) as withdraw_count,
        COUNT(DISTINCT user_address) as unique_providers
      FROM liquidity_events
      WHERE pool_address = $1
        AND block_time > NOW() - INTERVAL '%s hours'
      GROUP BY hour
      ORDER BY hour DESC
    `;

    const result = await db.query(query, [poolAddress]);
    return result.rows;
  }
}