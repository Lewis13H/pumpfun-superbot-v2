#!/usr/bin/env npx tsx

/**
 * Analyze AMM Logs
 * Check what logs are available for AMM trades
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';

async function main() {
  const logger = new Logger({ context: 'AMMLogAnalyzer', color: chalk.magenta });
  
  console.log(chalk.cyan('\n🔍 Analyzing AMM Trade Logs\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    let ammTxCount = 0;
    const logPatterns = new Map<string, number>();
    const rayLogExamples: string[] = [];
    
    // Listen for raw stream data
    eventBus.on('stream:data', (data) => {
      if (!data?.transaction?.transaction?.transaction) return;
      
      const tx = data.transaction.transaction.transaction;
      const accounts = tx.message?.accountKeys || [];
      const logs = data.transaction.meta?.logMessages || [];
      
      // Check if it's an AMM transaction
      const hasAMM = accounts.some((acc: any) => {
        const accStr = typeof acc === 'string' ? acc : acc.toString();
        return accStr.includes('pAMMBay6');
      });
      
      if (!hasAMM) return;
      
      ammTxCount++;
      
      // Analyze logs for the first few AMM transactions
      if (ammTxCount <= 3) {
        console.log(chalk.yellow(`\n=== AMM Transaction #${ammTxCount} ===`));
        console.log(`Total logs: ${logs.length}`);
        
        logs.forEach((log: string, i: number) => {
          // Skip standard logs
          if (log.includes('invoke') || log.includes('success') || log.includes('Program log:')) {
            return;
          }
          
          // Look for interesting patterns
          if (log.includes('ray_log:')) {
            console.log(chalk.green(`[${i}] RAY LOG: ${log.substring(0, 100)}...`));
            if (rayLogExamples.length < 5) {
              rayLogExamples.push(log);
            }
          } else if (log.includes('amount') || log.includes('Amount')) {
            console.log(chalk.blue(`[${i}] AMOUNT: ${log}`));
          } else if (log.includes('Transfer') || log.includes('transfer')) {
            console.log(chalk.magenta(`[${i}] TRANSFER: ${log}`));
          } else if (log.includes('Event') || log.includes('event')) {
            console.log(chalk.cyan(`[${i}] EVENT: ${log}`));
          } else if (!log.includes('Program') && log.length > 10) {
            console.log(chalk.gray(`[${i}] OTHER: ${log.substring(0, 80)}...`));
          }
          
          // Track patterns
          const patterns = ['ray_log:', 'Transfer', 'amount', 'Event', 'mint', 'balance'];
          patterns.forEach(pattern => {
            if (log.toLowerCase().includes(pattern.toLowerCase())) {
              logPatterns.set(pattern, (logPatterns.get(pattern) || 0) + 1);
            }
          });
        });
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Analyzing AMM logs for 15 seconds...\n');
    
    // Run for 15 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n📊 Analysis Results:\n'));
      console.log(`Total AMM Transactions: ${ammTxCount}`);
      
      console.log(chalk.cyan('\n📝 Log Pattern Frequency:'));
      Array.from(logPatterns.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([pattern, count]) => {
          console.log(`  ${pattern}: ${count} occurrences`);
        });
      
      if (rayLogExamples.length > 0) {
        console.log(chalk.green('\n📋 Ray Log Examples:'));
        rayLogExamples.forEach((log, i) => {
          const match = log.match(/ray_log:\s*([A-Za-z0-9+/=]+)/);
          if (match) {
            const base64Data = match[1];
            const buffer = Buffer.from(base64Data, 'base64');
            console.log(`\n${i + 1}. Base64: ${base64Data.substring(0, 50)}...`);
            console.log(`   Hex: ${buffer.toString('hex')}`);
            console.log(`   Length: ${buffer.length} bytes`);
            
            // Try to parse as amounts
            if (buffer.length >= 16) {
              const val1 = buffer.readBigUInt64LE(0);
              const val2 = buffer.readBigUInt64LE(8);
              console.log(`   Value 1: ${val1} (${Number(val1) / 1e9} SOL)`);
              console.log(`   Value 2: ${val2} (${Number(val2) / 1e9} SOL)`);
            }
          }
        });
      }
      
      console.log(chalk.yellow('\n💡 Recommendations:'));
      if (logPatterns.get('ray_log:') > 0) {
        console.log('- Ray logs are present but may not contain trade amounts');
      }
      if (logPatterns.get('Transfer') > 0) {
        console.log('- Transfer logs present - could parse token transfers');
      }
      if (logPatterns.get('Event') > 0) {
        console.log('- Event logs present - check for BuyEvent/SellEvent');
      }
      console.log('- Consider using token balance changes from transaction meta');
      
      process.exit(0);
    }, 15000);
    
  } catch (error) {
    logger.error('Analysis failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);