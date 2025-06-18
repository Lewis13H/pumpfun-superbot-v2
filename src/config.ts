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
    flushInterval: 5000, // 5 seconds
    archiveThreshold: parseInt(process.env.ARCHIVE_THRESHOLD || '15000'), // $15k
    batchSize: parseInt(process.env.BATCH_SIZE || '100')
  }
};