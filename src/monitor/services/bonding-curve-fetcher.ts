// src/monitor/services/bonding-curve-fetcher.ts

import { Connection, PublicKey } from "@solana/web3.js";
import { Buffer } from 'buffer';

export interface BondingCurveData {
  virtualTokenReserves: number;  // Raw lamports
  virtualSolReserves: number;    // Raw lamports
  realTokenReserves: number;     // Raw tokens
  realSolReserves: number;       // Raw lamports
  tokenTotalSupply: number;      // Raw tokens
  complete: boolean;
  solBalance: number;            // Human-readable SOL
  progress: number;              // Progress percentage
}

export class BondingCurveFetcher {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Fetch bonding curve data
   * Returns raw values to match Method 2 calculation
   */
  async getBondingCurveData(bondingCurveAddress: string): Promise<BondingCurveData | null> {
    try {
      const address = new PublicKey(bondingCurveAddress);
      const accountInfo = await this.connection.getAccountInfo(address);
      
      if (!accountInfo || !accountInfo.data) {
        return null;
      }

      // Get SOL balance in human-readable format
      const solBalance = accountInfo.lamports / 1e9;
      
      // Parse the account data
      const bondingCurveData = this.parseBondingCurveAccount(Buffer.from(accountInfo.data));
      
      if (!bondingCurveData) {
        return null;
      }

      // Calculate progress (real SOL reserves / 85 SOL target)
      const progress = (bondingCurveData.realSolReserves / 1e9 / 85) * 100;

      return {
        ...bondingCurveData,
        solBalance,
        progress: Math.min(progress, 100) // Cap at 100%
      };
    } catch (error) {
      console.error(`Error fetching bonding curve ${bondingCurveAddress}:`, error);
      return null;
    }
  }

  /**
   * Parse bonding curve account
   * Returns raw values (lamports and raw token amounts)
   */
  private parseBondingCurveAccount(data: Buffer): Omit<BondingCurveData, 'solBalance' | 'progress'> | null {
    try {
      if (data.length < 192) {
        return null;
      }

      let offset = 8; // Skip discriminator

      // Read all values as raw (matching your Method 2)
      const virtualTokenReserves = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const virtualSolReserves = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const realTokenReserves = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const realSolReserves = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const tokenTotalSupply = Number(data.readBigUInt64LE(offset));
      offset += 8;

      const complete = data[offset] === 1;

      return {
        virtualTokenReserves, // Keep raw for Method 2
        virtualSolReserves,   // Keep raw for Method 2
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
}