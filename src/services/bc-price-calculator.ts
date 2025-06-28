/**
 * Bonding Curve Price Calculator - Phase 3
 * 
 * Calculates accurate prices and market caps for pump.fun tokens
 * based on virtual reserves from the bonding curve.
 */

import { TOKEN_DECIMALS, LAMPORTS_PER_SOL, SUPPLY_1B } from '../utils/constants';

/**
 * Price calculation result
 */
export interface PriceResult {
  priceInSol: number;
  priceInUsd: number;
  marketCapSol: number;
  marketCapUsd: number;
  fullyDilutedMcapUsd: number;
}

/**
 * Calculate token price and market cap from virtual reserves
 * 
 * Price formula: virtualSolReserves / virtualTokenReserves
 * This gives us the price of 1 token in SOL
 * 
 * @param virtualSolReserves - Virtual SOL reserves in lamports
 * @param virtualTokenReserves - Virtual token reserves (with decimals)
 * @param solPriceUsd - Current SOL price in USD
 * @returns Price and market cap calculations
 */
export function calculateTokenPrice(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint,
  solPriceUsd: number
): PriceResult {
  // Convert reserves to numbers with proper decimal handling
  const solReserves = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
  const tokenReserves = Number(virtualTokenReserves) / Math.pow(10, TOKEN_DECIMALS);
  
  // Calculate price per token in SOL
  // Price = SOL reserves / Token reserves
  const priceInSol = solReserves / tokenReserves;
  
  // Convert to USD
  const priceInUsd = priceInSol * solPriceUsd;
  
  // Calculate market cap assuming 1B supply
  // Market cap = Price per token * Total supply
  const marketCapSol = priceInSol * SUPPLY_1B;
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
 * Calculate bonding curve progress percentage
 * 
 * Progress is based on SOL in the bonding curve:
 * - 30 SOL = 0% progress (starting point)
 * - 85 SOL = 100% progress (ready for graduation)
 * 
 * @param virtualSolReserves - Virtual SOL reserves in lamports
 * @returns Progress percentage (0-100)
 */
export function calculateBondingCurveProgress(virtualSolReserves: bigint): number {
  const solReserves = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
  
  // Bonding curve starts at 30 SOL and completes at 85 SOL
  const START_SOL = 30;
  const END_SOL = 85;
  const RANGE_SOL = END_SOL - START_SOL; // 55 SOL range
  
  // Calculate progress as percentage of the range
  const progress = ((solReserves - START_SOL) / RANGE_SOL) * 100;
  
  // Clamp between 0 and 100
  return Math.max(0, Math.min(progress, 100));
}

/**
 * Format price for display
 * 
 * @param price - Price in USD
 * @returns Formatted price string
 */
export function formatPrice(price: number): string {
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
 * Format market cap for display
 * 
 * @param mcap - Market cap in USD
 * @returns Formatted market cap string
 */
export function formatMarketCap(mcap: number): string {
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

/**
 * Calculate price impact of a trade
 * 
 * @param solAmount - SOL amount being traded
 * @param virtualSolReserves - Current virtual SOL reserves
 * @param isBuy - Whether this is a buy (true) or sell (false)
 * @returns Price impact as a percentage
 */
export function calculatePriceImpact(
  solAmount: bigint,
  virtualSolReserves: bigint,
  isBuy: boolean
): number {
  const amount = Number(solAmount) / LAMPORTS_PER_SOL;
  const reserves = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
  
  // Price impact formula: (amount / reserves) * 100
  // For buys, price goes up; for sells, price goes down
  const impact = (amount / reserves) * 100;
  
  return isBuy ? impact : -impact;
}

/**
 * Validate reserves are reasonable
 * 
 * @param virtualSolReserves - Virtual SOL reserves
 * @param virtualTokenReserves - Virtual token reserves
 * @returns true if reserves seem valid
 */
export function validateReserves(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): boolean {
  // Check for zero or negative values
  if (virtualSolReserves <= 0n || virtualTokenReserves <= 0n) {
    return false;
  }
  
  // Convert to SOL for validation
  const solReserves = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
  
  // Bonding curves typically have 30-85 SOL
  // Allow some margin for edge cases and potential slight overages
  if (solReserves < 25 || solReserves > 90) {
    return false;
  }
  
  // Token reserves should be reasonable (not too high or too low)
  const tokenReserves = Number(virtualTokenReserves) / Math.pow(10, TOKEN_DECIMALS);
  if (tokenReserves < 100_000 || tokenReserves > 2_000_000_000) {
    return false;
  }
  
  return true;
}

/**
 * Calculate estimated SOL needed to reach a target market cap
 * 
 * @param currentMcapUsd - Current market cap in USD
 * @param targetMcapUsd - Target market cap in USD
 * @param virtualSolReserves - Current virtual SOL reserves
 * @param virtualTokenReserves - Current virtual token reserves
 * @param solPriceUsd - Current SOL price in USD
 * @returns Estimated SOL needed
 */
export function calculateSolToTargetMcap(
  currentMcapUsd: number,
  targetMcapUsd: number,
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint,
  solPriceUsd: number
): number {
  if (currentMcapUsd >= targetMcapUsd) {
    return 0;
  }
  
  // This is a simplified estimation
  // In reality, the bonding curve is non-linear
  const mcapRatio = targetMcapUsd / currentMcapUsd;
  const currentSol = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
  
  // Rough estimate: SOL needed increases with square root of mcap ratio
  // This is an approximation of the bonding curve behavior
  const estimatedSolNeeded = currentSol * (Math.sqrt(mcapRatio) - 1);
  
  return Math.max(0, estimatedSolNeeded);
}