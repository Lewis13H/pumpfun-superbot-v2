/**
 * Helius Price Service
 * Uses Helius DAS API to get token prices for graduated tokens
 */

import { db } from '../database';
import chalk from 'chalk';

interface HeliusAssetResponse {
  jsonrpc: string;
  result: {
    nativeBalance: {
      lamports: number;
      price_per_sol: number;
      total_price: number;
    };
    items: Array<{
      id: string;
      token_info?: {
        symbol: string;
        balance: number;
        supply: number;
        decimals: number;
        token_program: string;
        price_info?: {
          price_per_token: number;
          total_price: number;
          currency: string;
        };
      };
    }>;
  };
}

export class HeliusPriceService {
  private static instance: HeliusPriceService;
  private readonly apiKey: string;
  private readonly rpcUrl: string;
  private cache = new Map<string, { price: number; timestamp: number }>();
  private readonly cacheTTL = 300000; // 5 minutes
  
  private constructor() {
    this.apiKey = process.env.HELIUS_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('HELIUS_API_KEY not found in environment variables');
    }
    this.rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
  }
  
  static getInstance(): HeliusPriceService {
    if (!HeliusPriceService.instance) {
      HeliusPriceService.instance = new HeliusPriceService();
    }
    return HeliusPriceService.instance;
  }
  
  /**
   * Get token price using Helius DAS API
   * Note: This requires the token to have price data available in Helius
   */
  async getTokenPrice(mintAddress: string): Promise<number | null> {
    // Check cache first
    const cached = this.cache.get(mintAddress);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      return cached.price;
    }
    
    try {
      // Use searchAssets to find the token
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'helius-price',
          method: 'searchAssets',
          params: {
            tokenType: 'fungible',
            mint: mintAddress,
            limit: 1,
            displayOptions: {
              showPrice: true, // Request price data
            },
          },
        }),
      });
      
      if (!response.ok) {
        console.error(chalk.red(`Helius API error: ${response.status} ${response.statusText}`));
        return null;
      }
      
      const data = await response.json();
      
      if (data.result?.items?.length > 0) {
        const token = data.result.items[0];
        const priceInfo = token.token_info?.price_info;
        
        if (priceInfo?.price_per_token) {
          const price = priceInfo.price_per_token;
          
          // Cache the result
          this.cache.set(mintAddress, {
            price,
            timestamp: Date.now(),
          });
          
          return price;
        }
      }
      
      // If no price from searchAssets, try getAsset
      const assetResponse = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'helius-asset',
          method: 'getAsset',
          params: {
            id: mintAddress,
            displayOptions: {
              showPrice: true,
            },
          },
        }),
      });
      
      if (assetResponse.ok) {
        const assetData = await assetResponse.json();
        const priceInfo = assetData.result?.token_info?.price_info;
        
        if (priceInfo?.price_per_token) {
          const price = priceInfo.price_per_token;
          
          // Cache the result
          this.cache.set(mintAddress, {
            price,
            timestamp: Date.now(),
          });
          
          return price;
        }
      }
      
      return null;
    } catch (error) {
      console.error(chalk.red(`Error fetching price from Helius for ${mintAddress}:`), error);
      return null;
    }
  }
  
  /**
   * Update prices for stale graduated tokens
   */
  async updateStaleGraduatedTokenPrices(): Promise<{
    successful: number;
    failed: number;
    noPrice: number;
  }> {
    console.log(chalk.cyan('🌟 Fetching prices from Helius API...'));
    
    // Get stale graduated tokens
    const result = await db.query(`
      SELECT mint_address
      FROM tokens_unified
      WHERE graduated_to_amm = true
        AND (
          updated_at < NOW() - INTERVAL '30 minutes'
          OR latest_price_usd IS NULL
          OR latest_price_usd = 0
        )
      ORDER BY latest_market_cap_usd DESC NULLS LAST
      LIMIT 50
    `);
    
    const mints = result.rows.map(r => r.mint_address);
    console.log(chalk.gray(`Found ${mints.length} stale graduated tokens`));
    
    let successful = 0;
    let failed = 0;
    let noPrice = 0;
    
    const updates: any[] = [];
    
    // Process tokens with rate limiting
    for (const mint of mints) {
      try {
        const price = await this.getTokenPrice(mint);
        
        if (price && price > 0) {
          updates.push({
            mint,
            priceUsd: price,
            marketCapUsd: price * 1e9, // Assuming 1B supply
          });
          successful++;
          console.log(chalk.green(`✓ ${mint.slice(0, 8)}... - $${price.toFixed(8)}`));
        } else {
          noPrice++;
          console.log(chalk.yellow(`○ ${mint.slice(0, 8)}... - No price data`));
        }
        
        // Rate limit: 10 RPS for free tier
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failed++;
        console.error(chalk.red(`✗ ${mint.slice(0, 8)}... - Error`));
      }
    }
    
    // Update database
    if (updates.length > 0) {
      const values = updates.map(u => [
        u.mint,
        u.priceUsd,
        u.marketCapUsd,
        'helius',
        new Date(),
      ]);
      
      await db.query(`
        UPDATE tokens_unified
        SET 
          latest_price_usd = v.price_usd,
          latest_market_cap_usd = v.market_cap,
          price_source = v.source,
          updated_at = v.update_time
        FROM (
          VALUES ${values.map((_, i) => 
            `($${i * 5 + 1}, $${i * 5 + 2}::numeric, $${i * 5 + 3}::numeric, $${i * 5 + 4}::text, $${i * 5 + 5}::timestamp)`
          ).join(', ')}
        ) AS v(mint_address, price_usd, market_cap, source, update_time)
        WHERE tokens_unified.mint_address = v.mint_address
      `, values.flat());
      
      console.log(chalk.green(`\n✅ Updated ${updates.length} token prices from Helius`));
    }
    
    return { successful, failed, noPrice };
  }
  
  /**
   * Check if Helius has price data for a token
   */
  async checkPriceAvailability(mintAddress: string): Promise<{
    hasPrice: boolean;
    price?: number;
    source?: string;
  }> {
    const price = await this.getTokenPrice(mintAddress);
    return {
      hasPrice: price !== null,
      price: price || undefined,
      source: price ? 'helius_das' : undefined,
    };
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}