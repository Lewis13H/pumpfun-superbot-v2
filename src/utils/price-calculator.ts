import { LAMPORTS_PER_SOL, TOKEN_DECIMALS, SUPPLY_1B } from './constants';

export interface PriceData {
  priceInSol: number;
  priceInUsd: number;
  mcapSol: number;
  mcapUsd: number;
}

export function calculatePrice(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint,
  solPriceUsd: number
): PriceData {
  // Convert reserves to numbers with proper decimals
  const sol = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
  const tokens = Number(virtualTokenReserves) / Math.pow(10, TOKEN_DECIMALS);
  
  // Calculate price per token
  const priceInSol = sol / tokens;
  const priceInUsd = priceInSol * solPriceUsd;
  
  // Calculate market cap (assuming 1B supply)
  const mcapSol = priceInSol * SUPPLY_1B;
  const mcapUsd = mcapSol * solPriceUsd;
  
  return {
    priceInSol,
    priceInUsd,
    mcapSol,
    mcapUsd
  };
}