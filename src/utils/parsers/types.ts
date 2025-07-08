/**
 * Common types for all parsers
 */

export enum EventType {
  BC_TRADE = 'bc_trade',
  AMM_TRADE = 'amm_trade',
  GRADUATION = 'graduation',
  POOL_CREATED = 'pool_created',
  RAYDIUM_SWAP = 'raydium_swap',
  RAYDIUM_LIQUIDITY = 'raydium_liquidity',
  AMM_LIQUIDITY_ADD = 'amm_liquidity_add',
  AMM_LIQUIDITY_REMOVE = 'amm_liquidity_remove',
  AMM_FEE_COLLECT = 'amm_fee_collect',
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
  tradeType: TradeType | string; // Allow string for 'buy'/'sell' compatibility
  mintAddress: string;
  userAddress: string;
  solAmount: bigint;
  tokenAmount: bigint;
  virtualSolReserves?: bigint; // Made optional - only available for BC trades
  virtualTokenReserves?: bigint; // Made optional - only available for BC trades
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
  // Additional fields for flexibility
  program?: string;
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
  programId?: string; // Program ID for event parsing
  meta?: any; // Transaction meta including inner instructions
  innerInstructions?: any[]; // Direct access to inner instructions
  preTokenBalances?: any[]; // Pre-transaction token balances
  postTokenBalances?: any[]; // Post-transaction token balances
}

export interface ParseStrategy {
  name?: string;
  canParse(context: ParseContext | any): boolean;
  parse(context: ParseContext | any, enhancedData?: any): ParsedEvent | ParsedEvent[] | TradeEvent | TradeEvent[] | null;
}