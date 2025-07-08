#!/usr/bin/env npx tsx

/**
 * Test AMM Inner Instruction Parsing with the updated context
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';

async function main() {
  const logger = new Logger({ context: 'AMMInnerIxTest', color: chalk.magenta });
  
  console.log(chalk.cyan('\n🔍 Testing AMM Inner Instruction Parsing with Updated Context\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    const parser = await container.resolve('EventParser') as UnifiedEventParser;
    
    let ammTradeCount = 0;
    let parsedByInnerIx = 0;
    let innerIxAvailable = 0;
    const tradeExamples: any[] = [];
    const strategyUsage = new Map<string, number>();
    
    // Listen for parser success events to track which strategy worked
    eventBus.on('parser:success', (data) => {
      if (data.eventType === 'amm_trade') {
        const strategy = data.strategy;
        strategyUsage.set(strategy, (strategyUsage.get(strategy) || 0) + 1);
        if (strategy === 'AMMTradeInnerIxStrategy') {
          parsedByInnerIx++;
        }
      }
    });
    
    // Listen for raw stream data
    eventBus.on('stream:data', (data) => {
      if (!data?.transaction?.transaction?.transaction) return;
      
      // Check if this is an AMM transaction
      const tx = data.transaction.transaction.transaction;
      const accounts = tx.message?.accountKeys || [];
      const hasAMM = accounts.some((acc: any) => {
        const accStr = typeof acc === 'string' ? acc : 
                       Buffer.isBuffer(acc) ? require('bs58').encode(acc) : '';
        return accStr.includes('pAMMBay6');
      });
      
      if (!hasAMM) return;
      
      ammTradeCount++;
      
      // Create context with inner instructions
      const context = UnifiedEventParser.createContext(data);
      
      // Check if inner instructions are available
      if (context.innerInstructions && context.innerInstructions.length > 0) {
        innerIxAvailable++;
        
        if (ammTradeCount <= 5) {
          console.log(chalk.green(`\n✅ AMM Trade #${ammTradeCount} has ${context.innerInstructions.length} inner instruction groups`));
          context.innerInstructions.forEach((group: any, i: number) => {
            console.log(`  Group ${i}: index=${group.index}, instructions=${group.instructions?.length || 0}`);
          });
        }
      }
      
      // Try to parse
      const event = parser.parse(context);
      
      if (event && event.type === 'amm_trade') {
        const ammEvent = event as any;
        const solAmountNum = Number(ammEvent.solAmount) / 1e9;
        const tokenAmountNum = Number(ammEvent.tokenAmount);
        
        // Collect examples
        if (tradeExamples.length < 10) {
          tradeExamples.push({
            tradeType: ammEvent.tradeType,
            solAmount: solAmountNum,
            tokenAmount: tokenAmountNum,
            signature: ammEvent.signature.substring(0, 20) + '...',
            hasInnerIx: context.innerInstructions?.length > 0,
            innerIxCount: context.innerInstructions?.length || 0
          });
        }
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring AMM trades with inner instruction support for 30 seconds...\n');
    
    // Run for 30 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n📊 Final Results:\n'));
      console.log(`Total AMM Trades: ${ammTradeCount}`);
      console.log(`AMM Trades with Inner Instructions: ${innerIxAvailable} (${ammTradeCount > 0 ? (innerIxAvailable/ammTradeCount*100).toFixed(1) : 0}%)`);
      console.log(`Parsed by Inner IX Strategy: ${parsedByInnerIx} (${ammTradeCount > 0 ? (parsedByInnerIx/ammTradeCount*100).toFixed(1) : 0}%)`);
      
      console.log(chalk.cyan('\n📊 Strategy Usage:'));
      Array.from(strategyUsage.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([strategy, count]) => {
          console.log(`  ${strategy}: ${count} trades`);
        });
      
      if (tradeExamples.length > 0) {
        console.log(chalk.cyan('\n📝 Trade Examples:'));
        tradeExamples.forEach((ex, i) => {
          console.log(`\n${i + 1}. ${ex.tradeType} - ${ex.signature}`);
          console.log(`   SOL: ${ex.solAmount.toFixed(6)} SOL`);
          console.log(`   Tokens: ${ex.tokenAmount.toLocaleString()}`);
          console.log(`   Inner Instructions: ${ex.hasInnerIx ? chalk.green(`Yes (${ex.innerIxCount} groups)`) : chalk.red('No')}`);
        });
      }
      
      if (parsedByInnerIx > 0) {
        console.log(chalk.green('\n✅ Inner instruction parsing is working!'));
        console.log(`${parsedByInnerIx} trades parsed with actual amounts from inner instructions`);
      } else if (innerIxAvailable > 0) {
        console.log(chalk.yellow('\n⚠️ Inner instructions are available but not being parsed'));
        console.log('The AMMTradeInnerIxStrategy may need adjustment');
      } else {
        console.log(chalk.red('\n❌ No inner instructions available for AMM trades'));
      }
      
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);