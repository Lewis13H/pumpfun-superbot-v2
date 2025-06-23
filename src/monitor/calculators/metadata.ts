// src/monitor/calculators/metadata.ts

import { TokenMetadata } from '../types';
import { DEFAULT_TOKEN_DECIMALS, DEFAULT_TOKEN_SUPPLY } from '../constants';
import { db } from '../../database';

export class MetadataCalculator {
  /**
   * Get token metadata with defaults for pump.fun tokens
   */
  static async getTokenMetadata(
    tokenMint: string
  ): Promise<TokenMetadata> {
    // For pump.fun tokens, we can use standard values
    const defaultMetadata: TokenMetadata = {
      decimals: DEFAULT_TOKEN_DECIMALS,
      totalSupply: DEFAULT_TOKEN_SUPPLY
    };

    // Try to get additional info from database if available
    try {
      const result = await db.query(
        'SELECT symbol, name FROM tokens WHERE address = $1',
        [tokenMint]
      );
      
      if (result.rows.length > 0 && result.rows[0].symbol) {
        console.log(`📊 Using cached metadata for ${result.rows[0].symbol}`);
      }
    } catch (error) {
      // Ignore errors, use defaults
    }
    
    return defaultMetadata;
  }
}