import dotenv from 'dotenv';
dotenv.config();

export const config = {
  database: {
    url: process.env.DATABASE_URL!,
    poolSize: parseInt(process.env.DB_POOL_SIZE || '20')
  },
  shyft: {
    apiKey: process.env.SHYFT_API_KEY!,
    grpcEndpoint: process.env.SHYFT_GRPC_ENDPOINT!,
    grpcToken: process.env.SHYFT_GRPC_TOKEN!,
    apiUrl: 'https://api.shyft.to/sol/v1'
  },
  monitoring: {
    archiveThreshold: parseInt(process.env.ARCHIVE_THRESHOLD || '15000'),
    batchSize: parseInt(process.env.BATCH_SIZE || '100'),
    flushInterval: parseInt(process.env.FLUSH_INTERVAL || '5000'), // 5 seconds
    metadataRateLimit: parseInt(process.env.METADATA_RATE_LIMIT || '10') // requests per second
  },
  websocket: {
    port: parseInt(process.env.WS_PORT || '8080')
  }
};

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'SHYFT_API_KEY',
  'SHYFT_GRPC_ENDPOINT',
  'SHYFT_GRPC_TOKEN'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}