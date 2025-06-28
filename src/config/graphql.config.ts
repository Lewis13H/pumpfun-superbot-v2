/**
 * GraphQL Configuration for Shyft API
 */

export const GRAPHQL_CONFIG = {
  // Shyft GraphQL endpoint with API key and network
  endpoint: `https://programs.shyft.to/v0/graphql/?api_key=${process.env.SHYFT_API_KEY || ''}&network=mainnet-beta`,
  
  // API configuration
  apiKey: process.env.SHYFT_API_KEY || '',
  
  // Request configuration
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  
  // Batch configuration
  maxBatchSize: 100, // Max tokens per query
  batchDelay: 100, // Delay between batches (ms)
  
  // Cache configuration
  cacheEnabled: true,
  cacheTTL: 300, // 5 minutes
  maxCacheSize: 10000, // Max cached entries
};

// Validate configuration
export function validateGraphQLConfig(): void {
  if (!GRAPHQL_CONFIG.apiKey) {
    throw new Error('SHYFT_API_KEY environment variable is required');
  }
  
  if (!GRAPHQL_CONFIG.endpoint) {
    throw new Error('GraphQL endpoint is not configured');
  }
}