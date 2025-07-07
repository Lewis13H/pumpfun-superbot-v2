#!/usr/bin/env npx tsx

/**
 * Test AMM Parsing Fix
 * Verify that AMM trade amounts are now reasonable
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';

async function main() {
  const logger = new Logger({ context: 'AMMParseFix', color: chalk.green });
  
  console.log(chalk.cyan('\n🔍 Testing AMM Parsing Fix\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    let ammTradeCount = 0;
    let reasonableAmounts = 0;
    let unreasonableAmounts = 0;
    const tradeExamples: any[] = [];
    
    // Listen for parsed AMM trades
    eventBus.on(EVENTS.TRADE_PARSED, (trade) => {
      if (trade.program !== 'amm') return;
      
      ammTradeCount++;
      
      const solAmountNum = Number(trade.sol_amount) / 1e9;
      const tokenAmountNum = Number(trade.token_amount);
      
      // Check if amounts are reasonable
      // Reasonable SOL amount: 0.001 - 1000 SOL
      // Unreasonable would be billions of SOL
      const isReasonable = solAmountNum > 0.001 && solAmountNum < 1000;
      
      if (isReasonable) {
        reasonableAmounts++;
      } else {
        unreasonableAmounts++;
      }
      
      // Collect first few examples
      if (tradeExamples.length < 5) {
        tradeExamples.push({
          tradeType: trade.trade_type,
          solAmount: solAmountNum,
          tokenAmount: tokenAmountNum,
          signature: trade.signature.substring(0, 20) + '...',
          isReasonable
        });
      }
      
      // Log first few trades
      if (ammTradeCount <= 3) {
        console.log(chalk.yellow(`\nAMM Trade #${ammTradeCount}:`));
        console.log(`  Type: ${trade.trade_type}`);
        console.log(`  SOL Amount: ${solAmountNum.toFixed(6)} SOL`);
        console.log(`  Token Amount: ${tokenAmountNum.toLocaleString()}`);
        console.log(`  Reasonable: ${isReasonable ? chalk.green('✓') : chalk.red('✗')}`);
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring AMM trades for 30 seconds...\n');
    
    // Run for 30 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n📊 Results:\n'));
      console.log(`Total AMM Trades: ${ammTradeCount}`);
      console.log(`Reasonable Amounts: ${reasonableAmounts} (${(reasonableAmounts/ammTradeCount*100).toFixed(1)}%)`);
      console.log(`Unreasonable Amounts: ${unreasonableAmounts} (${(unreasonableAmounts/ammTradeCount*100).toFixed(1)}%)`);
      
      if (tradeExamples.length > 0) {
        console.log(chalk.cyan('\n📝 Trade Examples:'));
        tradeExamples.forEach((ex, i) => {
          console.log(`\n${i + 1}. ${ex.tradeType} - ${ex.signature}`);
          console.log(`   SOL: ${ex.solAmount.toFixed(6)} SOL`);
          console.log(`   Tokens: ${ex.tokenAmount.toLocaleString()}`);
          console.log(`   Status: ${ex.isReasonable ? chalk.green('Reasonable ✓') : chalk.red('Unreasonable ✗')}`);
        });
      }
      
      if (unreasonableAmounts > reasonableAmounts) {
        console.log(chalk.red('\n❌ Fix not working - still seeing unreasonable amounts'));
      } else {
        console.log(chalk.green('\n✅ Fix appears to be working - amounts are reasonable'));
      }
      
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);