import { db } from '../database';
import { DexScreenerPriceService } from './dexscreener-price';

export class GraduatedPriceUpdater {
  private static instance: GraduatedPriceUpdater;
  private dexScreenerService: DexScreenerPriceService;
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_INTERVAL_MS = 60000; // Update every minute

  private constructor() {
    this.dexScreenerService = DexScreenerPriceService.getInstance();
  }

  static getInstance(): GraduatedPriceUpdater {
    if (!GraduatedPriceUpdater.instance) {
      GraduatedPriceUpdater.instance = new GraduatedPriceUpdater();
    }
    return GraduatedPriceUpdater.instance;
  }

  /**
   * Start periodic price updates for graduated tokens
   */
  startPriceUpdates(): void {
    if (this.updateInterval) {
      console.log('Price updates already running');
      return;
    }

    console.log('🚀 Starting graduated token price updates');
    
    // Run immediately
    this.updatePrices();
    
    // Then run periodically
    this.updateInterval = setInterval(() => {
      this.updatePrices();
    }, this.UPDATE_INTERVAL_MS);
  }

  /**
   * Stop periodic price updates
   */
  stopPriceUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('🛑 Stopped graduated token price updates');
    }
  }

  /**
   * Update prices for all graduated tokens
   */
  async updatePrices(): Promise<void> {
    try {
      // Get all graduated tokens
      const result = await db.query(`
        SELECT address, name, symbol 
        FROM tokens 
        WHERE graduated = true
      `);

      if (result.rows.length === 0) {
        console.log('No graduated tokens to update');
        return;
      }

      console.log(`📊 Updating prices for ${result.rows.length} graduated tokens`);

      // Get all addresses for batch request
      const addresses = result.rows.map((row: any) => row.address);
      const tokenMap = new Map(result.rows.map((row: any) => [row.address, row]));
      
      // Fetch prices in batch with rate limiting
      const priceData = await this.dexScreenerService.getBatchTokenData(addresses);
      
      // Update each token with fetched data
      let updated = 0;
      let failed = 0;
      
      for (const [address, tokenData] of priceData) {
        const token = tokenMap.get(address);
        if (token && tokenData) {
          try {
            await this.savePriceUpdate(
              address,
              tokenData.priceInSol,
              tokenData.price,
              tokenData.marketCap,
              true // graduated
            );
            
            // Also update volume if available
            if (tokenData.volume24h) {
              await db.query(`
                UPDATE tokens 
                SET volume_24h_usd = $1 
                WHERE address = $2
              `, [tokenData.volume24h, address]);
            }

            updated++;
            console.log(`✅ Updated ${(token as any).symbol}: $${tokenData.price.toFixed(6)}`);
          } catch (error) {
            console.error(`Error saving ${(token as any).symbol}:`, error);
            failed++;
          }
        }
      }
      
      // Count tokens that had no data
      const noData = result.rows.length - priceData.size;
      if (noData > 0) {
        console.log(`❌ No data available for ${noData} tokens`);
      }

      console.log(`\n📈 Summary: Updated ${updated}/${result.rows.length} tokens (${failed} failed)`);
    } catch (error) {
      console.error('Error updating graduated token prices:', error);
    }
  }

  /**
   * Update price for a specific graduated token
   */
  async updateSingleTokenPrice(mintAddress: string): Promise<boolean> {
    try {
      const tokenData = await this.dexScreenerService.getTokenData(mintAddress);
      
      if (!tokenData) {
        console.log(`No DexScreener data available for ${mintAddress}`);
        return false;
      }

      await this.savePriceUpdate(
        mintAddress,
        tokenData.priceInSol,
        tokenData.price,
        tokenData.marketCap,
        true
      );

      console.log(`💰 Updated ${mintAddress}:`);
      console.log(`   Price: $${tokenData.price.toFixed(6)}`);
      console.log(`   Market Cap: $${tokenData.marketCap.toLocaleString()}`);
      console.log(`   Liquidity: $${tokenData.liquidity.toLocaleString()}`);
      console.log(`   24h Volume: $${tokenData.volume24h.toLocaleString()}`);
      console.log(`   24h Change: ${tokenData.priceChange24h > 0 ? '+' : ''}${tokenData.priceChange24h.toFixed(2)}%`);
      if (tokenData.dexId) {
        console.log(`   Trading on: ${tokenData.dexId}`);
      }

      return true;
    } catch (error) {
      console.error(`Error updating price for ${mintAddress}:`, error);
      return false;
    }
  }

  /**
   * Save price update to database
   */
  private async savePriceUpdate(
    token: string,
    priceSol: number,
    priceUsd: number,
    marketCapUsd: number,
    graduated: boolean
  ): Promise<void> {
    await db.query(`
      INSERT INTO price_updates (
        time,
        token,
        price_sol,
        price_usd,
        liquidity_sol,
        liquidity_usd,
        market_cap_usd,
        bonding_complete,
        progress,
        is_graduated
      ) VALUES (
        NOW(),
        $1,
        $2,
        $3,
        0,  -- No liquidity data from Jupiter
        0,  -- No liquidity data from Jupiter
        $4,
        $5,
        $6,
        $7
      )
    `, [
      token,
      priceSol,
      priceUsd,
      marketCapUsd,
      graduated,
      graduated ? 100 : 0,
      graduated
    ]);

    // Also update the latest price in tokens table
    await db.query(`
      UPDATE tokens 
      SET 
        last_price_usd = $1,
        last_updated = NOW()
      WHERE address = $2
    `, [priceUsd, token]);
  }
}