#!/usr/bin/env node
/**
 * Comprehensive monitor with database persistence
 * Monitors both pump.fun bonding curves and pump.swap AMM pools
 * Saves all data for tokens that reach $8,888 market cap
 */

import { ComprehensiveSubscription } from '../stream/comprehensive-subscription';
import { ComprehensiveDbService } from '../database/comprehensive-db-service';
import { getSolPrice } from '../services/sol-price';
import { formatNumber, formatPercentage, formatPrice } from '../utils/formatters';
import { calculatePrice } from '../utils/price-calculator';
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
const CURSOR_UP = '\x1b[A';

interface Stats {
  bondingCurveTrades: number;
  bondingCurveStates: number;
  ammSwaps: number;
  ammStates: number;
  tokensSaved: Set<string>;
  errors: number;
  startTime: Date;
  lastActivity: Date;
  highValueEvents: number;
}

const stats: Stats = {
  bondingCurveTrades: 0,
  bondingCurveStates: 0,
  ammSwaps: 0,
  ammStates: 0,
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
let showDebugLogs = false;

async function main() {
  console.clear();
  console.log(`${BRIGHT}${CYAN}╔═══════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}${CYAN}║          COMPREHENSIVE MONITOR WITH DATABASE PERSISTENCE          ║${RESET}`);
  console.log(`${BRIGHT}${CYAN}║              Monitoring Bonding Curves + AMM Pools                ║${RESET}`);
  console.log(`${BRIGHT}${CYAN}║                  Saving tokens ≥ $8,888 market cap                ║${RESET}`);
  console.log(`${BRIGHT}${CYAN}╚═══════════════════════════════════════════════════════════════════╝${RESET}\n`);

  // Start SOL price updater
  console.log(`${YELLOW}Starting SOL price updater...${RESET}`);
  const solPriceUpdater = SolPriceUpdater.getInstance();
  solPriceUpdater.start();

  // Initialize database service
  dbService = new ComprehensiveDbService();
  console.log(`${GREEN}✓ Database service initialized${RESET}\n`);

  const subscription = new ComprehensiveSubscription({
    onUpdate: async (event) => {
      stats.lastActivity = new Date();
      
      switch (event.type) {
        case 'bonding_curve_trade':
          await handleBondingCurveTrade(event.event);
          break;
        case 'bonding_curve_account':
          await handleBondingCurveState(event.account, event.slot);
          break;
        case 'amm_swap':
          await handleAmmSwap(event.event);
          break;
        case 'amm_pool_account':
          await handleAmmPoolState(event.account, event.slot);
          break;
      }
    },
    onError: (error) => {
      stats.errors++;
      if (showDebugLogs) {
        console.error(`${RED}Stream error:${RESET}`, error.message);
      }
    },
    onConnect: () => {
      console.log(`${GREEN}✓ Connected to gRPC stream${RESET}\n`);
      startDashboard();
    }
  });

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n👋 Shutting down...');
    
    // Show final stats
    console.log(`\n${BRIGHT}${CYAN}Final Statistics:${RESET}`);
    console.log(`  Bonding Curve Trades: ${stats.bondingCurveTrades}`);
    console.log(`  Bonding Curve States: ${stats.bondingCurveStates}`);
    console.log(`  AMM Swaps: ${stats.ammSwaps}`);
    console.log(`  AMM Pool States: ${stats.ammStates}`);
    console.log(`  Unique Tokens Saved: ${stats.tokensSaved.size}`);
    console.log(`  High Value Events: ${stats.highValueEvents}`);
    console.log(`  Errors: ${stats.errors}`);
    
    // Clean up
    subscription.disconnect();
    await dbService.close();
    solPriceUpdater.stop();
    process.exit(0);
  });

  // Start monitoring
  await subscription.subscribe();
}

// Handler for bonding curve trades
async function handleBondingCurveTrade(event: any) {
  stats.bondingCurveTrades++;
  
  try {
    const solPrice = await getSolPrice();
    const priceUsd = event.price * solPrice;
    const marketCapUsd = priceUsd * 1_000_000_000; // 1B supply
    
    // Check if we should save this token
    if (marketCapUsd >= 8888) {
      stats.highValueEvents++;
      
      // Get or create token
      let tokenId = await dbService.getTokenByMint(event.mint);
      
      if (!tokenId) {
        // First time seeing this token above threshold
        tokenId = await dbService.saveToken({
          mintAddress: event.mint,
          symbol: event.symbol,
          name: event.name,
          uri: event.uri,
          firstProgram: 'bonding_curve',
          firstSeenSlot: BigInt(event.slot),
          firstMarketCapUsd: marketCapUsd,
          thresholdPriceSol: event.price,
          thresholdMarketCapUsd: marketCapUsd
        });
        
        stats.tokensSaved.add(event.mint);
        
        // Add to activity with high priority
        addActivity(
          `${BRIGHT}${GREEN}💎 NEW TOKEN SAVED: ${event.symbol || 'Unknown'} - $${formatNumber(marketCapUsd)}${RESET}`,
          true
        );
      }
      
      // Queue the trade
      await dbService.queueBondingCurveTrade({
        tokenId,
        signature: event.signature,
        tradeType: event.isBuy ? 'buy' : 'sell',
        userAddress: event.user,
        solAmount: event.solAmount,
        tokenAmount: event.tokenAmount,
        priceSol: event.price,
        priceUsd,
        marketCapUsd,
        virtualSolReserves: event.virtualSolReserves,
        virtualTokenReserves: event.virtualTokenReserves,
        slot: BigInt(event.slot),
        blockTime: new Date(event.timestamp)
      });
      
      // Add high-value trade to activity
      const tradeIcon = event.isBuy ? '🟢' : '🔴';
      const tradeType = event.isBuy ? 'BUY' : 'SELL';
      
      addActivity(
        `${tradeIcon} BC ${tradeType}: ${event.symbol || 'Unknown'} @ $${formatPrice(priceUsd)} (MC: $${formatNumber(marketCapUsd)}) 💾`
      );
    }
  } catch (error) {
    stats.errors++;
    if (showDebugLogs) {
      console.error(`${RED}Error processing BC trade:${RESET}`, error);
    }
  }
}

// Handler for bonding curve account updates
async function handleBondingCurveState(account: any, slot: bigint) {
  stats.bondingCurveStates++;
  
  try {
    // Calculate price from reserves
    const price = calculatePrice(
      account.virtualSolReserves,
      account.virtualTokenReserves
    );
    
    const solPrice = await getSolPrice();
    const priceUsd = price * solPrice;
    const marketCapUsd = priceUsd * 1_000_000_000;
    
    // Calculate progress
    const solReservesNumber = Number(account.virtualSolReserves) / 1e9;
    const progress = ((solReservesNumber - 30) / (85 - 30)) * 100;
    
    if (marketCapUsd >= 8888) {
      stats.highValueEvents++;
      
      // Get token ID (should exist from trades)
      const tokenId = await dbService.getTokenByMint(account.tokenMint);
      
      if (tokenId) {
        // Queue the state update
        await dbService.queueBondingCurveState({
          tokenId,
          virtualSolReserves: account.virtualSolReserves,
          virtualTokenReserves: account.virtualTokenReserves,
          realSolReserves: account.realSolReserves,
          realTokenReserves: account.realTokenReserves,
          priceSol: price,
          priceUsd,
          marketCapUsd,
          progressPercent: progress,
          slot: slot,
          blockTime: new Date() // Account updates don't have block time
        });
        
        // Check for graduation
        if (progress >= 100 && !account.complete) {
          await dbService.markTokenGraduated(tokenId, slot);
          addActivity(
            `${BRIGHT}${MAGENTA}🎓 TOKEN GRADUATED: ${account.tokenMint.slice(0, 8)}...${RESET}`,
            true
          );
        }
      }
    }
  } catch (error) {
    stats.errors++;
    if (showDebugLogs) {
      console.error(`${RED}Error processing BC state:${RESET}`, error);
    }
  }
}

// Handler for AMM swaps
async function handleAmmSwap(event: any) {
  stats.ammSwaps++;
  
  try {
    // Skip if amounts are invalid
    if (!event.amountIn || !event.amountOut || 
        isNaN(Number(event.amountIn)) || isNaN(Number(event.amountOut))) {
      return;
    }
    
    const solPrice = await getSolPrice();
    
    // Try to find associated token
    const poolId = await dbService.getPoolByAddress(event.poolAddress || 'unknown');
    
    if (poolId) {
      await dbService.queueAmmSwap({
        poolId,
        signature: event.signature,
        tradeType: event.isBuy ? 'buy' : 'sell',
        userAddress: event.user,
        amountIn: event.amountIn,
        amountOut: event.amountOut,
        slot: BigInt(event.slot),
        blockTime: new Date(event.timestamp)
      });
      
      // Only show significant AMM swaps
      const amountInNum = Number(event.amountIn) / 1e9;
      const amountOutNum = Number(event.amountOut) / 1e9;
      
      if (amountInNum > 0.1 || amountOutNum > 0.1) {
        const swapIcon = event.isBuy ? '🟢' : '🔴';
        const swapType = event.isBuy ? 'BUY' : 'SELL';
        
        addActivity(
          `${swapIcon} AMM ${swapType}: In: ${formatNumber(amountInNum)} Out: ${formatNumber(amountOutNum)}`
        );
      }
    }
  } catch (error) {
    stats.errors++;
    if (showDebugLogs) {
      console.error(`${RED}Error processing AMM swap:${RESET}`, error);
    }
  }
}

// Handler for AMM pool account updates
async function handleAmmPoolState(account: any, slot: bigint) {
  stats.ammStates++;
  
  // AMM pool updates are frequent and not directly useful without token account queries
  // We'll just count them for statistics
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
  console.log(`${CLEAR_LINE}${YELLOW}Bonding Curves:${RESET}  Trades: ${formatNumber(stats.bondingCurveTrades)} | States: ${formatNumber(stats.bondingCurveStates)}`);
  console.log(`${CLEAR_LINE}${BLUE}AMM Pools:${RESET}       Swaps: ${formatNumber(stats.ammSwaps)} | States: ${formatNumber(stats.ammStates)}`);
  console.log(`${CLEAR_LINE}${GREEN}Tokens Saved:${RESET}    ${stats.tokensSaved.size} unique tokens (≥$8,888 market cap)`);
  console.log(`${CLEAR_LINE}${MAGENTA}High Value:${RESET}      ${stats.highValueEvents} events above threshold`);
  console.log(`${CLEAR_LINE}${RED}Errors:${RESET}          ${stats.errors}`);
  console.log(`${CLEAR_LINE}${DIM}Runtime:${RESET}         ${hours}h ${minutes}m ${seconds}s`);
  
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