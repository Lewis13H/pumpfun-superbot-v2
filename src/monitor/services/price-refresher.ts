// src/monitor/services/price-refresher.ts

import { EventEmitter } from 'events';
import { db } from '../../database';
import { PriceCalculator } from '../calculators/price';
import { ProgressCalculator } from '../calculators/progress';
import { BondingCurveFetcher } from './bonding-curve-fetcher';
import { SolPriceService } from './sol-price';
import { PriceUpdate } from '../types';
import { DEFAULT_TOKEN_SUPPLY } from '../constants';
import { formatTokenAddress, formatMarketCap } from '../utils/format';

export class PriceRefresherService extends EventEmitter {
  private bondingCurveFetcher: BondingCurveFetcher;
  private refreshTimer?: NodeJS.Timeout;
  private isRefreshing: boolean = false;
  
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
    this.options.refreshInterval = options.refreshInterval || 60000;
    this.options.batchSize = options.batchSize || 20;
    this.options.maxConcurrent = options.maxConcurrent || 5;
  }

  start(): void {
    console.log(`🔄 Starting price refresher (interval: ${this.options.refreshInterval!/1000}s)`);
    
    // Initial refresh after 10 seconds
    setTimeout(() => this.refreshPrices(), 10000);
    
    // Set up periodic refresh
    this.refreshTimer = setInterval(() => {
      this.refreshPrices().catch(console.error);
    }, this.options.refreshInterval!);
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private async refreshPrices(): Promise<void> {
    if (this.isRefreshing) {
      console.log('⏳ Price refresh already in progress, skipping...');
      return;
    }

    this.isRefreshing = true;
    const startTime = Date.now();

    try {
      const tokens = await this.getTokensForRefresh();
      
      if (tokens.length === 0) {
        console.log('✅ No tokens need price refresh');
        return;
      }

      console.log(`📊 Refreshing prices for ${tokens.length} tokens`);
      
      const priceUpdates: PriceUpdate[] = [];
      
      // Process in batches
      for (let i = 0; i < tokens.length; i += this.options.batchSize!) {
        const batch = tokens.slice(i, i + this.options.batchSize!);
        const batchUpdates = await this.processBatch(batch);
        priceUpdates.push(...batchUpdates);
        
        if (i + this.options.batchSize! < tokens.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      if (priceUpdates.length > 0) {
        await db.bulkInsertPriceUpdates(priceUpdates);
        console.log(`✅ Refreshed ${priceUpdates.length} token prices`);
        
        this.emit('refresh:complete', {
          tokensChecked: tokens.length,
          pricesUpdated: priceUpdates.length,
          duration: Date.now() - startTime
        });
      }
      
    } catch (error) {
      console.error('❌ Price refresh error:', error);
      this.emit('refresh:error', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  private async getTokensForRefresh(): Promise<any[]> {
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
        AND t.bonding_curve != 'unknown'
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

  private async processBatch(tokens: any[]): Promise<PriceUpdate[]> {
    const updates: PriceUpdate[] = [];
    
    const chunks = [];
    for (let i = 0; i < tokens.length; i += this.options.maxConcurrent!) {
      chunks.push(tokens.slice(i, i + this.options.maxConcurrent!));
    }

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(token => 
        this.fetchTokenPrice(token).catch(err => {
          console.error(`Failed to fetch price for ${token.symbol || token.address}:`, err);
          return null;
        })
      );

      const chunkResults = await Promise.all(chunkPromises);
      updates.push(...chunkResults.filter(update => update !== null) as PriceUpdate[]);
    }

    return updates;
  }

  private async fetchTokenPrice(token: any): Promise<PriceUpdate | null> {
    try {
      const bondingCurveData = await this.bondingCurveFetcher.getBondingCurveData(
        token.bonding_curve
      );

      if (!bondingCurveData) {
        console.warn(`⚠️ No bonding curve data for ${token.symbol || formatTokenAddress(token.address)}`);
        return null;
      }

      // Check if graduated
      if (bondingCurveData.complete) {
        await db.query(
          'UPDATE tokens SET graduated = true WHERE address = $1',
          [token.address]
        );
        console.log(`🎓 Token ${token.symbol || token.address} has graduated`);
        return null;
      }

      // Use your existing Method 2 calculation
      const priceSol = PriceCalculator.calculatePrice(
        bondingCurveData.virtualSolReserves,
        bondingCurveData.virtualTokenReserves
      );
      
      const solPrice = this.solPriceService.getPrice();
      const priceUsd = priceSol * solPrice;
      const liquiditySol = bondingCurveData.realSolReserves / 1e9;
      const liquidityUsd = PriceCalculator.calculateLiquidityUsd(liquiditySol, solPrice);
      const marketCapUsd = PriceCalculator.calculateMarketCap(
        priceSol, 
        solPrice, 
        DEFAULT_TOKEN_SUPPLY
      );

      // Validate using enhanced validation
      const validation = PriceCalculator.validatePriceData(
        priceSol,
        marketCapUsd,
        liquiditySol,
        bondingCurveData.virtualSolReserves,
        bondingCurveData.virtualTokenReserves
      );

      if (!validation.isValid) {
        console.error(
          `🚨 Invalid price data for ${token.symbol || token.address}: ${validation.reason}`
        );
        return null;
      }

      const progress = ProgressCalculator.calculateProgress(liquiditySol);

      console.log(
        `💰 ${token.symbol || formatTokenAddress(token.address)}: ` +
        `$${priceUsd.toFixed(8)} | MCap: ${formatMarketCap(marketCapUsd)} | ` +
        `Progress: ${progress.toFixed(2)}%`
      );

      return {
        token: token.address,
        price_sol: priceSol,
        price_usd: priceUsd,
        liquidity_sol: liquiditySol,
        liquidity_usd: liquidityUsd,
        market_cap_usd: marketCapUsd,
        bonding_complete: false,
        progress
      };

    } catch (error) {
      console.error(`Error fetching price for ${token.symbol || token.address}:`, error);
      return null;
    }
  }

  getStats() {
    return {
      isRefreshing: this.isRefreshing,
      refreshInterval: this.options.refreshInterval,
      batchSize: this.options.batchSize,
      maxConcurrent: this.options.maxConcurrent
    };
  }
}