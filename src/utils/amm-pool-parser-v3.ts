/**
 * Simple AMM pool parser based on observed data patterns
 * From debug analysis, reserves appear to be at offsets 168-176
 */

import bs58 from 'bs58';

export interface ParsedAmmPoolV3 {
  discriminator: string;
  baseMint: string;
  quoteMint: string;
  baseReserves: bigint;
  quoteReserves: bigint;
  poolAddress: string;
}

export function parseAmmPoolAccountV3(data: Buffer, pubkey: any): ParsedAmmPoolV3 | null {
  try {
    if (data.length < 184) return null; // Need at least 184 bytes
    
    // Discriminator (8 bytes)
    const discriminator = data.slice(0, 8).toString('hex');
    
    // Only parse pool accounts (f19a6d0411b16dbc)
    if (discriminator !== 'f19a6d0411b16dbc') {
      return null;
    }
    
    // Based on debug analysis:
    // - Many pubkeys in the beginning
    // - Reserves appear at offsets 168 and 176
    
    // Try to extract base and quote mints from early pubkeys
    // Usually after discriminator and some metadata
    let baseMint = 'Unknown';
    let quoteMint = 'Unknown';
    
    // Look for the native SOL mint in the pubkeys to identify quote mint
    for (let offset = 8; offset < 140; offset += 32) {
      if (offset + 32 <= data.length) {
        const pubkeyBytes = data.slice(offset, offset + 32);
        const pubkeyStr = bs58.encode(pubkeyBytes);
        
        // Check if this is the native SOL mint
        if (pubkeyStr === 'So11111111111111111111111111111111111111112') {
          quoteMint = pubkeyStr;
          // The other mint is likely the base mint, often before or after SOL mint
          if (offset >= 40) {
            baseMint = bs58.encode(data.slice(offset - 32, offset));
          }
          break;
        }
      }
    }
    
    // Read reserves at the observed offsets
    let baseReserves = BigInt(0);
    let quoteReserves = BigInt(0);
    
    if (data.length >= 184) {
      // These offsets were observed in the debug output
      const value1 = data.readBigUInt64LE(168);
      const value2 = data.readBigUInt64LE(176);
      
      // Heuristic: determine which is base and which is quote
      // Usually token reserves are larger than SOL reserves
      // But check if value2 looks like a reasonable SOL amount (< 1M SOL)
      if (value2 < BigInt(1e15)) { // Less than 1M SOL
        baseReserves = value1;
        quoteReserves = value2;
      } else if (value1 < BigInt(1e15)) {
        baseReserves = value2;
        quoteReserves = value1;
      } else {
        // Both large, use as is
        baseReserves = value1;
        quoteReserves = value2;
      }
    }
    
    return {
      discriminator,
      baseMint,
      quoteMint,
      baseReserves,
      quoteReserves,
      poolAddress: typeof pubkey === 'string' ? pubkey : bs58.encode(pubkey)
    };
  } catch (error) {
    console.error('Error parsing AMM pool account V3:', error);
    return null;
  }
}