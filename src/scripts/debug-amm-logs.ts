#!/usr/bin/env npx tsx

/**
 * Debug AMM Logs
 * Script to see what logs AMM transactions actually contain
 */

import 'dotenv/config';
import chalk from 'chalk';
import bs58 from 'bs58';
import { createContainer } from '../core/container-factory';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { Logger } from '../core/logger';

async function main() {
  const logger = new Logger({ context: 'AMM-Log-Debug', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🔍 AMM Log Debugging Tool\n'));
  
  try {
    // Create container
    const container = await createContainer();
    
    // Track AMM-specific stats
    let ammTransactionsChecked = 0;
    let ammTransactionsWithLogs = 0;
    const ammProgram = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    const uniqueLogs = new Set<string>();
    const logPatterns = new Map<string, number>();
    
    // Create custom trading monitor with log inspection
    class LogInspectorMonitor extends TradingActivityMonitor {
      protected async processTransaction(data: any): Promise<void> {
        const tx = data.transaction?.transaction?.transaction;
        if (!tx?.message) return;
        
        const accountKeys = tx.message.accountKeys || [];
        const accountStrs = accountKeys.map((acc: any) => 
          typeof acc === 'string' ? acc : bs58.encode(acc)
        );
        
        // Check if this is an AMM transaction
        if (accountStrs.includes(ammProgram)) {
          ammTransactionsChecked++;
          
          const logs = tx.meta?.logMessages || [];
          
          if (logs.length > 0) {
            ammTransactionsWithLogs++;
            
            // First few transactions, log all details
            if (ammTransactionsChecked <= 5) {
              const signature = data.transaction?.transaction?.signature || 'unknown';
              logger.info('📝 AMM Transaction Logs:', {
                signature: typeof signature === 'string' ? signature : bs58.encode(signature),
                logCount: logs.length
              });
              
              logs.forEach((log: string, index: number) => {
                console.log(chalk.gray(`  [${index}]: ${log}`));
                
                // Collect unique log patterns
                const pattern = log.replace(/[A-HJ-NP-Za-km-z1-9]{32,44}/g, '<PUBKEY>')
                                  .replace(/\d+/g, '<NUM>');
                uniqueLogs.add(pattern);
                
                // Count specific patterns
                if (log.includes('Program pAMM')) {
                  logPatterns.set('Program pAMM', (logPatterns.get('Program pAMM') || 0) + 1);
                }
                if (log.includes('invoke')) {
                  logPatterns.set('invoke', (logPatterns.get('invoke') || 0) + 1);
                }
                if (log.includes('success')) {
                  logPatterns.set('success', (logPatterns.get('success') || 0) + 1);
                }
                if (log.includes('data:')) {
                  logPatterns.set('data:', (logPatterns.get('data:') || 0) + 1);
                }
                if (log.includes('Instruction:')) {
                  logPatterns.set('Instruction:', (logPatterns.get('Instruction:') || 0) + 1);
                }
              });
              
              console.log('');
            }
          }
        }
        
        // Don't call parent - we're just inspecting
      }
    }
    
    // Create and start the inspector monitor
    const monitor = new LogInspectorMonitor(container);
    await monitor.start();
    
    logger.info('Monitor started, analyzing AMM transaction logs...');
    
    // Run for 30 seconds
    setTimeout(async () => {
      console.log(chalk.yellow('\n\n🏁 Analysis complete!'));
      console.log('\nResults:');
      console.log(`- Checked ${ammTransactionsChecked} AMM transactions`);
      console.log(`- ${ammTransactionsWithLogs} had logs (${((ammTransactionsWithLogs/ammTransactionsChecked)*100).toFixed(1)}%)`);
      
      console.log('\nCommon log patterns found:');
      logPatterns.forEach((count, pattern) => {
        console.log(`- "${pattern}": ${count} times`);
      });
      
      console.log('\nUnique log patterns (first 20):');
      Array.from(uniqueLogs).slice(0, 20).forEach(pattern => {
        console.log(`- ${pattern}`);
      });
      
      await monitor.stop();
      process.exit(0);
    }, 30000); // 30 seconds
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\nShutting down...'));
      await monitor.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start inspector', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);