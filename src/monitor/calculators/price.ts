// src/monitor/calculators/price.ts

import { MAX_MARKET_CAP_USD } from '../constants';

export class PriceCalculator {
  /**
   * Calculate pump.fun token price using Method 2
   * (SOL in human-readable format, tokens in raw format)
   */
  static calculatePrice(
    virtualSolReserves: number,
    virtualTokenReserves: number
  ): number {
    // Method 2: Convert SOL to human-readable, keep tokens raw
    // This gives reasonable market caps ($1K-$50K range)
    const adjustedPrice = (virtualSolReserves / 1e9) / virtualTokenReserves;
    
    return adjustedPrice;
  }

  /**
   * Validate market cap is within reasonable bounds
   */
  static validateMarketCap(marketCapUsd: number): boolean {
    return marketCapUsd > 0 && marketCapUsd <= MAX_MARKET_CAP_USD;
  }

  /**
   * Calculate market cap in USD
   */
  static calculateMarketCap(
    priceInSol: number,
    solPriceUsd: number,
    totalSupply: number
  ): number {
    return priceInSol * solPriceUsd * totalSupply;
  }

  /**
   * Calculate liquidity in USD
   */
  static calculateLiquidityUsd(liquiditySol: number, solPriceUsd: number): number {
    return liquiditySol * solPriceUsd;
  }
}
