/**
 * Unified Price Calculator
 * Handles price calculations for both BC and AMM trades
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Logger } from '../../core/logger';

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

/**
 * Bonding curve specific price result
 */
export interface PriceResult {
  priceInSol: number;
  priceInUsd: number;
  marketCapSol: number;
  marketCapUsd: number;
  fullyDilutedMcapUsd: number;
}

export interface PriceImpactResult {
  priceImpact: number;
  effectivePrice: number;
  tokensOut: bigint;
  averagePrice: number;
}

export class PriceCalculator {
  private logger = new Logger({ context: 'PriceCalculator' });
  private readonly TOTAL_SUPPLY = 1_000_000_000; // 1B tokens (pump.fun default)
  private readonly PUMP_FUN_CIRCULATING_RATIO = 1.0; // 100% circulating for pump.fun BC tokens
  private readonly TOKEN_DECIMALS = 6;
  private readonly BONDING_CURVE_INITIAL_TOKENS = 793_000_000; // ~793M tokens initially in BC (79.3% of 1B)
  private readonly BONDING_CURVE_MIN_SOL = 25; // Minimum expected SOL in BC
  private readonly BONDING_CURVE_MAX_SOL = 100; // Maximum expected SOL in BC

  /**
   * Calculate price from reserves using constant product formula
   */
  calculatePrice(
    reserves: ReserveInfo,
    solPriceUsd: number = 180,
    isAmmToken: boolean = false,
    totalSupply?: bigint
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
    
    // Calculate market cap based on circulating supply
    let marketCapUsd: number;
    
    if (isAmmToken) {
      // For pump.fun graduated tokens:
      // Circulating supply = Total supply - Tokens locked in pool
      const totalSupplyTokens = this.TOTAL_SUPPLY; // 1B tokens
      
      // Simple and accurate: what's not in the pool is circulating
      const circulatingSupply = Math.max(0, totalSupplyTokens - tokenReserves);
      
      // Sanity check: if pool has >99% of supply, use typical 46% circulating
      if (tokenReserves > totalSupplyTokens * 0.99) {
        marketCapUsd = priceInUsd * (totalSupplyTokens * 0.46);
      } else {
        marketCapUsd = priceInUsd * circulatingSupply;
      }
    } else if (totalSupply) {
      // If we have the actual total supply, use 100% as circulating for BC tokens
      const totalSupplyNum = Number(totalSupply) / Math.pow(10, this.TOKEN_DECIMALS);
      const circulatingSupply = totalSupplyNum * this.PUMP_FUN_CIRCULATING_RATIO;
      marketCapUsd = priceInUsd * circulatingSupply;
    } else {
      // Default: assume 1B total supply with 100% circulating for BC tokens
      const circulatingSupply = this.TOTAL_SUPPLY * this.PUMP_FUN_CIRCULATING_RATIO;
      marketCapUsd = priceInUsd * circulatingSupply;
    }
    
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
   * Calculate bonding curve progress based on token depletion
   */
  calculateBondingCurveProgress(virtualTokenReserves: bigint | undefined | null, isComplete?: boolean): number {
    // If the bonding curve is marked as complete, it's 100%
    if (isComplete) {
      return 100;
    }
    
    // If no token reserves data, return 0
    if (!virtualTokenReserves || virtualTokenReserves === 0n) {
      this.logger.debug('No token reserves for BC progress calculation', { virtualTokenReserves });
      return 0;
    }
    
    // Progress is based on tokens sold from the bonding curve
    // pump.fun shows progress as: (initial tokens - remaining tokens) / initial tokens
    const tokensRemaining = Number(virtualTokenReserves) / Math.pow(10, this.TOKEN_DECIMALS);
    
    // Handle case where remaining tokens exceed initial (shouldn't happen but safe guard)
    if (tokensRemaining > this.BONDING_CURVE_INITIAL_TOKENS) {
      this.logger.warn('Token reserves exceed initial BC tokens', {
        tokensRemaining,
        initial: this.BONDING_CURVE_INITIAL_TOKENS
      });
      return 0;
    }
    
    const tokensSold = this.BONDING_CURVE_INITIAL_TOKENS - tokensRemaining;
    const progress = (tokensSold / this.BONDING_CURVE_INITIAL_TOKENS) * 100;
    
    return Math.min(Math.max(progress, 0), 100); // Clamp between 0 and 100
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

  /**
   * Calculate token price for bonding curve (BC-specific method)
   * Provides additional fields like fullyDilutedMcapUsd
   */
  calculateTokenPrice(
    virtualSolReserves: bigint,
    virtualTokenReserves: bigint,
    solPriceUsd: number
  ): PriceResult {
    // Convert reserves to numbers with proper decimal handling
    const solReserves = Number(virtualSolReserves) / Number(LAMPORTS_PER_SOL);
    const tokenReserves = Number(virtualTokenReserves) / Math.pow(10, this.TOKEN_DECIMALS);
    
    // Calculate price per token in SOL
    const priceInSol = solReserves / tokenReserves;
    
    // Convert to USD
    const priceInUsd = priceInSol * solPriceUsd;
    
    // Calculate market cap
    const marketCapSol = priceInSol * this.TOTAL_SUPPLY;
    const marketCapUsd = marketCapSol * solPriceUsd;
    
    // Fully diluted market cap (same as market cap for pump.fun)
    const fullyDilutedMcapUsd = marketCapUsd;
    
    return {
      priceInSol,
      priceInUsd,
      marketCapSol,
      marketCapUsd,
      fullyDilutedMcapUsd
    };
  }

  /**
   * Validate reserves are reasonable (enhanced for BC)
   */
  validateReserves(reserves: ReserveInfo): boolean {
    // Check for zero reserves
    if (reserves.solReserves === 0n || reserves.tokenReserves === 0n) {
      this.logger.warn('Invalid reserves: zero values', reserves);
      return false;
    }

    // Convert to SOL for validation
    const solReserves = Number(reserves.solReserves) / Number(LAMPORTS_PER_SOL);
    
    // For virtual reserves (bonding curve), check expected range
    if (reserves.isVirtual) {
      if (solReserves < this.BONDING_CURVE_MIN_SOL || solReserves > this.BONDING_CURVE_MAX_SOL) {
        this.logger.warn('Invalid BC reserves: out of expected range', { solReserves, reserves });
        return false;
      }
    }

    // Check for extreme ratios (potential manipulation)
    const ratio = Number(reserves.solReserves) / Number(reserves.tokenReserves);
    if (ratio < 1e-10 || ratio > 1e10) {
      this.logger.warn('Invalid reserves: extreme ratio', { ratio, reserves });
      return false;
    }

    // Token reserves validation
    const tokenReserves = Number(reserves.tokenReserves) / Math.pow(10, this.TOKEN_DECIMALS);
    if (reserves.isVirtual && (tokenReserves < 100_000 || tokenReserves > 2_000_000_000)) {
      this.logger.warn('Invalid BC token reserves: out of expected range', { tokenReserves, reserves });
      return false;
    }

    return true;
  }

  /**
   * Calculate estimated SOL needed to reach a target market cap
   */
  calculateSolToTargetMcap(
    currentMcapUsd: number,
    targetMcapUsd: number,
    virtualSolReserves: bigint,
    _virtualTokenReserves: bigint,
    _solPriceUsd: number
  ): number {
    if (currentMcapUsd >= targetMcapUsd) {
      return 0;
    }
    
    // This is a simplified estimation
    // In reality, the bonding curve is non-linear
    const mcapRatio = targetMcapUsd / currentMcapUsd;
    const currentSol = Number(virtualSolReserves) / Number(LAMPORTS_PER_SOL);
    
    // Rough estimate: SOL needed increases with square root of mcap ratio
    // This is an approximation of the bonding curve behavior
    const estimatedSolNeeded = currentSol * (Math.sqrt(mcapRatio) - 1);
    
    return Math.max(0, estimatedSolNeeded);
  }

  /**
   * Enhanced format price for display (from BC calculator)
   */
  formatPrice(price: number, _decimals: number = 6): string {
    if (price === 0) return '$0';
    
    if (price >= 1) {
      return `$${price.toFixed(2)}`;
    } else if (price >= 0.01) {
      return `$${price.toFixed(4)}`;
    } else if (price >= 0.0001) {
      return `$${price.toFixed(6)}`;
    } else if (price >= 0.000001) {
      return `$${price.toFixed(8)}`;
    } else {
      // For very small prices, use scientific notation
      return `$${price.toExponential(4)}`;
    }
  }

  /**
   * Enhanced format market cap for display (from BC calculator)
   */
  formatMarketCap(mcap: number): string {
    if (mcap >= 1_000_000_000) {
      return `$${(mcap / 1_000_000_000).toFixed(2)}B`;
    } else if (mcap >= 1_000_000) {
      return `$${(mcap / 1_000_000).toFixed(2)}M`;
    } else if (mcap >= 1_000) {
      return `$${(mcap / 1_000).toFixed(2)}K`;
    } else {
      return `$${mcap.toFixed(0)}`;
    }
  }
}