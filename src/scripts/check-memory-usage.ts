/**
 * Script to check memory usage and clean up caches
 */

import 'dotenv/config';
import { RealtimePriceCache } from '../services/pricing/realtime-price-cache';
import chalk from 'chalk';
import os from 'os';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function checkMemory() {
  console.log(chalk.blue('\n=== System Memory Usage ==='));
  
  // System memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = (usedMem / totalMem) * 100;
  
  console.log(`Total Memory: ${formatBytes(totalMem)}`);
  console.log(`Used Memory: ${formatBytes(usedMem)} (${memPercent.toFixed(1)}%)`);
  console.log(`Free Memory: ${formatBytes(freeMem)}`);
  
  // Process memory
  console.log(chalk.blue('\n=== Process Memory Usage ==='));
  const memUsage = process.memoryUsage();
  console.log(`RSS: ${formatBytes(memUsage.rss)}`);
  console.log(`Heap Total: ${formatBytes(memUsage.heapTotal)}`);
  console.log(`Heap Used: ${formatBytes(memUsage.heapUsed)}`);
  console.log(`External: ${formatBytes(memUsage.external)}`);
  console.log(`Array Buffers: ${formatBytes(memUsage.arrayBuffers || 0)}`);
  
  // Price cache stats
  console.log(chalk.blue('\n=== Price Cache Stats ==='));
  const priceCache = RealtimePriceCache.getInstance();
  const stats = priceCache.getStats();
  console.log(`Total Tokens Cached: ${stats.totalTokens}`);
  console.log(`Total Updates: ${stats.updateCount}`);
  console.log(`Memory Usage: ${stats.memoryUsage.toFixed(2)} MB`);
  
  return { memPercent, stats };
}

async function cleanupCaches() {
  console.log(chalk.yellow('\n=== Running Cache Cleanup ==='));
  
  // Clean up price cache (remove entries older than 30 minutes)
  const priceCache = RealtimePriceCache.getInstance();
  const cleanedCount = priceCache.cleanup(30 * 60 * 1000); // 30 minutes
  console.log(`Cleaned ${cleanedCount} stale price entries`);
  
  // Force garbage collection if available
  if (global.gc) {
    console.log('Running garbage collection...');
    global.gc();
  } else {
    console.log(chalk.gray('Garbage collection not available. Run with --expose-gc flag'));
  }
  
  return cleanedCount;
}

async function main() {
  console.log(chalk.green('Memory Usage Analysis\n'));
  
  // Check initial memory
  const { memPercent, stats } = checkMemory();
  
  if (memPercent > 80) {
    console.log(chalk.red(`\n⚠️  High memory usage detected: ${memPercent.toFixed(1)}%`));
    
    // Run cleanup
    const cleaned = await cleanupCaches();
    
    // Wait a bit for GC
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check memory again
    console.log(chalk.green('\n=== After Cleanup ==='));
    console.log(`Successfully cleaned ${cleaned} stale entries`);
    checkMemory();
  } else {
    console.log(chalk.green(`\n✓ Memory usage is normal: ${memPercent.toFixed(1)}%`));
  }
  
  // Recommendations
  console.log(chalk.blue('\n=== Recommendations ==='));
  if (stats.totalTokens > 10000) {
    console.log(chalk.yellow('• Consider implementing automatic cache eviction'));
    console.log(chalk.yellow('• Price cache has over 10,000 tokens'));
  }
  if (memPercent > 90) {
    console.log(chalk.red('• Critical: Consider restarting the application'));
    console.log(chalk.red('• Investigate memory leaks in monitors'));
  }
  
  process.exit(0);
}

main().catch(console.error);