/**
 * DexScreener Price Service
 * Fetches token prices from DexScreener API for graduated tokens
 */

import axios from 'axios';
import chalk from 'chalk';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

export class DexScreenerPriceService {
  private static instance: DexScreenerPriceService;
  private readonly baseUrl = 'https://api.dexscreener.com/latest/dex';
  private cache = new Map<string, { price: number; timestamp: number }>();
  private readonly CACHE_TTL = 60000; // 1 minute cache
  
  private constructor() {}
  
  static getInstance(): DexScreenerPriceService {
    if (!this.instance) {
      this.instance = new DexScreenerPriceService();
    }
    return this.instance;
  }
  
  /**
   * Get token price from DexScreener
   */
  async getTokenPrice(mintAddress: string): Promise<{
    priceUsd: number;
    marketCap: number;
    liquidity: number;
    volume24h: number;
    priceChange24h: number;
    source: string;
  } | null> {
    try {
      // Check cache
      const cached = this.cache.get(mintAddress);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return null; // Return null to avoid spamming API
      }
      
      // Fetch from DexScreener
      const url = `${this.baseUrl}/tokens/${mintAddress}`;
      const response = await axios.get<DexScreenerResponse>(url, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PumpFun-Monitor/1.0'
        }
      });
      
      if (!response.data.pairs || response.data.pairs.length === 0) {
        return null;
      }
      
      // Find the best pair (highest liquidity on Solana)
      const solanaPairs = response.data.pairs.filter(p => p.chainId === 'solana');
      if (solanaPairs.length === 0) {
        return null;
      }
      
      // Sort by liquidity and volume
      const bestPair = solanaPairs.sort((a, b) => {
        const liquidityA = a.liquidity?.usd || 0;
        const liquidityB = b.liquidity?.usd || 0;
        const volumeA = a.volume.h24 || 0;
        const volumeB = b.volume.h24 || 0;
        
        // Prioritize liquidity, then volume
        if (liquidityA !== liquidityB) {
          return liquidityB - liquidityA;
        }
        return volumeB - volumeA;
      })[0];
      
      const priceUsd = parseFloat(bestPair.priceUsd);
      
      // Cache the result
      this.cache.set(mintAddress, {
        price: priceUsd,
        timestamp: Date.now()
      });
      
      return {
        priceUsd,
        marketCap: bestPair.marketCap || bestPair.fdv || 0,
        liquidity: bestPair.liquidity?.usd || 0,
        volume24h: bestPair.volume.h24 || 0,
        priceChange24h: bestPair.priceChange.h24 || 0,
        source: `${bestPair.dexId} (DexScreener)`
      };
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          // Token not found on DexScreener
          return null;
        }
        if (error.response?.status === 429) {
          console.error(chalk.yellow('DexScreener rate limit hit'));
          return null;
        }
      }
      
      // Log other errors but don't crash
      if (process.env.DEBUG) {
        console.error(chalk.red('DexScreener API error:'), error);
      }
      
      return null;
    }
  }
  
  /**
   * Bulk fetch prices for multiple tokens
   */
  async getBulkPrices(mintAddresses: string[]): Promise<Map<string, {
    priceUsd: number;
    marketCap: number;
    liquidity: number;
    volume24h: number;
    priceChange24h: number;
    source: string;
  }>> {
    const results = new Map();
    
    // DexScreener doesn't have a bulk endpoint, so we need to fetch sequentially
    // with rate limiting to avoid 429 errors
    for (const mint of mintAddresses) {
      const price = await this.getTokenPrice(mint);
      if (price) {
        results.set(mint, price);
      }
      
      // Rate limit: 300ms between requests
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    return results;
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}