// src/monitor/types.ts

export interface TokenMetadata {
  decimals: number;
  totalSupply: number;
}

export interface NewToken {
  address: string;
  bondingCurve: string;
  creator: string;
  signature: string;
  timestamp: Date;
}

export interface PriceUpdate {
  token: string;
  price_sol: number;
  price_usd: number;
  liquidity_sol: number;
  liquidity_usd: number;
  market_cap_usd: number;
  bonding_complete: boolean;
  progress?: number;
}

export interface TradeEvent {
  mint: string;
  solAmount: number;
  tokenAmount: number;
  isBuy: boolean;
  user: string;
  virtual_token_reserves: number;
  virtual_sol_reserves: number;
  real_token_reserves: number;
  real_sol_reserves: number;
}

export interface ParsedInstruction {
  programId: string;
  name: string;
  data: any;
  accounts: Array<{
    pubkey: string;
    name: string;
  }>;
}

export interface ParsedTransaction {
  instructions: {
    pumpFunIxs: ParsedInstruction[];
    events: Array<{
      name: string;
      data: TradeEvent;
    }>;
  };
  transaction: any;
}

export interface FormattedTransaction {
  slot: number;
  signature: string;
  message: {
    header: any;
    accountKeys: string[];
    recentBlockhash: string;
    instructions: any[];
  };
  meta: any;
  version: string | number;
}

export interface MonitorStats {
  priceBufferSize: number;
  currentSolPrice: number;
  milestonesTracked: number;
  knownTokens: number;
  cachedMetadata: number;
}

export interface ProgressMilestone {
  token: string;
  milestone: number;
  progress: number;
  timestamp: Date;
}

export interface GraduationEvent {
  token: string;
  timestamp: Date;
}

export interface FlushEvent {
  count: number;
  updates: Array<{
    token: string;
    price_usd: number;
    market_cap_usd: number;
    liquidity_usd: number;
  }>;
}
