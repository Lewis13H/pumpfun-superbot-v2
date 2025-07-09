/**
 * Event Type Definitions
 * Strongly typed event interfaces for IDL-based parsing
 * Part of High Priority Week 1 implementation
 */

import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

/**
 * Pump.fun (Bonding Curve) Events
 */
export interface PumpFunEvents {
  /**
   * Token creation event when a new bonding curve is initialized
   */
  Create: {
    mint: PublicKey;
    bondingCurve: PublicKey;
    creator: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    decimals: number;
    bondingCurveType: number;
  };
  
  /**
   * Trade event when someone buys or sells on the bonding curve
   */
  Trade: {
    mint: PublicKey;
    trader: PublicKey;
    tokenAmount: BN;
    solAmount: BN;
    isBuy: boolean;
    virtualSolReserves: BN;
    virtualTokenReserves: BN;
    realSolReserves: BN;
    realTokenReserves: BN;
    bondingCurve: PublicKey;
  };
  
  /**
   * Completion/Graduation event when bonding curve reaches target
   */
  Complete: {
    mint: PublicKey;
    bondingCurve: PublicKey;
    virtualSolReserves: BN;
    virtualTokenReserves: BN;
    realSolReserves: BN;
    realTokenReserves: BN;
    timestamp: BN;
  };
  
  /**
   * Parameter update event
   */
  SetParams: {
    bondingCurve: PublicKey;
    buyFeeBps: number;
    sellFeeBps: number;
    targetSol: BN;
  };
}

/**
 * Pump.swap AMM Events
 */
export interface PumpSwapAMMEvents {
  /**
   * Pool initialization event
   */
  Initialize: {
    pool: PublicKey;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    baseVault: PublicKey;
    quoteVault: PublicKey;
    lpMint: PublicKey;
    fee: number;
    openTime: BN;
  };
  
  /**
   * Swap event (generic)
   */
  Swap: {
    pool: PublicKey;
    trader: PublicKey;
    inputMint: PublicKey;
    inputAmount: BN;
    outputMint: PublicKey;
    outputAmount: BN;
    inputVault: PublicKey;
    outputVault: PublicKey;
    poolBaseReserves: BN;
    poolQuoteReserves: BN;
  };
  
  /**
   * Buy event (quote to base)
   */
  Buy: {
    pool: PublicKey;
    trader: PublicKey;
    baseAmountOut: BN;
    quoteAmountIn: BN;
    poolBaseReserves: BN;
    poolQuoteReserves: BN;
    lpFee: BN;
    protocolFee: BN;
    userBaseAccount: PublicKey;
    userQuoteAccount: PublicKey;
  };
  
  /**
   * Sell event (base to quote)
   */
  Sell: {
    pool: PublicKey;
    trader: PublicKey;
    baseAmountIn: BN;
    quoteAmountOut: BN;
    poolBaseReserves: BN;
    poolQuoteReserves: BN;
    lpFee: BN;
    protocolFee: BN;
    userBaseAccount: PublicKey;
    userQuoteAccount: PublicKey;
  };
  
  /**
   * Add liquidity event
   */
  Deposit: {
    pool: PublicKey;
    provider: PublicKey;
    baseAmountIn: BN;
    quoteAmountIn: BN;
    lpTokensOut: BN;
    poolBaseReserves: BN;
    poolQuoteReserves: BN;
    lpSupply: BN;
    userBaseAccount: PublicKey;
    userQuoteAccount: PublicKey;
    userLpAccount: PublicKey;
  };
  
  /**
   * Remove liquidity event
   */
  Withdraw: {
    pool: PublicKey;
    provider: PublicKey;
    lpTokensIn: BN;
    baseAmountOut: BN;
    quoteAmountOut: BN;
    poolBaseReserves: BN;
    poolQuoteReserves: BN;
    lpSupply: BN;
    userBaseAccount: PublicKey;
    userQuoteAccount: PublicKey;
    userLpAccount: PublicKey;
  };
  
  /**
   * Pool creation event
   */
  CreatePool: {
    pool: PublicKey;
    creator: PublicKey;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    baseAmount: BN;
    quoteAmount: BN;
    lpTokensMinted: BN;
    openTime: BN;
  };
}

/**
 * Fee collection events
 */
export interface FeeEvents {
  /**
   * Creator fee collection
   */
  CollectCreatorFee: {
    pool: PublicKey;
    recipient: PublicKey;
    baseFeeAmount: BN;
    quoteFeeAmount: BN;
    timestamp: BN;
  };
  
  /**
   * Protocol fee collection
   */
  CollectProtocolFee: {
    pool: PublicKey;
    authority: PublicKey;
    baseFeeAmount: BN;
    quoteFeeAmount: BN;
    totalBaseFees: BN;
    totalQuoteFees: BN;
    timestamp: BN;
  };
  
  /**
   * LP fee accrual (implicit in swaps)
   */
  LpFeeAccrued: {
    pool: PublicKey;
    baseFeeAmount: BN;
    quoteFeeAmount: BN;
    fromSwap: PublicKey;
    timestamp: BN;
  };
}

/**
 * Combined event type for type safety
 */
export type PumpFunEvent = {
  [K in keyof PumpFunEvents]: {
    name: K;
    data: PumpFunEvents[K];
  };
}[keyof PumpFunEvents];

export type PumpSwapAMMEvent = {
  [K in keyof PumpSwapAMMEvents]: {
    name: K;
    data: PumpSwapAMMEvents[K];
  };
}[keyof PumpSwapAMMEvents];

export type FeeEvent = {
  [K in keyof FeeEvents]: {
    name: K;
    data: FeeEvents[K];
  };
}[keyof FeeEvents];

/**
 * Helper type guards
 */
export function isPumpFunEvent(event: any): event is PumpFunEvent {
  const validNames = ['Create', 'Trade', 'Complete', 'SetParams'];
  return event && validNames.includes(event.name);
}

export function isPumpSwapAMMEvent(event: any): event is PumpSwapAMMEvent {
  const validNames = ['Initialize', 'Swap', 'Buy', 'Sell', 'Deposit', 'Withdraw', 'CreatePool'];
  return event && validNames.includes(event.name);
}

export function isFeeEvent(event: any): event is FeeEvent {
  const validNames = ['CollectCreatorFee', 'CollectProtocolFee', 'LpFeeAccrued'];
  return event && validNames.includes(event.name);
}

/**
 * Event processing result
 */
export interface EventProcessingResult {
  success: boolean;
  eventsProcessed: number;
  errors: string[];
  metadata?: {
    programId: string;
    signature: string;
    slot: number;
    timestamp: number;
  };
}