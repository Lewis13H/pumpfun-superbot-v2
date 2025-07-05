#!/usr/bin/env npx tsx

/**
 * Test TradingActivityMonitor fix
 */

import { createContainer } from '../core/container-factory';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import chalk from 'chalk';

async function testTradingMonitor() {
  console.log(chalk.cyan('\n🧪 Testing TradingActivityMonitor Fix\n'));
  
  // Enable smart streaming
  process.env.USE_SMART_STREAMING = 'true';
  
  const container = await createContainer();
  
  try {
    // Create and start only the TradingActivityMonitor
    const tradingMonitor = new TradingActivityMonitor(container);
    console.log('TradingActivityMonitor created');
    
    await tradingMonitor.start();
    console.log('TradingActivityMonitor started');
    
    // Monitor for 10 seconds
    console.log(chalk.gray('\nMonitoring for 10 seconds...'));
    
    // Check stats every 2 seconds
    const interval = setInterval(() => {
      tradingMonitor.displayStats();
    }, 2000);
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    clearInterval(interval);
    
    // Final stats
    console.log(chalk.green('\n✅ Final Stats:'));
    tradingMonitor.displayStats();
    
    // Stop
    await tradingMonitor.stop();
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run test
testTradingMonitor().catch(console.error);