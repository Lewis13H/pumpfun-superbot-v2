import { struct, bool, u64 } from '@coral-xyz/borsh';

// Bonding curve account structure based on Shyft blog
export const BONDING_CURVE_LAYOUT = struct([
  u64('discriminator'),
  u64('virtualTokenReserves'),
  u64('virtualSolReserves'),
  u64('realTokenReserves'),
  u64('realSolReserves'),
  u64('tokenTotalSupply'),
  bool('complete'),
]);

export interface BondingCurveAccount {
  discriminator: bigint;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface BondingCurveData extends BondingCurveAccount {
  pubkey: string;
  mint?: string;
  progress: number;
  realSolInSol: number;
  virtualPriceInSol: number;
}

// Constants for progress calculation
export const BONDING_CURVE_TARGET_SOL = 85; // 85 SOL = 100% progress (migrates at ~86)
export const LAMPORTS_PER_SOL = 1e9;