/**
 * TypeScript types for GraphQL responses
 */

export interface BondingCurveData {
  pubkey: string; // This is the bonding curve address, not the token mint
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  realTokenReserves: string;
  tokenTotalSupply: string;
  complete: boolean;
  _updatedAt: string;
}

export interface GetBondingCurvesResponse {
  pump_BondingCurve: BondingCurveData[];
}

export interface PriceUpdate {
  mintAddress: string;
  priceInSol: number;
  priceInUsd: number;
  marketCapUsd: number;
  progress: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves?: bigint;
  realTokenReserves?: bigint;
  lastUpdated: Date;
  source: 'graphql' | 'amm';
}

export interface BulkPriceRecoveryResult {
  successful: PriceUpdate[];
  failed: FailedUpdate[];
  totalQueried: number;
  queryTime: number;
  graphqlQueries: number;
}

export interface FailedUpdate {
  mintAddress: string;
  reason: string;
  error?: Error;
}

export interface GraphQLError {
  message: string;
  extensions?: {
    code?: string;
    [key: string]: any;
  };
}

// AMM Pool Types
export interface AmmPoolData {
  pubkey: string;
  baseMint?: string; // SOL mint
  quoteMint?: string; // Token mint
  baseAccount: string; // SOL reserves account
  quoteAccount: string; // Token reserves account
  tokenMint: string; // Token mint address
  lpSupply: string;
  _updatedAt: string;
}

export interface TokenAccountData {
  pubkey: string;
  amount: string;
  mint: string;
  owner: string;
  _updatedAt: string;
}

export interface AmmPoolWithReserves extends AmmPoolData {
  baseReserves?: { amount: string }[];
  quoteReserves?: { amount: string }[];
}

export interface GetAmmPoolsResponse {
  pump_swap_LiquidityPool?: AmmPoolData[];
}

export interface GetTokenAccountsResponse {
  spl_Account: TokenAccountData[];
}

export interface GetAmmPoolsWithReservesResponse {
  pools: AmmPoolWithReserves[];
}

export interface AmmPriceUpdate extends Omit<PriceUpdate, 'source'> {
  poolAddress: string;
  lpSupply: bigint;
  source: 'amm';
}