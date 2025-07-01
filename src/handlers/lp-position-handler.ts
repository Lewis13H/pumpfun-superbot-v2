/**
 * LP Position Handler
 * Handles LP position updates and tracking
 */

import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedDbServiceV2 } from '../database/unified-db-service';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { SolPriceService } from '../services/sol-price';
import { LpPositionCalculator, TokenPrices } from '../services/lp-position-calculator';
import { db } from '../database';

interface LpPositionUpdate {
  account: {
    address: string;
    mint: string;
    owner: string;
    amount: bigint;
    decimals: number;
  };
  poolAddress: string;
  mintAddress: string;
  slot: number;
}

interface LpTransactionData {
  event: any; // Deposit or Withdraw event
  signature: string;
  slot: number;
  blockTime: Date;
}

export class LpPositionHandler {
  private logger: Logger;
  private solPriceService: SolPriceService;
  private positionCalculator: LpPositionCalculator;

  constructor(
    private eventBus: EventBus,
    _dbService: UnifiedDbServiceV2,
    private poolStateService: AmmPoolStateService
  ) {
    // _dbService is required for DI but we use db directly
    this.logger = new Logger({ context: 'LpPositionHandler' });
    this.solPriceService = SolPriceService.getInstance();
    this.positionCalculator = LpPositionCalculator.getInstance();
    
    // Subscribe to position events
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // LP position updates from token monitor
    this.eventBus.on(EVENTS.LP_POSITION_UPDATED, async (data: LpPositionUpdate) => {
      await this.handlePositionUpdate(data);
    });

    // Liquidity transactions from AMM monitor
    this.eventBus.on(EVENTS.LIQUIDITY_PROCESSED, async (data: LpTransactionData) => {
      await this.handleLiquidityTransaction(data);
    });
  }

  /**
   * Handle LP position update
   */
  async handlePositionUpdate(data: LpPositionUpdate): Promise<void> {
    try {
      const { account, poolAddress, mintAddress } = data;
      
      // Get pool state
      const poolState = await this.poolStateService.getPoolState(poolAddress);
      if (!poolState) {
        this.logger.warn('Pool state not found for position update', { poolAddress });
        return;
      }

      // Get current prices
      const solPrice = await this.solPriceService.getPrice();
      const tokenPrice = poolState.metrics.pricePerTokenUsd;
      
      const prices: TokenPrices = {
        base: solPrice,
        quote: tokenPrice
      };

      // Calculate position value
      const lpSupply = BigInt(poolState.account.lpSupply || 0);
      if (lpSupply === 0n) {
        this.logger.warn('LP supply is zero', { poolAddress });
        return;
      }

      const positionValue = this.positionCalculator.calculatePositionValue(
        account.amount,
        lpSupply,
        poolState.reserves,
        prices
      );

      // Update or create position in database
      await this.updatePosition({
        poolAddress,
        userAddress: account.owner,
        lpTokenAccount: account.address,
        lpBalance: account.amount,
        baseShare: BigInt(Math.floor(positionValue.baseAmount * 1e9)), // Convert to lamports
        quoteShare: BigInt(Math.floor(positionValue.quoteAmount * 1e6)), // Convert to token units
        totalValueUsd: positionValue.totalValueUSD,
        sharePercentage: positionValue.sharePercentage,
        isActive: account.amount > 0n
      });

      // Calculate impermanent loss if we have initial deposit info
      const initialDeposit = await this.getInitialDeposit(poolAddress, account.owner);
      if (initialDeposit) {
        const ilResult = this.positionCalculator.calculateImpermanentLoss(
          initialDeposit,
          positionValue,
          prices
        );

        await this.updateImpermanentLoss({
          poolAddress,
          userAddress: account.owner,
          ...ilResult
        });

        // Log significant IL
        if (Math.abs(ilResult.impermanentLossPercent) > 5) {
          this.logger.info('Significant impermanent loss detected', {
            user: account.owner.slice(0, 8) + '...',
            pool: poolAddress.slice(0, 8) + '...',
            ilPercent: ilResult.impermanentLossPercent.toFixed(2),
            currentValue: ilResult.currentValueUSD.toFixed(2),
            hodlValue: ilResult.hodlValueUSD.toFixed(2)
          });
        }
      }

      // Emit position processed event
      this.eventBus.emit(EVENTS.LP_POSITION_PROCESSED, {
        poolAddress,
        mintAddress,
        userAddress: account.owner,
        lpBalance: account.amount.toString(),
        totalValueUsd: positionValue.totalValueUSD,
        sharePercentage: positionValue.sharePercentage
      });

      // Log large positions
      if (positionValue.totalValueUSD > 10000) {
        this.logger.info('Large LP position updated', {
          user: account.owner.slice(0, 8) + '...',
          pool: poolAddress.slice(0, 8) + '...',
          value: `$${positionValue.totalValueUSD.toFixed(2)}`,
          share: `${positionValue.sharePercentage.toFixed(2)}%`
        });
      }

    } catch (error) {
      this.logger.error('Failed to handle position update', error as Error);
    }
  }

  /**
   * Handle liquidity transaction (deposit/withdraw)
   */
  async handleLiquidityTransaction(data: any): Promise<void> {
    try {
      const { type, pool, user, valueUsd, lpTokens, baseAmount, quoteAmount } = data;
      const blockTime = new Date();
      
      // Record transaction
      const transactionData = {
        signature: data.signature || `${Date.now()}-${Math.random()}`, // Fallback for missing signature
        poolAddress: pool,
        userAddress: user,
        transactionType: type as 'deposit' | 'withdraw',
        lpAmount: BigInt(lpTokens || 0),
        baseAmount: BigInt(baseAmount || 0),
        quoteAmount: BigInt(quoteAmount || 0),
        totalValueUsd: valueUsd,
        slot: BigInt(data.slot || 0),
        blockTime
      };

      await this.recordLiquidityTransaction(transactionData);

      // Update position timestamps
      if (type === 'deposit') {
        await this.updatePositionDepositTime(pool, user, blockTime);
      } else {
        await this.updatePositionWithdrawTime(pool, user, blockTime);
      }

    } catch (error) {
      this.logger.error('Failed to handle liquidity transaction', error as Error);
    }
  }

  /**
   * Update position in database
   */
  private async updatePosition(data: {
    poolAddress: string;
    userAddress: string;
    lpTokenAccount: string;
    lpBalance: bigint;
    baseShare: bigint;
    quoteShare: bigint;
    totalValueUsd: number;
    sharePercentage: number;
    isActive: boolean;
  }): Promise<void> {
    try {
      const query = `
        INSERT INTO lp_positions (
          pool_address, user_address, lp_token_account, lp_balance,
          base_share, quote_share, total_value_usd, share_percentage, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (pool_address, user_address) DO UPDATE SET
          lp_token_account = EXCLUDED.lp_token_account,
          lp_balance = EXCLUDED.lp_balance,
          base_share = EXCLUDED.base_share,
          quote_share = EXCLUDED.quote_share,
          total_value_usd = EXCLUDED.total_value_usd,
          share_percentage = EXCLUDED.share_percentage,
          is_active = EXCLUDED.is_active,
          last_updated = NOW()
        RETURNING id
      `;

      const values = [
        data.poolAddress,
        data.userAddress,
        data.lpTokenAccount,
        data.lpBalance.toString(),
        data.baseShare.toString(),
        data.quoteShare.toString(),
        data.totalValueUsd,
        data.sharePercentage,
        data.isActive
      ];

      const result = await db.query(query, values);
      const positionId = result.rows[0]?.id;

      // Record in history
      if (positionId) {
        await this.recordPositionHistory(positionId, data);
      }

    } catch (error) {
      this.logger.error('Failed to update position', error as Error);
    }
  }

  /**
   * Record position history
   */
  private async recordPositionHistory(positionId: number, data: any): Promise<void> {
    try {
      const query = `
        INSERT INTO lp_position_history (
          position_id, lp_balance, base_share, quote_share,
          value_usd, action, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `;

      const values = [
        positionId,
        data.lpBalance.toString(),
        data.baseShare.toString(),
        data.quoteShare.toString(),
        data.totalValueUsd,
        'update'
      ];

      await db.query(query, values);
    } catch (error) {
      this.logger.error('Failed to record position history', error as Error);
    }
  }

  /**
   * Record liquidity transaction
   */
  private async recordLiquidityTransaction(data: any): Promise<void> {
    try {
      const query = `
        INSERT INTO lp_transactions (
          signature, pool_address, user_address, transaction_type,
          lp_amount, base_amount, quote_amount, total_value_usd,
          slot, block_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (signature) DO NOTHING
      `;

      const values = [
        data.signature,
        data.poolAddress,
        data.userAddress,
        data.transactionType,
        data.lpAmount.toString(),
        data.baseAmount.toString(),
        data.quoteAmount.toString(),
        data.totalValueUsd,
        data.slot.toString(),
        data.blockTime
      ];

      await db.query(query, values);
    } catch (error) {
      this.logger.error('Failed to record liquidity transaction', error as Error);
    }
  }

  /**
   * Update impermanent loss
   */
  private async updateImpermanentLoss(data: any): Promise<void> {
    try {
      // First get position ID
      const positionQuery = `
        SELECT id FROM lp_positions 
        WHERE pool_address = $1 AND user_address = $2
      `;
      const positionResult = await db.query(positionQuery, [data.poolAddress, data.userAddress]);
      const positionId = positionResult.rows[0]?.id;

      if (!positionId) return;

      const query = `
        INSERT INTO lp_impermanent_loss (
          position_id, current_value_usd, hodl_value_usd,
          impermanent_loss_usd, impermanent_loss_percent, price_ratio_change
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (position_id) DO UPDATE SET
          current_value_usd = EXCLUDED.current_value_usd,
          hodl_value_usd = EXCLUDED.hodl_value_usd,
          impermanent_loss_usd = EXCLUDED.impermanent_loss_usd,
          impermanent_loss_percent = EXCLUDED.impermanent_loss_percent,
          price_ratio_change = EXCLUDED.price_ratio_change,
          calculated_at = NOW()
      `;

      const values = [
        positionId,
        data.currentValueUSD,
        data.hodlValueUSD,
        data.impermanentLoss,
        data.impermanentLossPercent,
        data.priceRatio
      ];

      await db.query(query, values);
    } catch (error) {
      this.logger.error('Failed to update impermanent loss', error as Error);
    }
  }

  /**
   * Get initial deposit info for IL calculation
   */
  private async getInitialDeposit(poolAddress: string, userAddress: string): Promise<any> {
    try {
      const query = `
        SELECT 
          base_amount / 1e9 as base_amount,
          quote_amount / 1e6 as quote_amount,
          base_price_usd,
          quote_price_usd,
          total_value_usd,
          block_time
        FROM lp_transactions
        WHERE pool_address = $1 
          AND user_address = $2
          AND transaction_type = 'deposit'
        ORDER BY block_time ASC
        LIMIT 1
      `;

      const result = await db.query(query, [poolAddress, userAddress]);
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        baseAmount: parseFloat(row.base_amount),
        quoteAmount: parseFloat(row.quote_amount),
        basePrice: parseFloat(row.base_price_usd || 0),
        quotePrice: parseFloat(row.quote_price_usd || 0),
        depositValueUSD: parseFloat(row.total_value_usd || 0),
        timestamp: row.block_time
      };
    } catch (error) {
      this.logger.error('Failed to get initial deposit', error as Error);
      return null;
    }
  }

  /**
   * Update position deposit time
   */
  private async updatePositionDepositTime(poolAddress: string, userAddress: string, time: Date): Promise<void> {
    try {
      await db.query(
        `UPDATE lp_positions 
         SET last_deposit_time = $3 
         WHERE pool_address = $1 AND user_address = $2`,
        [poolAddress, userAddress, time]
      );
    } catch (error) {
      this.logger.error('Failed to update deposit time', error as Error);
    }
  }

  /**
   * Update position withdraw time
   */
  private async updatePositionWithdrawTime(poolAddress: string, userAddress: string, time: Date): Promise<void> {
    try {
      await db.query(
        `UPDATE lp_positions 
         SET last_withdraw_time = $3 
         WHERE pool_address = $1 AND user_address = $2`,
        [poolAddress, userAddress, time]
      );
    } catch (error) {
      this.logger.error('Failed to update withdraw time', error as Error);
    }
  }

  /**
   * Get user LP positions
   */
  async getUserPositions(userAddress: string): Promise<any[]> {
    try {
      const query = `
        SELECT 
          lp.*,
          t.symbol,
          t.name,
          il.impermanent_loss_percent
        FROM lp_positions lp
        LEFT JOIN amm_pools p ON p.pool_address = lp.pool_address
        LEFT JOIN tokens_unified t ON t.mint_address = p.mint_address
        LEFT JOIN lp_impermanent_loss il ON il.position_id = lp.id
        WHERE lp.user_address = $1 AND lp.is_active = TRUE
        ORDER BY lp.total_value_usd DESC
      `;

      const result = await db.query(query, [userAddress]);
      return result.rows;
    } catch (error) {
      this.logger.error('Failed to get user positions', error as Error);
      return [];
    }
  }

  /**
   * Get pool LP providers
   */
  async getPoolProviders(poolAddress: string): Promise<any[]> {
    try {
      const query = `
        SELECT 
          lp.*,
          il.impermanent_loss_percent
        FROM lp_positions lp
        LEFT JOIN lp_impermanent_loss il ON il.position_id = lp.id
        WHERE lp.pool_address = $1 AND lp.is_active = TRUE
        ORDER BY lp.share_percentage DESC
      `;

      const result = await db.query(query, [poolAddress]);
      return result.rows;
    } catch (error) {
      this.logger.error('Failed to get pool providers', error as Error);
      return [];
    }
  }
}