#!/usr/bin/env node
import 'dotenv/config';
import { SubscriptionHandler } from '../stream/subscription';
import { extractTradeEvents } from '../utils/parser';
import { calculatePrice } from '../utils/price-calculator';
import { SolPriceService } from '../services/sol-price';

// Simple progress calculation based on virtual reserves
function calculateProgress(virtualSolReserves: bigint): number {
  // Pump.fun starts with 30 SOL virtual, completes at ~115 SOL virtual
  // This gives us 85 SOL range = 100% progress
  const startSol = 30;
  const targetSol = 115;
  const currentSol = Number(virtualSolReserves) / 1e9;
  
  if (currentSol <= startSol) return 0;
  if (currentSol >= targetSol) return 100;
  
  return ((currentSol - startSol) / (targetSol - startSol)) * 100;
}

async function main() {
  console.log('🚀 Pump.fun Progress Tracker');
  console.log('📊 Streaming token trades with progress estimation...');
  console.log('⌨️  Press Ctrl+C to stop\n');
  
  const solPriceService = SolPriceService.getInstance();
  await solPriceService.initialize();
  
  // Override the processTransaction method to add progress
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
        const progressBar = createProgressBar(progress);
        
        // Enhanced output with progress
        console.log(`
🪙 Token: ${event.mint}
💰 Price: $${priceData.priceInUsd.toFixed(8)} (${priceData.priceInSol.toFixed(8)} SOL)
📈 MCap: $${priceData.mcapUsd.toFixed(2)}
📊 Progress: ${progressBar} ${progress.toFixed(1)}%
💧 Virtual SOL: ${(Number(event.virtualSolReserves) / 1e9).toFixed(4)} SOL
${progress > 90 ? '⚠️  ALERT: Close to completion!' : ''}
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
    await handler.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  
  try {
    await handler.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

function createProgressBar(progress: number): string {
  const filled = Math.floor(progress / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

main().catch(console.error);