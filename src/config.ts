// src/config.ts

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  database: {
    connectionString: process.env.DATABASE_URL || 'postgresql://pump_user:password@localhost:5433/pump_monitor',
    poolSize: 20,
    idleTimeout: 30000,
    connectionTimeout: 2000
  },
  
  shyft: {
    apiKey: process.env.SHYFT_API_KEY!,
    endpoint: process.env.SHYFT_GRPC_ENDPOINT || 'grpc.shyft.to',
    token: process.env.SHYFT_GRPC_TOKEN!,
    rateLimit: parseInt(process.env.SHYFT_RATE_LIMIT || '2')
  },
  
  websocket: {
    port: parseInt(process.env.WS_PORT || '8080')
  },

  web: {
    port: parseInt(process.env.WEB_PORT || '3000')
  },
  
  monitoring: {
    flushInterval: parseInt(process.env.FLUSH_INTERVAL || '10000'),
    archiveThreshold: parseInt(process.env.ARCHIVE_THRESHOLD || '15000'),
    batchSize: parseInt(process.env.BATCH_SIZE || '50'),
  },

  rateLimit: {
    shyft: parseInt(process.env.SHYFT_RATE_LIMIT || '2'),
    shyftWindow: 1000,
    metadataRetryDelay: parseInt(process.env.METADATA_RETRY_DELAY || '5000'),
    metadataMaxRetries: parseInt(process.env.METADATA_MAX_RETRIES || '3'),
  },

  // Add price refresh configuration
  priceRefresh: {
    enabled: process.env.PRICE_REFRESH_ENABLED !== 'false',
    interval: parseInt(process.env.PRICE_REFRESH_INTERVAL || '60000'),
    batchSize: parseInt(process.env.PRICE_REFRESH_BATCH_SIZE || '20'),
    maxConcurrent: parseInt(process.env.PRICE_REFRESH_MAX_CONCURRENT || '5'),
    rpcUrl: process.env.PRICE_REFRESH_RPC_URL
  }
};