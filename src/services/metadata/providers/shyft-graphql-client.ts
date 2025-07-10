/**
 * Shyft GraphQL Client
 * Provides GraphQL interface for Shyft API with batching and caching
 */

import axios from 'axios';
import chalk from 'chalk';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    path?: string[];
  }>;
}

interface TokenMetadataQL {
  address: string;
  name?: string;
  symbol?: string;
  uri?: string;
  description?: string;
  image?: string;
  decimals: number;
  supply: string;
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  update_authority?: string;
  mint_authority?: string;
  freeze_authority?: string;
  is_mutable?: boolean;
  holder_count?: number;
  top_holders?: Array<{
    owner: string;
    balance: string;
    percentage: number;
  }>;
}

interface TransactionHistoryQL {
  signature: string;
  timestamp: number;
  type: string;
  status: string;
  fee: number;
  from: string;
  to?: string;
  amount?: string;
  program_id: string;
  instructions: Array<{
    program: string;
    type: string;
    data: any;
  }>;
}

export class ShyftGraphQLClient {
  private static instance: ShyftGraphQLClient;
  private readonly apiKey: string;
  private readonly graphqlEndpoint = 'https://api.shyft.to/sol/graphql';
  private readonly batchQueue: Map<string, Array<(result: any) => void>> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_DELAY = 100; // 100ms to collect batch requests
  
  // Cache
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_TTL = 300000; // 5 minutes
  
  // Stats
  private stats = {
    totalRequests: 0,
    batchedRequests: 0,
    cacheHits: 0,
    errors: 0
  };

  private constructor() {
    this.apiKey = process.env.SHYFT_API_KEY || process.env.SHYFT_GRPC_TOKEN || '';
    if (!this.apiKey) {
      console.warn(chalk.yellow('⚠️ SHYFT_API_KEY not found for GraphQL client'));
    }
  }

  static getInstance(): ShyftGraphQLClient {
    if (!this.instance) {
      this.instance = new ShyftGraphQLClient();
    }
    return this.instance;
  }

  /**
   * Get token metadata using GraphQL
   */
  async getTokenMetadata(mintAddress: string): Promise<TokenMetadataQL | null> {
    const cacheKey = `metadata:${mintAddress}`;
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.stats.cacheHits++;
      return cached.data;
    }

    const query = `
      query GetTokenMetadata($address: String!) {
        token(address: $address, network: "mainnet-beta") {
          address
          name
          symbol
          uri
          description
          image
          decimals
          supply
          creators {
            address
            share
            verified
          }
          update_authority
          mint_authority
          freeze_authority
          is_mutable
          holder_count
          top_holders(limit: 20) {
            owner
            balance
            percentage
          }
        }
      }
    `;

    try {
      const response = await this.query<{ token: TokenMetadataQL }>(query, {
        address: mintAddress
      });

      if (response.data?.token) {
        // Cache the result
        this.cache.set(cacheKey, {
          data: response.data.token,
          timestamp: Date.now()
        });
        return response.data.token;
      }
      return null;
    } catch (error) {
      console.error(chalk.red(`GraphQL error fetching metadata for ${mintAddress}:`), error);
      return null;
    }
  }

  /**
   * Get token metadata for multiple tokens in batch
   */
  async getTokenMetadataBatch(mintAddresses: string[]): Promise<Map<string, TokenMetadataQL | null>> {
    const results = new Map<string, TokenMetadataQL | null>();
    const uncachedAddresses: string[] = [];

    // Check cache first
    for (const address of mintAddresses) {
      const cacheKey = `metadata:${address}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.stats.cacheHits++;
        results.set(address, cached.data);
      } else {
        uncachedAddresses.push(address);
      }
    }

    if (uncachedAddresses.length === 0) {
      return results;
    }

    // Batch query for uncached tokens
    const query = `
      query GetTokenMetadataBatch($addresses: [String!]!) {
        tokens(addresses: $addresses, network: "mainnet-beta") {
          address
          name
          symbol
          uri
          description
          image
          decimals
          supply
          creators {
            address
            share
            verified
          }
          update_authority
          mint_authority
          freeze_authority
          is_mutable
          holder_count
        }
      }
    `;

    try {
      const response = await this.query<{ tokens: TokenMetadataQL[] }>(query, {
        addresses: uncachedAddresses
      });

      if (response.data?.tokens) {
        for (const token of response.data.tokens) {
          results.set(token.address, token);
          // Cache the result
          this.cache.set(`metadata:${token.address}`, {
            data: token,
            timestamp: Date.now()
          });
        }
        
        // Set null for tokens not found
        for (const address of uncachedAddresses) {
          if (!results.has(address)) {
            results.set(address, null);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red('GraphQL batch query error:'), error);
      // Set all uncached as null on error
      for (const address of uncachedAddresses) {
        results.set(address, null);
      }
    }

    this.stats.batchedRequests++;
    return results;
  }

  /**
   * Get transaction history for a token
   */
  async getTokenTransactionHistory(
    mintAddress: string,
    limit: number = 50,
    beforeSignature?: string
  ): Promise<TransactionHistoryQL[]> {
    const query = `
      query GetTokenHistory($address: String!, $limit: Int!, $before: String) {
        tokenTransactions(
          address: $address,
          network: "mainnet-beta",
          limit: $limit,
          before: $before
        ) {
          signature
          timestamp
          type
          status
          fee
          from
          to
          amount
          program_id
          instructions {
            program
            type
            data
          }
        }
      }
    `;

    try {
      const response = await this.query<{ tokenTransactions: TransactionHistoryQL[] }>(
        query,
        {
          address: mintAddress,
          limit,
          before: beforeSignature
        }
      );

      return response.data?.tokenTransactions || [];
    } catch (error) {
      console.error(chalk.red(`GraphQL error fetching history for ${mintAddress}:`), error);
      return [];
    }
  }

  /**
   * Get token creation transaction
   */
  async getTokenCreationTransaction(mintAddress: string): Promise<TransactionHistoryQL | null> {
    const query = `
      query GetTokenCreation($address: String!) {
        tokenCreation(address: $address, network: "mainnet-beta") {
          signature
          timestamp
          type
          status
          fee
          from
          program_id
          instructions {
            program
            type
            data
          }
        }
      }
    `;

    try {
      const response = await this.query<{ tokenCreation: TransactionHistoryQL }>(
        query,
        { address: mintAddress }
      );

      return response.data?.tokenCreation || null;
    } catch (error) {
      console.error(chalk.red(`GraphQL error fetching creation tx for ${mintAddress}:`), error);
      return null;
    }
  }

  /**
   * Execute GraphQL query
   */
  private async query<T>(query: string, variables: any = {}): Promise<GraphQLResponse<T>> {
    this.stats.totalRequests++;

    try {
      const response = await axios.post(
        this.graphqlEndpoint,
        {
          query,
          variables
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data.errors) {
        console.error(chalk.red('GraphQL errors:'), response.data.errors);
        this.stats.errors++;
      }

      return response.data;
    } catch (error) {
      this.stats.errors++;
      if (axios.isAxiosError(error)) {
        console.error(chalk.red('GraphQL request failed:'), error.message);
        if (error.response?.data) {
          console.error('Response:', error.response.data);
        }
      }
      throw error;
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheHitRate: this.stats.cacheHits / (this.stats.totalRequests || 1)
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}