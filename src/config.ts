import dotenv from 'dotenv';
dotenv.config();

export const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://pump_user:password@localhost:5433/pump_monitor',
    connectionString: process.env.DATABASE_URL || 'postgresql://pump_user:password@localhost:5433/pump_monitor',
    poolSize: 20
  },
  
  shyft: {
    apiKey: process.env.SHYFT_API_KEY!,
    endpoint: process.env.SHYFT_GRPC_ENDPOINT || 'grpc.shyft.to',
    token: process.env.SHYFT_GRPC_TOKEN!
  },
  
  websocket: {
    port: parseInt(process.env.WS_PORT || '8080')
  },

  web: {
    port: parseInt(process.env.WEB_PORT || '3000')
  },
  
  monitoring: {
    flushInterval: parseInt(process.env.FLUSH_INTERVAL || '10000'), // Increased from 5000
    archiveThreshold: parseInt(process.env.ARCHIVE_THRESHOLD || '15000'),
    batchSize: parseInt(process.env.BATCH_SIZE || '50'), // Reduced from 100
  },

  rateLimit: {
    shyft: parseInt(process.env.SHYFT_RATE_LIMIT || '2'),
    pumpFun: parseInt(process.env.PUMP_FUN_RATE_LIMIT || '2'),
    metadataRetryDelay: parseInt(process.env.METADATA_RETRY_DELAY || '5000'),
    metadataMaxRetries: parseInt(process.env.METADATA_MAX_RETRIES || '3'),
  },
};
