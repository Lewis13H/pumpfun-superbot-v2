/**
 * Manual account parsers that don't rely on BorshAccountsCoder
 * These directly parse the binary data based on known account structures
 */

import bs58 from 'bs58';

// Pump.fun Bonding Curve Account Structure
export interface ParsedBondingCurve {
  discriminator: string;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

// Pump.swap AMM Pool Account Structure  
export interface ParsedAmmPool {
  discriminator: string;
  baseMint: string;
  quoteMint: string;
  poolAuthority: string;
  baseVault: string;
  quoteVault: string;
  baseReserves: bigint;
  quoteReserves: bigint;
  lpFeeNumerator: bigint;
  lpFeeDenominator: bigint;
  protocolFeeNumerator: bigint;
  protocolFeeDenominator: bigint;
  disableFlags: number;
}

export function parseBondingCurveAccountManual(data: Buffer): ParsedBondingCurve | null {
  try {
    if (data.length < 89) return null; // Minimum size for bonding curve
    
    let offset = 0;
    
    // Discriminator (8 bytes)
    const discriminator = data.slice(offset, offset + 8).toString('hex');
    offset += 8;
    
    // Based on the pump.fun IDL and testing:
    // virtual_token_reserves: u64
    const virtualTokenReserves = data.readBigUInt64LE(offset);
    offset += 8;
    
    // virtual_sol_reserves: u64
    const virtualSolReserves = data.readBigUInt64LE(offset);
    offset += 8;
    
    // real_token_reserves: u64
    const realTokenReserves = data.readBigUInt64LE(offset);
    offset += 8;
    
    // real_sol_reserves: u64
    const realSolReserves = data.readBigUInt64LE(offset);
    offset += 8;
    
    // token_total_supply: u64
    const tokenTotalSupply = data.readBigUInt64LE(offset);
    offset += 8;
    
    // complete: bool (1 byte)
    const complete = data[offset] === 1;
    
    return {
      discriminator,
      virtualTokenReserves,
      virtualSolReserves,
      realTokenReserves,
      realSolReserves,
      tokenTotalSupply,
      complete
    };
  } catch (error) {
    console.error('Error parsing bonding curve account:', error);
    return null;
  }
}

export function parseAmmPoolAccountManual(data: Buffer): ParsedAmmPool | null {
  try {
    if (data.length < 200) return null; // Minimum size for AMM pool
    
    let offset = 0;
    
    // Discriminator (8 bytes)
    const discriminator = data.slice(offset, offset + 8).toString('hex');
    offset += 8;
    
    // Pool discriminator: f19a6d0411b16dbc
    // GlobalConfig discriminator: 95089ccaa0fcb0d9
    if (discriminator === '95089ccaa0fcb0d9') {
      // This is a GlobalConfig account, not a pool
      return null;
    }
    
    // Based on typical AMM pool structure:
    // base_mint: Pubkey (32 bytes)
    const baseMint = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // quote_mint: Pubkey (32 bytes)
    const quoteMint = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // pool_authority: Pubkey (32 bytes)
    const poolAuthority = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // base_vault: Pubkey (32 bytes)
    const baseVault = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // quote_vault: Pubkey (32 bytes)
    const quoteVault = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // base_reserves: u64
    const baseReserves = data.readBigUInt64LE(offset);
    offset += 8;
    
    // quote_reserves: u64
    const quoteReserves = data.readBigUInt64LE(offset);
    offset += 8;
    
    // lp_fee_numerator: u64
    const lpFeeNumerator = data.readBigUInt64LE(offset);
    offset += 8;
    
    // lp_fee_denominator: u64
    const lpFeeDenominator = data.readBigUInt64LE(offset);
    offset += 8;
    
    // protocol_fee_numerator: u64
    const protocolFeeNumerator = data.readBigUInt64LE(offset);
    offset += 8;
    
    // protocol_fee_denominator: u64
    const protocolFeeDenominator = data.readBigUInt64LE(offset);
    offset += 8;
    
    // disable_flags: u8
    const disableFlags = data[offset];
    
    return {
      discriminator,
      baseMint,
      quoteMint,
      poolAuthority,
      baseVault,
      quoteVault,
      baseReserves,
      quoteReserves,
      lpFeeNumerator,
      lpFeeDenominator,
      protocolFeeNumerator,
      protocolFeeDenominator,
      disableFlags
    };
  } catch (error) {
    console.error('Error parsing AMM pool account:', error);
    return null;
  }
}