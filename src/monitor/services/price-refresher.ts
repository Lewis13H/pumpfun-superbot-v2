import { EventEmitter } from 'events';
import { db } from '../../database';
import { PriceCalculator } from '../calculators/price';
import { ProgressCalculator } from '../calculators/progress';
import { BondingCurveFetcher } from './bonding-curve-fetcher';
import { SolPriceService } from './sol-price';
import { PriceUpdate } from '../types';
import { DEFAULT_TOKEN_SUPPLY } from '../constants';
import { formatMarketCap } from '../utils/format';

export class PriceRefresherService extends EventEmitter {
  private bondingCurveFetcher: BondingCurveFetcher;
  private refreshTimer?: NodeJS.Timeout;
  private isRefreshing: boolean = false;
  private invalidTokens = new Set<string>(); // Track tokens with invalid bonding curves

  constructor(
    rpcUrl: string,
    private solPriceService: SolPriceService,
    private options: {
      refreshInterval?: number;
      batchSize?: number;
      maxConcurrent?: number;
    } = {}
  ) {
    super();
    
    this.bondingCurveFetcher = new BondingCurveFetcher(rpcUrl);
    
    // Set defaults
    this.options.refreshInterval = this.options.refreshInterval || 60000; // 1 minute
    this.options.batchSize = this.options.batchSize || 20;
    this.options.maxConcurrent = this.options.maxConcurrent || 5;
  }

  /**
   * Start the price refresh service
   */
  start(): void {
    if (this.refreshTimer) {
      return; // Already running
    }

    console.log('🔄 Starting price refresh service...');
    
    // Initial refresh
    this.refreshPrices();
    
    // Set up periodic refresh
    this.refreshTimer = setInterval(() => {
      this.refreshPrices();
    }, this.options.refreshInterval);
  }

  /**
   * Stop the price refresh service
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
      console.log('⏹️ Price refresh service stopped');
    }
  }

  /**
   * Refresh prices for active tokens with error handling
   */
  async refreshPrices(): Promise<void> {
    if (this.isRefreshing) {
      console.log('⏸️ Price refresh already in progress, skipping...');
      return;
    }

    this.isRefreshing = true;

    try {
      console.log('🔄 Starting price refresh...');
      
      // Get active tokens, excluding those we know have invalid bonding curves
      const activeTokens = await this.getTokensForRefresh();
      
      if (activeTokens.length === 0) {
        console.log('ℹ️ No valid tokens to refresh');
        return;
      }

      console.log(`📊 Refreshing prices for ${activeTokens.length} tokens...`);
      
      // Process in smaller batches to handle errors gracefully
      const batchSize = this.options.batchSize!;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < activeTokens.length; i += batchSize) {
        const batch = activeTokens.slice(i, i + batchSize);
        const batchResults = await this.processBatch(batch);
        
        successCount += batchResults.success;
        errorCount += batchResults.errors;
        
        // Log progress
        console.log(`📈 Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(activeTokens.length/batchSize)}: ${batchResults.success} success, ${batchResults.errors} errors`);
      }

      console.log(`✅ Price refresh complete: ${successCount} successful, ${errorCount} errors`);
      
      // Archive tokens with persistent invalid bonding curves
      if (this.invalidTokens.size > 0) {
        await this.archiveInvalidTokens();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Price refresh failed:', errorMessage);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Get tokens that need price refresh with proper validation
   */
  private async getTokensForRefresh() {
    const query = `
      SELECT DISTINCT t.address, t.bonding_curve, t.symbol,
             p.last_price_time,
             EXTRACT(EPOCH FROM (NOW() - p.last_price_time)) as seconds_since_update
      FROM tokens t
      LEFT JOIN LATERAL (
        SELECT MAX(time) as last_price_time
        FROM price_updates
        WHERE token = t.address
      ) p ON true
      WHERE NOT t.archived   
        AND NOT t.graduated
        AND t.bonding_curve IS NOT NULL
        AND t.bonding_curve != 'unknown'
        AND t.bonding_curve != ''
        AND LENGTH(t.bonding_curve) = 44
        AND (
          p.last_price_time IS NULL   
          OR p.last_price_time < NOW() - INTERVAL '5 minutes'
        )
      ORDER BY p.last_price_time ASC NULLS FIRST
      LIMIT 100
    `;
    
    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Process a batch of tokens with error handling
   */
  private async processBatch(tokens: any[]): Promise<{success: number, errors: number}> {
    let successCount = 0;
    let errorCount = 0;

    const results = await Promise.allSettled(
      tokens.map(async (token) => {
        try {
          const priceUpdate = await this.refreshTokenPrice(token);
          if (priceUpdate) {
            await db.bulkInsertPriceUpdates([priceUpdate]);
            return { success: true, token: token.address };
          } else {
            // Mark as invalid if we consistently can't get price data
            this.invalidTokens.add(token.address);
            return { success: false, token: token.address };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Error processing ${token.symbol || token.address}:`, errorMessage);
          this.invalidTokens.add(token.address);
          return { success: false, token: token.address };
        }
      })
    );

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.success) {
        successCount++;
      } else {
        errorCount++;
      }
    });

    return { success: successCount, errors: errorCount };
  }

  /**
   * Refresh price for a single token with proper error handling
   */
  private async refreshTokenPrice(token: any): Promise<PriceUpdate | null> {
    try {
      // Validate bonding curve address before using it
      if (!token.bonding_curve || token.bonding_curve.length !== 44) {
        console.warn(`⚠️ Invalid bonding curve for ${token.symbol}: "${token.bonding_curve}"`);
        return null;
      }

      // Get bonding curve data
      const bondingCurveData = await this.bondingCurveFetcher.getBondingCurveData(token.bonding_curve);
      
      if (!bondingCurveData) {
        console.warn(`⚠️ No bonding curve data for ${token.symbol || token.address}`);
        return null;
      }

      // Calculate price using your existing Method 2 - FIXED method call
      const priceInSol = PriceCalculator.calculatePrice(
        bondingCurveData.virtualSolReserves,
        bondingCurveData.virtualTokenReserves
      );

      if (!priceInSol || priceInSol <= 0) {
        console.warn(`⚠️ Invalid price calculation for ${token.symbol}`);
        return null;
      }

      // FIXED: Use correct method name
      const solPriceUsd = this.solPriceService.getPrice();
      const priceInUsd = priceInSol * solPriceUsd;

      // Calculate market cap using your existing method
      const marketCapUsd = PriceCalculator.calculateMarketCap(
        priceInSol,
        solPriceUsd,
        DEFAULT_TOKEN_SUPPLY
      );

      // Validate market cap is reasonable
      if (!PriceCalculator.validateMarketCap(marketCapUsd)) {
        console.warn(`⚠️ Invalid market cap for ${token.symbol}: ${formatMarketCap(marketCapUsd)}`);
        return null;
      }

      // Check if bonding curve is complete
      if (bondingCurveData.complete) {
        console.log(`🎓 Token ${token.symbol} bonding curve completed at ${formatMarketCap(marketCapUsd)}`);
        
        // Mark as graduated
        await db.query('UPDATE tokens SET graduated = true WHERE address = $1', [token.address]);
        
        return null; // Don't create price update for graduated tokens
      }

      // Calculate progress and liquidity - FIXED method call
      const progress = ProgressCalculator.calculateProgress(
        bondingCurveData.virtualSolReserves
      );

      const liquiditySol = bondingCurveData.realSolReserves / 1e9;
      const liquidityUsd = liquiditySol * solPriceUsd;

      return {
        token: token.address,
        price_sol: priceInSol,
        price_usd: priceInUsd,
        liquidity_sol: liquiditySol,
        liquidity_usd: liquidityUsd,
        market_cap_usd: marketCapUsd,
        bonding_complete: bondingCurveData.complete,
        progress
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error refreshing price for ${token.symbol || token.address}:`, errorMessage);
      return null;
    }
  }

  /**
   * Archive tokens with consistently invalid bonding curves
   */
  private async archiveInvalidTokens(): Promise<void> {
    if (this.invalidTokens.size === 0) return;

    try {
      const invalidTokenArray = Array.from(this.invalidTokens);
      console.log(`🗂️ Archiving ${invalidTokenArray.length} tokens with invalid bonding curves...`);
      
      await db.query(`
        UPDATE tokens 
        SET archived = true, 
            last_updated = NOW() 
        WHERE address = ANY($1)
      `, [invalidTokenArray]);
      
      console.log(`✅ Archived ${invalidTokenArray.length} invalid tokens`);
      this.invalidTokens.clear();
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Error archiving invalid tokens:', errorMessage);
    }
  }

  /**
   * Health check method
   */
  async healthCheck(): Promise<{status: string, validTokens: number, invalidTokens: number}> {
    try {
      const stats = await db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN LENGTH(bonding_curve) = 44 AND bonding_curve != 'unknown' THEN 1 END) as valid,
          COUNT(CASE WHEN LENGTH(bonding_curve) != 44 OR bonding_curve = 'unknown' OR bonding_curve IS NULL THEN 1 END) as invalid
        FROM tokens 
        WHERE NOT archived
      `);
      
      const row = stats.rows[0];
      
      return {
        status: 'healthy',
        validTokens: parseInt(row.valid),
        invalidTokens: parseInt(row.invalid)
      };
    } catch (error) {
      return {
        status: 'error',
        validTokens: 0,
        invalidTokens: 0
      };
    }
  }
}