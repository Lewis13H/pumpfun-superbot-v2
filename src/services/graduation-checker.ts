import { db } from '../database';
import { DexScreenerPriceService } from './dexscreener-price';

export class GraduationChecker {
  private static instance: GraduationChecker;
  private dexScreenerService: DexScreenerPriceService;

  private constructor() {
    this.dexScreenerService = DexScreenerPriceService.getInstance();
  }

  static getInstance(): GraduationChecker {
    if (!GraduationChecker.instance) {
      GraduationChecker.instance = new GraduationChecker();
    }
    return GraduationChecker.instance;
  }

  /**
   * Check all tokens in database for graduation status
   */
  async checkAllTokensForGraduation(): Promise<void> {
    console.log('🔍 Checking all tokens for graduation status...\n');
    
    try {
      // Get all non-graduated tokens
      const result = await db.query(`
        SELECT address, name, symbol, graduated
        FROM tokens
        WHERE graduated = false OR graduated IS NULL
        ORDER BY created_at DESC
      `);

      if (result.rows.length === 0) {
        console.log('No non-graduated tokens to check.');
        return;
      }

      console.log(`Checking ${result.rows.length} tokens for graduation...\n`);

      let newlyGraduated = 0;
      let checked = 0;
      let errors = 0;

      for (const token of result.rows) {
        try {
          // Check if token has DexScreener data (indicates it's on Raydium)
          const dexData = await this.dexScreenerService.getTokenData(token.address);
          
          if (dexData && dexData.liquidity > 0) {
            // Token is trading on DEX - mark as graduated
            console.log(`🎓 GRADUATED: ${token.name} (${token.symbol})`);
            console.log(`   Market Cap: $${dexData.marketCap.toLocaleString()}`);
            console.log(`   Liquidity: $${dexData.liquidity.toLocaleString()}`);
            console.log(`   DEX: ${dexData.dexId || 'Unknown'}`);
            
            // Mark as graduated
            await this.markTokenAsGraduated(token.address, dexData);
            newlyGraduated++;
          }
          
          checked++;
          
          // Progress indicator
          if (checked % 10 === 0) {
            console.log(`\n📊 Progress: ${checked}/${result.rows.length} checked`);
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          errors++;
          // Silently continue - token might not be on DEX
        }
      }

      console.log('\n✅ Graduation check complete!');
      console.log(`   Total checked: ${checked}`);
      console.log(`   Newly graduated: ${newlyGraduated}`);
      console.log(`   Errors/Not found: ${errors}`);
      
      // Show rate limit status
      const rateLimitStatus = this.dexScreenerService.getRateLimitStatus();
      console.log(`\n📊 DexScreener Rate Limit: ${rateLimitStatus.current}/${rateLimitStatus.max} requests`);
      if (rateLimitStatus.current > 0) {
        console.log(`   Resets in: ${Math.ceil(rateLimitStatus.resets / 1000)}s`);
      }
      
      if (newlyGraduated > 0) {
        console.log('\n🎉 Newly graduated tokens have been updated!');
      }

    } catch (error) {
      console.error('Error checking graduations:', error);
    }
  }

  /**
   * Check a single token for graduation
   */
  async checkSingleTokenGraduation(address: string): Promise<boolean> {
    try {
      const dexData = await this.dexScreenerService.getTokenData(address);
      
      if (dexData && dexData.liquidity > 0) {
        console.log(`🎓 Token ${address} has graduated!`);
        console.log(`   Market Cap: $${dexData.marketCap.toLocaleString()}`);
        console.log(`   Liquidity: $${dexData.liquidity.toLocaleString()}`);
        
        await this.markTokenAsGraduated(address, dexData);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error checking graduation for ${address}:`, error);
      return false;
    }
  }

  /**
   * Mark token as graduated and save initial DEX data
   */
  private async markTokenAsGraduated(address: string, dexData: any): Promise<void> {
    try {
      await db.query('BEGIN');
      
      // Update token as graduated
      await db.query(`
        UPDATE tokens 
        SET 
          graduated = true,
          graduation_time = COALESCE(graduation_time, NOW()),
          last_price_usd = $1,
          last_updated = NOW()
        WHERE address = $2
      `, [dexData.price, address]);
      
      // Save graduation price update
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
          0,
          $4,
          $5,
          true,
          100,
          true
        )
      `, [
        address,
        dexData.priceInSol,
        dexData.price,
        dexData.liquidity,
        dexData.marketCap
      ]);
      
      // Update volume if available
      if (dexData.volume24h) {
        await db.query(`
          UPDATE tokens 
          SET volume_24h_usd = $1 
          WHERE address = $2
        `, [dexData.volume24h, address]);
      }
      
      await db.query('COMMIT');
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Get summary of graduation status
   */
  async getGraduationSummary(): Promise<void> {
    const result = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated = true) as graduated,
        COUNT(*) FILTER (WHERE graduated = false OR graduated IS NULL) as not_graduated,
        COUNT(*) as total
      FROM tokens
    `);
    
    const stats = result.rows[0];
    console.log('\n📊 Token Graduation Summary:');
    console.log(`   Total tokens: ${stats.total}`);
    console.log(`   Graduated: ${stats.graduated}`);
    console.log(`   Not graduated: ${stats.not_graduated}`);
    console.log(`   Graduation rate: ${((stats.graduated / stats.total) * 100).toFixed(1)}%`);
  }
}