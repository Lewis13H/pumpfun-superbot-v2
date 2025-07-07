#!/usr/bin/env npx tsx

/**
 * Test Trading Monitor Subscription
 * Check if TradingActivityMonitor is subscribing to AMM program
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';

async function main() {
  console.log(chalk.cyan('\n🔍 Testing Trading Monitor Subscription\n'));
  
  try {
    const container = await createContainer();
    
    // Create monitor instance
    const monitor = new TradingActivityMonitor(container);
    
    // Check what programs it monitors
    const programs = (monitor as any).getProgramIds();
    console.log(chalk.yellow('Programs monitored by TradingActivityMonitor:'));
    programs.forEach((program: string) => {
      console.log(`  - ${program}`);
    });
    
    // Check the expected programs
    const expectedPrograms = {
      BC: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      AMM: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
      RAYDIUM: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'
    };
    
    console.log(chalk.yellow('\nExpected programs:'));
    Object.entries(expectedPrograms).forEach(([name, program]) => {
      const isMonitored = programs.includes(program);
      console.log(`  ${name}: ${program} ${isMonitored ? chalk.green('✅') : chalk.red('❌')}`);
    });
    
    // Build subscription request to see what's actually subscribed
    const subscriptionRequest = (monitor as any).buildEnhancedSubscribeRequest();
    console.log(chalk.yellow('\nSubscription request:'));
    console.log(JSON.stringify(subscriptionRequest, null, 2));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
  
  process.exit(0);
}

main().catch(console.error);