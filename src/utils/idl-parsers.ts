import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from 'fs';
import * as path from 'path';
import { fixIdlForAnchor } from "./idl-fixer";

// Load and fix IDLs
const pumpRawIdl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'idls', 'pump_0.1.0.json'), 'utf8'));
const ammRawIdl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'idls', 'pump_amm_0.1.0.json'), 'utf8'));

const pumpIdl = fixIdlForAnchor(pumpRawIdl);
const ammIdl = fixIdlForAnchor(ammRawIdl);

// Create coders
export const pumpAccountsCoder = new BorshAccountsCoder(pumpIdl);
export const ammAccountsCoder = new BorshAccountsCoder(ammIdl);

export interface ParsedBondingCurve {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface ParsedAmmPool {
  baseMint: string;
  quoteMint: string;
  baseReserves: bigint;
  quoteReserves: bigint;
  lpFeeNumerator: bigint;
  lpFeeDenominator: bigint;
  protocolFeeNumerator: bigint;
  protocolFeeDenominator: bigint;
  disableFlags: number;
}

export function parseBondingCurveAccount(data: Buffer): ParsedBondingCurve | null {
  try {
    // Try to decode as bondingCurve account
    const decoded = pumpAccountsCoder.decode('bondingCurve', data);
    
    return {
      virtualSolReserves: BigInt(decoded.virtualSolReserves.toString()),
      virtualTokenReserves: BigInt(decoded.virtualTokenReserves.toString()),
      realSolReserves: BigInt(decoded.realSolReserves.toString()),
      realTokenReserves: BigInt(decoded.realTokenReserves.toString()),
      tokenTotalSupply: BigInt(decoded.tokenTotalSupply.toString()),
      complete: decoded.complete
    };
  } catch (error) {
    console.error('Failed to parse bonding curve account:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function parseAmmPoolAccount(data: Buffer): ParsedAmmPool | null {
  try {
    // Try to decode as Pool account
    const decoded = ammAccountsCoder.decode('Pool', data);
    
    return {
      baseMint: decoded.baseMint.toString(),
      quoteMint: decoded.quoteMint.toString(),
      baseReserves: BigInt(decoded.baseReserves.toString()),
      quoteReserves: BigInt(decoded.quoteReserves.toString()),
      lpFeeNumerator: BigInt(decoded.lpFeeNumerator.toString()),
      lpFeeDenominator: BigInt(decoded.lpFeeDenominator.toString()),
      protocolFeeNumerator: BigInt(decoded.protocolFeeNumerator.toString()),
      protocolFeeDenominator: BigInt(decoded.protocolFeeDenominator.toString()),
      disableFlags: decoded.disableFlags
    };
  } catch (error) {
    console.error('Failed to parse AMM pool account:', error instanceof Error ? error.message : String(error));
    return null;
  }
}