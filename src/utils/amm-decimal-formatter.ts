/**
 * AMM Decimal Formatter Utility
 * Properly formats token amounts from raw values to human-readable format
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export interface TokenAmountFormatted {
  raw: string;
  formatted: number;
  display: string;
  decimals: number;
}

export interface PoolReservesFormatted {
  tokenReserves: TokenAmountFormatted;
  solReserves: TokenAmountFormatted;
  price: {
    pricePerTokenSol: number;
    pricePerTokenUsd: number;
    marketCapUsd: number;
  };
}

/**
 * Format token amount from raw to human readable
 */
export function formatTokenAmount(rawAmount: string | number | bigint, decimals: number = 6): TokenAmountFormatted {
  const raw = rawAmount.toString();
  const divisor = Math.pow(10, decimals);
  const formatted = Number(raw) / divisor;
  
  // Create display string with proper formatting
  const display = formatted.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  
  return {
    raw,
    formatted,
    display,
    decimals
  };
}

/**
 * Format SOL amount from lamports to SOL
 */
export function formatSolAmount(lamports: string | number | bigint): TokenAmountFormatted {
  const raw = lamports.toString();
  const formatted = Number(raw) / Number(LAMPORTS_PER_SOL);
  
  // SOL typically shown with 9 decimals
  const display = formatted.toFixed(9);
  
  return {
    raw,
    formatted,
    display,
    decimals: 9
  };
}

/**
 * Format pool reserves and calculate price
 */
export function formatPoolReserves(
  tokenReserves: string | number | bigint,
  solReserves: string | number | bigint,
  tokenDecimals: number = 6,
  solPriceUsd: number,
  tokenSupply: number = 1_000_000_000 // 1B default
): PoolReservesFormatted {
  const token = formatTokenAmount(tokenReserves, tokenDecimals);
  const sol = formatSolAmount(solReserves);
  
  // Calculate price per token
  const pricePerTokenSol = token.formatted > 0 ? sol.formatted / token.formatted : 0;
  const pricePerTokenUsd = pricePerTokenSol * solPriceUsd;
  const marketCapUsd = pricePerTokenUsd * tokenSupply;
  
  return {
    tokenReserves: token,
    solReserves: sol,
    price: {
      pricePerTokenSol,
      pricePerTokenUsd,
      marketCapUsd
    }
  };
}

/**
 * Format trade amounts from AMM events
 */
export function formatTradeAmounts(event: any, tokenDecimals: number = 6): {
  solAmount: TokenAmountFormatted;
  tokenAmount: TokenAmountFormatted;
  tradeType: 'buy' | 'sell';
} {
  let solAmount: TokenAmountFormatted;
  let tokenAmount: TokenAmountFormatted;
  let tradeType: 'buy' | 'sell';
  
  if (event.name === 'BuyEvent') {
    // Buy event: quote_amount_in is SOL, base_amount_out is tokens
    solAmount = formatSolAmount(event.data.quote_amount_in || event.data.quoteAmountIn);
    tokenAmount = formatTokenAmount(event.data.base_amount_out || event.data.baseAmountOut, tokenDecimals);
    tradeType = 'buy';
  } else if (event.name === 'SellEvent') {
    // Sell event: base_amount_in is tokens, quote_amount_out is SOL
    tokenAmount = formatTokenAmount(event.data.base_amount_in || event.data.baseAmountIn, tokenDecimals);
    solAmount = formatSolAmount(event.data.quote_amount_out || event.data.quoteAmountOut);
    tradeType = 'sell';
  } else {
    throw new Error(`Unknown event type: ${event.name}`);
  }
  
  return { solAmount, tokenAmount, tradeType };
}

/**
 * Create a formatted display string for a trade
 */
export function formatTradeDisplay(
  tradeType: 'buy' | 'sell',
  solAmount: TokenAmountFormatted,
  tokenAmount: TokenAmountFormatted,
  pricePerTokenUsd: number,
  mint: string,
  signature: string
): string {
  const action = tradeType === 'buy' ? 'Bought' : 'Sold';
  const tokenDisplay = tokenAmount.display;
  const solDisplay = solAmount.display;
  const priceDisplay = pricePerTokenUsd.toFixed(12);
  
  return `${action} ${tokenDisplay} tokens for ${solDisplay} SOL @ $${priceDisplay}/token
Mint: ${mint}
Tx: https://solscan.io/tx/${signature}`;
}

/**
 * Compare raw vs formatted amounts for debugging
 */
export function debugAmounts(
  rawTokenAmount: string,
  rawSolAmount: string,
  tokenDecimals: number = 6
): void {
  console.log('\n=== Amount Comparison ===');
  console.log('Token Amount:');
  console.log(`  Raw: ${rawTokenAmount}`);
  console.log(`  Formatted: ${Number(rawTokenAmount) / Math.pow(10, tokenDecimals)}`);
  console.log(`  Display: ${(Number(rawTokenAmount) / Math.pow(10, tokenDecimals)).toLocaleString('en-US')}`);
  
  console.log('\nSOL Amount:');
  console.log(`  Raw (lamports): ${rawSolAmount}`);
  console.log(`  Formatted: ${Number(rawSolAmount) / Number(LAMPORTS_PER_SOL)}`);
  console.log(`  Display: ${(Number(rawSolAmount) / Number(LAMPORTS_PER_SOL)).toFixed(9)} SOL`);
  console.log('========================\n');
}

/**
 * Validate decimal conversion
 */
export function validateDecimalConversion(
  displayAmount: string,
  expectedDecimals: number
): boolean {
  // Remove commas and parse
  const cleanAmount = displayAmount.replace(/,/g, '');
  const parts = cleanAmount.split('.');
  
  if (parts.length === 2) {
    // Check decimal places
    return parts[1].length <= expectedDecimals;
  }
  
  return true;
}

// Export example usage
export const EXAMPLE_USAGE = `
// Example: Format raw token amount
const rawTokenAmount = "162927136728";
const formatted = formatTokenAmount(rawTokenAmount, 6);
console.log(formatted.display); // "162,927.136728"

// Example: Format pool reserves
const reserves = formatPoolReserves(
  "162927136728", // token reserves
  "1234567890",   // sol reserves (lamports)
  6,              // token decimals
  150            // SOL price USD
);
console.log(reserves.price.pricePerTokenUsd); // Price per token in USD
`;