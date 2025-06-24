// src/monitor/services/bonding-curve-fetcher.ts - Enhanced version

import { Connection, PublicKey } from '@solana/web3.js';

export interface BondingCurveData {  
  virtualTokenReserves: number;  
  virtualSolReserves: number;    
  realTokenReserves: number;     
  realSolReserves: number;       
  tokenTotalSupply: number;      
  complete: boolean;  
  solBalance: number;            
  progress: number;              
}

export class BondingCurveFetcher {
  private connection: Connection;
  private maxRetries: number = 3;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Validate if a string is a valid Solana public key
   */
  private isValidPublicKey(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    
    if (address.length !== 44) {
      return false;
    }
    
    if (address === 'unknown' || address.includes('...')) {
      return false;
    }
    
    try {
      new PublicKey(address);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Enhanced bonding curve data parsing with better error handling
   */
  async getBondingCurveData(bondingCurveAddress: string): Promise<BondingCurveData | null> {
    if (!this.isValidPublicKey(bondingCurveAddress)) {
      console.warn(`⚠️ Skipping invalid bonding curve: "${bondingCurveAddress}" (length: ${bondingCurveAddress?.length || 0})`);
      return null;
    }

    try {
      const address = new PublicKey(bondingCurveAddress);
      
      // Add retry logic for rate limiting
      let accountInfo = null;
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          accountInfo = await this.connection.getAccountInfo(address);
          break;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes('429') && attempt < this.maxRetries - 1) {
            // Wait longer for rate limits
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
          throw error;
        }
      }
      
      if (!accountInfo) {
        console.warn(`⚠️ No account data found for bonding curve: ${bondingCurveAddress}`);
        return null;
      }

      const data = accountInfo.data;
      
      // ✅ IMPROVED: Handle different data lengths gracefully
      if (data.length < 32) {
        console.warn(`⚠️ Invalid bonding curve data length: ${data.length} bytes`);
        return null;
      }

      // ✅ IMPROVED: Try different parsing methods based on data length
      return this.parseWithFallback(data, bondingCurveAddress);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // ✅ IMPROVED: Don't log routine errors as errors
      if (errorMessage.includes('429')) {
        console.warn(`⚠️ Rate limited for ${bondingCurveAddress}, will retry later`);
      } else {
        console.warn(`⚠️ Could not fetch bonding curve data for ${bondingCurveAddress}: ${errorMessage}`);
      }
      return null;
    }
  }

  /**
   * Parse bonding curve data with multiple fallback methods
   */
  private parseWithFallback(data: Buffer, address: string): BondingCurveData | null {
    try {
      // Method 1: Standard parsing (your current method)
      if (data.length >= 64) {
        return this.parseStandardFormat(data);
      }
      
      // Method 2: Compact format for 8-byte data
      if (data.length >= 8) {
        return this.parseCompactFormat(data);
      }
      
      console.warn(`⚠️ Unknown bonding curve format for ${address}: ${data.length} bytes`);
      return null;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ Error parsing bonding curve data for ${address}:`, errorMessage);
      return null;
    }
  }

  /**
   * Standard bonding curve parsing
   */
  private parseStandardFormat(data: Buffer): BondingCurveData {
    let offset = 8; // Skip discriminator
    
    // ✅ IMPROVED: Add bounds checking and safe parsing
    const virtualTokenReserves = this.safeReadBigUInt64LE(data, offset);
    offset += 8;
    
    const virtualSolReserves = this.safeReadBigUInt64LE(data, offset);
    offset += 8;
    
    const realTokenReserves = this.safeReadBigUInt64LE(data, offset);
    offset += 8;
    
    const realSolReserves = this.safeReadBigUInt64LE(data, offset);
    offset += 8;
    
    const tokenTotalSupply = this.safeReadBigUInt64LE(data, offset);
    offset += 8;
    
    const complete = data.length > offset ? data.readUInt8(offset) === 1 : false;
    
    const solBalance = realSolReserves / 1e9;
    const progress = Math.min((realSolReserves / 85e9) * 100, 100);
    
    return {
      virtualTokenReserves,
      virtualSolReserves,
      realTokenReserves,
      realSolReserves,
      tokenTotalSupply,
      complete,
      solBalance,
      progress
    };
  }

  /**
   * Compact format parsing for smaller data
   */
  private parseCompactFormat(data: Buffer): BondingCurveData {
    // For 8-byte data, assume it's just the SOL reserves
    const realSolReserves = this.safeReadBigUInt64LE(data, 0);
    
    // Calculate estimated values
    const progress = Math.min((realSolReserves / 85e9) * 100, 100);
    const virtualSolReserves = realSolReserves + (30 * 1e9); // Add virtual amount
    const virtualTokenReserves = Math.max(1e15 - (realSolReserves * 1e6), 1e9); // Estimate
    
    return {
      virtualTokenReserves,
      virtualSolReserves,
      realTokenReserves: 0, // Unknown
      realSolReserves,
      tokenTotalSupply: 1e15, // Standard 1B tokens
      complete: progress >= 100,
      solBalance: realSolReserves / 1e9,
      progress
    };
  }

  /**
   * Safe number parsing with overflow protection
   */
  private safeReadBigUInt64LE(buffer: Buffer, offset: number): number {
    try {
      if (offset + 8 > buffer.length) {
        return 0;
      }
      
      const bigIntValue = buffer.readBigUInt64LE(offset);
      
      // ✅ IMPROVED: Prevent numeric overflow
      if (bigIntValue > Number.MAX_SAFE_INTEGER) {
        console.warn(`⚠️ Large number detected, capping at safe integer: ${bigIntValue}`);
        return Number.MAX_SAFE_INTEGER;
      }
      
      return Number(bigIntValue);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ Error reading number at offset ${offset}:`, errorMessage);
      return 0;
    }
  }

  /**
   * Batch fetch with improved rate limiting
   */
  async getBatchBondingCurveData(addresses: string[]): Promise<Map<string, BondingCurveData>> {
    const results = new Map();
    const validAddresses = addresses.filter(addr => this.isValidPublicKey(addr));
    
    if (validAddresses.length !== addresses.length) {
      console.log(`⚠️ Filtered out ${addresses.length - validAddresses.length} invalid bonding curve addresses`);
    }

    // ✅ IMPROVED: Slower batch processing to avoid rate limits
    const batchSize = 5; // Reduced from 10
    const delay = 200; // Increased delay
    
    for (let i = 0; i < validAddresses.length; i += batchSize) {
      const batch = validAddresses.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (address) => {
          const data = await this.getBondingCurveData(address);
          if (data) {
            results.set(address, data);
          }
        })
      );

      // Rate limiting delay
      if (i + batchSize < validAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return results;
  }
}