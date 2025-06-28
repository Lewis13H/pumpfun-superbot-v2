/**
 * AMM Pool State Types
 * Defines interfaces for pump.swap AMM pool state tracking
 */

/**
 * Decoded pool account data from on-chain
 */
export interface AmmPoolAccount {
  poolAddress: string;
  poolBump: number;
  index: number;
  creator: string;
  baseMint: string;      // SOL in most cases
  quoteMint: string;     // The token being traded
  lpMint: string;        // LP token mint
  poolBaseTokenAccount: string;   // Pool's SOL account
  poolQuoteTokenAccount: string;  // Pool's token account
  lpSupply: number;      // Total LP tokens minted
  coinCreator: string;   // Original token creator
  slot: number;
}

/**
 * Pool reserves and calculated values
 */
export interface AmmPoolReserves {
  mintAddress: string;
  poolAddress: string;
  virtualSolReserves: number;     // SOL reserves in lamports
  virtualTokenReserves: number;   // Token reserves (with decimals)
  realSolReserves?: number;       // Actual SOL in pool account
  realTokenReserves?: number;     // Actual tokens in pool account
  lpSupply: number;               // Total LP tokens
  lastUpdateSlot: number;
  lastUpdateTime: Date;
}

/**
 * Calculated pool metrics
 */
export interface AmmPoolMetrics {
  mintAddress: string;
  poolAddress: string;
  pricePerTokenSol: number;       // SOL per token
  pricePerTokenUsd: number;       // USD per token
  marketCapUsd: number;           // Fully diluted market cap
  liquiditySol: number;           // Total SOL liquidity
  liquidityUsd: number;           // Total USD liquidity
  volume24hSol?: number;          // 24h volume in SOL
  volume24hUsd?: number;          // 24h volume in USD
  priceChange24h?: number;        // 24h price change percentage
}

/**
 * Complete pool state combining all data
 */
export interface AmmPoolState {
  account: AmmPoolAccount;
  reserves: AmmPoolReserves;
  metrics: AmmPoolMetrics;
  isActive: boolean;              // Whether pool is actively trading
  lastTradeAt?: Date;             // Last trade timestamp
}

/**
 * Pool state update event
 */
export interface PoolStateUpdate {
  type: 'account' | 'reserves' | 'trade';
  mintAddress: string;
  poolAddress: string;
  data: Partial<AmmPoolState>;
  slot: number;
  timestamp: Date;
}

/**
 * Token account data for reserve fetching
 */
export interface TokenAccountData {
  address: string;
  mint: string;
  owner: string;
  amount: number;
  decimals: number;
  slot: number;
}