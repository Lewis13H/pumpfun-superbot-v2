/**
 * Unified Price Calculator
 * Handles price calculations for both BC and AMM trades
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Logger } from '../core/logger';

export interface PriceInfo {
  priceInSol: number;
  priceInLamports: number;
  priceInUsd: number;
  marketCapUsd: number;
}

export interface ReserveInfo {
  solReserves: bigint;
  tokenReserves: bigint;
  isVirtual?: boolean;
}

export interface PriceImpactResult {
  priceImpact: number;
  effectivePrice: number;
  tokensOut: bigint;
  averagePrice: number;
}

export class PriceCalculator {
  private logger = new Logger({ context: 'PriceCalculator' });
  private readonly TOTAL_SUPPLY = 1_000_000_000; // 1B tokens
  private readonly TOKEN_DECIMALS = 6;
  private readonly BONDING_CURVE_PROGRESS_SOL = 85; // SOL needed for graduation

  /**
   * Calculate price from reserves using constant product formula
   */
  calculatePrice(
    reserves: ReserveInfo,
    solPriceUsd: number = 180
  ): PriceInfo {
    if (reserves.solReserves === 0n || reserves.tokenReserves === 0n) {
      return {
        priceInSol: 0,
        priceInLamports: 0,
        priceInUsd: 0,
        marketCapUsd: 0
      };
    }

    // Convert reserves to numbers with proper decimal handling
    const solReserves = Number(reserves.solReserves) / Number(LAMPORTS_PER_SOL); // Convert lamports to SOL
    const tokenReserves = Number(reserves.tokenReserves) / Math.pow(10, this.TOKEN_DECIMALS); // Apply token decimals
    
    // Calculate price per token in SOL
    const priceInSol = solReserves / tokenReserves;
    
    // Calculate price in USD
    const priceInUsd = priceInSol * solPriceUsd;
    
    // Calculate market cap (price * total supply)
    const marketCapUsd = priceInUsd * this.TOTAL_SUPPLY;
    
    // Price in lamports (for legacy compatibility)
    const priceInLamports = priceInSol * Number(LAMPORTS_PER_SOL);

    return {
      priceInSol,
      priceInLamports,
      priceInUsd,
      marketCapUsd
    };
  }

  /**
   * Calculate bonding curve progress
   */
  calculateBondingCurveProgress(virtualSolReserves: bigint): number {
    // Progress is based on SOL in the bonding curve
    // Starts at ~30 SOL, completes at ~85 SOL
    const solInCurve = Number(virtualSolReserves) / Number(LAMPORTS_PER_SOL);
    const progress = (solInCurve / this.BONDING_CURVE_PROGRESS_SOL) * 100;
    
    return Math.min(progress, 100);
  }

  /**
   * Calculate price impact for a trade
   */
  calculatePriceImpact(
    amountIn: bigint,
    reserves: ReserveInfo,
    isBuyingToken: boolean
  ): PriceImpactResult {
    const k = reserves.solReserves * reserves.tokenReserves;
    
    let newSolReserves: bigint;
    let newTokenReserves: bigint;
    let tokensOut: bigint;
    
    if (isBuyingToken) {
      // Buying tokens with SOL
      newSolReserves = reserves.solReserves + amountIn;
      newTokenReserves = k / newSolReserves;
      tokensOut = reserves.tokenReserves - newTokenReserves;
    } else {
      // Selling tokens for SOL
      newTokenReserves = reserves.tokenReserves + amountIn;
      newSolReserves = k / newTokenReserves;
      tokensOut = reserves.solReserves - newSolReserves;
    }
    
    // Calculate prices
    const oldPrice = Number(reserves.solReserves) / Number(reserves.tokenReserves);
    const newPrice = Number(newSolReserves) / Number(newTokenReserves);
    const effectivePrice = Number(amountIn) / Number(tokensOut);
    
    // Price impact percentage
    const priceImpact = ((newPrice - oldPrice) / oldPrice) * 100;
    
    return {
      priceImpact: Math.abs(priceImpact),
      effectivePrice,
      tokensOut,
      averagePrice: (oldPrice + newPrice) / 2
    };
  }

  /**
   * Calculate slippage for a trade
   */
  calculateSlippage(
    expectedPrice: number,
    actualPrice: number
  ): number {
    if (expectedPrice === 0) return 0;
    return Math.abs((actualPrice - expectedPrice) / expectedPrice) * 100;
  }

  /**
   * Validate reserves are reasonable
   */
  validateReserves(reserves: ReserveInfo): boolean {
    // Check for zero reserves
    if (reserves.solReserves === 0n || reserves.tokenReserves === 0n) {
      this.logger.warn('Invalid reserves: zero values', reserves);
      return false;
    }

    // Check for extreme ratios (potential manipulation)
    const ratio = Number(reserves.solReserves) / Number(reserves.tokenReserves);
    if (ratio < 1e-10 || ratio > 1e10) {
      this.logger.warn('Invalid reserves: extreme ratio', { ratio, reserves });
      return false;
    }

    // Check constant K hasn't decreased (for AMM)
    // This would need historical K value to properly validate

    return true;
  }

  /**
   * Format price for display
   */
  formatPrice(price: number, decimals: number = 6): string {
    if (price === 0) return '0';
    
    if (price < 0.000001) {
      return price.toExponential(2);
    } else if (price < 1) {
      return price.toFixed(decimals);
    } else if (price < 1000) {
      return price.toFixed(4);
    } else if (price < 1000000) {
      return price.toFixed(2);
    } else {
      return price.toExponential(2);
    }
  }

  /**
   * Format market cap for display
   */
  formatMarketCap(marketCap: number): string {
    if (marketCap < 1000) {
      return `$${marketCap.toFixed(2)}`;
    } else if (marketCap < 1000000) {
      return `$${(marketCap / 1000).toFixed(1)}K`;
    } else if (marketCap < 1000000000) {
      return `$${(marketCap / 1000000).toFixed(1)}M`;
    } else {
      return `$${(marketCap / 1000000000).toFixed(1)}B`;
    }
  }

  /**
   * Calculate price from trade amounts
   */
  calculatePriceFromTrade(
    solAmount: bigint,
    tokenAmount: bigint,
    solPriceUsd: number = 180
  ): PriceInfo {
    if (tokenAmount === 0n) {
      return {
        priceInSol: 0,
        priceInLamports: 0,
        priceInUsd: 0,
        marketCapUsd: 0
      };
    }

    // Convert amounts to proper units
    const solInSol = Number(solAmount) / Number(LAMPORTS_PER_SOL);
    const tokensWithDecimals = Number(tokenAmount) / Math.pow(10, this.TOKEN_DECIMALS);
    
    // Calculate price per token in SOL
    const priceInSol = solInSol / tokensWithDecimals;
    
    // Calculate price in USD and market cap
    const priceInUsd = priceInSol * solPriceUsd;
    const marketCapUsd = priceInUsd * this.TOTAL_SUPPLY;
    const priceInLamports = priceInSol * Number(LAMPORTS_PER_SOL);

    return {
      priceInSol,
      priceInLamports,
      priceInUsd,
      marketCapUsd
    };
  }
}