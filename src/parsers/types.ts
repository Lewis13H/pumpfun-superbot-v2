/**
 * Common types for all parsers
 */

export enum EventType {
  BC_TRADE = 'bc_trade',
  AMM_TRADE = 'amm_trade',
  GRADUATION = 'graduation',
  POOL_CREATED = 'pool_created',
  UNKNOWN = 'unknown'
}

export enum TradeType {
  BUY = 'buy',
  SELL = 'sell'
}

export interface BaseEvent {
  type: EventType;
  signature: string;
  slot: bigint;
  blockTime?: number;
  programId: string;
}

export interface TradeEvent extends BaseEvent {
  tradeType: TradeType;
  mintAddress: string;
  userAddress: string;
  solAmount: bigint;
  tokenAmount: bigint;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves?: bigint;
  realTokenReserves?: bigint;
  // Phase 1 additions
  innerInstructions?: number;
  tokenTransfers?: number;
  hasPoolCreation?: boolean;
  graduated?: boolean;
  migrationTx?: string;
  destinationType?: 'amm_pool' | 'raydium' | 'unknown';
  poolCreated?: boolean;
  poolAddress?: string;
  // Additional AMM properties
  priceUsd?: number;
  marketCapUsd?: number;
  volumeUsd?: number;
}

export interface BCTradeEvent extends TradeEvent {
  type: EventType.BC_TRADE;
  bondingCurveKey: string;
  vSolInBondingCurve: bigint;
  vTokenInBondingCurve: bigint;
  creator?: string; // Creator address from pump.fun bonding curve
  bondingCurveProgress?: number; // Progress percentage (0-100)
}

export interface AMMTradeEvent extends TradeEvent {
  type: EventType.AMM_TRADE;
  poolAddress: string;
  inputMint: string;
  inAmount: bigint;
  outputMint: string;
  outAmount: bigint;
}

export interface GraduationEvent extends BaseEvent {
  type: EventType.GRADUATION;
  mintAddress: string;
  bondingCurveKey: string;
  timestamp: number;
}

export interface PoolCreatedEvent extends BaseEvent {
  type: EventType.POOL_CREATED;
  poolAddress: string;
  mintAddress: string;
  lpMint: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
}

export type ParsedEvent = BCTradeEvent | AMMTradeEvent | GraduationEvent | PoolCreatedEvent;

export interface ParseContext {
  signature: string;
  slot: bigint;
  blockTime?: number;
  accounts: string[];
  logs: string[];
  data?: Buffer;
  accountKeys?: (string | Buffer)[];
  userAddress?: string;
  fullTransaction?: any; // Full gRPC transaction data for IDL parsing
}

export interface ParseStrategy {
  name: string;
  canParse(context: ParseContext): boolean;
  parse(context: ParseContext): ParsedEvent | null;
}