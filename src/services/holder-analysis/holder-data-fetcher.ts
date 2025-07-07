/**
 * Holder Data Fetcher Service
 * 
 * Orchestrates fetching holder data from multiple sources (Helius, Shyft)
 * with fallback mechanisms and data normalization
 */

import { HeliusApiClient, HeliusTokenHolder } from './helius-api-client';
import { ShyftDasApiClient, ShyftTokenHolder } from './shyft-das-api-client';
import { logger } from '../../core/logger';
import { EventEmitter } from 'events';

export interface NormalizedTokenHolder {
  address: string;
  balance: string;
  uiBalance: number;
  percentage: number;
  rank?: number;
}

export interface TokenHolderData {
  mintAddress: string;
  tokenInfo: {
    name: string;
    symbol: string;
    decimals: number;
    supply: string;
    creator?: string;
  };
  holders: NormalizedTokenHolder[];
  totalHolders: number;
  fetchedAt: Date;
  source: 'helius' | 'shyft' | 'mixed';
}

export interface FetcherOptions {
  preferredSource?: 'helius' | 'shyft';
  maxHolders?: number;
  enableFallback?: boolean;
  cacheResults?: boolean;
  cacheTTL?: number; // in seconds
}

export class HolderDataFetcher extends EventEmitter {
  private heliusClient: HeliusApiClient;
  private shyftClient: ShyftDasApiClient;
  private cache: Map<string, { data: TokenHolderData; expiry: number }> = new Map();

  constructor(
    heliusApiKey?: string,
    shyftApiKey?: string
  ) {
    super();
    this.heliusClient = new HeliusApiClient(heliusApiKey);
    this.shyftClient = new ShyftDasApiClient(shyftApiKey);
  }

  /**
   * Fetch holder data with automatic fallback
   */
  async fetchHolderData(
    mintAddress: string,
    options: FetcherOptions = {}
  ): Promise<TokenHolderData | null> {
    const {
      preferredSource = 'shyft',
      maxHolders = 1000,
      enableFallback = true,
      cacheResults = true,
      cacheTTL = 300 // 5 minutes
    } = options;

    // Check cache first
    if (cacheResults) {
      const cached = this.getFromCache(mintAddress);
      if (cached) {
        this.emit('cache_hit', { mintAddress });
        return cached;
      }
    }

    this.emit('fetch_start', { mintAddress, source: preferredSource });

    let result: TokenHolderData | null = null;

    // Try preferred source first
    if (preferredSource === 'helius') {
      result = await this.fetchFromHelius(mintAddress, maxHolders);
      if (!result && enableFallback) {
        logger.info(`Helius failed for ${mintAddress}, falling back to Shyft`);
        result = await this.fetchFromShyft(mintAddress, maxHolders);
      }
    } else {
      result = await this.fetchFromShyft(mintAddress, maxHolders);
      if (!result && enableFallback) {
        logger.info(`Shyft failed for ${mintAddress}, falling back to Helius`);
        result = await this.fetchFromHelius(mintAddress, maxHolders);
      }
    }

    if (result && cacheResults) {
      this.saveToCache(mintAddress, result, cacheTTL);
    }

    this.emit('fetch_complete', { 
      mintAddress, 
      success: !!result,
      source: result?.source,
      holderCount: result?.totalHolders 
    });

    return result;
  }

  /**
   * Fetch from Helius API
   */
  private async fetchFromHelius(
    mintAddress: string,
    maxHolders: number
  ): Promise<TokenHolderData | null> {
    try {
      const response = await this.heliusClient.getTokenHolders(mintAddress, 1, 100);
      if (!response || !response.result) {
        return null;
      }

      // Fetch all holders if needed
      let holders: HeliusTokenHolder[] = response.result.owners;
      if (response.result.pagination && response.result.pagination.total_pages > 1) {
        holders = await this.heliusClient.getAllTokenHolders(mintAddress, maxHolders);
      }

      // Get token metadata
      const metadata = await this.heliusClient.getTokenMetadata(mintAddress);

      // Normalize data
      const tokenInfo = response.result.token_info;
      const supply = BigInt(tokenInfo.supply);
      
      const normalizedHolders: NormalizedTokenHolder[] = holders
        .map((holder, index) => {
          const balance = BigInt(Math.floor(holder.balance * Math.pow(10, holder.decimals)));
          const percentage = supply > BigInt(0) ? 
            Number((balance * BigInt(10000)) / supply) / 100 : 0;

          return {
            address: holder.owner,
            balance: balance.toString(),
            uiBalance: holder.balance,
            percentage,
            rank: index + 1
          };
        })
        .sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)));

      // Re-rank after sorting
      normalizedHolders.forEach((holder, index) => {
        holder.rank = index + 1;
      });

      return {
        mintAddress,
        tokenInfo: {
          name: tokenInfo.name || metadata?.name || '',
          symbol: tokenInfo.symbol || metadata?.symbol || '',
          decimals: tokenInfo.decimals,
          supply: tokenInfo.supply,
          creator: metadata?.updateAuthority
        },
        holders: normalizedHolders.slice(0, maxHolders),
        totalHolders: response.result.pagination?.total_pages 
          ? response.result.pagination.total_pages * 100 
          : holders.length,
        fetchedAt: new Date(),
        source: 'helius'
      };
    } catch (error) {
      logger.error(`Failed to fetch from Helius for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch from Shyft DAS API
   */
  private async fetchFromShyft(
    mintAddress: string,
    maxHolders: number
  ): Promise<TokenHolderData | null> {
    try {
      const response = await this.shyftClient.getTokenHolders(mintAddress, 1, 100);
      if (!response || !response.result) {
        return null;
      }

      // Fetch all holders if needed
      let holders: ShyftTokenHolder[] = response.result.holders;
      if (response.result.totalHolders > 100) {
        holders = await this.shyftClient.getAllTokenHolders(mintAddress, maxHolders);
      }

      // Get additional token info
      const creationInfo = await this.shyftClient.getTokenCreationInfo(mintAddress);

      // Normalize data
      const normalizedHolders: NormalizedTokenHolder[] = holders
        .map((holder, index) => ({
          address: holder.address,
          balance: holder.amount,
          uiBalance: holder.uiAmount,
          percentage: holder.percentage,
          rank: index + 1
        }))
        .sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)));

      // Re-rank after sorting
      normalizedHolders.forEach((holder, index) => {
        holder.rank = index + 1;
      });

      return {
        mintAddress,
        tokenInfo: {
          name: response.result.token.name,
          symbol: response.result.token.symbol,
          decimals: response.result.token.decimals,
          supply: response.result.token.supply,
          creator: creationInfo?.creator || response.result.token.updateAuthority
        },
        holders: normalizedHolders.slice(0, maxHolders),
        totalHolders: response.result.totalHolders,
        fetchedAt: new Date(),
        source: 'shyft'
      };
    } catch (error) {
      logger.error(`Failed to fetch from Shyft for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch holder data from both sources and merge
   */
  async fetchFromBothSources(
    mintAddress: string,
    maxHolders: number = 1000
  ): Promise<TokenHolderData | null> {
    const [heliusData, shyftData] = await Promise.allSettled([
      this.fetchFromHelius(mintAddress, maxHolders),
      this.fetchFromShyft(mintAddress, maxHolders)
    ]);

    const helius = heliusData.status === 'fulfilled' ? heliusData.value : null;
    const shyft = shyftData.status === 'fulfilled' ? shyftData.value : null;

    if (!helius && !shyft) {
      return null;
    }

    // If only one source succeeded, return it
    if (!helius) return shyft;
    if (!shyft) return helius;

    // Merge data from both sources
    const mergedHolders = this.mergeHolderData(
      helius.holders,
      shyft.holders
    );

    return {
      mintAddress,
      tokenInfo: {
        ...helius.tokenInfo,
        // Prefer Shyft for some fields as it might be more up-to-date
        name: shyft.tokenInfo.name || helius.tokenInfo.name,
        symbol: shyft.tokenInfo.symbol || helius.tokenInfo.symbol
      },
      holders: mergedHolders.slice(0, maxHolders),
      totalHolders: Math.max(helius.totalHolders, shyft.totalHolders),
      fetchedAt: new Date(),
      source: 'mixed'
    };
  }

  /**
   * Merge holder data from multiple sources
   */
  private mergeHolderData(
    holders1: NormalizedTokenHolder[],
    holders2: NormalizedTokenHolder[]
  ): NormalizedTokenHolder[] {
    const holderMap = new Map<string, NormalizedTokenHolder>();

    // Add all holders from first source
    holders1.forEach(holder => {
      holderMap.set(holder.address, holder);
    });

    // Merge or add holders from second source
    holders2.forEach(holder => {
      const existing = holderMap.get(holder.address);
      if (existing) {
        // Average the percentages if they differ
        existing.percentage = (existing.percentage + holder.percentage) / 2;
      } else {
        holderMap.set(holder.address, holder);
      }
    });

    // Convert back to array and sort by balance
    const merged = Array.from(holderMap.values())
      .sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)));

    // Re-rank
    merged.forEach((holder, index) => {
      holder.rank = index + 1;
    });

    return merged;
  }

  /**
   * Cache management
   */
  private getFromCache(mintAddress: string): TokenHolderData | null {
    const cached = this.cache.get(mintAddress);
    if (!cached) return null;

    if (Date.now() > cached.expiry) {
      this.cache.delete(mintAddress);
      return null;
    }

    return cached.data;
  }

  private saveToCache(
    mintAddress: string,
    data: TokenHolderData,
    ttlSeconds: number
  ): void {
    this.cache.set(mintAddress, {
      data,
      expiry: Date.now() + (ttlSeconds * 1000)
    });

    // Emit cache size for monitoring
    this.emit('cache_update', { size: this.cache.size });
  }

  /**
   * Clear cache
   */
  clearCache(mintAddress?: string): void {
    if (mintAddress) {
      this.cache.delete(mintAddress);
    } else {
      this.cache.clear();
    }
    this.emit('cache_clear', { mintAddress });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ mintAddress: string; expiry: Date }>;
  } {
    const entries = Array.from(this.cache.entries()).map(([key, value]) => ({
      mintAddress: key,
      expiry: new Date(value.expiry)
    }));

    return {
      size: this.cache.size,
      entries
    };
  }
}