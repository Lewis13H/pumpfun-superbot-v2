// src/metadata.ts - Token Metadata Fetcher (FIXED)
import { PublicKey } from '@solana/web3.js';
import { config } from './config';
import { db } from './database';

// Define the token type to match what monitor emits
interface TokenData {
  address: string;
  bondingCurve: string;
  creator: string;
  signature: string;
  timestamp: Date;
}

export class MetadataFetcher {
  private queue: TokenData[] = [];
  private isProcessing = false;
  private rateLimitDelay = 100; // 10 requests per second = 100ms between requests

  constructor() {
    // Start processing queue
    setInterval(() => this.processQueue(), 1000);
  }

  // Add token to metadata fetch queue - FIXED to accept full token object
  enqueue(token: TokenData) {
    // Check if already in queue
    const exists = this.queue.some(t => t.address === token.address);
    if (!exists) {
      this.queue.push(token);
      console.log(`📋 Queued ${token.address.substring(0, 8)}... for metadata fetch`);
    }
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const token = this.queue.shift(); // Now we have the full token object

    if (token) {
      try {
        const metadata = await this.fetchTokenMetadata(token.address);
        if (metadata) {
          await db.upsertToken(
            {
              address: token.address,
              bondingCurve: token.bondingCurve, // USE ORIGINAL BONDING CURVE
              vanityId: metadata.vanityId,
              symbol: metadata.symbol,
              name: metadata.name,
              imageUri: metadata.imageUri
            },
            token.timestamp,
            token.creator,
            token.signature
          );
          console.log(`✅ Metadata fetched for ${metadata.symbol || token.address.substring(0, 8)}`);
        }
      } catch (error) {
        console.error(`Error fetching metadata for ${token.address}:`, error);
        // Re-queue on error
        this.queue.push(token);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
    }

    this.isProcessing = false;
  }

  // FIXED: Return only metadata, not bonding curve
  private async fetchTokenMetadata(tokenAddress: string): Promise<any> {
    try {
      // First, try to get pump.fun specific metadata
      const pumpMetadata = await this.fetchPumpFunMetadata(tokenAddress);
      if (pumpMetadata) return pumpMetadata;

      // Fallback to standard Solana token metadata
      return await this.fetchSolanaTokenMetadata(tokenAddress);
    } catch (error) {
      console.error('Error in fetchTokenMetadata:', error);
      return null;
    }
  }

  // FIXED: Don't return bondingCurve from API
  private async fetchPumpFunMetadata(tokenAddress: string): Promise<any> {
    try {
      const response = await fetch(
        `https://api.shyft.to/sol/v1/token/get_info?network=mainnet-beta&token_address=${tokenAddress}`,
        {
          headers: {
            'x-api-key': config.shyft.apiKey
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Shyft API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.result) {
        return null;
      }

      const result = data.result;

      // Extract pump.fun vanity ID from metadata if available
      let vanityId: string | undefined;
      if (result.metadata_uri) {
        // Pump.fun URIs often contain the vanity ID
        const match = result.metadata_uri.match(/pump\.fun\/([A-Za-z0-9]+)/);
        if (match) {
          vanityId = match[1];
        }
      }

      return {
        symbol: result.symbol || 'UNKNOWN',
        name: result.name || 'Unknown Token',
        imageUri: result.image_uri || result.image,
        vanityId
        // NO bondingCurve here - it comes from blockchain, not API
      };
    } catch (error) {
      console.error('Error fetching pump.fun metadata:', error);
      return null;
    }
  }

  // FIXED: Don't return bondingCurve from API
  private async fetchSolanaTokenMetadata(tokenAddress: string): Promise<any> {
    try {
      // Alternative: Use Solana's Metaplex metadata
      const response = await fetch(
        `https://api.shyft.to/sol/v1/nft/read?network=mainnet-beta&token_address=${tokenAddress}`,
        {
          headers: {
            'x-api-key': config.shyft.apiKey
          }
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data.success || !data.result) {
        return null;
      }

      const result = data.result;
      return {
        symbol: result.symbol || 'UNKNOWN',
        name: result.name || 'Unknown Token',
        imageUri: result.image || result.cached_image_uri,
        vanityId: null
        // NO bondingCurve here - it comes from blockchain, not API
      };
    } catch (error) {
      console.error('Error fetching Solana metadata:', error);
      return null;
    }
  }

  // Add a method to get queue status
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing
    };
  }
}

// src/config.ts remains the same
import * as dotenv from 'dotenv';
dotenv.config();

export const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/pump_monitor',
    poolSize: 20
  },
  
  shyft: {
    apiKey: process.env.SHYFT_API_KEY || '',
    grpcEndpoint: process.env.SHYFT_GRPC_ENDPOINT || 'grpc.shyft.to',
    grpcToken: process.env.SHYFT_GRPC_TOKEN || ''
  },
  
  websocket: {
    port: parseInt(process.env.WS_PORT || '8080')
  },
  
  monitoring: {
    flushInterval: 5000, // 5 seconds
    batchSize: parseInt(process.env.BATCH_SIZE || '100'),
    archiveThreshold: parseInt(process.env.ARCHIVE_THRESHOLD || '15000')
  }
};