/**
 * Enhanced AMM pool parser that handles the actual pump.swap pool structure
 */

import bs58 from 'bs58';

export interface ParsedAmmPoolV2 {
  discriminator: string;
  baseMint: string;
  quoteMint: string;
  baseReserves: bigint;
  quoteReserves: bigint;
  poolAddress: string;
}

/**
 * Parse pump.swap AMM pool accounts based on observed data patterns
 * 
 * Observed structure from test data:
 * - Discriminator: f19a6d0411b16dbc (8 bytes)
 * - Unknown byte (1 byte) - values like fe, ff, fd
 * - Padding (5 bytes of 00)
 * - Then pubkeys and other data
 */
export function parseAmmPoolAccountV2(data: Buffer, pubkey: any): ParsedAmmPoolV2 | null {
  try {
    if (data.length < 200) return null;
    
    let offset = 0;
    
    // Discriminator (8 bytes)
    const discriminator = data.slice(offset, offset + 8).toString('hex');
    offset += 8;
    
    // Only parse pool accounts (not GlobalConfig)
    if (discriminator !== 'f19a6d0411b16dbc') {
      return null;
    }
    
    // Skip unknown byte and padding (6 bytes total based on test data)
    offset += 6;
    
    // Now we should be at the first pubkey
    // The exact order might vary, but we'll try to parse pubkeys
    const pubkeys: string[] = [];
    
    // Try to extract 5-6 pubkeys (mints, vaults, authority)
    for (let i = 0; i < 6; i++) {
      if (offset + 32 <= data.length) {
        const pubkeyBytes = data.slice(offset, offset + 32);
        // Check if it looks like a valid pubkey (not all zeros)
        if (!pubkeyBytes.every(b => b === 0)) {
          pubkeys.push(bs58.encode(pubkeyBytes));
        }
        offset += 32;
      }
    }
    
    // After pubkeys, look for u64 values (reserves)
    const u64Values: bigint[] = [];
    
    // Scan for potential u64 values
    // Look for reasonable reserve values (likely in the range of millions to billions of lamports)
    const allU64Values: { offset: number, value: bigint }[] = [];
    
    // Scan through the entire buffer for u64 values
    for (let i = 140; i < Math.min(data.length - 8, 400); i += 8) {
      const value = data.readBigUInt64LE(i);
      
      // Look for values that could be reasonable reserves in lamports
      // Typically between 1 SOL (1e9) and 1M SOL (1e15)
      if (value > BigInt(1e8) && value < BigInt(1e16)) {
        allU64Values.push({ offset: i, value });
      }
    }
    
    // Try to find a pair of values that look like reserves
    // Usually the token reserves are larger than SOL reserves
    for (let i = 0; i < allU64Values.length - 1; i++) {
      const val1 = allU64Values[i];
      const val2 = allU64Values[i + 1];
      
      // Check if these could be a reserve pair
      // Often they're 8 bytes apart
      if (val2.offset - val1.offset === 8) {
        u64Values.push(val1.value);
        u64Values.push(val2.value);
        
        // Log for debugging
        console.log(`  Found potential reserve pair at offsets ${val1.offset}-${val2.offset}: ${val1.value} / ${val2.value}`);
        break;
      }
    }
    
    // Based on patterns, the first two u64s after pubkeys are often the reserves
    if (pubkeys.length >= 2 && u64Values.length >= 2) {
      // Heuristic: base reserves are usually larger than quote reserves for pump tokens
      // Or they might be in a specific order
      let baseReserves = u64Values[0];
      let quoteReserves = u64Values[1];
      
      // Additional heuristic: if the second value is much smaller and looks like SOL amount
      // (less than 1M SOL = 1e15 lamports), it's probably quote (SOL)
      if (u64Values[1] < BigInt(1e15) && u64Values[0] > u64Values[1]) {
        // Looks correct
      } else if (u64Values[0] < BigInt(1e15) && u64Values[1] > u64Values[0]) {
        // Swap them
        baseReserves = u64Values[1];
        quoteReserves = u64Values[0];
      }
      
      return {
        discriminator,
        baseMint: pubkeys[0] || 'Unknown',
        quoteMint: pubkeys[1] || 'Unknown', 
        baseReserves,
        quoteReserves,
        poolAddress: typeof pubkey === 'string' ? pubkey : bs58.encode(pubkey)
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing AMM pool account V2:', error);
    return null;
  }
}