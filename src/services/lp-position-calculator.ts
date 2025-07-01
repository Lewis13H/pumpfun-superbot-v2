/**
 * LP Position Calculator Service
 * Calculates LP position values and impermanent loss
 */

import { AmmPoolReserves } from '../types/amm-pool-state';

export interface TokenPrices {
  base: number;  // SOL price in USD
  quote: number; // Token price in USD
}

export interface PositionValue {
  baseAmount: number;
  quoteAmount: number;
  totalValueUSD: number;
  sharePercentage: number;
}

export interface DepositInfo {
  baseAmount: number;
  quoteAmount: number;
  basePrice: number;
  quotePrice: number;
  depositValueUSD: number;
  lpTokensReceived: bigint;
  timestamp: Date;
}

export interface ImpermanentLossResult {
  currentValueUSD: number;
  hodlValueUSD: number;
  impermanentLoss: number; // Negative means loss, positive means gain
  impermanentLossPercent: number;
  priceRatio: number; // Current price ratio vs initial
}

export class LpPositionCalculator {
  private static instance: LpPositionCalculator;

  private constructor() {
    // Initialization if needed
  }

  static getInstance(): LpPositionCalculator {
    if (!LpPositionCalculator.instance) {
      LpPositionCalculator.instance = new LpPositionCalculator();
    }
    return LpPositionCalculator.instance;
  }

  /**
   * Calculate current position value
   */
  calculatePositionValue(
    lpBalance: bigint,
    lpSupply: bigint,
    poolReserves: AmmPoolReserves,
    prices: TokenPrices
  ): PositionValue {
    // Calculate share of pool
    const shareOfPool = Number(lpBalance) / Number(lpSupply);
    
    // Calculate share of each asset
    const baseShare = poolReserves.virtualSolReserves * shareOfPool / 1e9; // Convert lamports to SOL
    const quoteShare = poolReserves.virtualTokenReserves * shareOfPool / 1e6; // Assuming 6 decimals
    
    // Calculate USD value
    const baseValueUSD = baseShare * prices.base;
    const quoteValueUSD = quoteShare * prices.quote;
    const totalValueUSD = baseValueUSD + quoteValueUSD;
    
    return {
      baseAmount: baseShare,
      quoteAmount: quoteShare,
      totalValueUSD,
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
  ): ImpermanentLossResult {
    // Calculate what the initial deposit would be worth if just held
    const hodlValueUSD = 
      (initialDeposit.baseAmount * currentPrices.base) + 
      (initialDeposit.quoteAmount * currentPrices.quote);
    
    // Current value is from the position calculation
    const currentValueUSD = currentPosition.totalValueUSD;
    
    // Calculate impermanent loss
    const impermanentLoss = currentValueUSD - hodlValueUSD;
    const impermanentLossPercent = (impermanentLoss / hodlValueUSD) * 100;
    
    // Calculate price ratio change
    const initialPriceRatio = initialDeposit.quotePrice / initialDeposit.basePrice;
    const currentPriceRatio = currentPrices.quote / currentPrices.base;
    const priceRatio = currentPriceRatio / initialPriceRatio;
    
    return {
      currentValueUSD,
      hodlValueUSD,
      impermanentLoss,
      impermanentLossPercent,
      priceRatio
    };
  }

  /**
   * Calculate LP tokens to mint for a deposit
   */
  calculateLpTokensForDeposit(
    baseAmountIn: bigint,
    quoteAmountIn: bigint,
    poolBaseReserves: bigint,
    poolQuoteReserves: bigint,
    currentLpSupply: bigint
  ): bigint {
    if (currentLpSupply === 0n) {
      // Initial liquidity provision
      // LP tokens = sqrt(baseAmount * quoteAmount)
      const product = baseAmountIn * quoteAmountIn;
      return this.sqrt(product);
    }
    
    // Calculate LP tokens based on the asset that gives fewer tokens
    // This ensures the deposit maintains the pool ratio
    const lpFromBase = (baseAmountIn * currentLpSupply) / poolBaseReserves;
    const lpFromQuote = (quoteAmountIn * currentLpSupply) / poolQuoteReserves;
    
    // Return the minimum to maintain ratio
    return lpFromBase < lpFromQuote ? lpFromBase : lpFromQuote;
  }

  /**
   * Calculate assets received for LP token burn
   */
  calculateAssetsForBurn(
    lpTokenAmount: bigint,
    currentLpSupply: bigint,
    poolBaseReserves: bigint,
    poolQuoteReserves: bigint
  ): { baseAmount: bigint; quoteAmount: bigint } {
    const baseAmount = (lpTokenAmount * poolBaseReserves) / currentLpSupply;
    const quoteAmount = (lpTokenAmount * poolQuoteReserves) / currentLpSupply;
    
    return { baseAmount, quoteAmount };
  }

  /**
   * Calculate the K constant for the pool
   */
  calculateK(baseReserves: bigint, quoteReserves: bigint): bigint {
    return baseReserves * quoteReserves;
  }

  /**
   * Calculate pool utilization rate
   */
  calculateUtilizationRate(
    volume24h: number,
    totalLiquidity: number
  ): number {
    if (totalLiquidity === 0) return 0;
    return (volume24h / totalLiquidity) * 100;
  }

  /**
   * Calculate fee APR for liquidity providers
   */
  calculateFeeAPR(
    dailyFees: number,
    totalLiquidity: number
  ): number {
    if (totalLiquidity === 0) return 0;
    return (dailyFees / totalLiquidity) * 365 * 100;
  }

  /**
   * Estimate position after time period with fees
   */
  estimatePositionWithFees(
    currentPosition: PositionValue,
    dailyVolume: number,
    feeRate: number = 0.003, // 0.3% default fee
    days: number = 30
  ): PositionValue {
    // Calculate daily fees generated
    const dailyFees = dailyVolume * feeRate;
    
    // LP's share of fees
    const lpShareOfFees = dailyFees * currentPosition.sharePercentage / 100;
    
    // Total fees over period
    const totalFees = lpShareOfFees * days;
    
    // Assume fees are distributed 50/50 between assets
    const additionalValueUSD = totalFees;
    
    return {
      ...currentPosition,
      totalValueUSD: currentPosition.totalValueUSD + additionalValueUSD
    };
  }

  /**
   * Calculate break-even point for impermanent loss vs fees
   */
  calculateBreakEvenDays(
    impermanentLossUSD: number,
    dailyFeesUSD: number
  ): number {
    if (dailyFeesUSD <= 0) return Infinity;
    return Math.abs(impermanentLossUSD) / dailyFeesUSD;
  }

  /**
   * Helper: Integer square root for bigint
   */
  private sqrt(value: bigint): bigint {
    if (value < 0n) {
      throw new Error('Square root of negative number');
    }
    if (value === 0n) return 0n;
    
    let z = value;
    let x = value / 2n + 1n;
    
    while (x < z) {
      z = x;
      x = (value / x + x) / 2n;
    }
    
    return z;
  }

  /**
   * Format position summary
   */
  formatPositionSummary(
    position: PositionValue,
    ilResult?: ImpermanentLossResult
  ): string {
    let summary = `Position Value: $${position.totalValueUSD.toFixed(2)}\n`;
    summary += `Share of Pool: ${position.sharePercentage.toFixed(4)}%\n`;
    summary += `Base (SOL): ${position.baseAmount.toFixed(4)}\n`;
    summary += `Quote: ${position.quoteAmount.toFixed(2)}\n`;
    
    if (ilResult) {
      summary += `\nImpermanent Loss: ${ilResult.impermanentLossPercent.toFixed(2)}%`;
      summary += ` ($${Math.abs(ilResult.impermanentLoss).toFixed(2)})\n`;
      summary += `HODL Value: $${ilResult.hodlValueUSD.toFixed(2)}\n`;
      summary += `Price Ratio Change: ${((ilResult.priceRatio - 1) * 100).toFixed(2)}%`;
    }
    
    return summary;
  }
}