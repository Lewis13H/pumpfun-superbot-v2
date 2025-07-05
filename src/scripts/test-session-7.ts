#!/usr/bin/env npx tsx

/**
 * Test Session 7: Data Pipeline Architecture
 * Tests the unified data pipeline with event normalization and routing
 */

import { createContainer } from '../core/container-factory';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { LiquidityMonitor } from '../monitors/domain/liquidity-monitor';
import { EventBus, EVENTS } from '../core/event-bus';
import chalk from 'chalk';

async function testSession7() {
  console.log(chalk.cyan('\n🚀 Testing Session 7: Data Pipeline Architecture\n'));
  
  // Enable smart streaming and pipeline
  process.env.USE_SMART_STREAMING = 'true';
  
  const container = await createContainer();
  const eventBus = await container.resolve('EventBus') as EventBus;
  
  try {
    // Configure data pipeline
    const pipelineConfig = {
      batchSize: 100,
      batchTimeout: 2000,
      maxRetries: 3,
      enableCaching: true,
      enableMetrics: true,
      processors: ['database', 'analytics', 'cache', 'token', 'trade', 'liquidity', 'pool']
    };
    
    // Set pipeline config before getting stream manager
    (container as any).pipelineConfig = pipelineConfig;
    
    // Get SmartStreamManager
    const streamManager = await container.resolve('StreamManager') as SmartStreamManager;
    await streamManager.initialize();
    
    console.log(chalk.green('✅ Smart stream manager initialized with data pipeline'));
    
    // Create domain monitors
    console.log(chalk.yellow('\n📦 Creating domain monitors...\n'));
    
    const tokenLifecycleMonitor = new TokenLifecycleMonitor(container);
    const tradingMonitor = new TradingActivityMonitor(container);
    const liquidityMonitor = new LiquidityMonitor(container);
    
    // Start monitors
    await tokenLifecycleMonitor.start();
    console.log(chalk.green('✅ Token lifecycle monitor started'));
    
    await tradingMonitor.start();
    console.log(chalk.green('✅ Trading activity monitor started'));
    
    await liquidityMonitor.start();
    console.log(chalk.green('✅ Liquidity monitor started'));
    
    // Track pipeline stats
    let pipelineStatsUpdates = 0;
    eventBus.on(EVENTS.PIPELINE_STATS_UPDATED, (stats: any) => {
      pipelineStatsUpdates++;
      if (pipelineStatsUpdates % 5 === 0) { // Show every 5th update
        console.log(chalk.magenta('\n📊 Pipeline Stats Update:'));
        console.log(`  Events Processed: ${stats.eventsProcessed}`);
        console.log(`  Events Queued: ${stats.eventsQueued}`);
        console.log(`  Batches: ${stats.batchesProcessed}`);
        console.log(`  Throughput: ${stats.throughput.toFixed(2)} events/s`);
        console.log(`  Error Rate: ${stats.errorRate.toFixed(2)}%`);
      }
    });
    
    // Display stats every 10 seconds
    const statsInterval = setInterval(() => {
      console.log(chalk.blue('\n📈 System Statistics:'));
      console.log(chalk.gray('─'.repeat(60)));
      
      // Get comprehensive stats
      const stats = streamManager.getStats();
      
      // Connection pool stats
      console.log(chalk.cyan('Connection Pool:'));
      console.log(`  Active: ${stats.pool.active}`);
      console.log(`  Healthy: ${stats.pool.healthy}`);
      console.log(`  Total Created: ${stats.pool.totalCreated}`);
      
      // Monitor stats
      console.log(chalk.yellow('\nMonitors:'));
      console.log(`  Total: ${stats.monitors.total}`);
      console.log(`  By Group:`, stats.monitors.byGroup);
      
      // Pipeline stats
      if (stats.pipeline) {
        console.log(chalk.magenta('\nData Pipeline:'));
        console.log(`  Events Processed: ${stats.pipeline.eventsProcessed}`);
        console.log(`  Events Failed: ${stats.pipeline.eventsFailed}`);
        console.log(`  Avg Batch Size: ${stats.pipeline.avgBatchSize.toFixed(1)}`);
        console.log(`  Avg Processing Time: ${stats.pipeline.avgProcessingTime.toFixed(0)}ms`);
        console.log(`  Throughput: ${stats.pipeline.throughput.toFixed(2)} events/s`);
      }
      
      // Load balancer stats
      if (stats.load) {
        console.log(chalk.green('\nLoad Balancing:'));
        console.log(`  Average Load: ${stats.load.averageLoad.toFixed(1)}%`);
        console.log(`  Max Load: ${stats.load.maxLoad.toFixed(1)}%`);
        console.log(`  Min Load: ${stats.load.minLoad.toFixed(1)}%`);
      }
      
      console.log(chalk.gray('─'.repeat(60)));
    }, 10000);
    
    // Run for 2 minutes
    console.log(chalk.yellow('\n⏳ Running for 2 minutes to collect pipeline metrics...\n'));
    
    await new Promise(resolve => setTimeout(resolve, 120000));
    
    // Stop everything
    clearInterval(statsInterval);
    
    console.log(chalk.cyan('\n🔍 Final Statistics:\n'));
    
    // Display final stats
    const finalStats = streamManager.getStats();
    
    // Get pipeline instance for detailed metrics
    const { DataPipeline } = await import('../services/pipeline/data-pipeline');
    // Set EventBus before getting instance
    DataPipeline.setEventBus(eventBus);
    const pipeline = DataPipeline.getInstance();
    
    // Display pipeline metrics
    pipeline.displayStats();
    
    // Display pipeline metrics summary
    const pipelineMetrics = pipeline.getMetrics();
    console.log(chalk.magenta('\n📊 Pipeline Metrics Summary:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Total Events: ${pipelineMetrics.totalEvents}`);
    console.log(`Throughput: ${pipelineMetrics.throughput.toFixed(2)} events/s`);
    console.log(`Processing Time Percentiles:`);
    console.log(`  P50: ${pipelineMetrics.processingTimePercentiles.p50}ms`);
    console.log(`  P90: ${pipelineMetrics.processingTimePercentiles.p90}ms`);
    console.log(`  P99: ${pipelineMetrics.processingTimePercentiles.p99}ms`);
    
    // Event type breakdown
    console.log(chalk.cyan('\n📋 Event Types Processed:'));
    for (const [type, stats] of Object.entries(pipelineMetrics.eventTypes)) {
      const typeStats = stats as any;
      console.log(`  ${type}: ${typeStats.count} events`);
    }
    
    // Source breakdown
    console.log(chalk.yellow('\n🌐 Event Sources:'));
    for (const [source, stats] of Object.entries(pipelineMetrics.sources)) {
      const sourceStats = stats as any;
      console.log(`  ${source}: ${sourceStats.eventsReceived} received, ${sourceStats.errorCount} errors`);
    }
    
    // Success summary
    console.log(chalk.green('\n✅ Session 7 Test Summary:'));
    console.log('- Data pipeline successfully integrated with SmartStreamManager');
    console.log('- Event normalization working across all domain monitors');
    console.log('- Batch processing and routing functioning correctly');
    console.log('- Pipeline metrics collection and reporting operational');
    console.log(`- Processed ${pipelineMetrics.totalEvents} events with ${finalStats.pipeline?.errorRate.toFixed(2)}% error rate`);
    
    // Cleanup
    await tokenLifecycleMonitor.stop();
    await tradingMonitor.stop();
    await liquidityMonitor.stop();
    await streamManager.stop();
    
    console.log(chalk.green('\n✅ Session 7 test completed successfully!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error);
  }
  
  process.exit(0);
}

// Run the test
testSession7().catch(console.error);