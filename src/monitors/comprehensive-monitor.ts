#!/usr/bin/env node
import { ComprehensiveSubscription, ComprehensiveEvent } from '../stream/comprehensive-subscription';
import { formatPrice, formatTimestamp, formatProgress } from '../utils/formatters';
import { getSolPrice } from '../services/sol-price';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

interface Statistics {
  // Transaction stats
  bondingCurveBuys: number;
  bondingCurveSells: number;
  bondingCurveVolume: bigint;
  ammBuys: number;
  ammSells: number;
  ammVolume: bigint;
  
  // Account stats
  bondingCurveAccounts: number;
  ammPoolAccounts: number;
  lastBondingCurveUpdate: Date | null;
  lastAmmPoolUpdate: Date | null;
  
  // General
  startTime: Date;
  lastEventTime: Date;
}

const stats: Statistics = {
  bondingCurveBuys: 0,
  bondingCurveSells: 0,
  bondingCurveVolume: 0n,
  ammBuys: 0,
  ammSells: 0,
  ammVolume: 0n,
  bondingCurveAccounts: 0,
  ammPoolAccounts: 0,
  lastBondingCurveUpdate: null,
  lastAmmPoolUpdate: null,
  startTime: new Date(),
  lastEventTime: new Date(),
};

// Store latest account states
const bondingCurveStates = new Map<string, any>();
const ammPoolStates = new Map<string, any>();

function printHeader() {
  console.clear();
  console.log(chalk.cyan('╔════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║') + chalk.white.bold('        COMPREHENSIVE MONITOR - TRANSACTIONS + ACCOUNTS                 ') + chalk.cyan('║'));
  console.log(chalk.cyan('╚════════════════════════════════════════════════════════════════════════╝'));
  console.log();
  printStatistics();
  console.log(chalk.gray('─'.repeat(74)));
}

function printStatistics() {
  const runtime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000);
  const hours = Math.floor(runtime / 3600);
  const minutes = Math.floor((runtime % 3600) / 60);
  const seconds = runtime % 60;

  console.log(chalk.yellow.bold('📊 Live Statistics:'));
  console.log();
  
  // Transaction Stats
  console.log(chalk.green.bold('📈 TRANSACTIONS:'));
  console.log(chalk.magenta('  Bonding Curve:') + 
    chalk.green(` Buys: ${stats.bondingCurveBuys}`) + chalk.gray(' | ') + 
    chalk.red(`Sells: ${stats.bondingCurveSells}`) + chalk.gray(' | ') +
    chalk.white(`Volume: ${(Number(stats.bondingCurveVolume) / 1e9).toFixed(2)} SOL`));
  
  console.log(chalk.blue('  AMM Swaps:') + 
    chalk.green(`    Buys: ${stats.ammBuys}`) + chalk.gray(' | ') + 
    chalk.red(`Sells: ${stats.ammSells}`) + chalk.gray(' | ') +
    chalk.white(`Volume: ${(Number(stats.ammVolume) / 1e9).toFixed(2)} SOL`));
  
  // Account Stats
  console.log();
  console.log(chalk.cyan.bold('📂 ACCOUNTS:'));
  console.log(chalk.magenta(`  Bonding Curves: ${stats.bondingCurveAccounts}`) + 
    (stats.lastBondingCurveUpdate ? chalk.gray(` | Last: ${formatTimestamp(stats.lastBondingCurveUpdate)}`) : ''));
  console.log(chalk.blue(`  AMM Pools: ${stats.ammPoolAccounts}`) + 
    (stats.lastAmmPoolUpdate ? chalk.gray(` | Last: ${formatTimestamp(stats.lastAmmPoolUpdate)}`) : ''));
  
  console.log();
  console.log(chalk.gray(`Runtime: ${hours}h ${minutes}m ${seconds}s | Last event: ${formatTimestamp(stats.lastEventTime)}`));
}

async function handleEvent(event: ComprehensiveEvent): Promise<void> {
  stats.lastEventTime = new Date();
  const solPrice = await getSolPrice();

  switch (event.type) {
    case 'bonding_curve_trade': {
      const trade = event.event;
      const priceUsd = trade.price * solPrice;
      const marketCapUsd = priceUsd * 1e9;
      const volumeSol = Number(trade.solAmount) / 1e9;

      // Update statistics
      if (trade.isBuy) {
        stats.bondingCurveBuys++;
      } else {
        stats.bondingCurveSells++;
      }
      stats.bondingCurveVolume += trade.solAmount;

      // Format output
      const typeStr = trade.isBuy ? chalk.green.bold('BUY ') : chalk.red.bold('SELL');
      const priceStr = formatPrice(trade.price, solPrice);
      const progressStr = formatProgress(trade.virtualSolReserves);

      printHeader();
      console.log(chalk.magenta.bold('🔄 BONDING CURVE TRADE'));
      console.log(`${typeStr} ${chalk.white(trade.symbol || trade.mint.slice(0, 8))} | ${priceStr} | MC: $${(marketCapUsd / 1000).toFixed(1)}K`);
      console.log(`${progressStr} | Vol: ${volumeSol.toFixed(4)} SOL`);
      console.log(chalk.gray(`User: ${trade.user}`));
      break;
    }

    case 'amm_swap': {
      const swap = event.event;
      const volumeSol = Number(swap.solAmount) / 1e9;
      const tokenAmount = Number(swap.tokenAmount) / 1e6;

      // Update statistics
      if (swap.type === 'Buy') {
        stats.ammBuys++;
      } else {
        stats.ammSells++;
      }
      stats.ammVolume += swap.solAmount;

      const typeStr = swap.type === 'Buy' ? chalk.green.bold('BUY ') : chalk.red.bold('SELL');

      printHeader();
      console.log(chalk.blue.bold('💱 AMM SWAP'));
      console.log(`${typeStr} | ${volumeSol.toFixed(4)} SOL ⇄ ${tokenAmount.toFixed(2)} tokens`);
      console.log(chalk.gray(`Token: ${swap.tokenMint}`));
      console.log(chalk.gray(`User: ${swap.user}`));
      break;
    }

    case 'bonding_curve_account': {
      const account = event.account;
      stats.bondingCurveAccounts = bondingCurveStates.size + 1;
      stats.lastBondingCurveUpdate = new Date();
      
      // Store account state
      bondingCurveStates.set(account.tokenMint || 'unknown', account);
      
      const solReserves = Number(account.virtualSolReserves) / 1e9;
      const progress = ((solReserves - 30) / (85 - 30)) * 100;
      
      printHeader();
      console.log(chalk.magenta.bold('📊 BONDING CURVE UPDATE'));
      console.log(`Reserves: ${solReserves.toFixed(2)} SOL | Progress: ${progress.toFixed(1)}%`);
      console.log(`Complete: ${account.complete ? chalk.green('YES') : chalk.yellow('NO')}`);
      break;
    }

    case 'amm_pool_account': {
      const pool = event.account;
      stats.ammPoolAccounts = ammPoolStates.size + 1;
      stats.lastAmmPoolUpdate = new Date();
      
      // Store pool state
      ammPoolStates.set(pool.poolAddress, pool);
      
      const baseAmount = Number(pool.baseReserves) / 1e6;
      const quoteAmount = Number(pool.quoteReserves) / 1e9;
      
      printHeader();
      console.log(chalk.blue.bold('💧 AMM POOL UPDATE'));
      console.log(`Pool: ${pool.poolAddress.slice(0, 8)}...`);
      console.log(`Reserves: ${baseAmount.toFixed(2)} tokens ⇄ ${quoteAmount.toFixed(4)} SOL`);
      break;
    }
  }
}

async function main() {
  printHeader();
  console.log(chalk.yellow('🔍 Connecting to comprehensive stream...'));

  const subscription = new ComprehensiveSubscription({
    onUpdate: handleEvent,
    onError: (error) => {
      console.error(chalk.red('❌ Stream error:'), error.message);
    },
    onConnect: () => {
      printHeader();
      console.log(chalk.green('✅ Connected! Monitoring transactions AND accounts...'));
    },
    onDisconnect: () => {
      console.log(chalk.yellow('⚠️ Disconnected from stream'));
    },
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n👋 Shutting down...'));
    subscription.disconnect();
    process.exit(0);
  });

  try {
    await subscription.subscribe();
  } catch (error) {
    console.error(chalk.red('❌ Failed to start:'), error);
    process.exit(1);
  }
}

main().catch(console.error);