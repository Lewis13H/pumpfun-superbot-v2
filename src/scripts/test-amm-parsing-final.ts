#!/usr/bin/env npx tsx

/**
 * Final test of AMM trade parsing with inner instructions
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';
import bs58 from 'bs58';

async function main() {
  const logger = new Logger({ context: 'AMMFinalTest', color: chalk.green });
  
  console.log(chalk.cyan('\n🔍 Final Test of AMM Trade Parsing\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    const parser = await container.resolve('EventParser') as UnifiedEventParser;
    
    let ammTradeCount = 0;
    let innerIxAvailable = 0;
    let parsedWithReasonableAmounts = 0;
    const tradeExamples: any[] = [];
    const strategyUsage = new Map<string, number>();
    
    // Listen for parser success events
    eventBus.on('parser:success', (data) => {
      if (data.eventType === 'amm_trade') {
        const strategy = data.strategy;
        strategyUsage.set(strategy, (strategyUsage.get(strategy) || 0) + 1);
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
                       Buffer.isBuffer(acc) ? bs58.encode(acc) : '';
        return accStr.includes('pAMMBay6');
      });
      
      if (!hasAMM) return;
      
      ammTradeCount++;
      
      // Create context with inner instructions
      const context = UnifiedEventParser.createContext(data);
      
      // Check if inner instructions are available
      if (context.innerInstructions && context.innerInstructions.length > 0) {
        innerIxAvailable++;
      }
      
      // Try to parse
      const event = parser.parse(context);
      
      if (event && event.type === 'amm_trade') {
        const ammEvent = event as any;
        const solAmountNum = Number(ammEvent.solAmount) / 1e9;
        const tokenAmountNum = Number(ammEvent.tokenAmount);
        
        // Check if amounts are reasonable (0.001 to 1000 SOL)
        const isReasonable = solAmountNum > 0.001 && solAmountNum < 1000;
        if (isReasonable) {
          parsedWithReasonableAmounts++;
        }
        
        // Collect first 10 examples
        if (tradeExamples.length < 10) {
          tradeExamples.push({
            signature: ammEvent.signature,
            tradeType: ammEvent.tradeType,
            solAmount: solAmountNum,
            tokenAmount: tokenAmountNum,
            userAddress: ammEvent.userAddress,
            tokenMint: ammEvent.mintAddress,
            hasInnerIx: context.innerInstructions?.length > 0,
            isReasonable
          });
        }
        
        // Log first few in detail
        if (ammTradeCount <= 3 && isReasonable) {
          console.log(chalk.green(`\n✅ AMM Trade #${ammTradeCount} (Reasonable):`));
          console.log(`  Signature: ${ammEvent.signature}`);
          console.log(`  Type: ${ammEvent.tradeType}`);
          console.log(`  SOL Amount: ${solAmountNum.toFixed(6)} SOL`);
          console.log(`  Token Amount: ${tokenAmountNum.toLocaleString()}`);
          console.log(`  User: ${ammEvent.userAddress}`);
          console.log(`  Token: ${ammEvent.mintAddress}`);
          console.log(`  Inner Instructions: ${context.innerInstructions?.length || 0} groups`);
        }
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring AMM trades for 30 seconds...\n');
    
    // Run for 30 seconds
    setTimeout(async () => {
      console.log(chalk.yellow('\n\n📊 Final Results:\n'));
      console.log(`Total AMM Trades: ${ammTradeCount}`);
      console.log(`With Inner Instructions: ${innerIxAvailable} (${ammTradeCount > 0 ? (innerIxAvailable/ammTradeCount*100).toFixed(1) : 0}%)`);
      console.log(`Parsed with Reasonable Amounts: ${parsedWithReasonableAmounts} (${ammTradeCount > 0 ? (parsedWithReasonableAmounts/ammTradeCount*100).toFixed(1) : 0}%)`);
      
      console.log(chalk.cyan('\n📊 Strategy Usage:'));
      Array.from(strategyUsage.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([strategy, count]) => {
          console.log(`  ${strategy}: ${count} trades`);
        });
      
      if (tradeExamples.length > 0) {
        console.log(chalk.cyan('\n📝 Trade Examples:'));
        console.log('\nFirst 5 trades for Solscan verification:');
        tradeExamples.slice(0, 5).forEach((ex, i) => {
          console.log(`\n${i + 1}. ${ex.tradeType.toUpperCase()}`);
          console.log(`   Signature: ${ex.signature}`);
          console.log(`   Solscan: https://solscan.io/tx/${ex.signature}`);
          console.log(`   SOL: ${ex.solAmount.toFixed(6)} SOL`);
          console.log(`   Status: ${ex.isReasonable ? chalk.green('✓ Reasonable') : chalk.red('✗ Unreasonable')} ${!ex.isReasonable ? `(${ex.solAmount.toExponential(2)} SOL)` : ''}`);
        });
      }
      
      if (parsedWithReasonableAmounts > ammTradeCount * 0.8) {
        console.log(chalk.green('\n✅ SUCCESS! AMM parsing is now working correctly'));
        console.log(`${parsedWithReasonableAmounts} out of ${ammTradeCount} trades have reasonable amounts`);
      } else if (parsedWithReasonableAmounts > ammTradeCount * 0.5) {
        console.log(chalk.yellow('\n⚠️ PARTIAL SUCCESS'));
        console.log(`${parsedWithReasonableAmounts} out of ${ammTradeCount} trades have reasonable amounts`);
        console.log('Some trades may still need better parsing');
      } else {
        console.log(chalk.red('\n❌ AMM parsing still needs work'));
        console.log(`Only ${parsedWithReasonableAmounts} out of ${ammTradeCount} trades have reasonable amounts`);
      }
      
      // Check database for recent AMM trades
      if (parsedWithReasonableAmounts > 0) {
        console.log(chalk.cyan('\n📊 Checking Database:'));
        const { Pool } = await import('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        
        try {
          const result = await pool.query(`
            SELECT 
              COUNT(*) as count,
              ROUND(AVG(sol_amount::numeric / 1e9)::numeric, 4) as avg_sol,
              ROUND(MIN(sol_amount::numeric / 1e9)::numeric, 4) as min_sol,
              ROUND(MAX(sol_amount::numeric / 1e9)::numeric, 4) as max_sol
            FROM trades_unified 
            WHERE program = 'amm_pool' 
              AND created_at > NOW() - INTERVAL '2 minutes'
              AND sol_amount::numeric / 1e9 < 1000
          `);
          
          const stats = result.rows[0];
          console.log(`\nRecent AMM trades in DB (last 2 min):`);
          console.log(`  Count: ${stats.count}`);
          console.log(`  Avg SOL: ${stats.avg_sol}`);
          console.log(`  Min SOL: ${stats.min_sol}`);
          console.log(`  Max SOL: ${stats.max_sol}`);
        } catch (error) {
          console.error('Database query error:', error);
        } finally {
          await pool.end();
        }
      }
      
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);