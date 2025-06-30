#!/usr/bin/env tsx

/**
 * Test BC Account Monitor and show statistics
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { BCAccountMonitor } from '../src/monitors/bc-account-monitor';
import { Logger, LogLevel } from '../src/core/logger';

// Enable info logging
Logger.setGlobalLevel(LogLevel.INFO);

async function main() {
  try {
    const container = await createContainer();
    const monitor = new BCAccountMonitor(container);
    
    console.log(chalk.blue('Starting BC Account Monitor...'));
    await monitor.start();
    
    // Display stats every 10 seconds
    setInterval(() => {
      console.log(chalk.yellow('\n=== CURRENT STATS ==='));
      monitor.displayStats();
    }, 10000);
    
    // Run for 60 seconds
    setTimeout(() => {
      console.log(chalk.green('\nTest complete!'));
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    console.error(chalk.red('Failed to start:'), error);
    process.exit(1);
  }
}

main().catch(console.error);