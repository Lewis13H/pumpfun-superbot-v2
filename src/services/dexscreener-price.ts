import { SolPriceService } from './sol-price';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  priceNative: string;
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

export class DexScreenerPriceService {
  private static instance: DexScreenerPriceService;
  private solPriceService: SolPriceService;
  private priceCache: Map<string, { data: DexScreenerPair; timestamp: number }> = new Map();
  private readonly CACHE_DURATION_MS = 60000; // 60 seconds cache to minimize API calls
  private readonly API_BASE_URL = 'https://api.dexscreener.com/latest/dex';
  
  // Rate limiting
  private requestTimestamps: number[] = [];
  private readonly RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
  private readonly MAX_REQUESTS_PER_WINDOW = 50; // Leave buffer under 60 limit
  private requestQueue: Array<{ resolve: Function; reject: Function; fn: Function }> = [];
  private isProcessingQueue = false;

  private constructor() {
    this.solPriceService = SolPriceService.getInstance();
  }

  static getInstance(): DexScreenerPriceService {
    if (!DexScreenerPriceService.instance) {
      DexScreenerPriceService.instance = new DexScreenerPriceService();
    }
    return DexScreenerPriceService.instance;
  }

  /**
   * Enforce rate limiting
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Remove timestamps outside the rate limit window
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => now - timestamp < this.RATE_LIMIT_WINDOW_MS
    );
    
    // If we're at the rate limit, wait
    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_WINDOW) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = (oldestTimestamp + this.RATE_LIMIT_WINDOW_MS) - now + 1000; // Add 1s buffer
      
      if (waitTime > 0) {
        console.log(`⏳ DexScreener rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // Recursively check again after waiting
        return this.enforceRateLimit();
      }
    }
    
    // Record this request
    this.requestTimestamps.push(now);
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await this.enforceRateLimit();
          const result = await request.fn();
          request.resolve(result);
        } catch (error) {
          request.reject(error);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    this.isProcessingQueue = false;
  }

  /**
   * Queue a request with rate limiting
   */
  private async queueRequest<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject, fn });
      this.processQueue();
    });
  }

  /**
   * Get token data from DexScreener
   */
  async getTokenData(mintAddress: string): Promise<{
    price: number;
    marketCap: number;
    priceInSol: number;
    liquidity: number;
    volume24h: number;
    priceChange24h: number;
    priceChange6h: number;
    priceChange1h: number;
    priceChange5m: number;
    pairAddress?: string;
    dexId?: string;
  } | null> {
    // Check cache first
    const cached = this.priceCache.get(mintAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
      return this.formatTokenData(cached.data);
    }

    // Use rate-limited queue for the actual API request
    return this.queueRequest(async () => {
      try {
        // DexScreener API endpoint for token pairs
        const response = await fetch(`${this.API_BASE_URL}/tokens/${mintAddress}`);
        
        if (!response.ok) {
          if (response.status === 429) {
            console.log(`DexScreener rate limit hit (429). Will retry after delay.`);
          }
          return null;
        }

        const data = await response.json() as DexScreenerResponse;
        
        if (!data.pairs || data.pairs.length === 0) {
          return null;
        }

        // Find the most liquid pair (usually the main trading pair)
        const mainPair = data.pairs.reduce((best, pair) => {
          return (pair.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? pair : best;
        }, data.pairs[0]);

        // Cache the result
        this.priceCache.set(mintAddress, {
          data: mainPair,
          timestamp: Date.now()
        });

        return this.formatTokenData(mainPair);
      } catch (error) {
        console.error(`Error fetching DexScreener data for ${mintAddress}:`, error);
        return null;
      }
    });
  }

  /**
   * Format DexScreener data into our standard format
   */
  private async formatTokenData(pair: DexScreenerPair): Promise<{
    price: number;
    marketCap: number;
    priceInSol: number;
    liquidity: number;
    volume24h: number;
    priceChange24h: number;
    priceChange6h: number;
    priceChange1h: number;
    priceChange5m: number;
    pairAddress?: string;
    dexId?: string;
  }> {
    const solPrice = await this.solPriceService.getPrice();
    const price = parseFloat(pair.priceUsd);
    
    return {
      price,
      marketCap: pair.marketCap || pair.fdv || 0,
      priceInSol: price / solPrice,
      liquidity: pair.liquidity?.usd || 0,
      volume24h: pair.volume?.h24 || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      priceChange6h: pair.priceChange?.h6 || 0,
      priceChange1h: pair.priceChange?.h1 || 0,
      priceChange5m: pair.priceChange?.m5 || 0,
      pairAddress: pair.pairAddress,
      dexId: pair.dexId
    };
  }

  /**
   * Get price for a single token
   */
  async getTokenPrice(mintAddress: string): Promise<number | null> {
    const data = await this.getTokenData(mintAddress);
    return data?.price || null;
  }

  /**
   * Get data for multiple tokens efficiently
   */
  async getBatchTokenData(mintAddresses: string[]): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    const uncachedAddresses: string[] = [];
    
    // Check cache first
    for (const address of mintAddresses) {
      const cached = this.priceCache.get(address);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
        const formatted = await this.formatTokenData(cached.data);
        if (formatted) {
          results.set(address, formatted);
        }
      } else {
        uncachedAddresses.push(address);
      }
    }
    
    // Fetch uncached tokens with rate limiting
    console.log(`📊 Fetching ${uncachedAddresses.length} tokens from DexScreener (cached: ${results.size})`);
    
    for (const address of uncachedAddresses) {
      const data = await this.getTokenData(address);
      if (data) {
        results.set(address, data);
      }
    }
    
    return results;
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus(): { current: number; max: number; resets: number } {
    const now = Date.now();
    const activeRequests = this.requestTimestamps.filter(
      timestamp => now - timestamp < this.RATE_LIMIT_WINDOW_MS
    ).length;
    
    const oldestTimestamp = this.requestTimestamps[0];
    const resetTime = oldestTimestamp ? (oldestTimestamp + this.RATE_LIMIT_WINDOW_MS) : now;
    
    return {
      current: activeRequests,
      max: this.MAX_REQUESTS_PER_WINDOW,
      resets: Math.max(0, resetTime - now)
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }
}