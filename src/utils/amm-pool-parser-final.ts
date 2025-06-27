/**
 * Final AMM pool parser that looks for the most reasonable reserve values
 */

import bs58 from 'bs58';

export interface ParsedAmmPoolFinal {
  discriminator: string;
  baseMint: string;
  quoteMint: string;
  baseReserves: bigint;
  quoteReserves: bigint;
  poolAddress: string;
}

export function parseAmmPoolAccountFinal(data: Buffer, pubkey: any): ParsedAmmPoolFinal | null {
  try {
    if (data.length < 200) return null;
    
    // Discriminator (8 bytes)
    const discriminator = data.slice(0, 8).toString('hex');
    
    // Only parse pool accounts
    if (discriminator !== 'f19a6d0411b16dbc') {
      return null;
    }
    
    // Extract mints from early pubkeys
    let baseMint = 'Unknown';
    let quoteMint = 'Unknown';
    
    // Collect all potential u64 values with their offsets
    const u64Candidates: { offset: number, value: bigint }[] = [];
    
    // Scan the entire buffer for u64 values
    for (let offset = 140; offset < Math.min(data.length - 8, 300); offset += 8) {
      const value = data.readBigUInt64LE(offset);
      
      // Look for reasonable reserve amounts:
      // - More than 0.001 SOL (1e6 lamports) to filter out dust
      // - Less than 100K SOL (1e14 lamports) for SOL reserves
      // - Less than 100B tokens (1e20 smallest units) for token reserves
      if (value > BigInt(1e6) && value < BigInt(1e20)) {
        u64Candidates.push({ offset, value });
      }
    }
    
    // Look for the smallest consecutive pair of u64s that could be reserves
    // Reserves are often stored together
    let bestBaseReserves = BigInt(0);
    let bestQuoteReserves = BigInt(0);
    let lowestSum = BigInt('18446744073709551615'); // Max uint64
    
    for (let i = 0; i < u64Candidates.length - 1; i++) {
      const val1 = u64Candidates[i];
      const val2 = u64Candidates[i + 1];
      
      // Check if they're consecutive (8 bytes apart)
      if (val2.offset - val1.offset === 8) {
        // Calculate sum to find the smallest reasonable pair
        const sum = val1.value + val2.value;
        
        // Additional heuristics:
        // - Both values should be reasonable (not too large)
        // - The smaller value is likely SOL (usually < 10K SOL = 1e13 lamports)
        const smallerValue = val1.value < val2.value ? val1.value : val2.value;
        
        if (smallerValue < BigInt(1e13) && sum < lowestSum) {
          // This looks like a better candidate
          lowestSum = sum;
          
          // The smaller value is likely quote (SOL)
          if (val1.value < val2.value) {
            bestQuoteReserves = val1.value;
            bestBaseReserves = val2.value;
          } else {
            bestQuoteReserves = val2.value;
            bestBaseReserves = val1.value;
          }
          
          console.log(`  Better reserve candidate at ${val1.offset}-${val2.offset}: ${bestBaseReserves} tokens / ${bestQuoteReserves} SOL`);
        }
      }
    }
    
    // If we didn't find a good pair, try individual values
    if (bestBaseReserves === BigInt(0) && u64Candidates.length >= 2) {
      // Find the two smallest values that could be reserves
      const sorted = [...u64Candidates].sort((a, b) => 
        Number(a.value - b.value)
      );
      
      // Take the two smallest reasonable values
      for (let i = 0; i < sorted.length && i < 10; i++) {
        const candidate = sorted[i];
        if (candidate.value > BigInt(1e8) && candidate.value < BigInt(1e13)) {
          // This could be SOL reserves
          if (bestQuoteReserves === BigInt(0)) {
            bestQuoteReserves = candidate.value;
          }
        } else if (candidate.value > BigInt(1e12) && candidate.value < BigInt(1e18)) {
          // This could be token reserves  
          if (bestBaseReserves === BigInt(0)) {
            bestBaseReserves = candidate.value;
          }
        }
        
        if (bestBaseReserves !== BigInt(0) && bestQuoteReserves !== BigInt(0)) {
          break;
        }
      }
    }
    
    return {
      discriminator,
      baseMint,
      quoteMint,
      baseReserves: bestBaseReserves,
      quoteReserves: bestQuoteReserves,
      poolAddress: typeof pubkey === 'string' ? pubkey : bs58.encode(pubkey)
    };
  } catch (error) {
    console.error('Error parsing AMM pool account final:', error);
    return null;
  }
}