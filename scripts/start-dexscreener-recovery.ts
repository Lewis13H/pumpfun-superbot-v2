#!/usr/bin/env tsx
/**
 * Start DexScreener Recovery Service
 */

import 'dotenv/config';
import { DexScreenerPriceRecovery } from '../src/services/dexscreener-price-recovery';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🔄 Starting DexScreener Price Recovery Service'));
  console.log(chalk.gray('─'.repeat(80)));
  
  const recovery = DexScreenerPriceRecovery.getInstance();
  
  // Start with 30-minute intervals
  recovery.start(30);
  
  console.log(chalk.green('✓ Service started'));
  console.log(chalk.gray('Recovery will run every 30 minutes'));
  console.log(chalk.gray('Press Ctrl+C to stop'));
  
  // Keep process alive
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\nShutting down...'));
    recovery.stop();
    process.exit(0);
  });
}

main().catch(console.error);