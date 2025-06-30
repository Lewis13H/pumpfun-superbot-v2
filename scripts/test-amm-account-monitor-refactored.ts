#!/usr/bin/env tsx
/**
 * Test script for the refactored AMM Account Monitor
 * Verifies that the monitor is working correctly with the DI container
 */

import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { Container, TOKENS } from '../src/core/container';
import { EventBus, EVENTS } from '../src/core/event-bus';
import { AMMAccountMonitor } from '../src/monitors/amm-account-monitor';
import { db } from '../src/database';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Test configuration
const TEST_DURATION = 30000; // 30 seconds
const STATS_INTERVAL = 5000; // 5 seconds

// Track test metrics
interface TestMetrics {
  eventsEmitted: {
    poolStateUpdated: number;
    monitorStarted: number;
    monitorError: number;
  };
  databaseChecks: {
    poolStatesCount: number;
    lastCheckTime: Date;
  };
  poolStates: Map<string, any>;
}

const metrics: TestMetrics = {
  eventsEmitted: {
    poolStateUpdated: 0,
    monitorStarted: 0,
    monitorError: 0
  },
  databaseChecks: {
    poolStatesCount: 0,
    lastCheckTime: new Date()
  },
  poolStates: new Map()
};

/**
 * Display test statistics
 */
function displayStats(): void {
  console.clear();
  console.log(chalk.cyan.bold('\n=== AMM Account Monitor Test ===\n'));
  
  console.log(chalk.yellow('Event Emissions:'));
  console.log(`  - Pool State Updates: ${metrics.eventsEmitted.poolStateUpdated}`);
  console.log(`  - Monitor Started: ${metrics.eventsEmitted.monitorStarted}`);
  console.log(`  - Monitor Errors: ${metrics.eventsEmitted.monitorError}`);
  
  console.log(chalk.yellow('\nDatabase Status:'));
  console.log(`  - Pool States in DB: ${metrics.databaseChecks.poolStatesCount}`);
  console.log(`  - Last Check: ${metrics.databaseChecks.lastCheckTime.toLocaleTimeString()}`);
  
  console.log(chalk.yellow('\nTracked Pools:'));
  console.log(`  - Unique Pools: ${metrics.poolStates.size}`);
  
  if (metrics.poolStates.size > 0) {
    console.log(chalk.gray('\n  Recent Pool Updates:'));
    const pools = Array.from(metrics.poolStates.entries()).slice(-5);
    for (const [poolAddress, state] of pools) {
      console.log(chalk.gray(`    - ${poolAddress.substring(0, 8)}... | Token: ${state.mintAddress.substring(0, 8)}... | LP Supply: ${state.lpSupply}`));
    }
  }
}

/**
 * Check database for pool states
 */
async function checkDatabase(): Promise<void> {
  try {
    // Count total pool states
    const countResult = await db.query('SELECT COUNT(*) as count FROM amm_pool_states');
    metrics.databaseChecks.poolStatesCount = parseInt(countResult.rows[0].count);
    
    // Get recent pool states
    const recentResult = await db.query(`
      SELECT mint_address, pool_address, virtual_sol_reserves, virtual_token_reserves, created_at
      FROM amm_pool_states
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (recentResult.rows.length > 0) {
      console.log(chalk.green('\n✓ Database contains pool states:'));
      for (const row of recentResult.rows.slice(0, 3)) {
        console.log(chalk.gray(`  - Mint: ${row.mint_address.substring(0, 8)}... | Pool: ${row.pool_address.substring(0, 8)}... | Time: ${new Date(row.created_at).toLocaleTimeString()}`));
      }
    }
    
    metrics.databaseChecks.lastCheckTime = new Date();
  } catch (error) {
    console.error(chalk.red('Database check failed:'), error);
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners(eventBus: EventBus): void {
  // Listen for pool state updates
  eventBus.on(EVENTS.POOL_STATE_UPDATED, (data) => {
    metrics.eventsEmitted.poolStateUpdated++;
    metrics.poolStates.set(data.poolAddress, {
      mintAddress: data.mintAddress,
      lpSupply: data.poolState?.lpSupply || 'N/A',
      slot: data.slot,
      timestamp: new Date()
    });
    
    console.log(chalk.green(`\n✓ Pool state update received: ${data.poolAddress.substring(0, 8)}...`));
  });
  
  // Listen for monitor start
  eventBus.on(EVENTS.MONITOR_STARTED, (data) => {
    metrics.eventsEmitted.monitorStarted++;
    console.log(chalk.green(`\n✓ Monitor started: ${data.name}`));
  });
  
  // Listen for monitor errors
  eventBus.on(EVENTS.MONITOR_ERROR, (data) => {
    metrics.eventsEmitted.monitorError++;
    console.log(chalk.red(`\n✗ Monitor error: ${data.error?.message || 'Unknown error'}`));
  });
}

/**
 * Run the test
 */
async function runTest(): Promise<void> {
  let container: Container | null = null;
  let monitor: AMMAccountMonitor | null = null;
  let statsInterval: NodeJS.Timeout | null = null;
  let dbCheckInterval: NodeJS.Timeout | null = null;
  
  try {
    console.log(chalk.cyan.bold('Starting AMM Account Monitor Test...\n'));
    
    // Verify environment variables
    if (!process.env.SHYFT_GRPC_ENDPOINT || !process.env.SHYFT_GRPC_TOKEN) {
      throw new Error('Missing required environment variables: SHYFT_GRPC_ENDPOINT and SHYFT_GRPC_TOKEN');
    }
    
    if (!process.env.DATABASE_URL) {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }
    
    console.log(chalk.gray('Environment variables verified ✓'));
    
    // Create DI container
    console.log(chalk.gray('Creating DI container...'));
    container = await createContainer();
    console.log(chalk.green('Container created ✓'));
    
    // Get event bus and setup listeners
    const eventBus = await container.resolve<EventBus>(TOKENS.EventBus);
    setupEventListeners(eventBus);
    console.log(chalk.green('Event listeners setup ✓'));
    
    // Verify pool state service is available
    try {
      const poolStateService = await container.resolve(TOKENS.PoolStateService);
      console.log(chalk.green('Pool state service available ✓'));
    } catch (error) {
      console.log(chalk.yellow('Pool state service not available (optional)'));
    }
    
    // Create and start the monitor
    console.log(chalk.gray('\nCreating AMM account monitor...'));
    monitor = new AMMAccountMonitor(container);
    
    console.log(chalk.gray('Starting monitor...'));
    await monitor.start();
    
    // Setup periodic stats display
    statsInterval = setInterval(displayStats, STATS_INTERVAL);
    
    // Setup periodic database checks
    dbCheckInterval = setInterval(checkDatabase, STATS_INTERVAL);
    
    // Initial database check
    await checkDatabase();
    
    // Display initial stats
    displayStats();
    
    // Run for the test duration
    console.log(chalk.cyan(`\nTest will run for ${TEST_DURATION / 1000} seconds...\n`));
    
    await new Promise(resolve => setTimeout(resolve, TEST_DURATION));
    
    console.log(chalk.cyan.bold('\n\n=== Test Summary ===\n'));
    
    // Final stats
    console.log(chalk.yellow('Event Totals:'));
    console.log(`  - Pool State Updates: ${metrics.eventsEmitted.poolStateUpdated}`);
    console.log(`  - Monitor Started: ${metrics.eventsEmitted.monitorStarted}`);
    console.log(`  - Monitor Errors: ${metrics.eventsEmitted.monitorError}`);
    
    console.log(chalk.yellow('\nDatabase Results:'));
    console.log(`  - Pool States Saved: ${metrics.databaseChecks.poolStatesCount}`);
    console.log(`  - Unique Pools Tracked: ${metrics.poolStates.size}`);
    
    // Determine test result
    const success = metrics.eventsEmitted.monitorStarted > 0 && metrics.eventsEmitted.monitorError === 0;
    
    if (success) {
      console.log(chalk.green.bold('\n✓ Test PASSED'));
      
      if (metrics.eventsEmitted.poolStateUpdated === 0) {
        console.log(chalk.yellow('\nNote: No pool state updates received during test period.'));
        console.log(chalk.gray('This is normal if no AMM pools were updated during the test.'));
      }
    } else {
      console.log(chalk.red.bold('\n✗ Test FAILED'));
      
      if (metrics.eventsEmitted.monitorStarted === 0) {
        console.log(chalk.red('  - Monitor failed to start'));
      }
      
      if (metrics.eventsEmitted.monitorError > 0) {
        console.log(chalk.red(`  - Monitor encountered ${metrics.eventsEmitted.monitorError} errors`));
      }
    }
    
  } catch (error) {
    console.error(chalk.red.bold('\n✗ Test failed with error:'), error);
    process.exit(1);
  } finally {
    // Cleanup
    if (statsInterval) clearInterval(statsInterval);
    if (dbCheckInterval) clearInterval(dbCheckInterval);
    
    if (monitor) {
      console.log(chalk.gray('\nStopping monitor...'));
      await monitor.stop();
    }
    
    // Close database connection
    await db.end();
    
    console.log(chalk.gray('Test cleanup complete'));
  }
}

// Run the test
runTest().catch(error => {
  console.error(chalk.red.bold('Unhandled error:'), error);
  process.exit(1);
});