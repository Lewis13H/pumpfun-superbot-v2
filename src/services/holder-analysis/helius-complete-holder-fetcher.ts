/**
 * Helius Complete Holder Fetcher
 * 
 * Uses Helius getTokenAccounts to fetch ALL token holders
 * Based on: https://www.helius.dev/blog/how-to-get-token-holders-on-solana
 */

import axios from 'axios';
import { logger } from '../../core/logger';
import { EventEmitter } from 'events';
import { API_RATE_LIMITERS } from '../../utils/api-rate-limiter';

export interface HeliusTokenAccount {
  address: string;
  owner: string;
  amount: string;
  decimals: number;
  uiAmount: number;
}

export interface HeliusTokenAccountsResponse {
  jsonrpc: string;
  id: string;
  result: {
    total: number;
    limit: number;
    page: number;
    token_accounts: HeliusTokenAccount[];
  };
}

export interface CompleteHolderData {
  mintAddress: string;
  tokenInfo: {
    name: string;
    symbol: string;
    decimals: number;
    supply: string;
    image?: string;
  };
  holders: Array<{
    address: string;
    balance: string;
    uiBalance: number;
    percentage: number;
    rank?: number;
  }>;
  totalHolders: number;
  uniqueHolders: number;
  fetchedAt: Date;
}

export class HeliusCompleteHolderFetcher extends EventEmitter {
  private apiKey: string;
  private rpcUrl: string;
  
  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.HELIUS_API_KEY || '';
    this.rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
    
    if (!this.apiKey) {
      logger.warn('Helius API key not provided');
    }
  }

  /**
   * Fetch ALL token holders using getTokenAccounts
   */
  async fetchAllHolders(
    mintAddress: string,
    options: { 
      pageLimit?: number; 
      includeZeroBalances?: boolean;
      progressCallback?: (progress: number, total: number) => void;
    } = {}
  ): Promise<CompleteHolderData | null> {
    const { 
      pageLimit = 100, // Max 100 pages (100k accounts)
      includeZeroBalances = false,
      progressCallback
    } = options;
    
    try {
      logger.debug(`Fetching all holders for ${mintAddress} using Helius getTokenAccounts`);
      
      // First get token metadata
      const metadata = await this.fetchTokenMetadata(mintAddress);
      
      // Collect all token accounts
      const holderMap = new Map<string, { balance: string; uiBalance: number }>();
      let page = 1;
      let totalAccounts = 0;
      let hasMore = true;
      
      while (hasMore && page <= pageLimit) {
        const response = await this.fetchTokenAccountsPage(mintAddress, page);
        
        if (!response || !response.result || response.result.token_accounts.length === 0) {
          hasMore = false;
          break;
        }
        
        // Process accounts
        for (const account of response.result.token_accounts) {
          // Skip zero balances if requested
          if (!includeZeroBalances && account.uiAmount === 0) {
            continue;
          }
          
          // Aggregate balances by owner
          const existing = holderMap.get(account.owner);
          if (existing) {
            // Add to existing balance
            const newBalance = (BigInt(existing.balance) + BigInt(account.amount)).toString();
            const newUiBalance = existing.uiBalance + account.uiAmount;
            holderMap.set(account.owner, { balance: newBalance, uiBalance: newUiBalance });
          } else {
            holderMap.set(account.owner, { 
              balance: account.amount, 
              uiBalance: account.uiAmount 
            });
          }
        }
        
        totalAccounts += response.result.token_accounts.length;
        
        // Progress callback
        if (progressCallback) {
          progressCallback(totalAccounts, response.result.total);
        }
        
        // Check if we've fetched all accounts
        if (totalAccounts >= response.result.total) {
          hasMore = false;
        }
        
        page++;
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      logger.debug(`Fetched ${totalAccounts} token accounts for ${holderMap.size} unique holders`);
      
      // Convert to holder array and calculate percentages
      const totalSupply = metadata.supply ? parseFloat(metadata.supply) : 0;
      const holders = Array.from(holderMap.entries())
        .map(([address, data]) => {
          const percentage = totalSupply > 0 
            ? (data.uiBalance / (totalSupply / Math.pow(10, metadata.decimals))) * 100 
            : 0;
          
          return {
            address,
            balance: data.balance,
            uiBalance: data.uiBalance,
            percentage,
            rank: 0 // Will be set after sorting
          };
        })
        .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));
      
      // Add ranks
      holders.forEach((holder, index) => {
        holder.rank = index + 1;
      });
      
      return {
        mintAddress,
        tokenInfo: metadata,
        holders,
        totalHolders: totalAccounts,
        uniqueHolders: holderMap.size,
        fetchedAt: new Date()
      };
      
    } catch (error) {
      logger.error(`Failed to fetch all holders for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch a single page of token accounts
   */
  private async fetchTokenAccountsPage(
    mintAddress: string,
    page: number
  ): Promise<HeliusTokenAccountsResponse | null> {
    try {
      const response = await API_RATE_LIMITERS.helius.execute(async () =>
        axios.post<HeliusTokenAccountsResponse>(
          this.rpcUrl,
          {
            jsonrpc: "2.0",
            id: "helius-holder-fetch",
            method: "getTokenAccounts",
            params: {
              page: page,
              limit: 1000, // Max limit per page
              mint: mintAddress,
              options: {
                showZeroBalance: false // Filter out zero balance accounts
              }
            }
          },
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      );
      
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn(`Rate limited on page ${page}, waiting...`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Increased wait time
        // Retry once
        return this.fetchTokenAccountsPage(mintAddress, page);
      }
      throw error;
    }
  }

  /**
   * Fetch token metadata
   */
  private async fetchTokenMetadata(mintAddress: string): Promise<any> {
    try {
      const response = await API_RATE_LIMITERS.helius.execute(async () =>
        axios.post(
          `https://api.helius.xyz/v0/token-metadata?api-key=${this.apiKey}`,
          {
            mintAccounts: [mintAddress],
            includeOffChain: true,
            disableCache: false
          }
        )
      );
      
      const metadata = response.data?.[0];
      if (!metadata) {
        // Return minimal metadata
        return {
          name: 'Unknown',
          symbol: 'Unknown',
          decimals: 9,
          supply: '0'
        };
      }
      
      return {
        name: metadata.onChainMetadata?.metadata?.name || metadata.offChainMetadata?.name || 'Unknown',
        symbol: metadata.onChainMetadata?.metadata?.symbol || metadata.offChainMetadata?.symbol || 'Unknown',
        decimals: metadata.onChainMetadata?.tokenStandard?.decimals || 9,
        supply: metadata.onChainMetadata?.supply || '0',
        image: metadata.offChainMetadata?.image
      };
    } catch (error) {
      logger.warn(`Failed to fetch metadata for ${mintAddress}:`, error);
      return {
        name: 'Unknown',
        symbol: 'Unknown',
        decimals: 9,
        supply: '0'
      };
    }
  }

  /**
   * Get top holders only (faster method)
   */
  async getTopHolders(
    mintAddress: string,
    limit: number = 100
  ): Promise<CompleteHolderData | null> {
    // For top holders, we can use the first page or two
    const data = await this.fetchAllHolders(mintAddress, { pageLimit: Math.ceil(limit / 1000) });
    
    if (data) {
      data.holders = data.holders.slice(0, limit);
    }
    
    return data;
  }
}