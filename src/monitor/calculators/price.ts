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

  /**
   * Enhanced validation for price data
   * NEW METHOD - Added for price refresh validation
   */
  static validatePriceData(
    priceInSol: number,
    marketCapUsd: number,
    liquiditySol: number,
    virtualSolReserves: number,
    virtualTokenReserves: number
  ): { isValid: boolean; reason?: string } {
    // Basic sanity checks
    if (priceInSol <= 0 || !isFinite(priceInSol)) {
      return { isValid: false, reason: 'Invalid price' };
    }

    // Use existing validateMarketCap
    if (!this.validateMarketCap(marketCapUsd)) {
      return { isValid: false, reason: `Market cap out of bounds: $${marketCapUsd.toFixed(2)}` };
    }

    // Market cap reasonable bounds for pump.fun
    const MIN_REASONABLE_MCAP = 100; // $100
    if (marketCapUsd < MIN_REASONABLE_MCAP) {
      return { isValid: false, reason: `Market cap too low: $${marketCapUsd.toFixed(2)}` };
    }

    // Liquidity sanity check (0-85 SOL for pump.fun)
    if (liquiditySol < 0 || liquiditySol > 85) {
      return { isValid: false, reason: `Invalid liquidity: ${liquiditySol.toFixed(2)} SOL` };
    }

    // Reserve sanity checks
    if (virtualSolReserves <= 0 || virtualTokenReserves <= 0) {
      return { isValid: false, reason: 'Invalid reserves' };
    }

    // Check for suspiciously round numbers (potential test data)
    if (marketCapUsd % 1000000 === 0 && marketCapUsd > 1000000) {
      return { isValid: false, reason: 'Suspicious round market cap value' };
    }

    return { isValid: true };
  }

  /**
   * Calculate price with validation
   * NEW METHOD - For safer price calculations
   */
  static calculatePriceWithValidation(
    virtualSolReserves: number,
    virtualTokenReserves: number,
    solPriceUsd: number,
    totalSupply: number = 1_000_000_000
  ): { 
    isValid: boolean; 
    priceInSol?: number; 
    priceInUsd?: number; 
    marketCapUsd?: number;
    error?: string;
  } {
    try {
      // Basic input validation
      if (virtualSolReserves <= 0 || virtualTokenReserves <= 0) {
        return { isValid: false, error: 'Invalid reserves' };
      }

      // Use existing calculation method
      const priceInSol = this.calculatePrice(virtualSolReserves, virtualTokenReserves);
      const priceInUsd = priceInSol * solPriceUsd;
      const marketCapUsd = this.calculateMarketCap(priceInSol, solPriceUsd, totalSupply);

      // Validate the calculated values
      const validation = this.validatePriceData(
        priceInSol,
        marketCapUsd,
        0, // Liquidity will be checked separately
        virtualSolReserves,
        virtualTokenReserves
      );

      if (!validation.isValid) {
        return { isValid: false, error: validation.reason };
      }

      return {
        isValid: true,
        priceInSol,
        priceInUsd,
        marketCapUsd
      };
    } catch (error) {
      return { isValid: false, error: `Calculation error: ${error}` };
    }
  }
}