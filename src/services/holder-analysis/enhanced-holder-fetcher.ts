/**
 * Enhanced Holder Fetcher
 * 
 * Optimized to use Helius and Shyft APIs/RPC for holder data
 * Based on their documentation:
 * - Helius: https://www.helius.dev/docs
 * - Shyft: https://docs.shyft.to/
 */

import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../../core/logger';
import { EventEmitter } from 'events';

export interface EnhancedTokenHolder {
  address: string;
  amount: string;
  uiAmount: number;
  percentage: number;
  rank: number;
}

export interface EnhancedHolderData {
  mintAddress: string;
  tokenInfo: {
    name: string;
    symbol: string;
    decimals: number;
    supply: string;
    creator?: string;
    image?: string;
  };
  holders: EnhancedTokenHolder[];
  totalHolders: number;
  fetchedAt: Date;
  source: 'helius' | 'shyft' | 'helius-rpc' | 'shyft-rpc';
}

export class EnhancedHolderFetcher extends EventEmitter {
  private heliusApiKey?: string;
  private shyftApiKey?: string;
  private heliusConnection?: Connection;
  private shyftConnection?: Connection;
  private cache: Map<string, { data: EnhancedHolderData; expiry: number }> = new Map();
  
  constructor(heliusApiKey?: string, shyftApiKey?: string) {
    super();
    this.heliusApiKey = heliusApiKey || process.env.HELIUS_API_KEY;
    this.shyftApiKey = shyftApiKey || process.env.SHYFT_API_KEY;
    
    // Initialize connections if API keys are available
    if (this.heliusApiKey) {
      this.heliusConnection = new Connection(
        `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`,
        { commitment: 'confirmed' }
      );
    }
    
    if (this.shyftApiKey && process.env.SHYFT_RPC_URL) {
      this.shyftConnection = new Connection(
        process.env.SHYFT_RPC_URL,
        { commitment: 'confirmed' }
      );
    }
  }

  /**
   * Fetch holder data with Helius priority
   */
  async fetchHolderData(
    mintAddress: string,
    options: { maxHolders?: number; useCache?: boolean } = {}
  ): Promise<EnhancedHolderData | null> {
    const { maxHolders = 100, useCache = true } = options;
    
    // Check cache
    if (useCache) {
      const cached = this.getFromCache(mintAddress);
      if (cached) {
        this.emit('cache_hit', { mintAddress });
        return cached;
      }
    }
    
    logger.debug(`Fetching holder data for ${mintAddress}`);
    
    // Try Helius first (best for holder data)
    let result = await this.fetchFromHeliusAPI(mintAddress, maxHolders);
    
    if (!result && this.heliusConnection) {
      logger.debug(`Helius API failed, trying Helius RPC for ${mintAddress}`);
      result = await this.fetchFromHeliusRPC(mintAddress, maxHolders);
    }
    
    // Shyft token holder endpoint doesn't exist - skip it
    // if (!result) {
    //   logger.debug(`Helius failed, trying Shyft for ${mintAddress}`);
    //   result = await this.fetchFromShyftAPI(mintAddress, maxHolders);
    // }
    // 
    // if (!result && this.shyftConnection) {
    //   logger.debug(`Shyft API failed, trying Shyft RPC for ${mintAddress}`);
    //   result = await this.fetchFromShyftRPC(mintAddress, maxHolders);
    // }
    
    if (result && useCache) {
      this.saveToCache(mintAddress, result);
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
   * Fetch from Helius API (supports holder data)
   */
  private async fetchFromHeliusAPI(
    mintAddress: string,
    maxHolders: number
  ): Promise<EnhancedHolderData | null> {
    if (!this.heliusApiKey) return null;
    
    try {
      // Get token metadata first
      const metadataResponse = await axios.post(
        `https://api.helius.xyz/v0/token-metadata?api-key=${this.heliusApiKey}`,
        {
          mintAccounts: [mintAddress],
          includeOffChain: true,
          disableCache: false
        }
      );
      
      const tokenData = metadataResponse.data?.[0];
      if (!tokenData) return null;
      
      // Get token accounts (holders) - Helius supports this via enhanced transactions
      // For now, we'll use the RPC method through Helius
      return await this.fetchFromHeliusRPC(mintAddress, maxHolders);
      
    } catch (error) {
      logger.error(`Helius API error for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch using Helius RPC
   */
  private async fetchFromHeliusRPC(
    mintAddress: string,
    _maxHolders: number
  ): Promise<EnhancedHolderData | null> {
    if (!this.heliusConnection) return null;
    
    try {
      const mintPubkey = new PublicKey(mintAddress);
      
      // Get token supply
      const supply = await this.heliusConnection.getTokenSupply(mintPubkey);
      if (!supply.value) return null;
      
      // Get largest accounts
      const largestAccounts = await this.heliusConnection.getTokenLargestAccounts(mintPubkey);
      if (!largestAccounts.value || largestAccounts.value.length === 0) return null;
      
      // Get token metadata via Helius API
      let tokenInfo = {
        name: 'Unknown',
        symbol: 'Unknown',
        decimals: supply.value.decimals,
        supply: supply.value.amount,
        creator: undefined as string | undefined,
        image: undefined as string | undefined
      };
      
      if (this.heliusApiKey) {
        try {
          const metadataResponse = await axios.post(
            `https://api.helius.xyz/v0/token-metadata?api-key=${this.heliusApiKey}`,
            { mintAccounts: [mintAddress] }
          );
          const metadata = metadataResponse.data?.[0];
          if (metadata) {
            tokenInfo.name = metadata.onChainMetadata?.metadata?.name || metadata.offChainMetadata?.name || 'Unknown';
            tokenInfo.symbol = metadata.onChainMetadata?.metadata?.symbol || metadata.offChainMetadata?.symbol || 'Unknown';
            tokenInfo.creator = metadata.onChainMetadata?.updateAuthority;
            tokenInfo.image = metadata.offChainMetadata?.image;
          }
        } catch (err) {
          logger.warn('Failed to fetch Helius metadata:', err);
        }
      }
      
      // Transform holders
      const totalSupply = supply.value.uiAmount || 0;
      const holders: EnhancedTokenHolder[] = largestAccounts.value.map((account, index) => {
        const uiAmount = parseInt(account.amount) / Math.pow(10, supply.value.decimals);
        const percentage = totalSupply > 0 ? (uiAmount / totalSupply) * 100 : 0;
        
        return {
          address: account.address.toBase58(),
          amount: account.amount,
          uiAmount,
          percentage,
          rank: index + 1
        };
      });
      
      return {
        mintAddress,
        tokenInfo,
        holders,
        totalHolders: holders.length,
        fetchedAt: new Date(),
        source: 'helius-rpc'
      };
      
    } catch (error) {
      logger.error(`Helius RPC error for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch from Shyft API
   */
  private async fetchFromShyftAPI(
    mintAddress: string,
    _maxHolders: number
  ): Promise<EnhancedHolderData | null> {
    if (!this.shyftApiKey) return null;
    
    try {
      // Get token info from Shyft
      const tokenResponse = await axios.get(
        `https://api.shyft.to/sol/v1/token/info`,
        {
          headers: { 'x-api-key': this.shyftApiKey },
          params: {
            network: 'mainnet-beta',
            token_address: mintAddress
          }
        }
      );
      
      const tokenData = tokenResponse.data?.result;
      if (!tokenData) return null;
      
      // Shyft doesn't provide holder list via standard API
      // Fall back to RPC method
      return await this.fetchFromShyftRPC(mintAddress, _maxHolders);
      
    } catch (error) {
      logger.error(`Shyft API error for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch using Shyft RPC
   */
  private async fetchFromShyftRPC(
    mintAddress: string,
    _maxHolders: number
  ): Promise<EnhancedHolderData | null> {
    if (!this.shyftConnection) return null;
    
    try {
      const mintPubkey = new PublicKey(mintAddress);
      
      // Get token supply
      const supply = await this.shyftConnection.getTokenSupply(mintPubkey);
      if (!supply.value) return null;
      
      // Get largest accounts
      const largestAccounts = await this.shyftConnection.getTokenLargestAccounts(mintPubkey);
      if (!largestAccounts.value || largestAccounts.value.length === 0) return null;
      
      // Get token metadata via Shyft API
      let tokenInfo = {
        name: 'Unknown',
        symbol: 'Unknown',
        decimals: supply.value.decimals,
        supply: supply.value.amount,
        creator: undefined as string | undefined,
        image: undefined as string | undefined
      };
      
      if (this.shyftApiKey) {
        try {
          const tokenResponse = await axios.get(
            `https://api.shyft.to/sol/v1/token/info`,
            {
              headers: { 'x-api-key': this.shyftApiKey },
              params: {
                network: 'mainnet-beta',
                token_address: mintAddress
              }
            }
          );
          const metadata = tokenResponse.data?.result;
          if (metadata) {
            tokenInfo.name = metadata.name || 'Unknown';
            tokenInfo.symbol = metadata.symbol || 'Unknown';
            tokenInfo.creator = metadata.update_authority;
            tokenInfo.image = metadata.image;
          }
        } catch (err) {
          logger.warn('Failed to fetch Shyft metadata:', err);
        }
      }
      
      // Transform holders
      const totalSupply = supply.value.uiAmount || 0;
      const holders: EnhancedTokenHolder[] = largestAccounts.value.map((account, index) => {
        const uiAmount = parseInt(account.amount) / Math.pow(10, supply.value.decimals);
        const percentage = totalSupply > 0 ? (uiAmount / totalSupply) * 100 : 0;
        
        return {
          address: account.address.toBase58(),
          amount: account.amount,
          uiAmount,
          percentage,
          rank: index + 1
        };
      });
      
      return {
        mintAddress,
        tokenInfo,
        holders,
        totalHolders: holders.length,
        fetchedAt: new Date(),
        source: 'shyft-rpc'
      };
      
    } catch (error) {
      logger.error(`Shyft RPC error for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Cache management
   */
  private getFromCache(mintAddress: string): EnhancedHolderData | null {
    const cached = this.cache.get(mintAddress);
    if (!cached || cached.expiry < Date.now()) {
      this.cache.delete(mintAddress);
      return null;
    }
    return cached.data;
  }

  private saveToCache(mintAddress: string, data: EnhancedHolderData): void {
    this.cache.set(mintAddress, {
      data,
      expiry: Date.now() + (5 * 60 * 1000) // 5 minutes
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}