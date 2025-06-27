/**
 * Correct AMM pool parser based on the actual IDL structure
 * The Pool account doesn't store reserves - it stores token account addresses
 */

import bs58 from 'bs58';

export interface ParsedAmmPoolCorrect {
  discriminator: string;
  poolBump: number;
  index: number;
  creator: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  poolBaseTokenAccount: string;
  poolQuoteTokenAccount: string;
  lpSupply: bigint;
  poolAddress: string;
}

export function parseAmmPoolAccountCorrect(data: Buffer, pubkey: any): ParsedAmmPoolCorrect | null {
  try {
    // Pool account is 211 bytes (8 discriminator + 203 data)
    if (data.length < 211) return null;
    
    let offset = 0;
    
    // Discriminator (8 bytes)
    const discriminator = data.slice(offset, offset + 8).toString('hex');
    offset += 8;
    
    // Pool discriminator: f19a6d0411b16dbc
    if (discriminator !== 'f19a6d0411b16dbc') {
      return null;
    }
    
    // pool_bump: u8 (1 byte)
    const poolBump = data.readUInt8(offset);
    offset += 1;
    
    // index: u16 (2 bytes)
    const index = data.readUInt16LE(offset);
    offset += 2;
    
    // creator: Pubkey (32 bytes)
    const creator = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // base_mint: Pubkey (32 bytes)
    const baseMint = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // quote_mint: Pubkey (32 bytes)
    const quoteMint = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // lp_mint: Pubkey (32 bytes)
    const lpMint = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // pool_base_token_account: Pubkey (32 bytes)
    const poolBaseTokenAccount = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // pool_quote_token_account: Pubkey (32 bytes)
    const poolQuoteTokenAccount = bs58.encode(data.slice(offset, offset + 32));
    offset += 32;
    
    // lp_supply: u64 (8 bytes)
    const lpSupply = data.readBigUInt64LE(offset);
    
    return {
      discriminator,
      poolBump,
      index,
      creator,
      baseMint,
      quoteMint,
      lpMint,
      poolBaseTokenAccount,
      poolQuoteTokenAccount,
      lpSupply,
      poolAddress: typeof pubkey === 'string' ? pubkey : bs58.encode(pubkey)
    };
  } catch (error) {
    console.error('Error parsing AMM pool account correct:', error);
    return null;
  }
}