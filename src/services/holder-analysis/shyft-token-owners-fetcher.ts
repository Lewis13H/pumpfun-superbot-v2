/**
 * Shyft Token Owners Fetcher
 * 
 * Uses Shyft's getTokenOwners endpoint to fetch token holders
 * Based on: https://api.shyft.to/sol/api/explore/#/Token/GetTokenController_getTokenOwners
 */

import axios from 'axios';
import { logger } from '../../core/logger';
import { EventEmitter } from 'events';

export interface ShyftTokenOwner {
  owner: string;
  associated_account: string;
  balance: number;
  info?: {
    lamports: number;
    owner: string;
    executable: boolean;
    rent_epoch: number;
  };
}

export interface ShyftTokenOwnersResponse {
  success: boolean;
  message: string;
  result: ShyftTokenOwner[];
}

export interface ShyftCompleteHolderData {
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
  fetchedAt: Date;
}

export class ShyftTokenOwnersFetcher extends EventEmitter {
  private apiKey: string;
  private baseUrl: string = 'https://api.shyft.to/sol/v1';
  
  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.SHYFT_API_KEY || '';
    
    if (!this.apiKey) {
      logger.warn('Shyft API key not provided');
    }
  }

  /**
   * Fetch all token owners using Shyft's getTokenOwners endpoint
   */
  async fetchAllOwners(
    mintAddress: string,
    options: {
      network?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ShyftCompleteHolderData | null> {
    const { 
      network = 'mainnet-beta',
      limit = 1000,
      offset = 0
    } = options;
    
    try {
      logger.debug(`Fetching token owners for ${mintAddress} using Shyft API`);
      
      // First get token info
      const tokenInfo = await this.fetchTokenInfo(mintAddress, network);
      
      // Fetch token owners
      const ownersResponse = await axios.get<ShyftTokenOwnersResponse>(
        `${this.baseUrl}/token/owners`,
        {
          headers: {
            'x-api-key': this.apiKey
          },
          params: {
            network,
            token_address: mintAddress,
            limit,
            offset
          }
        }
      );
      
      if (!ownersResponse.data.success || !ownersResponse.data.result) {
        logger.error(`Failed to fetch token owners: ${ownersResponse.data.message}`);
        return null;
      }
      
      const owners = ownersResponse.data.result;
      logger.debug(`Fetched ${owners.length} token owners for ${mintAddress}`);
      
      // Calculate total supply for percentage calculations
      const totalSupply = tokenInfo.supply ? parseFloat(tokenInfo.supply) : 0;
      
      // Transform to our holder format
      const holders = owners
        .map((owner, index) => {
          const uiBalance = owner.balance;
          const percentage = totalSupply > 0 
            ? (uiBalance / (totalSupply / Math.pow(10, tokenInfo.decimals))) * 100 
            : 0;
          
          return {
            address: owner.owner,
            balance: (owner.balance * Math.pow(10, tokenInfo.decimals)).toString(),
            uiBalance: uiBalance,
            percentage,
            rank: index + 1
          };
        })
        .sort((a, b) => b.uiBalance - a.uiBalance);
      
      // Re-rank after sorting
      holders.forEach((holder, index) => {
        holder.rank = index + 1;
      });
      
      return {
        mintAddress,
        tokenInfo,
        holders,
        totalHolders: holders.length,
        fetchedAt: new Date()
      };
      
    } catch (error: any) {
      logger.error(`Failed to fetch token owners for ${mintAddress}:`, error);
      
      if (error.response?.status === 404) {
        logger.warn(`Token owners endpoint not found - Shyft API may have changed`);
      } else if (error.response?.status === 429) {
        logger.warn(`Rate limited by Shyft API`);
      }
      
      return null;
    }
  }

  /**
   * Fetch token info from Shyft
   */
  private async fetchTokenInfo(mintAddress: string, network: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/token/info`,
        {
          headers: {
            'x-api-key': this.apiKey
          },
          params: {
            network,
            token_address: mintAddress
          }
        }
      );
      
      if (response.data.success && response.data.result) {
        const info = response.data.result;
        return {
          name: info.name || 'Unknown',
          symbol: info.symbol || 'Unknown',
          decimals: info.decimals || 9,
          supply: info.current_supply || '0',
          image: info.image
        };
      }
    } catch (error) {
      logger.warn(`Failed to fetch token info for ${mintAddress}:`, error);
    }
    
    // Return default info if fetch fails
    return {
      name: 'Unknown',
      symbol: 'Unknown',
      decimals: 9,
      supply: '0'
    };
  }

  /**
   * Fetch paginated owners if there are more than the limit
   */
  async fetchAllOwnersPaginated(
    mintAddress: string,
    maxPages: number = 10
  ): Promise<ShyftCompleteHolderData | null> {
    const limit = 1000; // Max per page
    let allOwners: ShyftTokenOwner[] = [];
    let offset = 0;
    let hasMore = true;
    let page = 0;
    
    // Get token info first
    const tokenInfo = await this.fetchTokenInfo(mintAddress, 'mainnet-beta');
    
    while (hasMore && page < maxPages) {
      try {
        const response = await axios.get<ShyftTokenOwnersResponse>(
          `${this.baseUrl}/token/owners`,
          {
            headers: {
              'x-api-key': this.apiKey
            },
            params: {
              network: 'mainnet-beta',
              token_address: mintAddress,
              limit,
              offset
            }
          }
        );
        
        if (!response.data.success || !response.data.result) {
          hasMore = false;
          break;
        }
        
        const owners = response.data.result;
        allOwners = allOwners.concat(owners);
        
        // Check if we got less than limit (no more pages)
        if (owners.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
          page++;
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        logger.info(`Fetched page ${page + 1}: ${owners.length} owners (total: ${allOwners.length})`);
        
      } catch (error) {
        logger.error(`Error fetching page ${page + 1}:`, error);
        hasMore = false;
      }
    }
    
    if (allOwners.length === 0) {
      return null;
    }
    
    // Calculate total supply for percentage calculations
    const totalSupply = tokenInfo.supply ? parseFloat(tokenInfo.supply) : 0;
    
    // Transform and sort holders
    const holders = allOwners
      .map((owner) => {
        const uiBalance = owner.balance;
        const percentage = totalSupply > 0 
          ? (uiBalance / (totalSupply / Math.pow(10, tokenInfo.decimals))) * 100 
          : 0;
        
        return {
          address: owner.owner,
          balance: (owner.balance * Math.pow(10, tokenInfo.decimals)).toString(),
          uiBalance: uiBalance,
          percentage
        };
      })
      .sort((a, b) => b.uiBalance - a.uiBalance);
    
    // Add ranks
    holders.forEach((holder, index) => {
      holder.rank = index + 1;
    });
    
    return {
      mintAddress,
      tokenInfo,
      holders,
      totalHolders: holders.length,
      fetchedAt: new Date()
    };
  }
}