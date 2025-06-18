import fetch from 'node-fetch';
import { db } from './database';
import { config } from './config';
import { EventEmitter } from 'events';

interface ShyftTokenResponse {
  success: boolean;
  message: string;
  result?: {
    address: string;
    symbol?: string;
    name?: string;
    image_uri?: string;
    metadata?: {
      symbol?: string;
      name?: string;
      uri?: string;
    };
  };
}

interface PumpFunDataResponse {
  success: boolean;
  data?: {
    symbol?: string;
    name?: string;
    mint?: string;
    image_uri?: string;
    usd_market_cap?: number;
    description?: string;
    vanity_id?: string;
    bonding_curve?: string;
  };
}

export class MetadataFetcher extends EventEmitter {
  private queue: string[] = [];
  private processing = false;
  private rateLimitDelay = 100; // 10 requests per second
  private lastRequestTime = 0;

  constructor() {
    super();
  }

  enqueue(address: string) {
    if (!this.queue.includes(address)) {
      this.queue.push(address);
      console.log(`📋 Queued ${address} for metadata fetch (${this.queue.length} in queue)`);
    }
    
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      // Rate limiting
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < this.rateLimitDelay) {
        await this.sleep(this.rateLimitDelay - timeSinceLastRequest);
      }
      
      const address = this.queue.shift()!;
      this.lastRequestTime = Date.now();
      
      try {
        const metadata = await this.fetchMetadata(address);
        if (metadata) {
          await this.saveMetadata(address, metadata);
          
          // Emit event for the dashboard
          this.emit('metadata:fetched', {
            address,
            ...metadata
          });
        }
      } catch (error) {
        console.error(`❌ Error fetching metadata for ${address}:`, error);
        // Re-queue on error
        this.queue.push(address);
      }
    }
    
    this.processing = false;
  }

  private async fetchMetadata(address: string) {
    try {
      // Try Shyft API first
      const shyftData = await this.fetchFromShyft(address);
      if (shyftData) {
        return shyftData;
      }
      
      // Try pump.fun API if Shyft doesn't have data
      const pumpData = await this.fetchFromPumpFun(address);
      if (pumpData) {
        return pumpData;
      }
      
      console.log(`⚠️ No metadata found for ${address}`);
      return null;
    } catch (error) {
      console.error(`Error in fetchMetadata:`, error);
      throw error;
    }
  }

  private async fetchFromShyft(address: string) {
    const url = `https://api.shyft.to/sol/v1/token/get_info?network=mainnet-beta&token_address=${address}`;
    
    const response = await fetch(url, {
      headers: {
        'x-api-key': config.shyft.apiKey
      }
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limit exceeded');
      }
      return null;
    }
    
    const data = await response.json() as ShyftTokenResponse;
    
    if (!data.success || !data.result) {
      return null;
    }
    
    const result = data.result;
    
    return {
      symbol: result.symbol || result.metadata?.symbol || 'UNKNOWN',
      name: result.name || result.metadata?.name || address.slice(0, 8),
      imageUri: result.image_uri || result.metadata?.uri || null
    };
  }

  private async fetchFromPumpFun(address: string) {
    try {
      // First try the direct pump.fun API
      const response = await fetch(`https://frontend-api.pump.fun/coins/${address}`, {
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json() as PumpFunDataResponse;
      
      if (!data.success || !data.data) {
        return null;
      }
      
      const result = data.data;
      
      return {
        symbol: result.symbol || 'UNKNOWN',
        name: result.name || address.slice(0, 8),
        imageUri: result.image_uri || null,
        vanityId: result.vanity_id || null
      };
    } catch (error) {
      return null;
    }
  }

  private async saveMetadata(address: string, metadata: any) {
    try {
      await db.updateTokenMetadata(address, {
      symbol: metadata.symbol,
      name: metadata.name,
      imageUri: metadata.imageUri,
      vanityId: metadata.vanityId
    });
      
      console.log(`✅ Metadata saved for ${metadata.symbol}`);
    } catch (error) {
      console.error(`Failed to save metadata for ${address}:`, error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}