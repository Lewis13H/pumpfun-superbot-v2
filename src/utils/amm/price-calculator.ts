/**
 * AMM Price Calculator
 * Implements accurate price calculations using the constant product formula
 * and handles price impact calculations for AMM Session 2
 */

import { AmmPoolReserves } from '../../types/amm-pool-state';
import { getSolPrice } from '../../services/pricing/sol-price-service';

export interface PriceCalculation {
  pricePerTokenSol: number;        // SOL per token
  pricePerTokenUsd: number;        // USD per token
  marketCapUsd: number;            // Fully diluted market cap
  liquiditySol: number;            // Total liquidity in SOL
  liquidityUsd: number;            // Total liquidity in USD
  fullyDilutedSupply: number;      // Total token supply
}

export interface PriceImpact {
  amountIn: number;                // Input amount
  amountOut: number;               // Output amount
  priceImpact: number;             // Price impact percentage
  executionPrice: number;          // Actual execution price
  spotPrice: number;               // Current spot price
  newSpotPrice: number;            // Spot price after trade
}

export class AmmPriceCalculator {
  private readonly SOL_DECIMALS = 9;
  private readonly TOKEN_DECIMALS = 6;
  private readonly FULLY_DILUTED_SUPPLY = 1_000_000_000; // 1B tokens
  
  /**
   * Calculate current prices and metrics from pool reserves
   */
  async calculatePrices(reserves: AmmPoolReserves): Promise<PriceCalculation> {
    // Validate reserves
    if (!reserves.virtualSolReserves || !reserves.virtualTokenReserves) {
      throw new Error('Invalid reserves: cannot calculate price with zero reserves');
    }
    
    // Convert reserves to proper decimals
    const solReserves = reserves.virtualSolReserves / Math.pow(10, this.SOL_DECIMALS);
    const tokenReserves = reserves.virtualTokenReserves / Math.pow(10, this.TOKEN_DECIMALS);
    
    // Calculate spot price using constant product formula
    // Price = SOL_reserves / Token_reserves
    const pricePerTokenSol = solReserves / tokenReserves;
    
    // Get current SOL price
    const solPriceUsd = await getSolPrice();
    const pricePerTokenUsd = pricePerTokenSol * solPriceUsd;
    
    // Calculate market cap
    const marketCapUsd = pricePerTokenUsd * this.FULLY_DILUTED_SUPPLY;
    
    // Calculate liquidity (2x one side for constant product AMM)
    const liquiditySol = solReserves * 2;
    const liquidityUsd = liquiditySol * solPriceUsd;
    
    return {
      pricePerTokenSol,
      pricePerTokenUsd,
      marketCapUsd,
      liquiditySol,
      liquidityUsd,
      fullyDilutedSupply: this.FULLY_DILUTED_SUPPLY,
    };
  }
  
  /**
   * Calculate price impact for a swap
   * Uses constant product formula: x * y = k
   */
  calculatePriceImpact(
    reserves: AmmPoolReserves,
    amountIn: number,
    isBuy: boolean  // true = buying tokens with SOL, false = selling tokens for SOL
  ): PriceImpact {
    // Convert reserves to proper decimals
    const solReserves = reserves.virtualSolReserves / Math.pow(10, this.SOL_DECIMALS);
    const tokenReserves = reserves.virtualTokenReserves / Math.pow(10, this.TOKEN_DECIMALS);
    
    // Current spot price
    const spotPrice = solReserves / tokenReserves;
    
    let amountOut: number;
    let newSolReserves: number;
    let newTokenReserves: number;
    
    if (isBuy) {
      // Buying tokens with SOL
      // Convert SOL input to proper decimals
      const solIn = amountIn;
      
      // Calculate output using constant product formula
      // dy = (y * dx) / (x + dx)
      const tokenOut = (tokenReserves * solIn) / (solReserves + solIn);
      amountOut = tokenOut;
      
      // New reserves after trade
      newSolReserves = solReserves + solIn;
      newTokenReserves = tokenReserves - tokenOut;
    } else {
      // Selling tokens for SOL
      // Convert token input to proper decimals
      const tokenIn = amountIn;
      
      // Calculate output using constant product formula
      // dx = (x * dy) / (y + dy)
      const solOut = (solReserves * tokenIn) / (tokenReserves + tokenIn);
      amountOut = solOut;
      
      // New reserves after trade
      newSolReserves = solReserves - solOut;
      newTokenReserves = tokenReserves + tokenIn;
    }
    
    // New spot price after trade
    const newSpotPrice = newSolReserves / newTokenReserves;
    
    // Execution price (total in / total out)
    const executionPrice = isBuy ? (amountIn / amountOut) : (amountOut / amountIn);
    
    // Price impact calculation
    // Impact = |executionPrice - spotPrice| / spotPrice * 100
    const priceImpact = Math.abs(executionPrice - spotPrice) / spotPrice * 100;
    
    return {
      amountIn,
      amountOut,
      priceImpact,
      executionPrice,
      spotPrice,
      newSpotPrice,
    };
  }
  
  /**
   * Calculate the constant K value for the pool
   */
  calculateConstantK(reserves: AmmPoolReserves): number {
    const solReserves = reserves.virtualSolReserves / Math.pow(10, this.SOL_DECIMALS);
    const tokenReserves = reserves.virtualTokenReserves / Math.pow(10, this.TOKEN_DECIMALS);
    return solReserves * tokenReserves;
  }
  
  /**
   * Validate if reserves maintain constant K after a trade
   * Useful for detecting issues or attacks
   */
  validateConstantK(
    reservesBefore: AmmPoolReserves,
    reservesAfter: AmmPoolReserves,
    tolerance: number = 0.001  // 0.1% tolerance for rounding
  ): boolean {
    const kBefore = this.calculateConstantK(reservesBefore);
    const kAfter = this.calculateConstantK(reservesAfter);
    
    const difference = Math.abs(kAfter - kBefore) / kBefore;
    return difference <= tolerance;
  }
  
  /**
   * Calculate slippage between expected and actual price
   */
  calculateSlippage(expectedPrice: number, actualPrice: number): number {
    return Math.abs(actualPrice - expectedPrice) / expectedPrice * 100;
  }
  
  /**
   * Format price for display
   */
  formatPrice(price: number, decimals: number = 6): string {
    if (price < 0.000001) {
      return price.toExponential(decimals);
    }
    return price.toFixed(decimals);
  }
  
  /**
   * Calculate price from a trade event
   * This is used when we have the actual trade amounts
   */
  calculatePriceFromTrade(
    solAmount: number,      // In lamports
    tokenAmount: number,    // With token decimals
    isBuy: boolean
  ): number {
    const solInSol = solAmount / Math.pow(10, this.SOL_DECIMALS);
    const tokenAdjusted = tokenAmount / Math.pow(10, this.TOKEN_DECIMALS);
    
    // Price = SOL / Tokens
    return isBuy ? (solInSol / tokenAdjusted) : (solInSol / tokenAdjusted);
  }
}

// Export singleton instance
export const ammPriceCalculator = new AmmPriceCalculator();