/**
 * Shyft DAS API Client for Holder Analysis
 * 
 * Uses Shyft's Digital Asset Standard (DAS) API for fetching token holder data
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../core/logger';
import { API_RATE_LIMITERS } from '../../utils/api-rate-limiter';

export interface ShyftTokenHolder {
  address: string;
  amount: string;
  decimals: number;
  uiAmount: number;
  percentage: number;
}

export interface ShyftTokenInfo {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  updateAuthority?: string;
  freezeAuthority?: string;
}

export interface ShyftHoldersResponse {
  success: boolean;
  message: string;
  result: {
    token: ShyftTokenInfo;
    holders: ShyftTokenHolder[];
    totalHolders: number;
    page: number;
    limit: number;
  };
}

export interface ShyftWalletAssets {
  address: string;
  sol_balance: number;
  tokens: Array<{
    mint: string;
    amount: string;
    decimals: number;
    uiAmount: number;
  }>;
  nfts: Array<{
    mint: string;
    name: string;
    collection?: string;
  }>;
}

export interface ShyftTransactionInfo {
  signature: string;
  timestamp: number;
  type: string;
  status: 'success' | 'failed';
  fee: number;
  feePayer: string;
  instructions: any[];
}

export class ShyftDasApiClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl = 'https://api.shyft.to/sol/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.SHYFT_API_KEY || '';
    
    if (!this.apiKey) {
      throw new Error('Shyft API key is required');
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey
      }
    });

    // Add request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`Shyft DAS API request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Shyft DAS API request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error?.response) {
          // Downgrade 404 errors for token/holders endpoint since it doesn't exist
          if (error.response.status === 404 && error.config?.url?.includes('/token/holders')) {
            logger.debug(`Shyft token/holders endpoint not found (expected)`);
          } else {
            logger.error(`Shyft DAS API error: ${error.response.status} - ${error.response.data?.message || error.message}`);
          }
        } else if (error?.message) {
          logger.error('Shyft DAS API network error:', error.message);
        } else {
          logger.error('Shyft DAS API unknown error');
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get token holders using DAS API
   */
  async getTokenHolders(
    mintAddress: string,
    page: number = 1,
    limit: number = 100,
    network: string = 'mainnet-beta'
  ): Promise<ShyftHoldersResponse | null> {
    try {
      const response = await API_RATE_LIMITERS.shyft.execute(async () =>
        this.client.get('/token/holders', {
          params: {
            network,
            token_address: mintAddress,
            page,
            size: limit
          }
        })
      );

      // Transform response to match our interface
      const data = response.data;
      if (!data.success) {
        logger.error('Shyft API returned unsuccessful response:', data.message);
        return null;
      }

      // Calculate percentages if not provided
      const totalSupply = parseFloat(data.result.total_supply || '0');
      const holders = data.result.data.map((holder: any) => {
        const amount = parseFloat(holder.amount || '0');
        const percentage = totalSupply > 0 ? (amount / totalSupply) * 100 : 0;
        
        return {
          address: holder.owner,
          amount: holder.amount,
          decimals: data.result.decimals || 9,
          uiAmount: amount / Math.pow(10, data.result.decimals || 9),
          percentage
        };
      });

      return {
        success: true,
        message: data.message,
        result: {
          token: {
            mint: mintAddress,
            name: data.result.name || '',
            symbol: data.result.symbol || '',
            decimals: data.result.decimals || 9,
            supply: data.result.total_supply || '0',
            updateAuthority: data.result.update_authority,
            freezeAuthority: data.result.freeze_authority
          },
          holders,
          totalHolders: data.result.total_holders || holders.length,
          page,
          limit
        }
      };
    } catch (error: any) {
      // Don't log 404 errors since we know the endpoint doesn't exist
      if (error?.response?.status !== 404) {
        logger.error(`Failed to fetch token holders from Shyft for ${mintAddress}:`, error);
      }
      return null;
    }
  }

  /**
   * Get all token holders (handles pagination)
   */
  async getAllTokenHolders(
    mintAddress: string,
    maxHolders: number = 1000,
    network: string = 'mainnet-beta'
  ): Promise<ShyftTokenHolder[]> {
    const allHolders: ShyftTokenHolder[] = [];
    let page = 1;
    const limit = 100;

    while (allHolders.length < maxHolders) {
      const response = await this.getTokenHolders(mintAddress, page, limit, network);
      if (!response || !response.result.holders || response.result.holders.length === 0) {
        break;
      }

      allHolders.push(...response.result.holders);

      // Check if we've fetched all holders
      if (allHolders.length >= response.result.totalHolders) {
        break;
      }

      // Check if this was the last page
      if (response.result.holders.length < limit) {
        break;
      }

      page++;

      // Rate limit protection (Shyft has rate limits)
      await this.delay(200);
    }

    return allHolders.slice(0, maxHolders);
  }

  /**
   * Get wallet portfolio
   */
  async getWalletAssets(
    walletAddress: string,
    network: string = 'mainnet-beta'
  ): Promise<ShyftWalletAssets | null> {
    try {
      const response = await API_RATE_LIMITERS.shyft.execute(async () =>
        this.client.get('/wallet/all_tokens', {
          params: {
            network,
            wallet: walletAddress
          }
        })
      );

      if (!response.data.success) {
        logger.error('Failed to fetch wallet assets:', response.data.message);
        return null;
      }

      const result = response.data.result;
      
      return {
        address: walletAddress,
        sol_balance: result.balance || 0,
        tokens: result.tokens || [],
        nfts: result.nfts || []
      };
    } catch (error) {
      logger.error(`Failed to fetch wallet assets for ${walletAddress}:`, error);
      return null;
    }
  }

  /**
   * Get transaction history for a wallet
   */
  async getWalletTransactions(
    walletAddress: string,
    limit: number = 50,
    network: string = 'mainnet-beta'
  ): Promise<ShyftTransactionInfo[]> {
    try {
      const response = await API_RATE_LIMITERS.shyft.execute(async () =>
        this.client.get('/transaction/history', {
          params: {
            network,
            account: walletAddress,
            limit,
            tx_num: limit
          }
        })
      );

      if (!response.data.success) {
        logger.error('Failed to fetch transaction history:', response.data.message);
        return [];
      }

      return response.data.result.map((tx: any) => ({
        signature: tx.signatures?.[0] || tx.txHash,
        timestamp: tx.timestamp,
        type: tx.type || 'unknown',
        status: tx.status,
        fee: tx.fee || 0,
        feePayer: tx.fee_payer || tx.feePayer,
        instructions: tx.instructions || []
      }));
    } catch (error) {
      logger.error(`Failed to fetch transactions for ${walletAddress}:`, error);
      return [];
    }
  }

  /**
   * Analyze wallet for classification hints
   */
  async analyzeWalletForClassification(walletAddress: string): Promise<{
    isBot: boolean;
    isSniper: boolean;
    isDeveloper: boolean;
    tradingPatterns: any;
  }> {
    try {
      // Get transaction history
      const transactions = await this.getWalletTransactions(walletAddress, 100);
      
      // Get wallet assets
      const assets = await this.getWalletAssets(walletAddress);

      // Analyze patterns
      const analysis = {
        isBot: false,
        isSniper: false,
        isDeveloper: false,
        tradingPatterns: {
          transactionCount: transactions.length,
          uniqueTokensTraded: new Set<string>(),
          averageTimeBetweenTx: 0,
          hasNFTs: assets?.nfts && assets.nfts.length > 0,
          tokenCount: assets?.tokens?.length || 0
        }
      };

      // Bot detection: high frequency, consistent timing
      if (transactions.length > 50) {
        const timeDiffs = this.calculateTransactionTimeDiffs(transactions);
        const avgDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
        if (avgDiff < 60 && timeDiffs.length > 20) {
          analysis.isBot = true;
        }
        analysis.tradingPatterns.averageTimeBetweenTx = avgDiff;
      }

      // Sniper detection: very early token purchases
      const tokenMints = transactions.filter(tx => 
        tx.type === 'TOKEN_MINT' || 
        (tx.instructions && tx.instructions.some((inst: any) => 
          inst.programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' // pump.fun program
        ))
      );

      if (tokenMints.length > 5) {
        analysis.isSniper = true;
      }

      // Developer detection: creates tokens or has update authority
      const hasCreatedTokens = transactions.some(tx => 
        tx.type === 'CREATE_TOKEN' || 
        tx.type === 'TOKEN_MINT'
      );
      
      if (hasCreatedTokens) {
        analysis.isDeveloper = true;
      }

      return analysis;
    } catch (error) {
      logger.error(`Failed to analyze wallet ${walletAddress}:`, error);
      return {
        isBot: false,
        isSniper: false,
        isDeveloper: false,
        tradingPatterns: {}
      };
    }
  }

  /**
   * Get token creation info
   */
  async getTokenCreationInfo(mintAddress: string): Promise<{
    creator?: string;
    creationTime?: number;
    initialSupply?: string;
  } | null> {
    try {
      const response = await API_RATE_LIMITERS.shyft.execute(async () =>
        this.client.get('/token/get_info', {
          params: {
            network: 'mainnet-beta',
            token_address: mintAddress
          }
        })
      );

      if (!response.data.success) {
        return null;
      }

      const tokenInfo = response.data.result;
      
      // Try to get creation transaction
      const creationTx = await this.getTokenCreationTransaction(mintAddress);
      
      return {
        creator: tokenInfo.update_authority || creationTx?.feePayer,
        creationTime: creationTx?.timestamp,
        initialSupply: tokenInfo.supply
      };
    } catch (error) {
      logger.error(`Failed to get token creation info for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Helper: Get token creation transaction
   */
  private async getTokenCreationTransaction(_mintAddress: string): Promise<any> {
    try {
      // This would need to search for the token creation transaction
      // For now, return null as this requires more complex logic
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Helper: Calculate time differences between transactions
   */
  private calculateTransactionTimeDiffs(transactions: ShyftTransactionInfo[]): number[] {
    const diffs: number[] = [];
    for (let i = 1; i < transactions.length; i++) {
      const diff = Math.abs(transactions[i].timestamp - transactions[i-1].timestamp);
      diffs.push(diff);
    }
    return diffs;
  }

  /**
   * Helper: Rate limiting delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}