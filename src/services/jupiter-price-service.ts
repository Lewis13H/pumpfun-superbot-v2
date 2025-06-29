/**
 * Jupiter Price Service
 * Fetches token prices from Jupiter API for graduated tokens
 */

import { db } from '../database';
import chalk from 'chalk';

interface JupiterPriceResponse {
  data: {
    [mint: string]: {
      id: string;
      mintSymbol: string;
      vsToken: string;
      vsTokenSymbol: string;
      price: number;
    };
  };
  timeTaken: number;
}

export class JupiterPriceService {
  private static instance: JupiterPriceService;
  private readonly baseUrl = 'https://price.jup.ag/v4';
  private cache = new Map<string, { price: number; timestamp: number }>();
  private readonly cacheTTL = 60000; // 1 minute
  
  private constructor() {}
  
  static getInstance(): JupiterPriceService {
    if (!JupiterPriceService.instance) {
      JupiterPriceService.instance = new JupiterPriceService();
    }
    return JupiterPriceService.instance;
  }
  
  /**
   * Get prices for multiple tokens
   */
  async getPrices(mints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const uncachedMints: string[] = [];
    
    // Check cache first
    const now = Date.now();
    for (const mint of mints) {
      const cached = this.cache.get(mint);
      if (cached && (now - cached.timestamp) < this.cacheTTL) {
        prices.set(mint, cached.price);
      } else {
        uncachedMints.push(mint);
      }
    }
    
    if (uncachedMints.length === 0) {
      return prices;
    }
    
    // Fetch from Jupiter in batches of 100
    const batchSize = 100;
    for (let i = 0; i < uncachedMints.length; i += batchSize) {
      const batch = uncachedMints.slice(i, i + batchSize);
      
      try {
        const ids = batch.join(',');
        const response = await fetch(`${this.baseUrl}/price?ids=${ids}`);
        
        if (!response.ok) {
          console.error(chalk.red(`Jupiter API error: ${response.status} ${response.statusText}`));
          continue;
        }
        
        const data: JupiterPriceResponse = await response.json();
        
        // Process results
        for (const [mint, priceData] of Object.entries(data.data)) {
          if (priceData && priceData.price) {
            prices.set(mint, priceData.price);
            this.cache.set(mint, { price: priceData.price, timestamp: now });
          }
        }
      } catch (error) {
        console.error(chalk.red(`Error fetching prices from Jupiter:`), error);
      }
      
      // Delay between batches to avoid rate limits
      if (i + batchSize < uncachedMints.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return prices;
  }
  
  /**
   * Update graduated token prices from Jupiter
   */
  async updateGraduatedTokenPrices(): Promise<{
    successful: number;
    failed: number;
    totalQueried: number;
  }> {
    console.log(chalk.cyan('🃏 Fetching prices from Jupiter API...'));
    
    // Get all graduated tokens
    const result = await db.query(`
      SELECT mint_address
      FROM tokens_unified
      WHERE graduated_to_amm = true
    `);
    
    const mints = result.rows.map(r => r.mint_address);
    console.log(chalk.gray(`Found ${mints.length} graduated tokens`));
    
    // Get prices from Jupiter
    const prices = await this.getPrices(mints);
    
    let successful = 0;
    let failed = 0;
    
    // Update database
    const updates: any[] = [];
    for (const [mint, priceUsd] of prices.entries()) {
      updates.push({
        mint,
        priceUsd,
        marketCapUsd: priceUsd * 1e9, // Assuming 1B supply
      });
      successful++;
    }
    
    // Track failed mints
    for (const mint of mints) {
      if (!prices.has(mint)) {
        failed++;
      }
    }
    
    if (updates.length > 0) {
      // Batch update
      const values = updates.map(u => [
        u.mint,
        u.priceUsd,
        u.marketCapUsd,
        'jupiter',
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
      
      console.log(chalk.green(`✅ Updated ${updates.length} token prices from Jupiter`));
    }
    
    return {
      successful,
      failed,
      totalQueried: mints.length,
    };
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}