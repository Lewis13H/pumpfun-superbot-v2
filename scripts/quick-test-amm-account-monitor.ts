#!/usr/bin/env tsx
/**
 * Quick test to verify AMM Account Monitor is set up correctly
 */

import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { TOKENS } from '../src/core/container';
import { EVENTS } from '../src/core/event-bus';
import { AMMAccountMonitorRefactored } from '../src/monitors/amm-account-monitor-refactored';
import dotenv from 'dotenv';

dotenv.config();

async function quickTest() {
  try {
    console.log(chalk.cyan.bold('Quick AMM Account Monitor Test\n'));
    
    // 1. Check environment
    console.log(chalk.yellow('1. Checking environment variables...'));
    const hasGrpc = !!process.env.SHYFT_GRPC_ENDPOINT && !!process.env.SHYFT_GRPC_TOKEN;
    const hasDb = !!process.env.DATABASE_URL;
    
    console.log(`  - GRPC Config: ${hasGrpc ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  - Database: ${hasDb ? chalk.green('✓') : chalk.red('✗')}`);
    
    if (!hasGrpc || !hasDb) {
      throw new Error('Missing required environment variables');
    }
    
    // 2. Create container
    console.log(chalk.yellow('\n2. Creating DI container...'));
    const container = await createContainer();
    console.log(chalk.green('  ✓ Container created'));
    
    // 3. Verify services
    console.log(chalk.yellow('\n3. Verifying services...'));
    
    const eventBus = await container.resolve(TOKENS.EventBus);
    console.log(chalk.green('  ✓ EventBus available'));
    
    const streamClient = await container.resolve(TOKENS.StreamClient);
    console.log(chalk.green('  ✓ StreamClient available'));
    
    try {
      const poolStateService = await container.resolve(TOKENS.PoolStateService);
      console.log(chalk.green('  ✓ PoolStateService available'));
    } catch {
      console.log(chalk.yellow('  ! PoolStateService not available (optional)'));
    }
    
    // 4. Create monitor
    console.log(chalk.yellow('\n4. Creating AMM Account Monitor...'));
    const monitor = new AMMAccountMonitorRefactored(container);
    console.log(chalk.green('  ✓ Monitor created'));
    
    // 5. Setup event listeners
    console.log(chalk.yellow('\n5. Setting up event listeners...'));
    let eventCount = 0;
    
    eventBus.on(EVENTS.MONITOR_STARTED, (data) => {
      console.log(chalk.green(`  ✓ Monitor started: ${data.name}`));
    });
    
    eventBus.on(EVENTS.POOL_STATE_UPDATED, (data) => {
      eventCount++;
      console.log(chalk.blue(`  → Pool state update #${eventCount}: ${data.poolAddress.substring(0, 8)}...`));
    });
    
    eventBus.on(EVENTS.MONITOR_ERROR, (error) => {
      console.log(chalk.red(`  ✗ Monitor error: ${error.message}`));
    });
    
    // 6. Start monitor
    console.log(chalk.yellow('\n6. Starting monitor (10 second test)...'));
    await monitor.start();
    
    // Run for 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // 7. Stop monitor
    console.log(chalk.yellow('\n7. Stopping monitor...'));
    await monitor.stop();
    console.log(chalk.green('  ✓ Monitor stopped'));
    
    // Summary
    console.log(chalk.cyan.bold('\n=== Test Summary ==='));
    console.log(chalk.green('✓ All components initialized successfully'));
    console.log(`✓ Received ${eventCount} pool state updates`);
    
    if (eventCount === 0) {
      console.log(chalk.yellow('\nNote: No pool updates received. This is normal if no AMM pools were updated during the test.'));
    }
    
    process.exit(0);
  } catch (error) {
    console.error(chalk.red.bold('\n✗ Test failed:'), error);
    process.exit(1);
  }
}

// Run the test
quickTest();