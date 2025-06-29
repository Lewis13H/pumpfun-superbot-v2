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
  source: 'graphql';
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
  base_mint: string; // SOL mint
  quote_mint: string; // Token mint
  pool_base_token_account: string; // SOL reserves account
  pool_quote_token_account: string; // Token reserves account
  lp_supply: string;
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
  pump_fun_amm_Pool: AmmPoolData[];
}

export interface GetTokenAccountsResponse {
  spl_Account: TokenAccountData[];
}

export interface GetAmmPoolsWithReservesResponse {
  pools: AmmPoolWithReserves[];
}

export interface AmmPriceUpdate extends PriceUpdate {
  poolAddress: string;
  lpSupply: bigint;
  source: 'amm';
}