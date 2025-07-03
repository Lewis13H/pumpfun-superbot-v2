/**
 * Custom AMM Pool Account Decoder
 * Decodes pump.swap AMM pool accounts without using BorshAccountsCoder
 */

import { PublicKey } from '@solana/web3.js';
import * as borsh from '@coral-xyz/borsh';

/**
 * Pool account structure based on IDL
 */
export interface PoolAccount {
  poolBump: number;
  index: number;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  lpMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  lpSupply: bigint;
  coinCreator: PublicKey;
}

/**
 * Pool account layout for Borsh deserialization
 */
const POOL_LAYOUT = borsh.struct([
  borsh.u8('poolBump'),
  borsh.u16('index'),
  borsh.publicKey('creator'),
  borsh.publicKey('baseMint'),
  borsh.publicKey('quoteMint'),
  borsh.publicKey('lpMint'),
  borsh.publicKey('poolBaseTokenAccount'),
  borsh.publicKey('poolQuoteTokenAccount'),
  borsh.u64('lpSupply'),
  borsh.publicKey('coinCreator'),
]);

/**
 * Decode AMM pool account data
 */
export function decodePoolAccount(data: Buffer): PoolAccount | null {
  try {
    // Skip discriminator (8 bytes)
    const accountData = data.slice(8);
    
    // Decode using borsh
    const decoded = POOL_LAYOUT.decode(accountData);
    
    return {
      poolBump: decoded.poolBump,
      index: decoded.index,
      creator: decoded.creator,
      baseMint: decoded.baseMint,
      quoteMint: decoded.quoteMint,
      lpMint: decoded.lpMint,
      poolBaseTokenAccount: decoded.poolBaseTokenAccount,
      poolQuoteTokenAccount: decoded.poolQuoteTokenAccount,
      lpSupply: decoded.lpSupply,
      coinCreator: decoded.coinCreator,
    };
  } catch (error) {
    console.error('Failed to decode pool account:', error);
    return null;
  }
}

/**
 * Convert pool account to plain object with string addresses
 */
export function poolAccountToPlain(pool: PoolAccount) {
  return {
    poolBump: pool.poolBump,
    index: pool.index,
    creator: pool.creator.toBase58(),
    baseMint: pool.baseMint.toBase58(),
    quoteMint: pool.quoteMint.toBase58(),
    lpMint: pool.lpMint.toBase58(),
    poolBaseTokenAccount: pool.poolBaseTokenAccount.toBase58(),
    poolQuoteTokenAccount: pool.poolQuoteTokenAccount.toBase58(),
    lpSupply: pool.lpSupply.toString(),
    coinCreator: pool.coinCreator.toBase58(),
  };
}