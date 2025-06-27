#!/usr/bin/env node
/**
 * Enhanced comprehensive monitor with improved token detection
 * Matches threshold monitor's detection rate while maintaining comprehensive features
 */

import { SimpleSubscriptionHandler } from '../stream/subscription-simple';
import { extractTradeEvents } from '../utils/parser';
import { calculatePrice } from '../utils/price-calculator';
import { ComprehensiveDbService } from '../database/comprehensive-db-service';
import { getSolPrice } from '../services/sol-price';
import { formatNumber, formatPrice } from '../utils/formatters';
import dotenv from 'dotenv';
import { SolPriceUpdater } from '../services/sol-price-updater';

dotenv.config();

// ANSI color codes
const RESET = '\x1b[0m';
const BRIGHT = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const CLEAR_LINE = '\x1b[2K';

interface Stats {
  eventsProcessed: number;
  tokensSaved: Set<string>;
  errors: number;
  startTime: Date;
  lastActivity: Date;
  highValueEvents: number;
}

const stats: Stats = {
  eventsProcessed: 0,
  tokensSaved: new Set(),
  errors: 0,
  startTime: new Date(),
  lastActivity: new Date(),
  highValueEvents: 0
};

// Recent activity buffer
const recentActivity: string[] = [];
const MAX_ACTIVITY_LINES = 10;

// Global database service instance
let dbService: ComprehensiveDbService;

async function main() {
  console.clear();
  console.log(`${BRIGHT}${CYAN}╔═══════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}${CYAN}║        ENHANCED COMPREHENSIVE MONITOR (THRESHOLD MATCHING)        ║${RESET}`);
  console.log(`${BRIGHT}${CYAN}║              Improved detection matching threshold monitor        ║${RESET}`);
  console.log(`${BRIGHT}${CYAN}║                  Saving tokens ≥ $8,888 market cap                ║${RESET}`);
  console.log(`${BRIGHT}${CYAN}╚═══════════════════════════════════════════════════════════════════╝${RESET}\n`);

  // Start SOL price updater
  console.log(`${YELLOW}Starting SOL price updater...${RESET}`);
  const solPriceUpdater = SolPriceUpdater.getInstance();
  solPriceUpdater.start();

  // Initialize database service
  dbService = new ComprehensiveDbService();
  console.log(`${GREEN}✓ Database service initialized${RESET}\n`);

  // Use the same simple handler as threshold monitor
  const handler = new SimpleSubscriptionHandler();
  
  // Override processTransaction to match threshold monitor's logic
  (handler as any).processTransaction = async function(data: any) {
    stats.lastActivity = new Date();
    
    const logs = data.transaction?.transaction?.meta?.logMessages || [];
    const events = extractTradeEvents(logs);
    
    for (const event of events) {
      stats.eventsProcessed++;
      
      try {
        const solPrice = await getSolPrice();
        const priceData = calculatePrice(
          event.virtualSolReserves,
          event.virtualTokenReserves,
          solPrice
        );
        
        // Check if market cap meets threshold
        if (priceData.mcapUsd >= 8888) {
          stats.highValueEvents++;
          
          // Get or create token
          let tokenId = await dbService.getTokenByMint(event.mint);
          
          if (!tokenId) {
            // First time seeing this token above threshold
            tokenId = await dbService.saveToken({
              mintAddress: event.mint,
              symbol: undefined, // Would need to fetch from chain
              name: undefined,
              uri: undefined,
              firstProgram: 'bonding_curve',
              firstSeenSlot: BigInt(data.slot || 0),
              firstMarketCapUsd: priceData.mcapUsd,
              thresholdPriceSol: priceData.priceInSol,
              thresholdMarketCapUsd: priceData.mcapUsd
            });
            
            stats.tokensSaved.add(event.mint);
            
            // Add to activity with high priority
            addActivity(
              `${BRIGHT}${GREEN}💎 NEW TOKEN SAVED: ${event.mint.slice(0, 8)}... - $${formatNumber(priceData.mcapUsd)}${RESET}`,
              true
            );
            
            console.log(`\n🎉 TOKEN REACHED $8888 THRESHOLD!`);
            console.log(`   Address: ${event.mint}`);
            console.log(`   Market Cap: $${priceData.mcapUsd.toFixed(2)}`);
            console.log(`   Price: $${priceData.priceInUsd.toFixed(8)}`);
            console.log('');
          }
          
          // Queue the trade data
          await dbService.queueBondingCurveTrade({
            tokenId,
            signature: data.signature || 'unknown',
            tradeType: 'buy', // Would need to parse from event
            userAddress: 'unknown', // Would need to parse from event
            solAmount: BigInt(0), // Would need to parse from event
            tokenAmount: BigInt(0), // Would need to parse from event
            priceSol: priceData.priceInSol,
            priceUsd: priceData.priceInUsd,
            marketCapUsd: priceData.mcapUsd,
            virtualSolReserves: event.virtualSolReserves,
            virtualTokenReserves: event.virtualTokenReserves,
            slot: BigInt(data.slot || 0),
            blockTime: new Date()
          });
        }
      } catch (error) {
        stats.errors++;
        console.error('Error processing event:', error);
      }
    }
  };

  // Handle connection
  handler.onConnect = () => {
    console.log(`${GREEN}✓ Connected to gRPC stream${RESET}\n`);
    startDashboard();
  };

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n👋 Shutting down...');
    
    // Show final stats
    console.log(`\n${BRIGHT}${CYAN}Final Statistics:${RESET}`);
    console.log(`  Events Processed: ${stats.eventsProcessed}`);
    console.log(`  Unique Tokens Saved: ${stats.tokensSaved.size}`);
    console.log(`  High Value Events: ${stats.highValueEvents}`);
    console.log(`  Errors: ${stats.errors}`);
    
    // Clean up
    await handler.stop();
    await dbService.close();
    solPriceUpdater.stop();
    process.exit(0);
  });

  // Start monitoring
  try {
    await handler.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Add activity to the buffer
function addActivity(message: string, priority: boolean = false) {
  const timestamp = new Date().toLocaleTimeString();
  const activity = `${DIM}[${timestamp}]${RESET} ${message}`;
  
  if (priority) {
    recentActivity.unshift(activity);
  } else {
    recentActivity.push(activity);
  }
  
  // Keep only the most recent activities
  if (recentActivity.length > MAX_ACTIVITY_LINES) {
    recentActivity.pop();
  }
}

// Start the dashboard display
function startDashboard() {
  // Initial dashboard render
  renderDashboard();
  
  // Update dashboard every second
  setInterval(renderDashboard, 1000);
}

// Render the dashboard
function renderDashboard() {
  // Move cursor to the top of the dashboard area
  process.stdout.write('\x1b[H'); // Home position
  process.stdout.write('\x1b[10B'); // Move down 10 lines past the header
  
  const runtime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000);
  const hours = Math.floor(runtime / 3600);
  const minutes = Math.floor((runtime % 3600) / 60);
  const seconds = runtime % 60;
  
  const idleTime = Math.floor((Date.now() - stats.lastActivity.getTime()) / 1000);
  const idleIndicator = idleTime > 5 ? `${DIM}(idle ${idleTime}s)${RESET}` : `${GREEN}(active)${RESET}`;
  
  // Statistics section
  console.log(`${CLEAR_LINE}${BRIGHT}${CYAN}━━━ LIVE STATISTICS ━━━${RESET} ${idleIndicator}`);
  console.log(`${CLEAR_LINE}`);
  console.log(`${CLEAR_LINE}${YELLOW}Events Processed:${RESET} ${formatNumber(stats.eventsProcessed)}`);
  console.log(`${CLEAR_LINE}${GREEN}Tokens Saved:${RESET}     ${stats.tokensSaved.size} unique tokens (≥$8,888 market cap)`);
  console.log(`${CLEAR_LINE}${MAGENTA}High Value:${RESET}       ${stats.highValueEvents} events above threshold`);
  console.log(`${CLEAR_LINE}${RED}Errors:${RESET}           ${stats.errors}`);
  console.log(`${CLEAR_LINE}${DIM}Runtime:${RESET}          ${hours}h ${minutes}m ${seconds}s`);
  
  // Recent activity section
  console.log(`${CLEAR_LINE}`);
  console.log(`${CLEAR_LINE}${BRIGHT}${CYAN}━━━ RECENT ACTIVITY ━━━${RESET}`);
  console.log(`${CLEAR_LINE}`);
  
  // Show recent activities
  for (let i = 0; i < MAX_ACTIVITY_LINES; i++) {
    if (i < recentActivity.length) {
      console.log(`${CLEAR_LINE}${recentActivity[i]}`);
    } else {
      console.log(`${CLEAR_LINE}`);
    }
  }
  
  // Footer
  console.log(`${CLEAR_LINE}`);
  console.log(`${CLEAR_LINE}${DIM}Press Ctrl+C to stop monitoring${RESET}`);
}

main().catch(console.error);