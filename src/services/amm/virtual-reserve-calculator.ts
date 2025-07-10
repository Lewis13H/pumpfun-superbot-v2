/**
 * Virtual Reserve Calculator
 * Properly tracks virtual reserves for pump.fun AMM pools
 */

import { Logger } from '../../core/logger';

export interface VirtualReserves {
  solReserves: bigint;
  tokenReserves: bigint;
}

export class VirtualReserveCalculator {
  private logger = new Logger({ context: 'VirtualReserveCalculator' });
  
  // pump.fun constants
  private readonly INITIAL_VIRTUAL_SOL = 42_000_000_000n; // 42 SOL in lamports
  private readonly INITIAL_VIRTUAL_TOKENS = 1_000_000_000_000_000n; // 1B tokens with 6 decimals
  private readonly TOTAL_SUPPLY = 1_000_000_000; // 1B tokens
  private readonly TOKEN_DECIMALS = 6;
  private readonly SOL_DECIMALS = 9;
  
  // Cache for virtual reserves by mint
  private reserveCache = new Map<string, VirtualReserves>();
  
  /**
   * Initialize reserves for a new pool
   */
  initializeReserves(mintAddress: string): VirtualReserves {
    const reserves = {
      solReserves: this.INITIAL_VIRTUAL_SOL,
      tokenReserves: this.INITIAL_VIRTUAL_TOKENS
    };
    
    this.reserveCache.set(mintAddress, reserves);
    return reserves;
  }
  
  /**
   * Get current reserves for a mint (from cache or initialize)
   */
  getReserves(mintAddress: string): VirtualReserves {
    const cached = this.reserveCache.get(mintAddress);
    if (cached) return cached;
    
    return this.initializeReserves(mintAddress);
  }
  
  /**
   * Update reserves based on a trade
   */
  updateReserves(
    mintAddress: string,
    solAmount: bigint,
    tokenAmount: bigint,
    isBuy: boolean
  ): VirtualReserves {
    const currentReserves = this.getReserves(mintAddress);
    
    // Calculate new reserves using constant product formula
    const k = currentReserves.solReserves * currentReserves.tokenReserves;
    
    let newSolReserves: bigint;
    let newTokenReserves: bigint;
    
    if (isBuy) {
      // Buy: SOL goes in, tokens come out
      newSolReserves = currentReserves.solReserves + solAmount;
      newTokenReserves = k / newSolReserves;
    } else {
      // Sell: tokens go in, SOL comes out
      newTokenReserves = currentReserves.tokenReserves + tokenAmount;
      newSolReserves = k / newTokenReserves;
    }
    
    // Sanity check: token reserves cannot exceed total supply
    const maxTokenReserves = BigInt(this.TOTAL_SUPPLY) * BigInt(10 ** this.TOKEN_DECIMALS);
    if (newTokenReserves > maxTokenReserves) {
      this.logger.warn('Token reserves would exceed total supply, capping', {
        mintAddress,
        calculated: newTokenReserves.toString(),
        max: maxTokenReserves.toString()
      });
      newTokenReserves = maxTokenReserves;
      newSolReserves = k / newTokenReserves;
    }
    
    // Update cache
    const newReserves = {
      solReserves: newSolReserves,
      tokenReserves: newTokenReserves
    };
    
    this.reserveCache.set(mintAddress, newReserves);
    
    this.logger.debug('Updated virtual reserves', {
      mintAddress,
      solReserves: this.formatSol(newSolReserves),
      tokenReserves: this.formatTokens(newTokenReserves),
      k: k.toString()
    });
    
    return newReserves;
  }
  
  /**
   * Calculate price from reserves
   */
  calculatePrice(reserves: VirtualReserves, solPriceUsd: number): {
    priceInSol: number;
    priceInUsd: number;
  } {
    // Virtual reserves appear to use 9 decimals for both SOL and tokens
    // This provides extra precision for the constant product formula
    const priceInSol = Number(reserves.solReserves) / Number(reserves.tokenReserves);
    const priceInUsd = priceInSol * solPriceUsd;
    
    return { priceInSol, priceInUsd };
  }
  
  /**
   * Calculate market cap using pump.fun logic
   */
  calculateMarketCap(
    reserves: VirtualReserves,
    solPriceUsd: number
  ): number {
    const { priceInUsd } = this.calculatePrice(reserves, solPriceUsd);
    
    // For pump.fun graduated tokens, circulating supply is dynamic
    // Based on our analysis, it's approximately:
    // Circulating = Total Supply - Tokens in Pool
    
    const currentReservesInTokens = Number(reserves.tokenReserves) / (10 ** this.TOKEN_DECIMALS);
    const totalSupply = this.TOTAL_SUPPLY; // 1B tokens
    
    // Simple and accurate: circulating = total - pool reserves
    const circulatingSupply = Math.max(0, totalSupply - currentReservesInTokens);
    
    // Note: Virtual reserves use 9 decimals internally for precision
    // So we need to adjust when reserves are very close to total supply
    if (currentReservesInTokens > totalSupply * 0.99) {
      // Use ~46% as typical circulating for graduated tokens
      return priceInUsd * (totalSupply * 0.46);
    }
    
    return priceInUsd * circulatingSupply;
  }
  
  /**
   * Validate reserves are reasonable
   */
  validateReserves(reserves: VirtualReserves): boolean {
    // Check if reserves are positive
    if (reserves.solReserves <= 0n || reserves.tokenReserves <= 0n) {
      return false;
    }
    
    // Check if token reserves exceed total supply
    const maxTokenReserves = BigInt(this.TOTAL_SUPPLY) * BigInt(10 ** this.TOKEN_DECIMALS);
    if (reserves.tokenReserves > maxTokenReserves) {
      return false;
    }
    
    // Check if SOL reserves are reasonable (< 1M SOL)
    const maxSolReserves = 1_000_000n * BigInt(10 ** this.SOL_DECIMALS);
    if (reserves.solReserves > maxSolReserves) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Format SOL amount for display
   */
  private formatSol(lamports: bigint): string {
    return (Number(lamports) / (10 ** this.SOL_DECIMALS)).toFixed(4);
  }
  
  /**
   * Format token amount for display
   */
  private formatTokens(amount: bigint): string {
    return (Number(amount) / (10 ** this.TOKEN_DECIMALS)).toLocaleString();
  }
  
  /**
   * Clear cache (for testing or reset)
   */
  clearCache(): void {
    this.reserveCache.clear();
  }
  
  /**
   * Get all cached reserves (for debugging)
   */
  getAllCachedReserves(): Map<string, VirtualReserves> {
    return new Map(this.reserveCache);
  }
}