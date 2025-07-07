/**
 * Test AMM Parser
 * Quick test to verify AMM instruction parsing is working
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';

async function main() {
  const logger = new Logger({ context: 'AMM-Parser-Test', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🧪 Testing AMM Parser\n'));
  
  try {
    // Create container
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    // Track stats
    let ammTradesDetected = 0;
    let totalMessages = 0;
    
    // Listen for AMM trades
    eventBus.on(EVENTS.AMM_TRADE, (data) => {
      ammTradesDetected++;
      logger.info('✅ AMM Trade Parsed\!', {
        signature: data.trade.signature.substring(0, 8) + '...',
        type: data.trade.tradeType,
        mint: data.trade.mintAddress.substring(0, 8) + '...',
        solAmount: Number(data.trade.solAmount) / 1e9,
        tokenAmount: Number(data.trade.tokenAmount)
      });
    });
    
    // Listen for all stream data to count messages
    eventBus.on(EVENTS.STREAM_DATA, () => {
      totalMessages++;
    });
    
    // Import and start monitors
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    logger.info('Monitor started, waiting for AMM trades...');
    
    // Run for 30 seconds
    setTimeout(async () => {
      console.log(chalk.yellow('\n\n🏁 Test Results:'));
      console.log(`Total messages: ${totalMessages}`);
      console.log(`AMM trades detected: ${ammTradesDetected}`);
      
      if (ammTradesDetected > 0) {
        console.log(chalk.green('\n✅ AMM parsing is working\!'));
      } else {
        console.log(chalk.red('\n❌ No AMM trades detected'));
        console.log('This could mean:');
        console.log('1. No AMM activity during test period');
        console.log('2. Parser still not working correctly');
      }
      
      await monitor.stop();
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);
EOF < /dev/null