#!/usr/bin/env npx tsx

/**
 * Test AMM Heuristic Parsing
 * Verify that AMM trade amounts are now reasonable using heuristics
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';

async function main() {
  const logger = new Logger({ context: 'AMMHeuristicTest', color: chalk.green });
  
  console.log(chalk.cyan('\n🔍 Testing AMM Heuristic Parsing\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    const parser = await container.resolve('EventParser') as UnifiedEventParser;
    
    let ammTradeCount = 0;
    let reasonableAmounts = 0;
    let unreasonableAmounts = 0;
    let parsedByHeuristic = 0;
    const tradeExamples: any[] = [];
    const strategyUsage = new Map<string, number>();
    
    // Listen for parser success events to track which strategy worked
    eventBus.on('parser:success', (data) => {
      if (data.eventType === 'amm_trade') {
        const strategy = data.strategy;
        strategyUsage.set(strategy, (strategyUsage.get(strategy) || 0) + 1);
        if (strategy === 'AMMTradeHeuristicStrategy') {
          parsedByHeuristic++;
        }
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
          console.log(`  Status: ${isReasonable ? chalk.green('✓ REASONABLE') : chalk.red(`✗ UNREASONABLE (${solAmountNum.toExponential(2)} SOL)`)}`);
        }
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Testing AMM heuristic parsing for 20 seconds...\n');
    
    // Run for 20 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n📊 Final Results:\n'));
      console.log(`Total AMM Trades Parsed: ${ammTradeCount}`);
      console.log(`Parsed by Heuristic Strategy: ${parsedByHeuristic} (${ammTradeCount > 0 ? (parsedByHeuristic/ammTradeCount*100).toFixed(1) : 0}%)`);
      console.log(`Reasonable Amounts: ${reasonableAmounts} (${ammTradeCount > 0 ? (reasonableAmounts/ammTradeCount*100).toFixed(1) : 0}%)`);
      console.log(`Unreasonable Amounts: ${unreasonableAmounts} (${ammTradeCount > 0 ? (unreasonableAmounts/ammTradeCount*100).toFixed(1) : 0}%)`);
      
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
          console.log(`   Status: ${ex.isReasonable ? chalk.green('Reasonable ✓') : chalk.red('Unreasonable ✗')}`);
        });
      }
      
      if (reasonableAmounts > unreasonableAmounts) {
        console.log(chalk.green('\n✅ Heuristic parsing is working!'));
        console.log('Most trade amounts are now reasonable');
      } else if (parsedByHeuristic > 0) {
        console.log(chalk.yellow('\n⚠️  Heuristic parsing needs refinement'));
        console.log('Some trades are still showing unreasonable amounts');
      } else {
        console.log(chalk.red('\n❌ Heuristic strategy is not being used'));
        console.log('Check if it\'s being bypassed by other strategies');
      }
      
      process.exit(0);
    }, 20000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);