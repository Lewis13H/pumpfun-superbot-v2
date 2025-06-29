/**
 * DexScreener Price Recovery Service
 * Recovers prices for stale graduated tokens using DexScreener API
 */

import chalk from 'chalk';
import { db } from '../database';
import { DexScreenerPriceService } from './dexscreener-price-service';

export class DexScreenerPriceRecovery {
  private static instance: DexScreenerPriceRecovery;
  private dexScreener: DexScreenerPriceService;
  private isRunning = false;
  private recoveryInterval: NodeJS.Timeout | null = null;
  
  private constructor() {
    this.dexScreener = DexScreenerPriceService.getInstance();
  }
  
  static getInstance(): DexScreenerPriceRecovery {
    if (!this.instance) {
      this.instance = new DexScreenerPriceRecovery();
    }
    return this.instance;
  }
  
  /**
   * Start automatic recovery process
   */
  start(intervalMinutes: number = 30): void {
    if (this.isRunning) {
      console.log(chalk.yellow('DexScreener recovery already running'));
      return;
    }
    
    console.log(chalk.cyan('🔄 Starting DexScreener price recovery service'));
    console.log(chalk.gray(`Interval: ${intervalMinutes} minutes`));
    
    this.isRunning = true;
    
    // Run immediately
    this.recoverStalePrices();
    
    // Then run periodically
    this.recoveryInterval = setInterval(() => {
      this.recoverStalePrices();
    }, intervalMinutes * 60 * 1000);
  }
  
  /**
   * Stop recovery process
   */
  stop(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
    this.isRunning = false;
    console.log(chalk.yellow('DexScreener recovery stopped'));
  }
  
  /**
   * Recover prices for stale graduated tokens
   */
  async recoverStalePrices(): Promise<void> {
    console.log(chalk.cyan('\n🔍 Checking for stale graduated tokens...'));
    
    try {
      // Get stale graduated tokens
      const staleTokens = await this.getStaleGraduatedTokens();
      
      if (staleTokens.length === 0) {
        console.log(chalk.green('✓ No stale graduated tokens found'));
        return;
      }
      
      console.log(chalk.yellow(`Found ${staleTokens.length} stale graduated tokens`));
      
      let recovered = 0;
      let failed = 0;
      
      // Process in batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < staleTokens.length; i += batchSize) {
        const batch = staleTokens.slice(i, i + batchSize);
        
        for (const token of batch) {
          try {
            const priceData = await this.dexScreener.getTokenPrice(token.mint_address);
            
            if (priceData && priceData.priceUsd > 0) {
              // Update token price
              await db.query(`
                UPDATE tokens_unified
                SET
                  latest_price_usd = $2,
                  latest_market_cap_usd = $3,
                  price_source = $4,
                  last_dexscreener_update = NOW(),
                  updated_at = NOW()
                WHERE mint_address = $1
              `, [
                token.mint_address,
                priceData.priceUsd,
                priceData.marketCap || priceData.priceUsd * 1e9, // Assume 1B supply if no market cap
                priceData.source
              ]);
              
              // Log recovery (simplified - table structure may vary)
              try {
                await db.query(`
                  INSERT INTO price_update_sources (
                    mint_address, update_source, price_usd, market_cap_usd, metadata
                  ) VALUES ($1, $2, $3, $4, $5)
                `, [
                  token.mint_address,
                  'dexscreener_recovery',
                  priceData.priceUsd,
                  priceData.marketCap,
                  JSON.stringify({
                    source: priceData.source,
                    liquidity: priceData.liquidity,
                    volume24h: priceData.volume24h,
                    priceChange24h: priceData.priceChange24h
                  })
                ]);
              } catch (logError) {
                // Ignore logging errors - price update is what matters
              }
              
              recovered++;
              
              console.log(
                chalk.green('✓'),
                chalk.white(`${token.mint_address.slice(0, 8)}...`),
                chalk.gray(`${token.symbol || 'N/A'}`),
                chalk.yellow(`$${priceData.priceUsd.toFixed(8)}`),
                chalk.gray(`(${priceData.source})`)
              );
            } else {
              failed++;
              if (process.env.DEBUG) {
                console.log(
                  chalk.red('✗'),
                  chalk.white(`${token.mint_address.slice(0, 8)}...`),
                  chalk.gray('Not found on DexScreener')
                );
              }
            }
          } catch (error) {
            failed++;
            console.error(chalk.red(`Error recovering ${token.mint_address}:`), error);
          }
          
          // Rate limit pause between requests
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Longer pause between batches
        if (i + batchSize < staleTokens.length) {
          console.log(chalk.gray(`Processed batch ${Math.floor(i / batchSize) + 1}, waiting...`));
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log(chalk.cyan('\n📊 Recovery Summary:'));
      console.log(chalk.green(`✓ Recovered: ${recovered} tokens`));
      console.log(chalk.red(`✗ Failed: ${failed} tokens`));
      
    } catch (error) {
      console.error(chalk.red('Error in price recovery:'), error);
    }
  }
  
  /**
   * Get stale graduated tokens
   */
  private async getStaleGraduatedTokens(): Promise<any[]> {
    const result = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_price_usd,
        t.updated_at,
        EXTRACT(EPOCH FROM (NOW() - t.updated_at)) / 3600 as hours_since_update
      FROM tokens_unified t
      WHERE t.graduated_to_amm = TRUE
        AND t.current_program = 'amm_pool'
        AND (
          t.updated_at < NOW() - INTERVAL '1 hour'
          OR t.latest_price_usd IS NULL
          OR t.latest_price_usd = 0
        )
      ORDER BY t.latest_market_cap_usd DESC NULLS LAST
      LIMIT 100
    `);
    
    return result.rows;
  }
  
  /**
   * Manually recover a specific token
   */
  async recoverToken(mintAddress: string): Promise<boolean> {
    try {
      const priceData = await this.dexScreener.getTokenPrice(mintAddress);
      
      if (!priceData || priceData.priceUsd <= 0) {
        console.log(chalk.red(`Token ${mintAddress} not found on DexScreener`));
        return false;
      }
      
      // Update database
      await db.query(`
        UPDATE tokens_unified
        SET
          latest_price_usd = $2,
          latest_market_cap_usd = $3,
          price_source = $4,
          last_dexscreener_update = NOW(),
          updated_at = NOW()
        WHERE mint_address = $1
      `, [
        mintAddress,
        priceData.priceUsd,
        priceData.marketCap || priceData.priceUsd * 1e9,
        priceData.source
      ]);
      
      console.log(chalk.green(`✓ Recovered price for ${mintAddress}: $${priceData.priceUsd.toFixed(8)}`));
      return true;
      
    } catch (error) {
      console.error(chalk.red('Error recovering token:'), error);
      return false;
    }
  }
}