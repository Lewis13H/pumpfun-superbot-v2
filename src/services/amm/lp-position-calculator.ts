/**
 * LP Position Calculator
 * Calculates LP token values and impermanent loss
 */

import { Logger } from '../../core/logger';
import { db } from '../../database';
import { AmmPoolStateService } from './amm-pool-state-service';
import { SolPriceService } from '../pricing/sol-price-service';

export interface PositionValue {
  baseAmount: number;
  quoteAmount: number;
  totalValueUSD: number;
  sharePercentage: number;
}

export interface TokenPrices {
  base: number; // SOL price in USD
  quote: number; // Token price in USD
}

export interface DepositInfo {
  baseAmount: number;
  quoteAmount: number;
  basePrice: number;
  quotePrice: number;
  lpTokensReceived: bigint;
  timestamp: Date;
}

export interface LpPositionDetails {
  poolAddress: string;
  userAddress: string;
  lpBalance: bigint;
  currentValue: PositionValue;
  initialDeposit: DepositInfo;
  impermanentLoss: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
}

export class LpPositionCalculator {
  private static instance: LpPositionCalculator;
  private logger: Logger;
  private poolStateService: AmmPoolStateService;
  private solPriceService: SolPriceService;
  
  private constructor() {
    this.logger = new Logger({ context: 'LpPositionCalculator' });
    this.poolStateService = AmmPoolStateService.getInstance();
    this.solPriceService = SolPriceService.getInstance();
  }
  
  static getInstance(): LpPositionCalculator {
    if (!LpPositionCalculator.instance) {
      LpPositionCalculator.instance = new LpPositionCalculator();
    }
    return LpPositionCalculator.instance;
  }

  /**
   * Calculate position value based on LP token balance
   */
  calculatePositionValue(
    lpBalance: bigint,
    lpSupply: bigint,
    poolReserves: { base: number; quote: number },
    prices: TokenPrices
  ): PositionValue {
    if (lpSupply === 0n) {
      return {
        baseAmount: 0,
        quoteAmount: 0,
        totalValueUSD: 0,
        sharePercentage: 0
      };
    }
    
    const shareOfPool = Number(lpBalance) / Number(lpSupply);
    const baseShare = poolReserves.base * shareOfPool;
    const quoteShare = poolReserves.quote * shareOfPool;
    
    return {
      baseAmount: baseShare,
      quoteAmount: quoteShare,
      totalValueUSD: (baseShare * prices.base) + (quoteShare * prices.quote),
      sharePercentage: shareOfPool * 100
    };
  }

  /**
   * Calculate impermanent loss
   */
  calculateImpermanentLoss(
    initialDeposit: DepositInfo,
    currentPosition: PositionValue,
    currentPrices: TokenPrices
  ): number {
    // Calculate what the deposit would be worth if just held
    const holdValue = 
      (initialDeposit.baseAmount * currentPrices.base) + 
      (initialDeposit.quoteAmount * currentPrices.quote);
    
    // Current value in LP
    const lpValue = currentPosition.totalValueUSD;
    
    // IL = (LP Value / Hold Value - 1) * 100
    if (holdValue === 0) return 0;
    
    const impermanentLoss = ((lpValue / holdValue) - 1) * 100;
    return impermanentLoss;
  }

  /**
   * Calculate detailed impermanent loss with price ratio
   */
  calculateDetailedImpermanentLoss(
    initialPriceRatio: number,
    currentPriceRatio: number
  ): {
    ilPercentage: number;
    priceChangeRatio: number;
    divergenceLoss: number;
  } {
    const priceChangeRatio = currentPriceRatio / initialPriceRatio;
    
    // IL formula: 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
    const divergenceLoss = 2 * Math.sqrt(priceChangeRatio) / (1 + priceChangeRatio) - 1;
    const ilPercentage = divergenceLoss * 100;
    
    return {
      ilPercentage,
      priceChangeRatio,
      divergenceLoss
    };
  }

  /**
   * Get user's LP position details
   */
  async getUserPosition(
    poolAddress: string, 
    userAddress: string
  ): Promise<LpPositionDetails | null> {
    try {
      // Get current LP balance
      const balanceQuery = `
        SELECT lp_balance, last_updated 
        FROM lp_positions 
        WHERE pool_address = $1 AND user_address = $2
      `;
      const balanceResult = await db.query(balanceQuery, [poolAddress, userAddress]);
      
      if (balanceResult.rows.length === 0) {
        return null;
      }
      
      const lpBalance = BigInt(balanceResult.rows[0].lp_balance);
      
      // Get pool state
      const poolState = this.poolStateService.getPoolStateByAddress(poolAddress);
      if (!poolState) {
        this.logger.warn('Pool state not found', { poolAddress });
        return null;
      }
      
      // Get LP supply (would need to query on-chain or track in DB)
      const lpSupply = BigInt(1e12); // Placeholder
      
      // Get current prices
      const solPrice = await this.solPriceService.getPrice();
      const tokenPrice = this.calculateTokenPrice(poolState.reserves);
      
      const prices: TokenPrices = {
        base: solPrice,
        quote: tokenPrice * solPrice
      };
      
      // Calculate current position value
      const currentValue = this.calculatePositionValue(
        lpBalance,
        lpSupply,
        {
          base: poolState.reserves.virtualSolReserves / 1e9,
          quote: poolState.reserves.virtualTokenReserves / 1e6
        },
        prices
      );
      
      // Get initial deposit info
      const depositQuery = `
        SELECT 
          base_amount, quote_amount, base_price_usd, quote_price_usd,
          lp_amount, block_time
        FROM amm_liquidity_events
        WHERE pool_address = $1 AND user_address = $2 AND event_type = 'deposit'
        ORDER BY block_time ASC
        LIMIT 1
      `;
      const depositResult = await db.query(depositQuery, [poolAddress, userAddress]);
      
      let initialDeposit: DepositInfo;
      let impermanentLoss = 0;
      
      if (depositResult.rows.length > 0) {
        const deposit = depositResult.rows[0];
        initialDeposit = {
          baseAmount: Number(deposit.base_amount) / 1e9,
          quoteAmount: Number(deposit.quote_amount) / 1e6,
          basePrice: Number(deposit.base_price_usd),
          quotePrice: Number(deposit.quote_price_usd),
          lpTokensReceived: BigInt(deposit.lp_amount),
          timestamp: deposit.block_time
        };
        
        impermanentLoss = this.calculateImpermanentLoss(
          initialDeposit,
          currentValue,
          prices
        );
      } else {
        // Default deposit info if not found
        initialDeposit = {
          baseAmount: 0,
          quoteAmount: 0,
          basePrice: 0,
          quotePrice: 0,
          lpTokensReceived: 0n,
          timestamp: new Date()
        };
      }
      
      // Calculate PnL
      const initialValue = 
        (initialDeposit.baseAmount * initialDeposit.basePrice) +
        (initialDeposit.quoteAmount * initialDeposit.quotePrice);
      
      const unrealizedPnl = currentValue.totalValueUSD - initialValue;
      const realizedPnl = 0; // Would need to track withdrawals
      
      return {
        poolAddress,
        userAddress,
        lpBalance,
        currentValue,
        initialDeposit,
        impermanentLoss,
        realizedPnl,
        unrealizedPnl,
        totalPnl: realizedPnl + unrealizedPnl
      };
      
    } catch (error) {
      this.logger.error('Failed to get user position', error as Error);
      return null;
    }
  }

  /**
   * Calculate token price from pool reserves
   */
  private calculateTokenPrice(reserves: any): number {
    const solReserves = reserves.virtualSolReserves / 1e9;
    const tokenReserves = reserves.virtualTokenReserves / 1e6;
    
    if (tokenReserves === 0) return 0;
    return solReserves / tokenReserves;
  }

  /**
   * Update LP position in database
   */
  async updateLpPosition(
    poolAddress: string,
    userAddress: string,
    lpBalance: bigint,
    slot: number
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO lp_positions (
          pool_address, user_address, lp_token_balance,
          last_updated_slot, last_updated_at
        ) VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (pool_address, user_address) DO UPDATE SET
          lp_token_balance = $3,
          last_updated_slot = $4,
          last_updated_at = NOW()
      `;
      
      await db.query(query, [poolAddress, userAddress, lpBalance.toString(), slot]);
    } catch (error) {
      this.logger.error('Failed to update LP position', error as Error);
    }
  }
}