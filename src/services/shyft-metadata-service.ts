/**
 * Shyft Metadata Service
 * Uses Shyft's DAS API for token metadata enrichment
 * More cost-effective than Helius for bulk operations
 */

import axios from 'axios';
import chalk from 'chalk';
// import { db } from '../database';

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
  private readonly RATE_LIMIT_DELAY = 200; // 200ms between requests to avoid rate limits
  private lastRequestTime = 0;
  private requestCount = 0;
  private readonly MAX_REQUESTS_PER_MINUTE = 100; // Conservative limit
  
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
      
      // Implement rate limiting
      await this.enforceRateLimit();
      
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
    
    // First, check cache for all addresses
    const uncachedAddresses: string[] = [];
    for (const mint of mintAddresses) {
      const cached = this.cache.get(mint);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        results.set(mint, cached.data);
      } else {
        uncachedAddresses.push(mint);
      }
    }
    
    console.log(chalk.blue(`📦 ${results.size}/${mintAddresses.length} tokens found in cache`));
    
    if (uncachedAddresses.length === 0) {
      return results;
    }
    
    // Process uncached tokens sequentially to avoid rate limits
    console.log(chalk.yellow(`🔄 Fetching ${uncachedAddresses.length} tokens from Shyft API...`));
    
    for (let i = 0; i < uncachedAddresses.length; i++) {
      const mint = uncachedAddresses[i];
      
      try {
        const metadata = await this.getTokenMetadata(mint);
        if (metadata) {
          results.set(mint, metadata);
        }
        
        // Progress update every 10 tokens
        if ((i + 1) % 10 === 0) {
          console.log(chalk.gray(`  Progress: ${i + 1}/${uncachedAddresses.length}`));
        }
      } catch (error) {
        // Continue with next token on error
        if (process.env.DEBUG) {
          console.error(chalk.red(`Failed to fetch ${mint}:`), error);
        }
      }
    }
    
    console.log(chalk.green(`✅ Fetched ${results.size - (mintAddresses.length - uncachedAddresses.length)} new tokens from Shyft`));
    
    return results;
  }
  
  /**
   * Clear cache
   */
  /**
   * Enforce rate limiting
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Reset counter every minute
    if (timeSinceLastRequest > 60000) {
      this.requestCount = 0;
    }
    
    // Check if we're approaching rate limit
    if (this.requestCount >= this.MAX_REQUESTS_PER_MINUTE) {
      const waitTime = 60000 - timeSinceLastRequest;
      if (waitTime > 0) {
        console.log(chalk.yellow(`⏳ Rate limit reached, waiting ${(waitTime / 1000).toFixed(1)}s...`));
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.requestCount = 0;
      }
    }
    
    // Ensure minimum delay between requests
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }
  
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; requestCount: number; cacheHitRate: number } {
    return {
      size: this.cache.size,
      requestCount: this.requestCount,
      cacheHitRate: 0 // Would need to track hits/misses for accurate rate
    };
  }
  
  /**
   * Pre-populate cache with known metadata
   */
  populateCache(entries: Array<{ mintAddress: string; metadata: ShyftTokenMetadata }>): void {
    for (const entry of entries) {
      this.cache.set(entry.mintAddress, {
        data: entry.metadata,
        timestamp: Date.now()
      });
    }
    console.log(chalk.green(`✅ Pre-populated cache with ${entries.length} tokens`));
  }
}