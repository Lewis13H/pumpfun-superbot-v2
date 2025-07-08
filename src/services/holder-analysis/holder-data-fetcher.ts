/**
 * Holder Data Fetcher Service
 * 
 * Orchestrates fetching holder data from multiple sources (Helius, Shyft)
 * with fallback mechanisms and data normalization
 */

import { HeliusApiClient, HeliusTokenHolder } from './helius-api-client';
import { ShyftDasApiClient, ShyftTokenHolder } from './shyft-das-api-client';
import { RPCHolderFetcher, RPCTokenHolder } from './rpc-holder-fetcher';
import { EnhancedHolderFetcher } from './enhanced-holder-fetcher';
import { HeliusCompleteHolderFetcher } from './helius-complete-holder-fetcher';
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
  source: 'rpc' | 'helius' | 'shyft' | 'mixed';
}

export interface FetcherOptions {
  preferredSource?: 'rpc' | 'helius' | 'shyft' | 'helius-complete';
  maxHolders?: number;
  enableFallback?: boolean;
  cacheResults?: boolean;
  cacheTTL?: number; // in seconds
  completeData?: boolean; // Fetch ALL holders instead of just top holders
}

export class HolderDataFetcher extends EventEmitter {
  private rpcFetcher: RPCHolderFetcher;
  private enhancedFetcher: EnhancedHolderFetcher;
  private completeFetcher: HeliusCompleteHolderFetcher;
  private heliusClient: HeliusApiClient;
  private shyftClient: ShyftDasApiClient;
  private cache: Map<string, { data: TokenHolderData; expiry: number }> = new Map();

  constructor(
    heliusApiKey?: string,
    shyftApiKey?: string,
    rpcUrl?: string
  ) {
    super();
    this.rpcFetcher = new RPCHolderFetcher(rpcUrl, heliusApiKey);
    this.enhancedFetcher = new EnhancedHolderFetcher(heliusApiKey, shyftApiKey);
    this.completeFetcher = new HeliusCompleteHolderFetcher(heliusApiKey);
    this.heliusClient = new HeliusApiClient(heliusApiKey);
    this.shyftClient = new ShyftDasApiClient(shyftApiKey);
    
    // Forward events from enhanced fetcher
    this.enhancedFetcher.on('fetch_complete', (data) => this.emit('fetch_complete', data));
  }

  /**
   * Fetch holder data with automatic fallback
   */
  async fetchHolderData(
    mintAddress: string,
    options: FetcherOptions = {}
  ): Promise<TokenHolderData | null> {
    const {
      preferredSource = 'rpc',
      maxHolders = 1000,
      enableFallback = true,
      cacheResults = true,
      cacheTTL = 300, // 5 minutes
      completeData = false
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

    // If complete data is requested and we have Helius API key, use complete fetcher
    if (completeData && preferredSource === 'helius-complete' && process.env.HELIUS_API_KEY) {
      try {
        const completeData = await this.completeFetcher.fetchAllHolders(mintAddress, {
          pageLimit: Math.ceil(maxHolders / 1000), // 1000 per page
          includeZeroBalances: false
        });
        
        if (completeData) {
          result = {
            mintAddress: completeData.mintAddress,
            tokenInfo: completeData.tokenInfo,
            holders: completeData.holders.slice(0, maxHolders).map(h => ({
              address: h.address,
              balance: h.balance,
              uiBalance: h.uiBalance,
              percentage: h.percentage,
              rank: h.rank
            })),
            totalHolders: completeData.uniqueHolders,
            fetchedAt: completeData.fetchedAt,
            source: 'helius' as any
          };
          
          logger.debug(`Successfully fetched complete holder data for ${mintAddress}: ${completeData.uniqueHolders} holders`);
        }
      } catch (error) {
        logger.error(`Complete fetcher failed for ${mintAddress}:`, error);
      }
    }

    // If not using complete data or it failed, try enhanced fetcher
    if (!result) {
      try {
        const enhancedData = await this.enhancedFetcher.fetchHolderData(mintAddress, {
          maxHolders,
          useCache: false // We handle caching at this level
        });
        
        if (enhancedData) {
          // Convert enhanced data to our format
          result = {
            mintAddress: enhancedData.mintAddress,
            tokenInfo: {
              name: enhancedData.tokenInfo.name,
              symbol: enhancedData.tokenInfo.symbol,
              decimals: enhancedData.tokenInfo.decimals,
              supply: enhancedData.tokenInfo.supply,
              creator: enhancedData.tokenInfo.creator
            },
            holders: enhancedData.holders.map(h => ({
              address: h.address,
              balance: h.amount,
              uiBalance: h.uiAmount,
              percentage: h.percentage,
              rank: h.rank
            })),
            totalHolders: enhancedData.totalHolders,
            fetchedAt: enhancedData.fetchedAt,
            source: enhancedData.source as any
          };
          
          logger.debug(`Successfully fetched from enhanced fetcher (${enhancedData.source}) for ${mintAddress}`);
        }
      } catch (error) {
        logger.error(`Enhanced fetcher failed for ${mintAddress}:`, error);
      }
    }

    // Fallback to original methods if enhanced fetcher fails
    if (!result && preferredSource === 'rpc') {
      result = await this.fetchFromRPC(mintAddress, maxHolders);
      if (!result && enableFallback) {
        logger.debug(`RPC failed for ${mintAddress}, falling back to Helius`);
        result = await this.fetchFromHelius(mintAddress, maxHolders);
        // Shyft token holder endpoint doesn't exist - skip it
        // if (!result) {
        //   logger.debug(`Helius failed for ${mintAddress}, falling back to Shyft`);
        //   result = await this.fetchFromShyft(mintAddress, maxHolders);
        // }
      }
    } else if (preferredSource === 'helius') {
      result = await this.fetchFromHelius(mintAddress, maxHolders);
      if (!result && enableFallback) {
        logger.debug(`Helius failed for ${mintAddress}, falling back to RPC`);
        result = await this.fetchFromRPC(mintAddress, maxHolders);
        // Shyft token holder endpoint doesn't exist - skip it
        // if (!result) {
        //   logger.debug(`RPC failed for ${mintAddress}, falling back to Shyft`);
        //   result = await this.fetchFromShyft(mintAddress, maxHolders);
        // }
      }
    } else {
      // Shyft token holder endpoint doesn't exist - skip to RPC
      result = await this.fetchFromRPC(mintAddress, maxHolders);
      if (!result && enableFallback) {
        logger.debug(`RPC failed for ${mintAddress}, falling back to Helius`);
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
   * Fetch from RPC
   */
  private async fetchFromRPC(
    mintAddress: string,
    maxHolders: number
  ): Promise<TokenHolderData | null> {
    try {
      const rpcData = await this.rpcFetcher.fetchHolderData(mintAddress, maxHolders, false);
      if (!rpcData) {
        return null;
      }

      // Transform RPC data to our format
      const normalizedHolders: NormalizedTokenHolder[] = rpcData.holders.map(holder => ({
        address: holder.address,
        balance: holder.amount,
        uiBalance: holder.uiAmount,
        percentage: holder.percentage,
        rank: holder.rank
      }));

      return {
        mintAddress,
        tokenInfo: {
          name: 'Unknown', // RPC doesn't provide metadata
          symbol: 'Unknown',
          decimals: rpcData.tokenInfo.decimals,
          supply: rpcData.tokenInfo.supply,
          creator: undefined
        },
        holders: normalizedHolders,
        totalHolders: rpcData.totalHolders,
        fetchedAt: rpcData.fetchedAt,
        source: 'rpc' as any
      };
    } catch (error) {
      logger.error(`Failed to fetch from RPC for ${mintAddress}:`, error);
      return null;
    }
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