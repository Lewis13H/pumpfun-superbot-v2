/**
 * Trade data types
 */

export interface TradeData {
  signature: string;
  mint: string;
  user: string;
  side: 'buy' | 'sell';
  amountIn: string;
  amountOut: string;
  expectedAmountOut?: string;
  priceUsd?: number;
  volumeUsd?: number;
  timestamp: Date;
  slot: number;
  bondingCurveKey?: string;
  poolAddress?: string;
  solReserves?: string;
  tokenReserves?: string;
  bondingCurveProgress?: number;
  tradeFeeUsd?: number;
  program?: string;
}