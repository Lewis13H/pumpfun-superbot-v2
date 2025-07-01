/**
 * Fee Event Handler
 * Handles AMM fee collection events
 */

import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedDbServiceV2 } from '../database/unified-db-service';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { AmmFeeService } from '../services/amm-fee-service';
import { 
  CollectCoinCreatorFeeEvent, 
  CollectProtocolFeeEvent,
  AmmBuyEvent,
  AmmSellEvent
} from '../services/event-parser-service';
import { db } from '../database';

interface FeeEventData {
  event: CollectCoinCreatorFeeEvent | CollectProtocolFeeEvent;
  signature: string;
  slot: number;
  blockTime: Date;
}

interface TradeWithFeesData {
  event: AmmBuyEvent | AmmSellEvent;
  signature: string;
  slot: number;
  blockTime: Date;
}

export class FeeEventHandler {
  private logger: Logger;
  private feeService: AmmFeeService;

  constructor(
    private eventBus: EventBus,
    _dbService: UnifiedDbServiceV2,
    private poolStateService: AmmPoolStateService
  ) {
    // _dbService is required for DI but we use feeService for db operations
    this.logger = new Logger({ context: 'FeeEventHandler' });
    this.feeService = AmmFeeService.getInstance();
    
    // Subscribe to fee events
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Direct fee collection events
    this.eventBus.on(EVENTS.FEE_COLLECTED, async (data: FeeEventData) => {
      await this.handleFeeEvent(data);
    });

    this.eventBus.on(EVENTS.PROTOCOL_FEE_COLLECTED, async (data: FeeEventData) => {
      await this.handleFeeEvent(data);
    });

    // Trade events with fees
    this.eventBus.on(EVENTS.AMM_TRADE, async (data: any) => {
      await this.handleTradeWithFees(data);
    });
  }

  /**
   * Handle fee collection event
   */
  async handleFeeEvent(data: FeeEventData): Promise<void> {
    try {
      const { event, signature, slot, blockTime } = data;
      
      let feeType: 'creator' | 'protocol';
      let poolAddress: string;
      let coinAmount: string;
      let pcAmount: string;
      let recipient: string;

      // Determine event type
      if ('recipient' in event) {
        // Creator fee event
        feeType = 'creator';
        poolAddress = event.pool;
        coinAmount = event.coinAmount;
        pcAmount = event.pcAmount;
        recipient = event.recipient;
      } else {
        // Protocol fee event
        feeType = 'protocol';
        poolAddress = event.poolAddress;
        coinAmount = event.protocolCoinFee;
        pcAmount = event.protocolPcFee;
        recipient = event.poolAddress; // Protocol fees go to pool
      }

      // Process fee through service
      await this.feeService.processFeeEvent(
        feeType,
        poolAddress,
        coinAmount,
        pcAmount,
        signature,
        slot,
        blockTime
      );

      // Get pool state for context
      const poolState = await this.poolStateService.getPoolState(poolAddress);
      
      // Emit processed event
      this.eventBus.emit(EVENTS.FEE_PROCESSED, {
        feeType,
        poolAddress,
        mintAddress: poolState?.reserves.mintAddress,
        coinAmount,
        pcAmount,
        recipient,
        signature
      });

      this.logger.info('Fee event processed', {
        type: feeType,
        pool: poolAddress.slice(0, 8) + '...',
        coinAmount,
        pcAmount,
        signature: signature.slice(0, 8) + '...'
      });

      // Update daily metrics periodically
      await this.feeService.updateDailyMetrics(poolAddress);

    } catch (error) {
      this.logger.error('Failed to handle fee event', error as Error);
    }
  }

  /**
   * Handle trade with fees
   */
  async handleTradeWithFees(data: TradeWithFeesData): Promise<void> {
    try {
      const { event, signature, slot, blockTime } = data;
      
      // Check if trade has associated fees
      if (!event || typeof event !== 'object') {
        return;
      }

      // Extract fees from buy/sell events
      let lpFee: string = '0';
      let protocolFee: string = '0';
      let poolAddress: string = '';

      if ('lpFee' in event && event.lpFee) {
        lpFee = event.lpFee;
        protocolFee = event.protocolFee || '0';
        poolAddress = event.pool;
      }

      const totalFee = BigInt(lpFee) + BigInt(protocolFee);
      if (totalFee === 0n) {
        return; // No fees to process
      }

      // Process LP fees
      if (BigInt(lpFee) > 0n) {
        await this.feeService.processFeeEvent(
          'lp',
          poolAddress,
          '0', // Fees are typically in quote token
          lpFee,
          signature,
          slot,
          blockTime
        );
      }

      // Process protocol fees
      if (BigInt(protocolFee) > 0n) {
        await this.feeService.processFeeEvent(
          'protocol',
          poolAddress,
          '0', // Fees are typically in quote token
          protocolFee,
          signature,
          slot,
          blockTime
        );
      }

      this.logger.debug('Trade fees processed', {
        pool: poolAddress.slice(0, 8) + '...',
        lpFee,
        protocolFee,
        signature: signature.slice(0, 8) + '...'
      });

    } catch (error) {
      this.logger.error('Failed to handle trade fees', error as Error);
    }
  }

  /**
   * Get fee metrics for a pool
   */
  async getPoolFeeMetrics(poolAddress: string): Promise<any> {
    return await this.feeService.calculateFeeMetrics(poolAddress);
  }

  /**
   * Get top fee generating pools
   */
  async getTopFeeGeneratingPools(limit: number = 10): Promise<any[]> {
    try {
      const query = `
        SELECT 
          pool_address,
          SUM(total_value_usd) as total_fees_usd,
          COUNT(*) as fee_events,
          MAX(block_time) as last_fee_collected
        FROM amm_fee_events
        WHERE block_time > NOW() - INTERVAL '7 days'
        GROUP BY pool_address
        ORDER BY total_fees_usd DESC
        LIMIT $1
      `;

      const result = await db.query(query, [limit]);
      return result.rows;
    } catch (error) {
      this.logger.error('Failed to get top fee generating pools', error as Error);
      return [];
    }
  }
}