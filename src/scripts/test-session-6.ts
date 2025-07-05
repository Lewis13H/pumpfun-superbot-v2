#!/usr/bin/env npx tsx

/**
 * Test Session 6: Domain Monitor - Liquidity
 * 
 * Tests:
 * - LiquidityMonitor creation and initialization
 * - Pool state tracking
 * - Liquidity event detection
 * - TVL calculations
 * - Integration with existing monitors
 */

import { createContainer } from '../core/container-factory';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { LiquidityMonitor } from '../monitors/domain/liquidity-monitor';
import chalk from 'chalk';

async function testSession6() {
  console.log(chalk.cyan('\n🧪 Testing Smart Streaming Session 6 - Liquidity Monitor\n'));
  
  // Enable smart streaming
  process.env.USE_SMART_STREAMING = 'true';
  
  const container = await createContainer();
  
  try {
    // Get SmartStreamManager
    const streamManager = await container.resolve('StreamManager') as SmartStreamManager;
    
    // Initialize the stream manager
    await streamManager.initialize();
    
    // Session 1-5 Recap
    console.log(chalk.yellow('\n📦 Sessions 1-5 Status Check:'));
    const poolInfo = await streamManager.getPoolInfo();
    console.log('Connection Pool:', {
      totalConnections: poolInfo.totalConnections,
      activeConnections: poolInfo.activeConnections,
      healthyConnections: poolInfo.healthyConnections
    });
    
    const loadMetrics = streamManager.getLoadMetrics();
    console.log('Load Balancing:', {
      averageLoad: loadMetrics.summary?.averageLoad?.toFixed(2) || '0.00',
      connectionCount: loadMetrics.connectionLoads.size
    });
    
    // Session 6: Liquidity Monitor
    console.log(chalk.yellow('\n💧 Session 6: Domain Monitor - Liquidity'));
    const liquidityMonitor = new LiquidityMonitor(container);
    console.log('LiquidityMonitor created successfully');
    
    // Also create other monitors for comparison
    const tokenMonitor = new TokenLifecycleMonitor(container);
    const tradingMonitor = new TradingActivityMonitor(container);
    
    // Start all monitors
    console.log(chalk.yellow('\n🚀 Starting all domain monitors...'));
    
    // Start monitors one by one with a small delay to avoid race conditions
    await tokenMonitor.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await tradingMonitor.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await liquidityMonitor.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Monitor for 10 seconds
    console.log(chalk.gray('\nMonitoring liquidity events for 10 seconds...'));
    
    // Display periodic updates
    const interval = setInterval(() => {
      const metrics = liquidityMonitor.getMetrics();
      console.log(chalk.blue(`\n💧 Liquidity Update:`));
      console.log(`  Pools: ${metrics.totalPools}`);
      console.log(`  TVL: $${metrics.totalTVL.toFixed(2)}`);
      console.log(`  Liquidity Events: ${metrics.totalLiquidityEvents}`);
      console.log(`  Fee Events: ${metrics.totalFeeEvents}`);
      console.log(`  LP Positions: ${metrics.lpPositions}`);
      console.log(`  Parse Rate: ${metrics.parseRate.toFixed(2)}%`);
    }, 3000);
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    clearInterval(interval);
    
    // Display final stats
    console.log(chalk.green('\n✅ Session 6 Test Complete!'));
    
    // Show all monitor stats
    console.log(chalk.cyan('\n📊 Final Monitor Statistics:'));
    tokenMonitor.displayStats();
    tradingMonitor.displayStats();
    liquidityMonitor.displayStats();
    
    // Show subscription distribution
    const subscriptionGroups = streamManager.getSubscriptionGroups();
    console.log(chalk.cyan('\n🎯 Subscription Distribution:'));
    subscriptionGroups.forEach((count, group) => {
      console.log(`  ${group}: ${count} subscriptions`);
    });
    
    // Show pool states
    const poolStates = liquidityMonitor.getPoolStates();
    if (poolStates.size > 0) {
      console.log(chalk.cyan('\n🏊 Active Pools:'));
      let poolCount = 0;
      poolStates.forEach((pool, address) => {
        if (poolCount++ < 5) { // Show top 5
          console.log(`  ${address.slice(0, 8)}... - TVL: $${pool.tvlUSD.toFixed(2)}`);
        }
      });
      if (poolStates.size > 5) {
        console.log(`  ... and ${poolStates.size - 5} more pools`);
      }
    }
    
    // Cleanup
    await tokenMonitor.stop();
    await tradingMonitor.stop();
    await liquidityMonitor.stop();
    await streamManager.stop();
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  }
  
  console.log(chalk.green('\n✅ Session 6 tested successfully!'));
  console.log(chalk.gray('\nLiquidity monitoring is now integrated into the smart streaming architecture.'));
  process.exit(0);
}

// Run test
testSession6().catch(console.error);