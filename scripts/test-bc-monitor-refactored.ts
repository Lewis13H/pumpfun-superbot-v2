#!/usr/bin/env tsx

/**
 * Simple test script for the refactored BC monitor
 * Runs the monitor in isolation with debug output
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { BCMonitor } from '../src/monitors/bc-monitor';
import { Logger, LogLevel } from '../src/core/logger';
import { EVENTS } from '../src/core/event-bus';

// Enable debug logging
Logger.setGlobalLevel(LogLevel.DEBUG);

// Enable debug mode
process.env.DEBUG = 'true';
process.env.DEBUG_PARSE_ERRORS = 'true';
process.env.BC_SAVE_THRESHOLD = '1000'; // Lower threshold for testing

console.log(chalk.blue('================================='));
console.log(chalk.blue('BC Monitor Refactored Test Script'));
console.log(chalk.blue('================================='));
console.log(`Debug Mode: ${chalk.green('ENABLED')}`);
console.log(`Parse Errors: ${chalk.green('ENABLED')}`);
console.log(`Save Threshold: ${chalk.yellow('$1,000')}`);
console.log('');

async function main() {
  try {
    // Create container
    console.log(chalk.cyan('Initializing container and services...'));
    const container = await createContainer();

    // Get event bus for logging
    const eventBus = await container.resolve('EventBus' as any);

    // Log specific events
    eventBus.on(EVENTS.BC_TRADE, (data: any) => {
      console.log(chalk.green('\n🔍 BC TRADE DETECTED:'));
      console.log(`  Type: ${data.trade.tradeType}`);
      console.log(`  Mint: ${data.trade.mintAddress.substring(0, 12)}...`);
      console.log(`  Volume: $${data.trade.volumeUsd.toFixed(2)}`);
      console.log(`  Market Cap: $${data.trade.marketCapUsd.toFixed(2)}`);
    });

    eventBus.on(EVENTS.TOKEN_DISCOVERED, (token: any) => {
      console.log(chalk.magenta('\n💎 NEW TOKEN DISCOVERED:'));
      console.log(`  Mint: ${token.mintAddress.substring(0, 12)}...`);
      console.log(`  Market Cap: $${token.currentMarketCapUsd.toFixed(2)}`);
    });

    eventBus.on(EVENTS.MONITOR_ERROR, (error: any) => {
      console.log(chalk.red('\n❌ MONITOR ERROR:'));
      console.log(`  Monitor: ${error.monitor}`);
      console.log(`  Error: ${error.error.message}`);
    });

    // Create and start the monitor
    console.log(chalk.cyan('Starting BC Monitor Refactored...'));
    const monitor = new BCMonitor(container);

    await monitor.start();
    
    console.log(chalk.green('\n✅ Monitor started successfully!'));
    console.log(chalk.gray('Waiting for transactions... (Press Ctrl+C to stop)'));
    
    // Log stats every 30 seconds
    const statsInterval = setInterval(() => {
      monitor.displayStats();
    }, 30000);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\nShutting down...'));
      clearInterval(statsInterval);
      // Monitor will handle its own shutdown through BaseMonitor
      await new Promise(resolve => setTimeout(resolve, 2000));
      process.exit(0);
    });
    
  } catch (error) {
    console.error(chalk.red('Failed to start monitor:'), error);
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);