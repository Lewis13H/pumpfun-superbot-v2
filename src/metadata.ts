// src/metadata.ts - Token Metadata Fetcher
import { PublicKey } from '@solana/web3.js';
import { config } from './config';
import { db } from './database';

export class MetadataFetcher {
  private queue: string[] = [];
  private isProcessing = false;
  private rateLimitDelay = 100; // 10 requests per second = 100ms between requests

  constructor() {
    // Start processing queue
    setInterval(() => this.processQueue(), 1000);
  }

  // Add token to metadata fetch queue
  enqueue(tokenAddress: string) {
    if (!this.queue.includes(tokenAddress)) {
      this.queue.push(tokenAddress);
      console.log(`📋 Queued ${tokenAddress.substring(0, 8)}... for metadata fetch`);
    }
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const tokenAddress = this.queue.shift();

    if (tokenAddress) {
      try {
        const metadata = await this.fetchTokenMetadata(tokenAddress);
        if (metadata) {
          await db.upsertToken(
            {
              address: tokenAddress,
              bondingCurve: metadata.bondingCurve || 'unknown',
              vanityId: metadata.vanityId,
              symbol: metadata.symbol,
              name: metadata.name,
              imageUri: metadata.imageUri
            },
            new Date(), // Use current time as we don't have the original
            metadata.creator || 'unknown',
            'metadata-fetch'
          );
          console.log(`✅ Metadata fetched for ${metadata.symbol || tokenAddress.substring(0, 8)}`);
        }
      } catch (error) {
        console.error(`Error fetching metadata for ${tokenAddress}:`, error);
        // Re-queue on error
        this.queue.push(tokenAddress);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
    }

    this.isProcessing = false;
  }

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
        address: tokenAddress,
        symbol: result.symbol || 'UNKNOWN',
        name: result.name || 'Unknown Token',
        imageUri: result.image_uri || result.image,
        vanityId,
        bondingCurve: result.mint_authority || 'unknown',
        creator: result.owner || result.update_authority
      };
    } catch (error) {
      console.error('Error fetching pump.fun metadata:', error);
      return null;
    }
  }

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
        address: tokenAddress,
        symbol: result.symbol || 'UNKNOWN',
        name: result.name || 'Unknown Token',
        imageUri: result.image || result.cached_image_uri,
        bondingCurve: 'unknown',
        creator: result.creator_address || result.owner
      };
    } catch (error) {
      console.error('Error fetching Solana metadata:', error);
      return null;
    }
  }
}

// src/config.ts - Configuration file
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