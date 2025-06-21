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

// Token bucket for more precise rate limiting
class TokenBucket {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;
    this.refillRate = refillRatePerSecond;
    this.lastRefill = Date.now();
  }

  async take(): Promise<boolean> {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    
    // Calculate wait time
    const waitTime = (1 - this.tokens) / this.refillRate * 1000;
    await this.sleep(waitTime);
    
    this.refill();
    this.tokens -= 1;
    return true;
  }

  private refill() {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + timePassed * this.refillRate);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export class MetadataFetcher extends EventEmitter {  
  private queue: string[] = [];  
  private processing = false;  
  private rateLimitDelay = 1000; // Start with 1 request per second (even safer)
  private lastRequestTime = 0;
  private retryDelay = 10000; // 10 seconds before retry (increased)
  private maxRetries = 3;
  private retryCount = new Map<string, number>();
  private failedTokens = new Set<string>();
  
  // Token buckets for each API
  private shyftBucket: TokenBucket;
  private pumpBucket: TokenBucket;
  
  // Circuit breaker
  private shyftFailures = 0;
  private shyftCircuitOpen = false;
  private circuitOpenUntil = 0;

  constructor() {  
    super();
    
    // Initialize token buckets - very conservative rates
    // Shyft: 1 request per second max
    this.shyftBucket = new TokenBucket(5, 1);
    // Pump.fun: 1 request per second max  
    this.pumpBucket = new TokenBucket(5, 1);
  }

  enqueue(address: string) {  
    // Don't queue if already failed too many times
    if (this.failedTokens.has(address)) {
      return;
    }

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
      // Basic rate limiting on top of token bucket
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
          
          // Reset retry count on success
          this.retryCount.delete(address);
          
          // Gradually decrease rate limit delay on success
          if (this.rateLimitDelay > 1000) {
            this.rateLimitDelay = Math.max(this.rateLimitDelay * 0.95, 1000);
          }
          
          // Reset circuit breaker on success
          this.shyftFailures = 0;
        }  
      } catch (error: any) {  
        console.error(`❌ Error fetching metadata for ${address}:`, error.message);  
        
        // Handle rate limiting specifically
        if (error.message === 'Rate limit exceeded' || error.message === 'Circuit breaker open') {
          // Add back to queue but with delay
          const retries = this.retryCount.get(address) || 0;
          
          if (retries < this.maxRetries) {
            this.retryCount.set(address, retries + 1);
            console.log(`⏳ Will retry ${address} after delay (attempt ${retries + 1}/${this.maxRetries})`);
            
            // Add back to queue after exponential backoff
            setTimeout(() => {
              if (!this.failedTokens.has(address)) {
                this.queue.push(address);
                if (!this.processing) {
                  this.processQueue();
                }
              }
            }, this.retryDelay * Math.pow(2, retries));
          } else {
            console.log(`❌ Giving up on ${address} after ${this.maxRetries} retries`);
            this.failedTokens.add(address);
            this.retryCount.delete(address);
          }
          
          // Increase rate limit delay when we hit limits
          this.rateLimitDelay = Math.min(this.rateLimitDelay * 2, 5000);
          console.log(`⚠️ Increased rate limit delay to ${this.rateLimitDelay}ms`);
          
          // Add longer pause after rate limit error
          await this.sleep(5000);
        }
      }  
    }  
      
    this.processing = false;  
  }

  private async fetchMetadata(address: string) {  
    try {  
      // Check circuit breaker
      if (this.shyftCircuitOpen && Date.now() < this.circuitOpenUntil) {
        console.log('⚡ Circuit breaker is open, using pump.fun only');
        const pumpData = await this.fetchFromPumpFun(address);
        if (pumpData) return pumpData;
        throw new Error('Circuit breaker open');
      }
      
      // Try Shyft API first  
      const shyftData = await this.fetchFromShyft(address);  
      if (shyftData) {  
        return shyftData;  
      }  
        
      // Longer delay between different API calls
      await this.sleep(1000);
        
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
    // Check circuit breaker
    if (this.shyftCircuitOpen && Date.now() < this.circuitOpenUntil) {
      return null;
    }
    
    // Wait for token bucket
    await this.shyftBucket.take();
    
    const url = `https://api.shyft.to/sol/v1/token/get_info?network=mainnet-beta&token_address=${address}`;  
      
    try {
      const response = await fetch(url, {  
        headers: {  
          'x-api-key': config.shyft.apiKey  
        },
        timeout: 10000
      });  
        
      if (!response.ok) {  
        if (response.status === 429) {
          this.shyftFailures++;
          
          // Open circuit breaker after 3 failures
          if (this.shyftFailures >= 3) {
            this.shyftCircuitOpen = true;
            this.circuitOpenUntil = Date.now() + 60000; // 1 minute
            console.log('⚡ Opening Shyft circuit breaker for 1 minute');
          }
          
          throw new Error('Rate limit exceeded');  
        }
        if (response.status === 404) {
          return null;
        }
        throw new Error(`HTTP ${response.status}`);
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
    } catch (error: any) {
      if (error.message === 'Rate limit exceeded') {
        throw error;
      }
      console.warn(`Shyft API error for ${address}:`, error.message);
      return null;
    }
  }

  private async fetchFromPumpFun(address: string) {  
    // Wait for token bucket
    await this.pumpBucket.take();
    
    try {  
      const response = await fetch(`https://frontend-api.pump.fun/coins/${address}`, {  
        headers: {  
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });  
        
      if (!response.ok) {  
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
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
    } catch (error: any) {  
      if (error.message === 'Rate limit exceeded') {
        throw error;
      }
      console.warn(`Pump.fun API error for ${address}:`, error.message);
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
  
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      rateLimitDelay: this.rateLimitDelay,
      failedTokens: this.failedTokens.size,
      retryingTokens: this.retryCount.size,
      circuitBreakerOpen: this.shyftCircuitOpen
    };
  }
  
  // Manual circuit breaker reset
  resetCircuitBreaker() {
    this.shyftCircuitOpen = false;
    this.shyftFailures = 0;
    this.circuitOpenUntil = 0;
    console.log('⚡ Circuit breaker reset');
  }
}