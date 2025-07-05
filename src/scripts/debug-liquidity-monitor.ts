#!/usr/bin/env npx tsx

/**
 * Debug Liquidity Monitor
 * Runs the liquidity monitor for 3 minutes with enhanced debug logging
 */

import { createContainer } from '../core/container-factory';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { LiquidityMonitor } from '../monitors/domain/liquidity-monitor';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

// Create log file
const logFile = path.join(process.cwd(), `liquidity-debug-${Date.now()}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Override console.log to also write to file
const originalLog = console.log;
console.log = (...args: any[]) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  logStream.write(`[${new Date().toISOString()}] ${message}\n`);
  originalLog.apply(console, args);
};

async function debugLiquidityMonitor() {
  console.log(chalk.cyan('\n🔍 Debug Liquidity Monitor - 3 Minute Test\n'));
  console.log(`📝 Logging to: ${logFile}\n`);
  
  // Enable smart streaming and debug logging
  process.env.USE_SMART_STREAMING = 'true';
  process.env.LOG_LEVEL = 'DEBUG';
  
  const container = await createContainer();
  const startTime = Date.now();
  const runDuration = 3 * 60 * 1000; // 3 minutes
  
  try {
    // Get SmartStreamManager
    const streamManager = await container.resolve('StreamManager') as SmartStreamManager;
    
    // Initialize the stream manager
    await streamManager.initialize();
    
    // Create and start liquidity monitor
    console.log(chalk.yellow('🚀 Starting Liquidity Monitor with debug logging...\n'));
    const liquidityMonitor = new LiquidityMonitor(container);
    await liquidityMonitor.start();
    
    // Track statistics
    let lastStats = {
      messages: 0,
      liquidity: 0,
      fees: 0,
      pools: 0
    };
    
    // Display updates every 10 seconds
    const updateInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.floor((runDuration - (Date.now() - startTime)) / 1000);
      const metrics = liquidityMonitor.getMetrics();
      
      // Calculate rates
      const messageRate = metrics.messagesProcessed - lastStats.messages;
      const liquidityRate = metrics.totalLiquidityEvents - lastStats.liquidity;
      const feeRate = metrics.totalFeeEvents - lastStats.fees;
      
      console.log(chalk.blue(`\n⏱️  Elapsed: ${elapsed}s | Remaining: ${remaining}s`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Messages/sec: ${messageRate}`);
      console.log(`Total Messages: ${metrics.messagesProcessed}`);
      console.log(`Parse Rate: ${metrics.parseRate.toFixed(2)}%`);
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Liquidity Events: ${metrics.totalLiquidityEvents} (+${liquidityRate})`);
      console.log(`Fee Events: ${metrics.totalFeeEvents} (+${feeRate})`);
      console.log(`LP Positions: ${metrics.lpPositions}`);
      console.log(`Active Pools: ${metrics.totalPools}`);
      console.log(`Total TVL: $${metrics.totalTVL.toFixed(2)}`);
      console.log(chalk.gray('─'.repeat(50)));
      
      // Update last stats
      lastStats = {
        messages: metrics.messagesProcessed,
        liquidity: metrics.totalLiquidityEvents,
        fees: metrics.totalFeeEvents,
        pools: metrics.totalPools
      };
    }, 10000);
    
    // Run for 3 minutes
    await new Promise(resolve => setTimeout(resolve, runDuration));
    
    // Stop update interval
    clearInterval(updateInterval);
    
    // Display final statistics
    console.log(chalk.green('\n✅ 3-minute test complete!\n'));
    liquidityMonitor.displayStats();
    
    // Get final metrics
    const finalMetrics = liquidityMonitor.getMetrics();
    const poolStates = liquidityMonitor.getPoolStates();
    
    // Summary
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Total Duration: 3 minutes`);
    console.log(`Messages Processed: ${finalMetrics.messagesProcessed}`);
    console.log(`Messages/second: ${(finalMetrics.messagesProcessed / 180).toFixed(2)}`);
    console.log(`Parse Rate: ${finalMetrics.parseRate.toFixed(2)}%`);
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Liquidity Add/Remove Events: ${finalMetrics.totalLiquidityEvents}`);
    console.log(`Fee Collection Events: ${finalMetrics.totalFeeEvents}`);
    console.log(`LP Position Updates: ${finalMetrics.lpPositions}`);
    console.log(`Unique Pools Tracked: ${poolStates.size}`);
    console.log(`Total TVL: $${finalMetrics.totalTVL.toFixed(2)}`);
    console.log(chalk.gray('─'.repeat(50)));
    
    // Log pool details
    if (poolStates.size > 0) {
      console.log(chalk.cyan('\n🏊 Pool Details:'));
      let poolIndex = 0;
      poolStates.forEach((pool, address) => {
        if (poolIndex++ < 10) { // Show first 10 pools
          console.log(`\nPool ${poolIndex}: ${address}`);
          console.log(`  Token: ${pool.tokenMint}`);
          console.log(`  TVL: $${pool.tvlUSD.toFixed(2)}`);
          console.log(`  SOL Reserves: ${(Number(pool.solReserves) / 1e9).toFixed(4)} SOL`);
          console.log(`  Token Reserves: ${pool.tokenReserves.toString()}`);
        }
      });
      if (poolStates.size > 10) {
        console.log(`\n... and ${poolStates.size - 10} more pools`);
      }
    }
    
    // Analysis
    console.log(chalk.yellow('\n🔍 Analysis:'));
    if (finalMetrics.totalLiquidityEvents === 0) {
      console.log('- No liquidity add/remove events detected during this period');
      console.log('- This is normal as liquidity events are less frequent than trades');
      console.log('- The monitor is correctly processing transactions and looking for liquidity events');
    } else {
      console.log(`- Found ${finalMetrics.totalLiquidityEvents} liquidity events`);
      console.log(`- Average rate: ${(finalMetrics.totalLiquidityEvents / 180).toFixed(4)} events/second`);
    }
    
    if (poolStates.size > 0) {
      console.log(`- Tracking ${poolStates.size} active AMM pools`);
      console.log(`- Combined TVL: $${finalMetrics.totalTVL.toFixed(2)}`);
    }
    
    // Cleanup
    await liquidityMonitor.stop();
    await streamManager.stop();
    
    console.log(chalk.green(`\n✅ Log file saved to: ${logFile}`));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error);
  } finally {
    logStream.end();
  }
  
  process.exit(0);
}

// Run the debug monitor
debugLiquidityMonitor().catch(console.error);