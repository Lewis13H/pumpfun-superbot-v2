#!/usr/bin/env node
import { DualProgramSubscription, DualProgramEvent } from '../stream/dual-program-subscription';
import { formatPrice, formatTimestamp, formatProgress } from '../utils/formatters';
import { getSolPrice } from '../services/sol-price';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

interface Statistics {
  bondingCurveBuys: number;
  bondingCurveSells: number;
  bondingCurveVolume: bigint;
  ammBuys: number;
  ammSells: number;
  ammVolume: bigint;
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
  startTime: new Date(),
  lastEventTime: new Date(),
};

function printHeader() {
  console.clear();
  console.log(chalk.cyan('╔════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║') + chalk.white.bold('              DUAL PROGRAM MONITOR - BONDING CURVE + AMM                ') + chalk.cyan('║'));
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
  
  // Bonding Curve Stats
  console.log(chalk.magenta.bold('🔄 Bonding Curve:'));
  console.log(chalk.green(`  Buys: ${stats.bondingCurveBuys}`) + chalk.gray(' | ') + 
              chalk.red(`Sells: ${stats.bondingCurveSells}`) + chalk.gray(' | ') +
              chalk.white(`Volume: ${(Number(stats.bondingCurveVolume) / 1e9).toFixed(2)} SOL`));
  
  // AMM Stats
  console.log(chalk.blue.bold('💱 AMM Swaps:'));
  console.log(chalk.green(`  Buys: ${stats.ammBuys}`) + chalk.gray(' | ') + 
              chalk.red(`Sells: ${stats.ammSells}`) + chalk.gray(' | ') +
              chalk.white(`Volume: ${(Number(stats.ammVolume) / 1e9).toFixed(2)} SOL`));
  
  // Combined Stats
  const totalBuys = stats.bondingCurveBuys + stats.ammBuys;
  const totalSells = stats.bondingCurveSells + stats.ammSells;
  const totalVolume = stats.bondingCurveVolume + stats.ammVolume;
  
  console.log(chalk.yellow.bold('📈 Combined Totals:'));
  console.log(chalk.green(`  Buys: ${totalBuys}`) + chalk.gray(' | ') + 
              chalk.red(`Sells: ${totalSells}`) + chalk.gray(' | ') +
              chalk.white(`Volume: ${(Number(totalVolume) / 1e9).toFixed(2)} SOL`));
  
  console.log();
  console.log(chalk.gray(`Runtime: ${hours}h ${minutes}m ${seconds}s | Last event: ${formatTimestamp(stats.lastEventTime)}`));
}

async function handleEvent(event: DualProgramEvent): Promise<void> {
  stats.lastEventTime = new Date();
  const solPrice = await getSolPrice();

  if (event.type === 'bonding_curve') {
    const trade = event.event;
    const priceUsd = trade.price * solPrice;
    const marketCapUsd = priceUsd * 1e9; // 1B supply
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
    const volumeStr = `${volumeSol.toFixed(4)} SOL`;

    printHeader();
    console.log(chalk.magenta.bold('🔄 BONDING CURVE TRADE'));
    console.log(`${typeStr} ${chalk.white(trade.symbol || 'UNKNOWN')} | ${priceStr} | MC: $${(marketCapUsd / 1000).toFixed(1)}K`);
    console.log(`${progressStr} | Vol: ${volumeStr} | ${formatTimestamp(trade.timestamp)}`);
    console.log(chalk.gray(`Mint: ${trade.mint}`));
    console.log(chalk.gray(`User: ${trade.user}`));
    console.log(chalk.gray(`Tx: ${trade.signature}`));

  } else if (event.type === 'amm_swap') {
    const swap = event.event;
    const volumeSol = Number(swap.solAmount) / 1e9;

    // Update statistics
    if (swap.type === 'Buy') {
      stats.ammBuys++;
    } else {
      stats.ammSells++;
    }
    stats.ammVolume += swap.solAmount;

    // Format output
    const typeStr = swap.type === 'Buy' ? chalk.green.bold('BUY ') : chalk.red.bold('SELL');
    const volumeStr = `${volumeSol.toFixed(4)} SOL`;
    const tokenAmountStr = `${(Number(swap.tokenAmount) / 1e6).toFixed(2)} tokens`;

    printHeader();
    console.log(chalk.blue.bold('💱 AMM SWAP'));
    console.log(`${typeStr} | Vol: ${volumeStr} | Tokens: ${tokenAmountStr}`);
    console.log(`Instruction: ${swap.instructionName} | ${formatTimestamp(swap.timestamp)}`);
    console.log(chalk.gray(`Token: ${swap.tokenMint}`));
    console.log(chalk.gray(`User: ${swap.user}`));
    console.log(chalk.gray(`Pool: ${swap.poolAccount || 'N/A'}`));
    console.log(chalk.gray(`Tx: ${swap.signature}`));
  }
}

async function main() {
  printHeader();
  console.log(chalk.yellow('🔍 Connecting to dual-program stream...'));

  const subscription = new DualProgramSubscription({
    onTransaction: handleEvent,
    onError: (error) => {
      console.error(chalk.red('❌ Stream error:'), error.message);
    },
    onConnect: () => {
      printHeader();
      console.log(chalk.green('✅ Connected! Monitoring both Bonding Curve and AMM transactions...'));
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