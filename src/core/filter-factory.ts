/**
 * Filter Factory
 * Creates memcmp and datasize filters for account subscriptions
 */

import { PublicKey } from '@solana/web3.js';
import { SubscriptionFilter } from './subscription-builder';
import { Logger } from './logger';

export class FilterFactory {
  private static logger = new Logger({ context: 'FilterFactory' });

  /**
   * Create memcmp filter for exact byte match at offset
   */
  static memcmp(offset: number, bytes: Uint8Array | string): SubscriptionFilter {
    const filter: SubscriptionFilter = {
      memcmp: {
        offset,
        bytes: typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('base64')
      }
    };
    
    this.logger.debug('Created memcmp filter', { offset, bytesLength: bytes.length });
    return filter;
  }

  /**
   * Create datasize filter for accounts of specific size
   */
  static dataSize(size: number): SubscriptionFilter {
    const filter: SubscriptionFilter = {
      dataSize: size
    };
    
    this.logger.debug('Created datasize filter', { size });
    return filter;
  }

  /**
   * Create filter for bonding curve completion status
   */
  static bondingCurveComplete(isComplete: boolean): SubscriptionFilter {
    // Complete field is at offset 221 in bonding curve account
    const completeValue = isComplete ? 1 : 0;
    return this.memcmp(221, new Uint8Array([completeValue]));
  }

  /**
   * Create filter for specific mint address in bonding curve
   */
  static bondingCurveMint(mintAddress: string): SubscriptionFilter {
    // Mint field is at offset 64 in bonding curve account
    const mintPubkey = new PublicKey(mintAddress);
    return this.memcmp(64, mintPubkey.toBytes());
  }

  /**
   * Create filter for specific creator in bonding curve
   */
  static bondingCurveCreator(creatorAddress: string): SubscriptionFilter {
    // Creator field is at offset 32 in bonding curve account
    const creatorPubkey = new PublicKey(creatorAddress);
    return this.memcmp(32, creatorPubkey.toBytes());
  }

  /**
   * Create filter for bonding curves with minimum virtual reserves
   */
  static bondingCurveMinReserves(minSolReserves: bigint): SubscriptionFilter {
    // Virtual SOL reserves at offset 96 (8 bytes, little-endian)
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(minSolReserves);
    return this.memcmp(96, buffer);
  }

  /**
   * Create filter for AMM pool by mint
   */
  static ammPoolMint(mintAddress: string): SubscriptionFilter {
    // Token0 mint is at offset 8 in AMM pool account
    const mintPubkey = new PublicKey(mintAddress);
    return this.memcmp(8, mintPubkey.toBytes());
  }

  /**
   * Create filter for AMM pool by LP mint
   */
  static ammPoolLpMint(lpMintAddress: string): SubscriptionFilter {
    // LP mint is at offset 72 in AMM pool account
    const lpMintPubkey = new PublicKey(lpMintAddress);
    return this.memcmp(72, lpMintPubkey.toBytes());
  }

  /**
   * Create filter for active AMM pools (non-zero reserves)
   */
  static activeAmmPool(): SubscriptionFilter {
    // Check if reserves are non-zero
    // Reserve0 is at offset 104 (8 bytes)
    // This checks if first byte is non-zero (simple active check)
    return this.memcmp(104, new Uint8Array([1]));
  }

  /**
   * Create compound filter (combine multiple filters)
   */
  static compound(...filters: SubscriptionFilter[]): SubscriptionFilter[] {
    return filters.filter(f => f !== null);
  }

  /**
   * Create filter for accounts owned by specific program
   */
  static programOwned(_programId: string): SubscriptionFilter {
    // This is typically handled by the owner field in subscription, not memcmp
    // But we can create a placeholder
    this.logger.warn('Program ownership is handled by owner field, not filters');
    return {} as SubscriptionFilter;
  }

  /**
   * Create filter for token accounts with minimum balance
   */
  static tokenAccountMinBalance(minBalance: bigint): SubscriptionFilter {
    // Token account amount is at offset 64 (8 bytes, little-endian)
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(minBalance);
    return this.memcmp(64, buffer);
  }

  /**
   * Create filter for specific account discriminator (Anchor)
   */
  static anchorDiscriminator(discriminator: number[]): SubscriptionFilter {
    // Anchor discriminator is first 8 bytes
    return this.memcmp(0, new Uint8Array(discriminator));
  }

  /**
   * Helper to convert filters to subscription format
   */
  static toSubscriptionFormat(filters: SubscriptionFilter[]): any[] {
    return filters.map(filter => {
      if (filter.memcmp) {
        return {
          memcmp: {
            offset: filter.memcmp.offset.toString(),
            bytes: filter.memcmp.bytes
          }
        };
      }
      if (filter.dataSize !== undefined) {
        return {
          dataSize: filter.dataSize
        };
      }
      return null;
    }).filter(f => f !== null);
  }

  /**
   * Validate filter compatibility
   */
  static validateFilters(filters: SubscriptionFilter[]): boolean {
    // Check for conflicting filters
    const offsets = new Set<number>();
    
    for (const filter of filters) {
      if (filter.memcmp) {
        if (offsets.has(filter.memcmp.offset)) {
          this.logger.warn('Conflicting memcmp filters at same offset', {
            offset: filter.memcmp.offset
          });
          return false;
        }
        offsets.add(filter.memcmp.offset);
      }
    }
    
    // Check for multiple dataSize filters
    const dataSizeCount = filters.filter(f => f.dataSize !== undefined).length;
    if (dataSizeCount > 1) {
      this.logger.warn('Multiple dataSize filters not allowed');
      return false;
    }
    
    return true;
  }

  /**
   * Create optimized filter set for performance
   */
  static optimize(filters: SubscriptionFilter[]): SubscriptionFilter[] {
    // Sort by offset for better performance
    const sorted = [...filters].sort((a, b) => {
      const offsetA = a.memcmp?.offset ?? Number.MAX_VALUE;
      const offsetB = b.memcmp?.offset ?? Number.MAX_VALUE;
      return offsetA - offsetB;
    });
    
    // Remove duplicates
    const unique: SubscriptionFilter[] = [];
    const seen = new Set<string>();
    
    for (const filter of sorted) {
      const key = JSON.stringify(filter);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(filter);
      }
    }
    
    this.logger.debug('Optimized filters', {
      original: filters.length,
      optimized: unique.length
    });
    
    return unique;
  }
}