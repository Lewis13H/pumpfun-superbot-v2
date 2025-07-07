/**
 * Test AMM Fix
 * Direct test of AMM trade parsing
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';

async function main() {
  const logger = new Logger({ context: 'AMM-Fix-Test', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🧪 Testing AMM Trade Detection\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    let ammTradesDetected = 0;
    let ammTransactionsProcessed = 0;
    
    // Listen for AMM trades
    eventBus.on(EVENTS.AMM_TRADE, (data) => {
      ammTradesDetected++;
      console.log(chalk.green(`\n✅ AMM TRADE DETECTED! #${ammTradesDetected}`));
      console.log(`   Type: ${data.trade.tradeType}`);
      console.log(`   Token: ${data.trade.mintAddress.substring(0, 8)}...`);
      console.log(`   SOL: ${(Number(data.trade.solAmount) / 1e9).toFixed(4)}`);
      console.log(`   Signature: ${data.trade.signature.substring(0, 16)}...`);
    });
    
    // Count AMM transactions for comparison
    eventBus.on(EVENTS.STREAM_DATA, (data) => {
      if (data?.transaction?.transaction?.transaction) {
        const tx = data.transaction.transaction.transaction;
        const accountKeys = tx.message?.accountKeys || [];
        const ammProgram = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
        
        const hasAMM = accountKeys.some((key: any) => {
          const keyStr = typeof key === 'string' ? key : 
                        Buffer.isBuffer(key) ? require('bs58').encode(key) : '';
          return keyStr === ammProgram;
        });
        
        if (hasAMM) ammTransactionsProcessed++;
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    logger.info('Monitor started, waiting for AMM activity...');
    
    // Status updates
    const statusInterval = setInterval(() => {
      console.log(chalk.gray(`\nStatus: ${ammTransactionsProcessed} AMM txns seen, ${ammTradesDetected} trades parsed`));
      if (ammTransactionsProcessed > 0) {
        const parseRate = ((ammTradesDetected / ammTransactionsProcessed) * 100).toFixed(1);
        console.log(chalk.yellow(`Parse rate: ${parseRate}%`));
      }
    }, 5000);
    
    // Run for 1 minute
    setTimeout(async () => {
      clearInterval(statusInterval);
      
      console.log(chalk.yellow('\n\n🏁 Test Complete!\n'));
      console.log(`Total AMM transactions: ${ammTransactionsProcessed}`);
      console.log(`AMM trades parsed: ${ammTradesDetected}`);
      
      if (ammTradesDetected > 0) {
        console.log(chalk.green('\n✅ SUCCESS! AMM trades are being parsed correctly.'));
        const parseRate = ((ammTradesDetected / ammTransactionsProcessed) * 100).toFixed(1);
        console.log(chalk.green(`Parse rate: ${parseRate}%`));
      } else if (ammTransactionsProcessed > 0) {
        console.log(chalk.red('\n❌ FAILED! AMM transactions found but no trades parsed.'));
        console.log('The parser may still need adjustments.');
      } else {
        console.log(chalk.yellow('\n⚠️ No AMM transactions found during test period.'));
        console.log('Try running the test again.');
      }
      
      await monitor.stop();
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);