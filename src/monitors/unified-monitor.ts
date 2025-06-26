#!/usr/bin/env node
import 'dotenv/config';
import { SubscriptionHandler } from '../stream/subscription';
import { extractTradeEvents } from '../utils/parser';
import { calculatePrice } from '../utils/price-calculator';
import { SolPriceService } from '../services/sol-price';

// Progress calculation based on virtual reserves
function calculateProgress(virtualSolReserves: bigint): number {
  const startSol = 30;
  const targetSol = 115;
  const currentSol = Number(virtualSolReserves) / 1e9;
  
  if (currentSol <= startSol) return 0;
  if (currentSol >= targetSol) return 100;
  
  return ((currentSol - startSol) / (targetSol - startSol)) * 100;
}

// Create a visual progress bar
function createProgressBar(progress: number): string {
  const width = 30;
  const filled = Math.floor((progress / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
}

// Track recent tokens to avoid spam
const recentTokens = new Map<string, { count: number; lastSeen: number }>();
const COOLDOWN_MS = 5000; // 5 second cooldown per token

async function main() {
  console.log('🚀 Unified Pump.fun Monitor');
  console.log('💰 Tracking prices and bonding curve progress');
  console.log('━'.repeat(60));
  console.log('⌨️  Press Ctrl+C to stop\n');
  
  const solPriceService = SolPriceService.getInstance();
  await solPriceService.initialize();
  
  const handler = new SubscriptionHandler();
  
  // Override processTransaction for unified monitoring
  (handler as any).processTransaction = async function(data: any) {
    const logs = data.transaction?.transaction?.meta?.logMessages || [];
    const events = extractTradeEvents(logs);
    
    for (const event of events) {
      try {
        // Check cooldown
        const now = Date.now();
        const recent = recentTokens.get(event.mint);
        if (recent && now - recent.lastSeen < COOLDOWN_MS) {
          recent.count++;
          recent.lastSeen = now;
          continue; // Skip display but count
        }
        
        // Update recent tracking
        recentTokens.set(event.mint, { count: 1, lastSeen: now });
        
        // Calculate price and progress
        const solPrice = await solPriceService.getPrice();
        const priceData = calculatePrice(
          event.virtualSolReserves,
          event.virtualTokenReserves,
          solPrice
        );
        
        const progress = calculateProgress(event.virtualSolReserves);
        const progressBar = createProgressBar(progress);
        
        // Unified display
        console.log(`\n🪙 ${event.mint}`);
        console.log(`├─ Price: $${priceData.priceInUsd.toFixed(8)} (${priceData.priceInSol.toFixed(6)} SOL)`);
        console.log(`├─ MCap: $${priceData.mcapUsd.toLocaleString()}`);
        console.log(`├─ Progress: ${progressBar} ${progress.toFixed(1)}%`);
        console.log(`└─ Virtual: ${(Number(event.virtualSolReserves) / 1e9).toFixed(2)} SOL`);
        
        // Highlight significant milestones
        if (progress >= 95) {
          console.log('   🎯 NEAR GRADUATION!');
        } else if (progress >= 75) {
          console.log('   📈 High progress!');
        }
        
        if (priceData.mcapUsd >= 100000) {
          console.log('   💎 High market cap!');
        }
      } catch (error) {
        console.error('Error processing event:', error);
      }
    }
    
    // Clean up old entries
    const now = Date.now();
    for (const [mint, data] of recentTokens.entries()) {
      if (now - data.lastSeen > 60000) { // 1 minute
        recentTokens.delete(mint);
      }
    }
  };
  
  // Start monitoring
  await handler.start();
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down unified monitor...');
  process.exit(0);
});

main().catch(console.error);