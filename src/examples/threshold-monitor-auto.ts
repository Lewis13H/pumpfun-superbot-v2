import dotenv from 'dotenv';
import { SubscriptionHandler } from '../stream/subscription';
import { ThresholdTracker } from '../services/threshold-tracker';
import { GraduatedPriceUpdater } from '../services/graduated-price-updater';
import { StartupChecks } from '../services/startup-checks';
import { db } from '../database';

dotenv.config();

// Enable threshold tracking globally
const thresholdTracker = ThresholdTracker.getInstance();

// Override formatOutput to check threshold
const originalFormatOutput = require('../utils/formatter').formatOutput;
require('../utils/formatter').formatOutput = async function(mint: string, priceData: any) {
  // Check and save if meets threshold
  const saved = await thresholdTracker.checkAndSaveToken({
    mint,
    priceInSol: priceData.priceInSol,
    priceInUsd: priceData.priceInUsd,
    mcapSol: priceData.mcapSol,
    mcapUsd: priceData.mcapUsd,
    virtualSolReserves: priceData.virtualSolReserves,
    virtualTokenReserves: priceData.virtualTokenReserves,
    progress: priceData.progress
  });
  
  // Add indicator if we're tracking this token
  const indicator = saved ? ' 🆕' : (await thresholdTracker.isTracked(mint) ? ' 💾' : '');
  
  // Call original formatter with indicator
  originalFormatOutput(mint, priceData, indicator);
};

async function main() {
  console.log('🎯 Pump.fun $8888 Threshold Monitor with Auto Graduation Detection\n');
  console.log('📊 Monitoring for tokens with market cap ≥ $8888');
  console.log('🎓 Auto-detecting graduated tokens via DexScreener\n');
  
  // Run startup checks
  await StartupChecks.runAll();
  
  // Start graduated token price updates
  const graduatedUpdater = GraduatedPriceUpdater.getInstance();
  graduatedUpdater.startPriceUpdates();
  
  // Create and start subscription
  const handler = new SubscriptionHandler();
  
  // Handle graceful shutdown
  const cleanup = async () => {
    console.log('\n🛑 Shutting down...');
    graduatedUpdater.stopPriceUpdates();
    await handler.stop();
    
    // Show summary
    try {
      const result = await db.query(`
        SELECT 
          COUNT(DISTINCT address) as total_tokens,
          COUNT(DISTINCT CASE WHEN graduated = true THEN address END) as graduated_tokens,
          MIN(created_at) as first_saved,
          MAX(created_at) as last_saved
        FROM tokens
      `);
      
      const stats = result.rows[0];
      console.log('\n📈 Session Summary:');
      console.log(`   Total tokens saved: ${stats.total_tokens}`);
      console.log(`   Graduated tokens: ${stats.graduated_tokens}`);
      console.log(`   Monitoring since: ${stats.first_saved}`);
    } catch (error) {
      console.error('Error fetching summary:', error);
    }
    
    process.exit(0);
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  // Start monitoring
  await handler.start();
}

// Run the monitor
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});