#!/usr/bin/env npx tsx

/**
 * Simplified test for Session 6 to debug gRPC issues
 */

import { createContainer } from '../core/container-factory';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { LiquidityMonitor } from '../monitors/domain/liquidity-monitor';
import chalk from 'chalk';

async function testSession6Simple() {
  console.log(chalk.cyan('\n🧪 Testing Session 6 - Liquidity Monitor (Simplified)\n'));
  
  // Enable smart streaming
  process.env.USE_SMART_STREAMING = 'true';
  
  const container = await createContainer();
  
  try {
    // Get SmartStreamManager
    const streamManager = await container.resolve('StreamManager') as SmartStreamManager;
    
    // Initialize the stream manager
    console.log(chalk.yellow('Initializing stream manager...'));
    await streamManager.initialize();
    
    // Create and start only liquidity monitor
    console.log(chalk.yellow('\n💧 Creating Liquidity Monitor...'));
    const liquidityMonitor = new LiquidityMonitor(container);
    
    console.log(chalk.yellow('Starting monitor...'));
    await liquidityMonitor.start();
    
    // Monitor for 5 seconds
    console.log(chalk.gray('\nMonitoring for 5 seconds...'));
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Show stats
    liquidityMonitor.displayStats();
    
    // Stop monitor
    console.log(chalk.yellow('\nStopping monitor...'));
    await liquidityMonitor.stop();
    
    // Small delay before stopping stream manager
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Stop stream manager
    console.log(chalk.yellow('Stopping stream manager...'));
    await streamManager.stop();
    
    console.log(chalk.green('\n✅ Test completed successfully!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run test
testSession6Simple().catch(console.error);