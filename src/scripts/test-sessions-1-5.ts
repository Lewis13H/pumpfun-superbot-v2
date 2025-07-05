#!/usr/bin/env npx tsx

/**
 * Test Sessions 1-5 of Smart Streaming Implementation
 * 
 * Tests:
 * - Session 1: Connection Pool Foundation
 * - Session 2: Subscription Strategy 
 * - Session 3: Load Balancing & Monitoring
 * - Session 4: Domain Monitor - TokenLifecycle
 * - Session 5: Domain Monitor - TradingActivity
 */

import { createContainer } from '../core/container-factory';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import chalk from 'chalk';

async function testSessions() {
  console.log(chalk.cyan('\n🧪 Testing Smart Streaming Sessions 1-5\n'));
  
  // Enable smart streaming
  process.env.USE_SMART_STREAMING = 'true';
  
  const container = await createContainer();
  
  try {
    // Get SmartStreamManager
    const streamManager = await container.resolve('StreamManager') as SmartStreamManager;
    
    // Initialize the stream manager
    await streamManager.initialize();
    
    // Session 1: Connection Pool
    console.log(chalk.yellow('\n📦 Session 1: Connection Pool Foundation'));
    const poolInfo = await streamManager.getPoolInfo();
    console.log('Pool Info:', {
      totalConnections: poolInfo.totalConnections,
      activeConnections: poolInfo.activeConnections,
      healthyConnections: poolInfo.healthyConnections
    });
    
    // Session 2: Subscription Strategy
    console.log(chalk.yellow('\n🎯 Session 2: Subscription Strategy'));
    const subscriptionGroups = streamManager.getSubscriptionGroups();
    console.log('Subscription Groups:', subscriptionGroups);
    
    // Session 3: Load Balancing
    console.log(chalk.yellow('\n⚖️ Session 3: Load Balancing & Monitoring'));
    const loadMetrics = streamManager.getLoadMetrics();
    console.log('Load Metrics:', {
      connectionCount: loadMetrics.connectionLoads.size,
      averageLoad: loadMetrics.summary?.averageLoad?.toFixed(2) || '0.00',
      maxLoad: loadMetrics.summary?.maxLoad?.toFixed(2) || '0.00',
      minLoad: loadMetrics.summary?.minLoad?.toFixed(2) || '0.00'
    });
    
    // Session 4: TokenLifecycle Monitor
    console.log(chalk.yellow('\n🔄 Session 4: Domain Monitor - TokenLifecycle'));
    const tokenMonitor = new TokenLifecycleMonitor(container);
    console.log('TokenLifecycleMonitor created successfully');
    
    // Session 5: TradingActivity Monitor
    console.log(chalk.yellow('\n📊 Session 5: Domain Monitor - TradingActivity'));
    const tradingMonitor = new TradingActivityMonitor(container);
    console.log('TradingActivityMonitor created successfully');
    
    // Start monitors briefly to test
    console.log(chalk.yellow('\n🚀 Starting monitors...'));
    await tokenMonitor.start();
    await tradingMonitor.start();
    
    // Wait for some data
    console.log(chalk.gray('\nMonitoring for 5 seconds...'));
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Display stats
    console.log(chalk.green('\n✅ All Sessions Operational!'));
    
    // Show monitor stats
    tokenMonitor.displayStats();
    tradingMonitor.displayStats();
    
    // Show final load metrics
    const finalLoadMetrics = streamManager.getLoadMetrics();
    console.log(chalk.cyan('\n📈 Final Load Metrics:'));
    console.log('Connection Count:', finalLoadMetrics.connectionLoads.size);
    console.log('Average Load:', finalLoadMetrics.summary?.averageLoad?.toFixed(2) || '0.00');
    console.log('Max Load:', finalLoadMetrics.summary?.maxLoad?.toFixed(2) || '0.00');
    
    // Show subscription rate stats
    const rateStats = streamManager.getSubscriptionRateStats();
    console.log(chalk.cyan('\n📊 Subscription Rate Stats:'));
    console.log(`Subscriptions: ${rateStats.current}/${rateStats.limit} (${rateStats.percentage.toFixed(1)}%)`);
    console.log('By Connection:', rateStats.byConnection);
    
    // Cleanup
    await tokenMonitor.stop();
    await tradingMonitor.stop();
    await streamManager.stop();
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  }
  
  console.log(chalk.green('\n✅ All sessions tested successfully!'));
  process.exit(0);
}

// Run test
testSessions().catch(console.error);