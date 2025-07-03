/**
 * GraphQL Client with Connection Pooling and Error Handling
 */

import { GraphQLClient } from 'graphql-request';
import { GRAPHQL_CONFIG, validateGraphQLConfig } from '../../config/graphql.config';
import { GraphQLError } from '../../types/graphql.types';
import chalk from 'chalk';

export class ShyftGraphQLClient {
  private static instance: ShyftGraphQLClient;
  private client: GraphQLClient;
  private requestCount: number = 0;
  private errorCount: number = 0;
  private lastRequestTime: number = 0;
  
  private constructor() {
    validateGraphQLConfig();
    
    this.client = new GraphQLClient(GRAPHQL_CONFIG.endpoint, {
      headers: {
        'Content-Type': 'application/json',
      },
      // timeout: GRAPHQL_CONFIG.timeout, // timeout not supported in graphql-request v6+
    });
    
    if (process.env.DISABLE_MONITOR_STATS !== 'true') {
      console.log(chalk.green('✅ GraphQL client initialized'));
    }
  }
  
  static getInstance(): ShyftGraphQLClient {
    if (!ShyftGraphQLClient.instance) {
      ShyftGraphQLClient.instance = new ShyftGraphQLClient();
    }
    return ShyftGraphQLClient.instance;
  }
  
  /**
   * Execute a GraphQL query with retry logic
   */
  async query<T>(
    query: string,
    variables?: Record<string, any>,
    retries: number = GRAPHQL_CONFIG.maxRetries
  ): Promise<T> {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < GRAPHQL_CONFIG.batchDelay) {
      await this.sleep(GRAPHQL_CONFIG.batchDelay - timeSinceLastRequest);
    }
    
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.lastRequestTime = Date.now();
        this.requestCount++;
        
        const result = await this.client.request<T>(query, variables);
        return result;
        
      } catch (error: any) {
        lastError = error;
        this.errorCount++;
        
        console.error(chalk.red(`GraphQL error (attempt ${attempt + 1}/${retries + 1}):`), error.message);
        
        // Check if error is retryable
        if (!this.isRetryableError(error) || attempt === retries) {
          throw this.formatError(error);
        }
        
        // Exponential backoff
        const delay = GRAPHQL_CONFIG.retryDelay * Math.pow(2, attempt);
        console.log(chalk.yellow(`Retrying in ${delay}ms...`));
        await this.sleep(delay);
      }
    }
    
    throw lastError || new Error('GraphQL query failed');
  }
  
  /**
   * Execute multiple queries in batch
   */
  async batchQuery<T>(
    queries: Array<{ query: string; variables?: Record<string, any> }>
  ): Promise<T[]> {
    const results: T[] = [];
    
    for (const { query, variables } of queries) {
      try {
        const result = await this.query<T>(query, variables);
        results.push(result);
      } catch (error) {
        console.error(chalk.red('Batch query error:'), error);
        throw error;
      }
    }
    
    return results;
  }
  
  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return true;
    }
    
    // GraphQL specific errors
    const graphqlError = error as GraphQLError;
    if (graphqlError.extensions?.code) {
      const code = graphqlError.extensions.code;
      // Rate limiting, server errors
      return code === 'RATE_LIMITED' || code === 'INTERNAL_SERVER_ERROR';
    }
    
    // HTTP status codes
    if (error.response?.status) {
      const status = error.response.status;
      return status >= 500 || status === 429; // Server errors or rate limit
    }
    
    return false;
  }
  
  /**
   * Format error for better logging
   */
  private formatError(error: any): Error {
    if (error.response?.errors) {
      const graphqlErrors = error.response.errors as GraphQLError[];
      const messages = graphqlErrors.map(e => e.message).join('; ');
      return new Error(`GraphQL Error: ${messages}`);
    }
    
    if (error.message) {
      return new Error(`GraphQL Request Error: ${error.message}`);
    }
    
    return new Error('Unknown GraphQL error');
  }
  
  /**
   * Get client statistics
   */
  getStats() {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
      lastRequestTime: this.lastRequestTime,
    };
  }
  
  /**
   * Reset statistics
   */
  resetStats(): void {
    this.requestCount = 0;
    this.errorCount = 0;
  }
  
  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}