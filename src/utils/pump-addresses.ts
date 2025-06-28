/**
 * Pump.fun Address Utilities
 * Derives bonding curve addresses from token mints
 */

import { PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM } from './constants';

/**
 * Derive bonding curve PDA from token mint
 * @param tokenMint - The token mint address
 * @returns The bonding curve PDA
 */
export function deriveBondingCurveAddress(tokenMint: string | PublicKey): PublicKey {
  const mintPubkey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
  const programId = new PublicKey(PUMP_PROGRAM);
  
  // Pump.fun uses "bonding-curve" as seed with the token mint
  const [bondingCurvePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('bonding-curve'),
      mintPubkey.toBuffer()
    ],
    programId
  );
  
  return bondingCurvePda;
}

/**
 * Derive multiple bonding curve addresses
 * @param tokenMints - Array of token mint addresses
 * @returns Map of mint -> bonding curve address
 */
export function deriveBondingCurveAddresses(tokenMints: string[]): Map<string, string> {
  const addressMap = new Map<string, string>();
  
  for (const mint of tokenMints) {
    try {
      const bondingCurve = deriveBondingCurveAddress(mint);
      addressMap.set(mint, bondingCurve.toBase58());
    } catch (error) {
      console.error(`Failed to derive bonding curve for ${mint}:`, error);
    }
  }
  
  return addressMap;
}