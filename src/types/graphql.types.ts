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