#!/usr/bin/env tsx
/**
 * Verify AMM Trades Against Solscan
 * Captures detailed trade information for verification
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { TOKENS } from '../src/core/container';
import { EVENTS } from '../src/core/event-bus';
import { Logger } from '../src/core/logger';

const logger = new Logger({ context: 'VerifyAMMTrades', color: chalk.cyan });

interface DetailedTrade {
  signature: string;
  mintAddress: string;
  tradeType: 'buy' | 'sell';
  userAddress: string;
  solAmount: bigint;
  tokenAmount: bigint;
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  blockTime: Date;
  slot: bigint;
  poolAddress?: string;
}

async function verifyAMMTrades() {
  try {
    logger.info('Starting AMM Trade Verification Test\n');
    logger.info('Will capture 2 buy and 2 sell trades for verification...\n');
    
    const container = await createContainer();
    const eventBus = await container.resolve(TOKENS.EventBus);
    
    const buyTrades: DetailedTrade[] = [];
    const sellTrades: DetailedTrade[] = [];
    let totalTrades = 0;
    
    // Listen for AMM trades
    eventBus.on(EVENTS.AMM_TRADE, (data) => {
      totalTrades++;
      const trade = data.trade as DetailedTrade;
      
      if (!trade || !trade.signature) return;
      
      // Capture up to 2 of each type
      if (trade.tradeType === 'buy' && buyTrades.length < 2) {
        buyTrades.push(trade);
        logger.info(`Captured BUY trade #${buyTrades.length}`);
      } else if (trade.tradeType === 'sell' && sellTrades.length < 2) {
        sellTrades.push(trade);
        logger.info(`Captured SELL trade #${sellTrades.length}`);
      }
      
      // Stop when we have enough trades
      if (buyTrades.length >= 2 && sellTrades.length >= 2) {
        displayResults();
      }
    });
    
    // Create and start wrapped monitors
    const { AMMMonitor } = await import('../src/monitors/amm-monitor');
    const { AMMAccountMonitor } = await import('../src/monitors/amm-account-monitor');
    
    const ammMonitor = new AMMMonitor(container);
    const ammAccountMonitor = new AMMAccountMonitor(container);
    
    logger.info('Starting monitors...\n');
    await ammMonitor.start();
    await ammAccountMonitor.start();
    
    // Display results function
    const displayResults = async () => {
      await ammMonitor.stop();
      await ammAccountMonitor.stop();
      
      logger.box('Trade Verification Results', {
        'Total Trades Seen': totalTrades,
        'Buy Trades Captured': buyTrades.length,
        'Sell Trades Captured': sellTrades.length
      });
      
      // Display buy trades
      logger.info('\n' + chalk.green('=== BUY TRADES ==='));
      buyTrades.forEach((trade, i) => {
        const solAmountDisplay = Number(trade.solAmount) / 1e9;
        const tokenAmountDisplay = Number(trade.tokenAmount) / 1e6;
        const solReserves = Number(trade.virtualSolReserves) / 1e9;
        const tokenReserves = Number(trade.virtualTokenReserves) / 1e6;
        
        console.log(chalk.green(`\nBUY Trade #${i + 1}:`));
        console.log('─'.repeat(80));
        console.log(`Signature:     ${trade.signature}`);
        console.log(`Solscan URL:   https://solscan.io/tx/${trade.signature}`);
        console.log(`Mint Address:  ${trade.mintAddress}`);
        console.log(`User Address:  ${trade.userAddress}`);
        console.log(`SOL Amount:    ${solAmountDisplay.toFixed(6)} SOL`);
        console.log(`Token Amount:  ${tokenAmountDisplay.toLocaleString()} tokens`);
        console.log(`Price (SOL):   ${trade.priceSol.toFixed(9)} SOL per token`);
        console.log(`Price (USD):   $${trade.priceUsd.toFixed(6)} per token`);
        console.log(`Market Cap:    $${trade.marketCapUsd.toLocaleString()}`);
        console.log(`Pool Reserves: ${solReserves.toFixed(2)} SOL / ${tokenReserves.toLocaleString()} tokens`);
        console.log(`Block Time:    ${trade.blockTime.toISOString()}`);
        console.log(`Slot:          ${trade.slot}`);
      });
      
      // Display sell trades
      logger.info('\n' + chalk.red('=== SELL TRADES ==='));
      sellTrades.forEach((trade, i) => {
        const solAmountDisplay = Number(trade.solAmount) / 1e9;
        const tokenAmountDisplay = Number(trade.tokenAmount) / 1e6;
        const solReserves = Number(trade.virtualSolReserves) / 1e9;
        const tokenReserves = Number(trade.virtualTokenReserves) / 1e6;
        
        console.log(chalk.red(`\nSELL Trade #${i + 1}:`));
        console.log('─'.repeat(80));
        console.log(`Signature:     ${trade.signature}`);
        console.log(`Solscan URL:   https://solscan.io/tx/${trade.signature}`);
        console.log(`Mint Address:  ${trade.mintAddress}`);
        console.log(`User Address:  ${trade.userAddress}`);
        console.log(`SOL Amount:    ${solAmountDisplay.toFixed(6)} SOL`);
        console.log(`Token Amount:  ${tokenAmountDisplay.toLocaleString()} tokens`);
        console.log(`Price (SOL):   ${trade.priceSol.toFixed(9)} SOL per token`);
        console.log(`Price (USD):   $${trade.priceUsd.toFixed(6)} per token`);
        console.log(`Market Cap:    $${trade.marketCapUsd.toLocaleString()}`);
        console.log(`Pool Reserves: ${solReserves.toFixed(2)} SOL / ${tokenReserves.toLocaleString()} tokens`);
        console.log(`Block Time:    ${trade.blockTime.toISOString()}`);
        console.log(`Slot:          ${trade.slot}`);
      });
      
      logger.info('\n' + chalk.yellow('=== VERIFICATION INSTRUCTIONS ==='));
      console.log('1. Click on each Solscan URL above');
      console.log('2. On Solscan, look for:');
      console.log('   - Transaction type (Buy/Sell)');
      console.log('   - Token Transfer amounts');
      console.log('   - SOL Transfer amount');
      console.log('   - Interacting addresses');
      console.log('3. Compare the values with our captured data');
      console.log('\nNote: Our system shows amounts AFTER fees are deducted');
      
      process.exit(0);
    };
    
    // Timeout after 30 seconds
    setTimeout(async () => {
      if (buyTrades.length > 0 || sellTrades.length > 0) {
        logger.info('\n30 seconds elapsed, displaying captured trades...');
        displayResults();
      } else {
        logger.warn('\nNo trades captured in 30 seconds');
        await ammMonitor.stop();
        await ammAccountMonitor.stop();
        process.exit(1);
      }
    }, 30000);
    
  } catch (error) {
    logger.error('Test failed:', error as Error);
    process.exit(1);
  }
}

verifyAMMTrades();