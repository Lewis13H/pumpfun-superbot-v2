#!/usr/bin/env npx tsx

/**
 * Test AMM Inner Instruction Parsing
 * Verify that AMM trade amounts are now correctly parsed from inner instructions
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';

async function main() {
  const logger = new Logger({ context: 'AMMInnerIxTest', color: chalk.magenta });
  
  console.log(chalk.cyan('\n🔍 Testing AMM Inner Instruction Parsing\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    const parser = await container.resolve('EventParser') as UnifiedEventParser;
    
    let ammTradeCount = 0;
    let reasonableAmounts = 0;
    let unreasonableAmounts = 0;
    let parsedByInnerIx = 0;
    const tradeExamples: any[] = [];
    
    // Listen for parser success events to track which strategy worked
    eventBus.on('parser:success', (data) => {
      if (data.eventType === 'amm_trade' && data.strategy === 'AMMTradeInnerIxStrategy') {
        parsedByInnerIx++;
      }
    });
    
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
          console.log(`  Status: ${isReasonable ? chalk.green('✓ REASONABLE') : chalk.red('✗ UNREASONABLE')}`);
          
          // Check if inner instructions were available
          const hasInnerIx = data.transaction?.meta?.innerInstructions?.length > 0;
          console.log(`  Inner Instructions: ${hasInnerIx ? chalk.green('YES') : chalk.yellow('NO')}`);
        }
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring AMM trades with inner instruction parsing for 20 seconds...\n');
    
    // Run for 20 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n📊 Final Results:\n'));
      console.log(`Total AMM Trades Parsed: ${ammTradeCount}`);
      console.log(`Parsed by Inner IX Strategy: ${parsedByInnerIx} (${ammTradeCount > 0 ? (parsedByInnerIx/ammTradeCount*100).toFixed(1) : 0}%)`);
      console.log(`Reasonable Amounts: ${reasonableAmounts} (${ammTradeCount > 0 ? (reasonableAmounts/ammTradeCount*100).toFixed(1) : 0}%)`);
      console.log(`Unreasonable Amounts: ${unreasonableAmounts} (${ammTradeCount > 0 ? (unreasonableAmounts/ammTradeCount*100).toFixed(1) : 0}%)`);
      
      if (tradeExamples.length > 0) {
        console.log(chalk.cyan('\n📝 Trade Examples:'));
        tradeExamples.forEach((ex, i) => {
          console.log(`\n${i + 1}. ${ex.tradeType} - ${ex.signature}`);
          console.log(`   SOL: ${ex.solAmount.toFixed(6)} SOL`);
          console.log(`   Tokens: ${ex.tokenAmount.toLocaleString()}`);
          console.log(`   Status: ${ex.isReasonable ? chalk.green('Reasonable ✓') : chalk.red('Unreasonable ✗')}`);
        });
      }
      
      if (parsedByInnerIx === 0) {
        console.log(chalk.yellow('\n⚠️  No trades were parsed using inner instructions'));
        console.log('This might mean:');
        console.log('- Inner instructions are not included in the gRPC data');
        console.log('- The inner instruction parsing logic needs adjustment');
      } else if (unreasonableAmounts > reasonableAmounts) {
        console.log(chalk.red('\n❌ Still seeing unreasonable amounts'));
        console.log('The inner instruction parsing may need further refinement');
      } else {
        console.log(chalk.green('\n✅ AMM parsing is now working correctly!'));
        console.log('Trade amounts are reasonable and extracted from inner instructions');
      }
      
      process.exit(0);
    }, 20000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);