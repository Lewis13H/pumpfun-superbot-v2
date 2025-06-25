#!/usr/bin/env node
import 'dotenv/config';
import { SubscriptionHandler } from '../stream/subscription';
import { extractTradeEvents } from '../utils/parser';
import { calculatePrice } from '../utils/price-calculator';
import { SolPriceService } from '../services/sol-price';
import { ThresholdTracker } from '../services/threshold-tracker';
import { db } from '../database';

// Calculate progress based on virtual reserves
function calculateProgress(virtualSolReserves: bigint): number {
  const startSol = 30;
  const targetSol = 115;
  const currentSol = Number(virtualSolReserves) / 1e9;
  
  if (currentSol <= startSol) return 0;
  if (currentSol >= targetSol) return 100;
  
  return ((currentSol - startSol) / (targetSol - startSol)) * 100;
}

async function main() {
  console.log('🚀 Pump.fun $8888 Threshold Monitor');
  console.log('📊 Monitoring tokens that reach $8888 market cap...');
  console.log('💾 Tokens meeting threshold will be saved to database');
  console.log('⌨️  Press Ctrl+C to stop\n');
  
  const solPriceService = SolPriceService.getInstance();
  const thresholdTracker = ThresholdTracker.getInstance();
  
  await solPriceService.initialize();
  
  // Test database connection
  try {
    await db.query('SELECT 1');
    console.log('✅ Database connected successfully\n');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
  
  // Override the processTransaction method to add threshold checking
  const handler = new SubscriptionHandler();
  
  (handler as any).processTransaction = async function(data: any) {
    const logs = data.transaction?.transaction?.meta?.logMessages || [];
    const events = extractTradeEvents(logs);
    
    for (const event of events) {
      try {
        const solPrice = await solPriceService.getPrice();
        const priceData = calculatePrice(
          event.virtualSolReserves,
          event.virtualTokenReserves,
          solPrice
        );
        
        // Calculate progress
        const progress = calculateProgress(event.virtualSolReserves);
        
        // Prepare token data
        const tokenData = {
          mint: event.mint,
          priceInSol: priceData.priceInSol,
          priceInUsd: priceData.priceInUsd,
          mcapSol: priceData.mcapSol,
          mcapUsd: priceData.mcapUsd,
          virtualSolReserves: event.virtualSolReserves,
          virtualTokenReserves: event.virtualTokenReserves,
          progress
        };
        
        // Check threshold and save if needed
        const wasSaved = await thresholdTracker.checkAndSaveToken(tokenData);
        
        // Display output
        const isTracked = thresholdTracker.isTokenTracked(event.mint);
        const trackingIndicator = isTracked ? '💾' : '  ';
        const progressBar = createProgressBar(progress);
        
        console.log(`
${trackingIndicator} Token: ${event.mint}
   Price: $${priceData.priceInUsd.toFixed(8)} (${priceData.priceInSol.toFixed(8)} SOL)
   MCap: $${priceData.mcapUsd.toFixed(2)}
   Progress: ${progressBar} ${progress.toFixed(1)}%
   Virtual SOL: ${(Number(event.virtualSolReserves) / 1e9).toFixed(4)} SOL
   ${wasSaved ? '🎉 NEW TOKEN SAVED!' : ''}
${'─'.repeat(60)}
        `);
        
      } catch (error) {
        console.error('Error processing event:', error);
      }
    }
  };
  
  // Set up graceful shutdown
  const shutdown = async () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    console.log(`📊 Total tokens tracked: ${await thresholdTracker.getTrackedTokensCount()}`);
    await handler.stop();
    await db.close();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  
  try {
    await handler.start();
  } catch (error) {
    console.error('Fatal error:', error);
    await db.close();
    process.exit(1);
  }
}

function createProgressBar(progress: number): string {
  const filled = Math.floor(progress / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

main().catch(async (error) => {
  console.error('Unhandled error:', error);
  await db.close();
  process.exit(1);
});