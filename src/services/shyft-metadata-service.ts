/**
 * Shyft Metadata Service
 * Uses Shyft's DAS API for token metadata enrichment
 * More cost-effective than Helius for bulk operations
 */

import axios from 'axios';
import chalk from 'chalk';
import { db } from '../database';

interface ShyftTokenMetadata {
  address: string;
  name?: string;
  symbol?: string;
  uri?: string;
  description?: string;
  image?: string;
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  supply?: number;
  decimals?: number;
  is_mutable?: boolean;
  mint_authority?: string;
  freeze_authority?: string;
}

export class ShyftMetadataService {
  private static instance: ShyftMetadataService;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.shyft.to/sol/v1';
  private cache = new Map<string, { data: ShyftTokenMetadata; timestamp: number }>();
  private readonly CACHE_TTL = 3600000; // 1 hour
  private readonly RATE_LIMIT_DELAY = 50; // 50ms between requests (more aggressive than Helius)
  
  private constructor() {
    this.apiKey = process.env.SHYFT_API_KEY || '';
    if (!this.apiKey) {
      console.warn(chalk.yellow('SHYFT_API_KEY not found - using RPC endpoint token'));
      // Fall back to using the gRPC token if available
      this.apiKey = process.env.SHYFT_GRPC_TOKEN || '';
    }
  }
  
  static getInstance(): ShyftMetadataService {
    if (!this.instance) {
      this.instance = new ShyftMetadataService();
    }
    return this.instance;
  }
  
  /**
   * Get token metadata from Shyft
   */
  async getTokenMetadata(mintAddress: string): Promise<ShyftTokenMetadata | null> {
    try {
      // Check cache first
      const cached = this.cache.get(mintAddress);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }
      
      // Fetch from Shyft
      const response = await axios.get(`${this.baseUrl}/token/get_info`, {
        params: {
          network: 'mainnet-beta',
          token_address: mintAddress
        },
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json'
        },
        timeout: 5000
      });
      
      if (response.data.success && response.data.result) {
        const metadata = response.data.result as ShyftTokenMetadata;
        
        // Cache the result
        this.cache.set(mintAddress, {
          data: metadata,
          timestamp: Date.now()
        });
        
        return metadata;
      }
      
      return null;
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          console.error(chalk.yellow('Shyft rate limit hit'));
        } else if (error.response?.status === 404) {
          // Token not found - this is normal for new tokens
          return null;
        }
      }
      
      if (process.env.DEBUG) {
        console.error(chalk.red('Shyft metadata error:'), error);
      }
      
      return null;
    }
  }
  
  /**
   * Bulk fetch metadata for multiple tokens
   */
  async getBulkMetadata(mintAddresses: string[]): Promise<Map<string, ShyftTokenMetadata>> {
    const results = new Map<string, ShyftTokenMetadata>();
    
    // Process in batches to avoid rate limits
    const batchSize = 20;
    for (let i = 0; i < mintAddresses.length; i += batchSize) {
      const batch = mintAddresses.slice(i, i + batchSize);
      
      // Process batch concurrently with rate limiting
      const batchPromises = batch.map(async (mint, index) => {
        // Add delay based on position in batch
        await new Promise(resolve => setTimeout(resolve, index * this.RATE_LIMIT_DELAY));
        
        const metadata = await this.getTokenMetadata(mint);
        if (metadata) {
          results.set(mint, metadata);
        }
      });
      
      await Promise.all(batchPromises);
      
      // Pause between batches
      if (i + batchSize < mintAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: 0, // Would need to track this
      misses: 0
    };
  }
}