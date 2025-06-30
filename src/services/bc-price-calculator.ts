/**
 * Bonding Curve Price Calculator
 * This contains the CORRECT price calculation formulas that were working
 */

const LAMPORTS_PER_SOL = 1_000_000_000; // 1e9
const TOKEN_DECIMALS = 6;
const TOTAL_SUPPLY = 1_000_000_000; // 1B tokens

export interface PriceCalculationResult {
  priceInSol: number;
  priceInUsd: number;
  marketCapUsd: number;
  priceInLamports: number;
}

/**
 * Calculate token price from virtual reserves
 * THIS IS THE CORRECT FORMULA - DO NOT CHANGE
 */
export function calculateTokenPrice(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint,
  solPriceUsd: number = 180
): PriceCalculationResult {
  // Convert reserves to numbers with proper decimal handling
  const solReserves = Number(virtualSolReserves) / LAMPORTS_PER_SOL; // Convert lamports to SOL
  const tokenReserves = Number(virtualTokenReserves) / Math.pow(10, TOKEN_DECIMALS); // Apply token decimals
  
  if (solReserves === 0 || tokenReserves === 0) {
    return {
      priceInSol: 0,
      priceInUsd: 0,
      marketCapUsd: 0,
      priceInLamports: 0
    };
  }
  
  // Calculate price per token in SOL
  const priceInSol = solReserves / tokenReserves;
  
  // Calculate price in USD
  const priceInUsd = priceInSol * solPriceUsd;
  
  // Calculate market cap (price * total supply)
  const marketCapUsd = priceInUsd * TOTAL_SUPPLY;
  
  // Price in lamports (for legacy compatibility)
  const priceInLamports = priceInSol * LAMPORTS_PER_SOL;
  
  return {
    priceInSol,
    priceInUsd,
    marketCapUsd,
    priceInLamports
  };
}

/**
 * Calculate bonding curve progress percentage
 */
export function calculateBondingCurveProgress(virtualSolReserves: bigint): number {
  const solInCurve = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
  const GRADUATION_THRESHOLD = 85; // SOL
  return Math.min((solInCurve / GRADUATION_THRESHOLD) * 100, 100);
}

/**
 * Format price for display
 */
export function formatPrice(price: number): string {
  if (price === 0) return '$0';
  if (price < 0.000001) return `$${price.toExponential(2)}`;
  if (price < 1) return `$${price.toFixed(6)}`;
  if (price < 1000) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

/**
 * Format market cap for display
 */
export function formatMarketCap(marketCap: number): string {
  if (marketCap < 1000) return `$${marketCap.toFixed(2)}`;
  if (marketCap < 1_000_000) return `$${(marketCap / 1000).toFixed(1)}K`;
  if (marketCap < 1_000_000_000) return `$${(marketCap / 1_000_000).toFixed(1)}M`;
  return `$${(marketCap / 1_000_000_000).toFixed(1)}B`;
}

/**
 * Validate reserves are reasonable
 */
export function validateReserves(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): boolean {
  // Check for zero reserves
  if (virtualSolReserves === 0n || virtualTokenReserves === 0n) {
    return false;
  }
  
  // Check for extreme ratios
  const ratio = Number(virtualSolReserves) / Number(virtualTokenReserves);
  if (ratio < 1e-20 || ratio > 1e20) {
    return false;
  }
  
  return true;
}