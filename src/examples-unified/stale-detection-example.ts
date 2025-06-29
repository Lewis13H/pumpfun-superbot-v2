#!/usr/bin/env tsx

/**
 * Example: How to integrate Stale Token Detection with monitors
 */

import 'dotenv/config';
import { StaleTokenDetector } from '../services/stale-token-detector';
import chalk from 'chalk';

async function staleDetectionExample() {
  console.log(chalk.cyan.bold('\n📚 Stale Token Detection Integration Example\n'));
  
  // Initialize the detector with custom configuration
  const detector = StaleTokenDetector.getInstance({
    staleThresholdMinutes: 30,        // Mark as stale after 30 minutes
    criticalStaleMinutes: 60,         // Critical priority after 60 minutes
    scanIntervalMinutes: 5,           // Scan every 5 minutes
    batchSize: 100,                   // Process 100 tokens per batch
    maxConcurrentRecoveries: 3,       // 3 parallel recovery workers
    enableStartupRecovery: true,      // Auto-recover on startup
  });
  
  console.log(chalk.yellow('Starting stale token detector...\n'));
  
  // Start the service - it will:
  // 1. Check for system downtime and recover if needed
  // 2. Start periodic scanning for stale tokens
  // 3. Automatically recover stale token prices
  await detector.start();
  
  // The service is now running in the background
  console.log(chalk.green('✅ Stale token detector is running!\n'));
  
  // You can also manually trigger operations:
  
  // 1. Manually scan for stale tokens
  console.log(chalk.blue('Manually scanning for stale tokens...'));
  await detector.scanForStaleTokens();
  
  // 2. Get current statistics
  const stats = detector.getStats();
  console.log(chalk.gray('\nCurrent Statistics:'));
  console.log(`  Last scan: ${stats.lastScanTime?.toLocaleTimeString() || 'Never'}`);
  console.log(`  Stale tokens found: ${stats.staleTokensFound}`);
  console.log(`  Tokens recovered: ${stats.tokensRecovered}`);
  console.log(`  Success rate: ${(stats.recoverySuccessRate * 100).toFixed(1)}%`);
  console.log(`  Queue depth: ${stats.currentQueueDepth}`);
  
  // 3. Manually recover specific tokens
  const tokenToRecover = ['8MVcN7KU68qrmQYL7t4eUSaB9sEdSpcH1VRPt9f6pump'];
  console.log(chalk.blue('\nManually recovering a specific token...'));
  const results = await detector.recoverTokens(tokenToRecover);
  
  results.forEach(result => {
    if (result.success) {
      console.log(chalk.green(`✅ ${result.mintAddress}: $${result.newPriceUsd?.toFixed(8)}`));
    } else {
      console.log(chalk.red(`❌ ${result.mintAddress}: ${result.error}`));
    }
  });
  
  // Integration with monitors:
  console.log(chalk.cyan('\n💡 Integration Tips:'));
  console.log(chalk.gray('1. Start detector when monitor starts:'));
  console.log(chalk.gray('   await detector.start();'));
  console.log(chalk.gray('\n2. Stop detector when monitor stops:'));
  console.log(chalk.gray('   detector.stop();'));
  console.log(chalk.gray('\n3. The detector runs independently and automatically'));
  console.log(chalk.gray('   recovers stale prices in the background'));
  console.log(chalk.gray('\n4. No need to manually check for stale tokens -'));
  console.log(chalk.gray('   the service handles everything automatically!'));
  
  // Keep running for demo
  console.log(chalk.yellow('\n⏰ Demo running for 30 seconds...'));
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // Stop the service
  detector.stop();
  console.log(chalk.green('\n✅ Stale token detector stopped.'));
}

// Run example
staleDetectionExample()
  .then(() => {
    console.log(chalk.green('\n✨ Example completed!'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Example failed:'), error);
    process.exit(1);
  });