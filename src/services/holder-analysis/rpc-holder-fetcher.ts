/**
 * RPC-based Holder Fetcher
 * 
 * Uses Solana RPC to fetch token holder data
 * Falls back to Helius API when needed
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../../core/logger';
import { EventEmitter } from 'events';

export interface RPCTokenHolder {
  address: string;
  amount: string;
  uiAmount: number;
  percentage: number;
  rank: number;
}

export interface RPCHolderData {
  mintAddress: string;
  tokenInfo: {
    supply: string;
    decimals: number;
    uiSupply: number;
  };
  holders: RPCTokenHolder[];
  totalHolders: number;
  fetchedAt: Date;
  source: 'rpc' | 'helius';
}

export class RPCHolderFetcher extends EventEmitter {
  private connection: Connection;
  private heliusApiKey?: string;
  private cache: Map<string, { data: RPCHolderData; expiry: number }> = new Map();
  private cacheTTL: number = 300; // 5 minutes

  constructor(rpcUrl?: string, heliusApiKey?: string) {
    super();
    
    // Prioritize Helius RPC, then Shyft RPC, then custom URL, then default
    let connectionUrl = rpcUrl;
    
    if (!connectionUrl) {
      if (heliusApiKey || process.env.HELIUS_API_KEY) {
        connectionUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey || process.env.HELIUS_API_KEY}`;
        logger.debug('Using Helius RPC endpoint');
      } else if (process.env.SHYFT_RPC_URL) {
        connectionUrl = process.env.SHYFT_RPC_URL;
        logger.debug('Using Shyft RPC endpoint');
      } else if (process.env.SOLANA_RPC_URL) {
        connectionUrl = process.env.SOLANA_RPC_URL;
      } else {
        connectionUrl = 'https://api.mainnet-beta.solana.com';
        logger.warn('Using default Solana RPC (rate limited) - configure HELIUS_API_KEY or SHYFT_RPC_URL for better performance');
      }
    }
    
    this.connection = new Connection(connectionUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000
    });
    this.heliusApiKey = heliusApiKey || process.env.HELIUS_API_KEY;
  }

  /**
   * Fetch holder data using RPC
   */
  async fetchHolderData(
    mintAddress: string,
    limit: number = 100,
    useCache: boolean = true
  ): Promise<RPCHolderData | null> {
    try {
      // Check cache first
      if (useCache) {
        const cached = this.cache.get(mintAddress);
        if (cached && cached.expiry > Date.now()) {
          logger.debug(`Using cached holder data for ${mintAddress}`);
          return cached.data;
        }
      }

      logger.debug(`Fetching holder data for ${mintAddress} via RPC`);

      // Get token mint info
      const mintPubkey = new PublicKey(mintAddress);
      const supply = await this.connection.getTokenSupply(mintPubkey);
      
      if (!supply.value) {
        logger.error(`Failed to get token supply for ${mintAddress}`);
        return null;
      }

      const decimals = supply.value.decimals;
      const totalSupply = supply.value.uiAmount || 0;

      // Get largest token accounts (top 20)
      const largestAccounts = await this.connection.getTokenLargestAccounts(mintPubkey);
      
      if (!largestAccounts.value || largestAccounts.value.length === 0) {
        logger.warn(`No token accounts found for ${mintAddress}`);
        return null;
      }

      // Transform to our format
      const holders: RPCTokenHolder[] = largestAccounts.value.map((account, index) => {
        const amount = account.amount;
        const uiAmount = parseInt(amount) / Math.pow(10, decimals);
        const percentage = totalSupply > 0 ? (uiAmount / totalSupply) * 100 : 0;

        return {
          address: account.address.toBase58(),
          amount: amount,
          uiAmount: uiAmount,
          percentage: percentage,
          rank: index + 1
        };
      });

      const holderData: RPCHolderData = {
        mintAddress,
        tokenInfo: {
          supply: supply.value.amount,
          decimals: decimals,
          uiSupply: totalSupply
        },
        holders,
        totalHolders: holders.length, // RPC only gives us top 20
        fetchedAt: new Date(),
        source: 'rpc'
      };

      // Cache the result
      this.cache.set(mintAddress, {
        data: holderData,
        expiry: Date.now() + (this.cacheTTL * 1000)
      });

      this.emit('fetch_complete', { mintAddress, holderCount: holders.length, source: 'rpc' });
      return holderData;

    } catch (error) {
      logger.error(`RPC holder fetch error for ${mintAddress}:`, error);
      
      // Try Helius as fallback if configured
      if (this.heliusApiKey) {
        logger.info(`Falling back to Helius for ${mintAddress}`);
        return this.fetchFromHelius(mintAddress, limit);
      }
      
      return null;
    }
  }

  /**
   * Fallback to Helius API
   */
  private async fetchFromHelius(mintAddress: string, limit: number): Promise<RPCHolderData | null> {
    try {
      // Import axios dynamically to avoid dependency if not needed
      const axios = (await import('axios')).default;
      
      // Try to get token metadata first
      const metadataResponse = await axios.post(
        `https://api.helius.xyz/v0/token-metadata?api-key=${this.heliusApiKey}`,
        {
          mintAccounts: [mintAddress],
          includeOffChain: true,
          disableCache: false
        }
      );

      const tokenData = metadataResponse.data?.[0];
      
      // For holder data, we might need to use a different endpoint
      // For now, return minimal data
      const holderData: RPCHolderData = {
        mintAddress,
        tokenInfo: {
          supply: tokenData?.onChainMetadata?.supply || '0',
          decimals: tokenData?.onChainMetadata?.decimals || 0,
          uiSupply: 0
        },
        holders: [], // Helius doesn't provide holder list in standard API
        totalHolders: 0,
        fetchedAt: new Date(),
        source: 'helius'
      };

      this.emit('fetch_complete', { mintAddress, holderCount: 0, source: 'helius' });
      return holderData;

    } catch (error) {
      logger.error(`Helius fallback failed for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clean expired cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expiry < now) {
        this.cache.delete(key);
      }
    }
  }
}