#!/usr/bin/env tsx

/**
 * Debug BC price issues
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { BCMonitorRefactored } from '../src/monitors/bc-monitor-refactored';
import { Logger, LogLevel } from '../src/core/logger';
import { EVENTS } from '../src/core/event-bus';

// Enable debug logging
Logger.setGlobalLevel(LogLevel.DEBUG);

async function main() {
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus' as any);

    let tradeCount = 0;
    let zeroPriceCount = 0;

    // Log BC trade events with details
    eventBus.on(EVENTS.BC_TRADE, (data: any) => {
      tradeCount++;
      const trade = data.trade;
      
      console.log(chalk.cyan('\n=== BC TRADE ==='));
      console.log(`Signature: ${trade.signature.substring(0, 20)}...`);
      console.log(`Mint: ${trade.mintAddress.substring(0, 20)}...`);
      console.log(`SOL Amount: ${trade.solAmount}`);
      console.log(`Token Amount: ${trade.tokenAmount}`);
      console.log(`SOL Reserves: ${trade.virtualSolReserves}`);
      console.log(`Token Reserves: ${trade.virtualTokenReserves}`);
      console.log(`Price USD: ${trade.priceUsd}`);
      console.log(`Market Cap: ${trade.marketCapUsd}`);
      
      if (trade.priceUsd === 0) {
        zeroPriceCount++;
        console.log(chalk.red('⚠️ ZERO PRICE DETECTED'));
      }
    });

    // Log parser events with more details
    eventBus.on('parser:success', (data: any) => {
      console.log(chalk.green(`✓ Parse success: ${data.strategy} - ${data.eventType}`));
    });

    eventBus.on('parser:failed', (data: any) => {
      console.log(chalk.red(`✗ Parse failed: ${data.signature.substring(0, 20)}... - ${data.reason}`));
    });

    const monitor = new BCMonitorRefactored(container);
    await monitor.start();
    
    // Run for 10 seconds then show summary
    setTimeout(() => {
      console.log(chalk.yellow('\n=== SUMMARY ==='));
      console.log(`Total trades: ${tradeCount}`);
      console.log(`Zero price trades: ${zeroPriceCount}`);
      console.log(`Valid price trades: ${tradeCount - zeroPriceCount}`);
      process.exit(0);
    }, 10000);
    
  } catch (error) {
    console.error(chalk.red('Failed to start:'), error);
    process.exit(1);
  }
}

main().catch(console.error);