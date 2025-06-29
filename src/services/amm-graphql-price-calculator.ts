/**
 * AMM Price Calculator for GraphQL Data
 * Calculates prices from AMM pool reserves using constant product formula
 */

import { AmmPoolData, TokenAccountData } from '../types/graphql.types';

export interface AmmPriceResult {
  priceInSol: number;
  priceInUsd: number;
  marketCapUsd: number;
  poolLiquidityUsd: number;
}

/**
 * Calculate token price from AMM pool reserves
 * Uses constant product formula: price = reserveSOL / reserveToken
 */
export function calculateAmmTokenPrice(
  solReserves: bigint,
  tokenReserves: bigint,
  solPriceUsd: number
): AmmPriceResult {
  // Handle edge cases
  if (tokenReserves === 0n || solReserves === 0n) {
    return {
      priceInSol: 0,
      priceInUsd: 0,
      marketCapUsd: 0,
      poolLiquidityUsd: 0,
    };
  }
  
  // Calculate price in SOL (SOL per token)
  // Price = SOL reserves / Token reserves
  const priceInSol = Number(solReserves) / Number(tokenReserves);
  
  // Calculate price in USD
  const priceInUsd = priceInSol * solPriceUsd;
  
  // Calculate market cap (assuming 1B token supply as standard)
  const TOTAL_SUPPLY = 1_000_000_000;
  const marketCapUsd = priceInUsd * TOTAL_SUPPLY;
  
  // Calculate pool liquidity (2x SOL value as it's balanced)
  const solValueUsd = (Number(solReserves) / 1e9) * solPriceUsd;
  const poolLiquidityUsd = solValueUsd * 2;
  
  return {
    priceInSol,
    priceInUsd,
    marketCapUsd,
    poolLiquidityUsd,
  };
}

/**
 * Calculate price impact for a given trade size
 */
export function calculatePriceImpact(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  isBuy: boolean
): number {
  // For buys: SOL in, tokens out
  // For sells: tokens in, SOL out
  const actualReserveIn = isBuy ? reserveIn : reserveOut;
  const actualReserveOut = isBuy ? reserveOut : reserveIn;
  
  // Calculate amount out using constant product formula
  const amountInWithFee = amountIn * 997n / 1000n; // 0.3% fee
  const numerator = amountInWithFee * actualReserveOut;
  const denominator = actualReserveIn + amountInWithFee;
  const amountOut = numerator / denominator;
  
  // Calculate price before and after
  const priceBefore = Number(actualReserveIn) / Number(actualReserveOut);
  const priceAfter = Number(actualReserveIn + amountIn) / Number(actualReserveOut - amountOut);
  
  // Price impact percentage
  const priceImpact = ((priceAfter - priceBefore) / priceBefore) * 100;
  
  return Math.abs(priceImpact);
}

/**
 * Parse reserves from GraphQL response
 */
export function parseReserves(
  baseReserves?: { amount: string }[],
  quoteReserves?: { amount: string }[]
): { solReserves: bigint; tokenReserves: bigint } | null {
  if (!baseReserves?.length || !quoteReserves?.length) {
    return null;
  }
  
  try {
    const solReserves = BigInt(baseReserves[0].amount);
    const tokenReserves = BigInt(quoteReserves[0].amount);
    
    return { solReserves, tokenReserves };
  } catch (error) {
    console.error('Error parsing reserves:', error);
    return null;
  }
}

/**
 * Validate AMM pool data
 */
export function isValidAmmPool(pool: AmmPoolData): boolean {
  return (
    pool.pool_base_token_account &&
    pool.pool_quote_token_account &&
    pool.quote_mint &&
    pool.lp_supply !== '0'
  );
}

/**
 * Format pool liquidity for display
 */
export function formatPoolLiquidity(liquidityUsd: number): string {
  if (liquidityUsd >= 1_000_000) {
    return `$${(liquidityUsd / 1_000_000).toFixed(2)}M`;
  } else if (liquidityUsd >= 1_000) {
    return `$${(liquidityUsd / 1_000).toFixed(2)}K`;
  } else {
    return `$${liquidityUsd.toFixed(2)}`;
  }
}