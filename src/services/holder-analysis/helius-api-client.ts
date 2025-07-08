/**
 * Helius API Client for Holder Analysis
 * 
 * Provides methods to fetch holder data and token information from Helius
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../core/logger';

export interface HeliusTokenHolder {
  owner: string;
  balance: number;
  decimals: number;
}

export interface HeliusTokenHoldersResponse {
  result: {
    token_info: {
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      supply: string;
      price_info?: {
        price_per_token: number;
        currency: string;
      };
    };
    owners: HeliusTokenHolder[];
    pagination?: {
      page: number;
      limit: number;
      total_pages: number;
    };
  };
}

export interface HeliusWalletInfo {
  address: string;
  sol_balance: number;
  token_count: number;
  transaction_count: number;
  first_transaction_time?: string;
  last_transaction_time?: string;
}

export interface HeliusTransactionPattern {
  is_bot: boolean;
  is_sniper: boolean;
  mev_activity: boolean;
  bundler_usage: boolean;
  trading_frequency: 'high' | 'medium' | 'low';
  profit_loss?: number;
}

export class HeliusApiClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl = 'https://api.helius.xyz/v0';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.HELIUS_API_KEY || '';
    
    if (!this.apiKey) {
      logger.warn('Helius API key not provided - some features may be limited');
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`Helius API request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Helius API request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          logger.error(`Helius API error: ${error.response.status} - ${error.response.data?.error || error.message}`);
        } else {
          logger.error('Helius API network error:', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get token holders for a specific token
   */
  async getTokenHolders(
    mintAddress: string,
    page: number = 1,
    limit: number = 100
  ): Promise<HeliusTokenHoldersResponse | null> {
    try {
      const response = await this.client.post('/token/holders', {
        mint: mintAddress,
        page,
        limit
      }, {
        params: { 'api-key': this.apiKey }
      });

      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch token holders for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Get all token holders (paginated)
   */
  async getAllTokenHolders(
    mintAddress: string,
    maxHolders: number = 1000
  ): Promise<HeliusTokenHolder[]> {
    const allHolders: HeliusTokenHolder[] = [];
    let page = 1;
    const limit = 100;

    while (allHolders.length < maxHolders) {
      const response = await this.getTokenHolders(mintAddress, page, limit);
      if (!response || !response.result.owners || response.result.owners.length === 0) {
        break;
      }

      allHolders.push(...response.result.owners);

      // Check if we've reached the last page
      if (response.result.pagination) {
        if (page >= response.result.pagination.total_pages) {
          break;
        }
      } else if (response.result.owners.length < limit) {
        break;
      }

      page++;

      // Rate limit protection
      await this.delay(100);
    }

    return allHolders.slice(0, maxHolders);
  }

  /**
   * Get wallet information and classification hints
   */
  async getWalletInfo(walletAddress: string): Promise<HeliusWalletInfo | null> {
    try {
      const response = await this.client.get(`/addresses/${walletAddress}/balances`, {
        params: { 'api-key': this.apiKey }
      });

      // Get transaction history for classification
      const txResponse = await this.client.get(`/addresses/${walletAddress}/transactions`, {
        params: { 
          'api-key': this.apiKey,
          limit: 100
        }
      });

      const transactions = txResponse.data || [];
      const firstTx = transactions[transactions.length - 1];
      const lastTx = transactions[0];

      return {
        address: walletAddress,
        sol_balance: response.data.nativeBalance || 0,
        token_count: response.data.tokens?.length || 0,
        transaction_count: transactions.length,
        first_transaction_time: firstTx?.timestamp,
        last_transaction_time: lastTx?.timestamp
      };
    } catch (error) {
      logger.error(`Failed to fetch wallet info for ${walletAddress}:`, error);
      return null;
    }
  }

  /**
   * Analyze wallet transaction patterns for classification
   */
  async analyzeWalletPatterns(walletAddress: string): Promise<HeliusTransactionPattern | null> {
    try {
      const response = await this.client.get(`/addresses/${walletAddress}/transactions`, {
        params: { 
          'api-key': this.apiKey,
          limit: 100,
          type: 'SWAP'
        }
      });

      const transactions = response.data || [];
      
      // Analyze patterns
      const analysis: HeliusTransactionPattern = {
        is_bot: false,
        is_sniper: false,
        mev_activity: false,
        bundler_usage: false,
        trading_frequency: 'low',
        profit_loss: 0
      };

      if (transactions.length === 0) return analysis;

      // Check for bot patterns
      const timeDiffs = this.calculateTimeDifferences(transactions);
      const avgTimeDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
      
      // Bot detection: very consistent timing
      if (avgTimeDiff < 10 && timeDiffs.length > 10) {
        analysis.is_bot = true;
      }

      // Sniper detection: very early transactions
      const tokenCreationTimes = this.extractTokenCreationTimes(transactions);
      const sniperTrades = tokenCreationTimes.filter(t => t < 60); // Within 1 minute
      if (sniperTrades.length > 3) {
        analysis.is_sniper = true;
      }

      // MEV detection: sandwich attacks or frontrunning
      analysis.mev_activity = this.detectMEVActivity(transactions);

      // Bundler detection
      analysis.bundler_usage = transactions.some((tx: any) => 
        tx.description?.includes('bundle') || 
        tx.feePayer !== walletAddress
      );

      // Trading frequency
      if (transactions.length > 50) analysis.trading_frequency = 'high';
      else if (transactions.length > 20) analysis.trading_frequency = 'medium';

      return analysis;
    } catch (error) {
      logger.error(`Failed to analyze wallet patterns for ${walletAddress}:`, error);
      return null;
    }
  }

  /**
   * Get token metadata
   */
  async getTokenMetadata(mintAddress: string): Promise<any> {
    try {
      const response = await this.client.get(`/token-metadata`, {
        params: { 
          'api-key': this.apiKey,
          mint: mintAddress
        }
      });

      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch token metadata for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Helper: Calculate time differences between transactions
   */
  private calculateTimeDifferences(transactions: any[]): number[] {
    const diffs: number[] = [];
    for (let i = 1; i < transactions.length; i++) {
      const diff = Math.abs(transactions[i].timestamp - transactions[i-1].timestamp);
      diffs.push(diff);
    }
    return diffs;
  }

  /**
   * Helper: Extract token creation times from transactions
   */
  private extractTokenCreationTimes(transactions: any[]): number[] {
    // This is a simplified version - in reality, you'd need to parse the transaction
    // to find token creation events and calculate time differences
    return transactions
      .filter(tx => tx.type === 'TOKEN_MINT')
      .map(tx => tx.timestamp);
  }

  /**
   * Helper: Detect MEV activity patterns
   */
  private detectMEVActivity(transactions: any[]): boolean {
    // Look for sandwich attack patterns
    for (let i = 1; i < transactions.length - 1; i++) {
      const prev = transactions[i - 1];
      const curr = transactions[i];
      const next = transactions[i + 1];

      // Check if transactions are in same block
      if (prev.slot === curr.slot && curr.slot === next.slot) {
        // Check if it's a sandwich pattern (buy-victim-sell)
        if (prev.type === 'SWAP' && next.type === 'SWAP') {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Helper: Rate limiting delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}