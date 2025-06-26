import { db } from '../database';
import { GraduationChecker } from './graduation-checker';
import { GraduatedPriceUpdater } from './graduated-price-updater';

export class StartupChecks {
  private static hasRun = false;

  /**
   * Run all startup checks
   */
  static async runAll(): Promise<void> {
    if (this.hasRun) {
      console.log('⚠️  Startup checks already completed');
      return;
    }

    console.log('🚀 Running startup checks...\n');
    
    try {
      // 1. Check database connection
      await this.checkDatabase();
      
      // 2. Check for newly graduated tokens
      await this.checkGraduations();
      
      // 3. Update prices for graduated tokens
      await this.updateGraduatedPrices();
      
      // 4. Show system status
      await this.showSystemStatus();
      
      this.hasRun = true;
      console.log('\n✅ Startup checks complete!\n');
      
    } catch (error) {
      console.error('❌ Startup checks failed:', error);
      throw error;
    }
  }

  /**
   * Check database connection
   */
  private static async checkDatabase(): Promise<void> {
    try {
      await db.query('SELECT 1');
      console.log('✅ Database connection: OK');
    } catch (error) {
      console.error('❌ Database connection: FAILED');
      throw error;
    }
  }

  /**
   * Check for newly graduated tokens
   */
  private static async checkGraduations(): Promise<void> {
    console.log('\n📊 Checking for graduated tokens...');
    
    const checker = GraduationChecker.getInstance();
    
    // Quick check - only check tokens with high progress or recent activity
    const result = await db.query(`
      SELECT t.address, t.name, t.symbol
      FROM tokens t
      WHERE t.graduated = false OR t.graduated IS NULL
      AND EXISTS (
        SELECT 1 FROM price_updates p 
        WHERE p.token = t.address 
        AND (p.progress >= 80 OR p.time > NOW() - INTERVAL '24 hours')
      )
      LIMIT 20
    `);

    if (result.rows.length > 0) {
      console.log(`Found ${result.rows.length} tokens to check for graduation...`);
      
      let graduated = 0;
      for (const token of result.rows) {
        const hasGraduated = await checker.checkSingleTokenGraduation(token.address);
        if (hasGraduated) {
          graduated++;
        }
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (graduated > 0) {
        console.log(`\n🎓 Found ${graduated} newly graduated tokens!`);
      } else {
        console.log('No new graduations detected.');
      }
    } else {
      console.log('No tokens to check for graduation.');
    }
  }

  /**
   * Update prices for graduated tokens that need updates
   */
  private static async updateGraduatedPrices(): Promise<void> {
    console.log('\n💰 Updating graduated token prices...');
    
    const result = await db.query(`
      SELECT address, name, symbol
      FROM tokens
      WHERE graduated = true
      AND (
        last_updated IS NULL 
        OR last_updated < NOW() - INTERVAL '2 hours'
        OR last_price_usd IS NULL
      )
      LIMIT 10
    `);

    if (result.rows.length > 0) {
      console.log(`Updating ${result.rows.length} graduated token prices...`);
      
      const updater = GraduatedPriceUpdater.getInstance();
      
      for (const token of result.rows) {
        await updater.updateSingleTokenPrice(token.address);
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      console.log('All graduated token prices are up to date.');
    }
  }

  /**
   * Show system status
   */
  private static async showSystemStatus(): Promise<void> {
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(*) FILTER (WHERE graduated = true) as graduated_tokens,
        COUNT(*) FILTER (WHERE graduated = true AND last_updated > NOW() - INTERVAL '1 hour') as recently_updated,
        COUNT(*) FILTER (WHERE graduated = false AND created_at > NOW() - INTERVAL '24 hours') as new_tokens_24h,
        (SELECT COUNT(*) FROM price_updates WHERE time > NOW() - INTERVAL '1 hour') as price_updates_1h
      FROM tokens
    `);
    
    const stat = stats.rows[0];
    
    console.log('\n📈 System Status:');
    console.log(`   Total tokens: ${stat.total_tokens}`);
    console.log(`   Graduated tokens: ${stat.graduated_tokens}`);
    console.log(`   Recently updated: ${stat.recently_updated}`);
    console.log(`   New tokens (24h): ${stat.new_tokens_24h}`);
    console.log(`   Price updates (1h): ${stat.price_updates_1h}`);
  }
}