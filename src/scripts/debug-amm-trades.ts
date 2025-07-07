#!/usr/bin/env npx tsx

/**
 * Debug AMM Trades
 * Script to help debug why AMM trades are showing as 0
 */

import 'dotenv/config';
import chalk from 'chalk';
import bs58 from 'bs58';
import { createContainer } from '../core/container-factory';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';

async function main() {
  const logger = new Logger({ context: 'AMM-Debug', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🔍 AMM Trade Debugging Tool\n'));
  
  try {
    // Create container
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    // Track AMM-specific stats
    let ammTransactions = 0;
    let ammTrades = 0;
    let totalTransactions = 0;
    const ammProgram = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    
    // Listen for AMM trades
    eventBus.on(EVENTS.AMM_TRADE, (data) => {
      ammTrades++;
      logger.info('✅ AMM Trade Detected!', {
        signature: data.trade.signature,
        type: data.trade.tradeType,
        mint: data.trade.mintAddress,
        volume: data.trade.volumeUsd
      });
    });
    
    // Create custom trading monitor with debug logging
    class DebugTradingMonitor extends TradingActivityMonitor {
      protected async processTransaction(data: any): Promise<void> {
        totalTransactions++;
        
        const tx = data.transaction?.transaction?.transaction;
        if (!tx?.message) return;
        
        const accountKeys = tx.message.accountKeys || [];
        const accountStrs = accountKeys.map((acc: any) => 
          typeof acc === 'string' ? acc : bs58.encode(acc)
        );
        
        // Check if this is an AMM transaction
        if (accountStrs.includes(ammProgram)) {
          ammTransactions++;
          
          // Log transaction details
          const signature = data.transaction?.transaction?.signature || 'unknown';
          const logs = tx.meta?.logMessages || [];
          
          logger.info('🔍 AMM Transaction Found!', {
            signature: typeof signature === 'string' ? signature : bs58.encode(signature),
            accountCount: accountStrs.length,
            hasLogs: logs.length > 0
          });
          
          // Check for swap signatures in logs
          const swapSignatures = ['Swap', 'buy', 'Buy', 'sell', 'Sell', 'ray_log'];
          const hasSwapSignature = logs.some((log: string) => 
            swapSignatures.some(sig => log.includes(sig))
          );
          
          if (hasSwapSignature) {
            logger.info('✨ Has swap signature in logs');
            
            // Log relevant logs
            logs.forEach((log: string) => {
              if (swapSignatures.some(sig => log.includes(sig))) {
                logger.debug('Log:', log);
              }
            });
          } else {
            logger.warn('❌ No swap signature found in logs');
            logger.debug('First 5 logs:', logs.slice(0, 5));
          }
        }
        
        // Call parent implementation
        await super.processTransaction(data);
      }
      
      // Override to ensure we're checking the right programs
      protected getProgramIds(): string[] {
        const programs = super.getProgramIds();
        logger.info('Monitoring programs:', programs);
        return programs;
      }
      
      // Override to log subscription details
      protected buildEnhancedSubscribeRequest(): any {
        const request = super.buildEnhancedSubscribeRequest();
        logger.info('Subscription request includes programs:', this.getProgramIds());
        return request;
      }
    }
    
    // Create and start the debug monitor
    const monitor = new DebugTradingMonitor(container);
    await monitor.start();
    
    logger.info('Monitor started, listening for AMM trades...');
    logger.info(`AMM Program: ${ammProgram}`);
    
    // Display stats every 10 seconds
    setInterval(() => {
      console.log(chalk.gray('\n─'.repeat(50)));
      console.log(chalk.cyan('📊 Debug Stats:'));
      console.log(`Total Transactions: ${totalTransactions}`);
      console.log(`AMM Transactions: ${ammTransactions} (${((ammTransactions/totalTransactions)*100).toFixed(1)}%)`);
      console.log(`AMM Trades Parsed: ${ammTrades}`);
      if (ammTransactions > 0) {
        console.log(`Parse Rate: ${((ammTrades/ammTransactions)*100).toFixed(1)}%`);
      }
      console.log(chalk.gray('─'.repeat(50)));
    }, 10000);
    
    // Run for 2 minutes
    setTimeout(async () => {
      console.log(chalk.yellow('\n\n🏁 Test complete!'));
      console.log('\nFinal Results:');
      console.log(`- Saw ${totalTransactions} total transactions`);
      console.log(`- Found ${ammTransactions} AMM transactions`);
      console.log(`- Parsed ${ammTrades} AMM trades`);
      
      if (ammTransactions === 0) {
        console.log(chalk.red('\n❌ No AMM transactions detected!'));
        console.log('Possible issues:');
        console.log('1. AMM program not included in subscription');
        console.log('2. No AMM activity during test period');
        console.log('3. Subscription filtering issue');
      } else if (ammTrades === 0) {
        console.log(chalk.red('\n❌ AMM transactions found but no trades parsed!'));
        console.log('Possible issues:');
        console.log('1. Parsing strategy not working correctly');
        console.log('2. Log format has changed');
        console.log('3. Missing required data in transactions');
      }
      
      await monitor.stop();
      process.exit(0);
    }, 120000); // 2 minutes
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\nShutting down...'));
      await monitor.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start debug monitor', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);