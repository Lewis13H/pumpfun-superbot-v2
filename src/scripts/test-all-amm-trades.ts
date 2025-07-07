#!/usr/bin/env npx tsx

/**
 * Test All AMM Trades
 * Monitor all AMM trades regardless of save threshold
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';

async function main() {
  const logger = new Logger({ context: 'AMMTradeTest', color: chalk.green });
  
  console.log(chalk.cyan('\n🔍 Testing ALL AMM Trades (ignoring save threshold)\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    const parser = await container.resolve('EventParser') as UnifiedEventParser;
    
    let ammTradeCount = 0;
    let reasonableAmounts = 0;
    let unreasonableAmounts = 0;
    const tradeExamples: any[] = [];
    
    // Listen for raw stream data
    eventBus.on('stream:data', (data) => {
      if (!data?.transaction?.transaction?.transaction) return;
      
      const context = UnifiedEventParser.createContext(data);
      const event = parser.parse(context);
      
      if (event && event.type === 'amm_trade') {
        ammTradeCount++;
        
        const ammEvent = event as any;
        const solAmountNum = Number(ammEvent.solAmount) / 1e9;
        const tokenAmountNum = Number(ammEvent.tokenAmount);
        
        // Check if amounts are reasonable
        const isReasonable = solAmountNum > 0.001 && solAmountNum < 1000;
        
        if (isReasonable) {
          reasonableAmounts++;
        } else {
          unreasonableAmounts++;
        }
        
        // Collect examples
        if (tradeExamples.length < 10) {
          tradeExamples.push({
            tradeType: ammEvent.tradeType,
            solAmount: solAmountNum,
            tokenAmount: tokenAmountNum,
            signature: ammEvent.signature.substring(0, 20) + '...',
            isReasonable
          });
        }
        
        // Log first few trades in detail
        if (ammTradeCount <= 5) {
          console.log(chalk.yellow(`\n🔄 AMM Trade #${ammTradeCount}:`));
          console.log(`  Type: ${ammEvent.tradeType}`);
          console.log(`  SOL Amount: ${solAmountNum.toFixed(6)} SOL`);
          console.log(`  Token Amount: ${tokenAmountNum.toLocaleString()}`);
          console.log(`  Reasonable: ${isReasonable ? chalk.green('✓ YES') : chalk.red('✗ NO - ' + solAmountNum.toFixed(2) + ' SOL')}`);
        }
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring ALL AMM trades for 20 seconds...\n');
    console.log(chalk.gray('AMM Save Threshold: $' + (process.env.AMM_SAVE_THRESHOLD || '1000')));
    console.log(chalk.gray('Note: Trades below threshold won\'t be saved to DB\n'));
    
    // Run for 20 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n📊 Final Results:\n'));
      console.log(`Total AMM Trades Parsed: ${ammTradeCount}`);
      console.log(`Reasonable Amounts: ${reasonableAmounts} (${ammTradeCount > 0 ? (reasonableAmounts/ammTradeCount*100).toFixed(1) : 0}%)`);
      console.log(`Unreasonable Amounts: ${unreasonableAmounts} (${ammTradeCount > 0 ? (unreasonableAmounts/ammTradeCount*100).toFixed(1) : 0}%)`);
      
      if (tradeExamples.length > 0) {
        console.log(chalk.cyan('\n📝 All Trade Examples:'));
        tradeExamples.forEach((ex, i) => {
          console.log(`\n${i + 1}. ${ex.tradeType} - ${ex.signature}`);
          console.log(`   SOL: ${ex.solAmount.toFixed(6)} SOL`);
          console.log(`   Tokens: ${ex.tokenAmount.toLocaleString()}`);
          console.log(`   Status: ${ex.isReasonable ? chalk.green('Reasonable ✓') : chalk.red('Unreasonable ✗ (' + ex.solAmount.toExponential(2) + ' SOL)')}`);
        });
      }
      
      if (ammTradeCount === 0) {
        console.log(chalk.red('\n❌ No AMM trades were parsed'));
      } else if (unreasonableAmounts > reasonableAmounts) {
        console.log(chalk.red('\n❌ Fix NOT working - still seeing unreasonable amounts (billions of SOL)'));
        console.log(chalk.yellow('The instruction data contains slippage parameters, not actual amounts.'));
        console.log(chalk.yellow('We need to extract actual amounts from logs or events.'));
      } else {
        console.log(chalk.green('\n✅ Fix IS working - amounts are now reasonable!'));
      }
      
      process.exit(0);
    }, 20000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);