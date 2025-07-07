#!/usr/bin/env npx tsx

/**
 * Debug AMM Parsing
 * Comprehensive debugging of AMM trade detection
 */

import 'dotenv/config';
import chalk from 'chalk';
import bs58 from 'bs58';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';

async function main() {
  const logger = new Logger({ context: 'AMM-Debug', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🔍 AMM Parsing Debug Tool\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    const parser = await container.resolve('EventParser') as UnifiedEventParser;
    
    // Stats
    let totalTransactions = 0;
    let ammTransactions = 0;
    let ammTradesParsed = 0;
    let bcTradesParsed = 0;
    let parseFailures = 0;
    const ammProgram = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    const bcProgram = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    
    // Sample AMM logs
    const sampleLogs: string[] = [];
    
    // Listen for raw stream data
    eventBus.on(EVENTS.STREAM_DATA, (data) => {
      if (!data?.transaction?.transaction?.transaction) return;
      
      totalTransactions++;
      const tx = data.transaction.transaction.transaction;
      const accounts = tx.message?.accountKeys || [];
      const logs = tx.meta?.logMessages || [];
      
      // Convert account keys to strings
      const accountStrs = accounts.map((acc: any) => 
        typeof acc === 'string' ? acc : bs58.encode(acc)
      );
      
      // Check if it's an AMM transaction
      if (accountStrs.includes(ammProgram)) {
        ammTransactions++;
        
        // Capture first few AMM logs for analysis
        if (sampleLogs.length < 5 && logs.length > 0) {
          sampleLogs.push(`=== AMM Transaction ${sampleLogs.length + 1} ===`);
          sampleLogs.push(`Signature: ${data.transaction.transaction.signature}`);
          sampleLogs.push(`Logs (${logs.length}):`);
          logs.forEach((log: string, i: number) => {
            sampleLogs.push(`  [${i}] ${log}`);
          });
          sampleLogs.push('');
        }
        
        // Try to parse
        try {
          const context = UnifiedEventParser.createContext(data);
          context.programId = ammProgram;
          const event = parser.parse(context);
          
          if (event) {
            const eventType = event.type;
            if (eventType === 'amm_trade' || eventType === 'AMM_TRADE') {
              ammTradesParsed++;
              logger.info('✅ AMM trade parsed successfully', {
                type: event.tradeType,
                mint: event.mintAddress?.substring(0, 8) + '...'
              });
            }
          } else {
            parseFailures++;
            
            // Log why parsing failed
            if (parseFailures <= 3) {
              logger.warn('❌ Failed to parse AMM transaction', {
                hasLogs: logs.length > 0,
                logSample: logs.slice(0, 3),
                accounts: accountStrs.length
              });
            }
          }
        } catch (error) {
          parseFailures++;
          logger.error('Parse error:', error as Error);
        }
      }
      
      // Also check BC trades for comparison
      if (accountStrs.includes(bcProgram)) {
        try {
          const context = UnifiedEventParser.createContext(data);
          context.programId = bcProgram;
          const event = parser.parse(context);
          if (event && (event.type === 'bc_trade' || event.type === 'BC_TRADE')) {
            bcTradesParsed++;
          }
        } catch (error) {
          // Ignore BC parse errors
        }
      }
    });
    
    // Listen for parsed AMM trades
    eventBus.on(EVENTS.AMM_TRADE, (data) => {
      logger.info('🎯 AMM_TRADE event emitted', {
        mint: data.trade.mintAddress.substring(0, 8) + '...',
        type: data.trade.tradeType,
        volume: data.trade.volumeUsd
      });
    });
    
    // Start monitoring
    console.log('Starting monitor to capture AMM transactions...\n');
    
    // Use TradingActivityMonitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    // Status updates
    const statusInterval = setInterval(() => {
      console.log(chalk.gray('\n─'.repeat(60)));
      console.log(chalk.cyan('📊 Debug Stats:'));
      console.log(`Total Transactions: ${totalTransactions}`);
      console.log(`AMM Transactions: ${ammTransactions} (${((ammTransactions/totalTransactions)*100).toFixed(1)}%)`);
      console.log(`AMM Trades Parsed: ${ammTradesParsed} (${ammTransactions > 0 ? ((ammTradesParsed/ammTransactions)*100).toFixed(1) : 0}%)`);
      console.log(`BC Trades Parsed: ${bcTradesParsed}`);
      console.log(`Parse Failures: ${parseFailures}`);
      
      if (ammTransactions > 0 && ammTradesParsed === 0) {
        console.log(chalk.red('\n⚠️ AMM transactions detected but no trades parsed!'));
        console.log('This suggests the parsing logic needs adjustment.');
      }
      
      console.log(chalk.gray('─'.repeat(60)));
    }, 10000);
    
    // Run for 1 minute
    setTimeout(async () => {
      clearInterval(statusInterval);
      
      console.log(chalk.yellow('\n\n🏁 Debug Complete!\n'));
      
      // Show sample logs
      if (sampleLogs.length > 0) {
        console.log(chalk.cyan('Sample AMM Transaction Logs:'));
        console.log(chalk.gray('─'.repeat(60)));
        sampleLogs.forEach(log => console.log(log));
      }
      
      // Final analysis
      console.log(chalk.cyan('\n📋 Analysis:'));
      if (ammTransactions === 0) {
        console.log(chalk.red('❌ No AMM transactions detected'));
        console.log('Possible issues:');
        console.log('1. No AMM activity during test period');
        console.log('2. Subscription not including AMM program');
      } else if (ammTradesParsed === 0) {
        console.log(chalk.red('❌ AMM transactions found but no trades parsed'));
        console.log('Issues:');
        console.log('1. Log format may be different than expected');
        console.log('2. Parsing strategy needs adjustment');
        console.log('3. Check the sample logs above for patterns');
      } else {
        const parseRate = ((ammTradesParsed / ammTransactions) * 100).toFixed(1);
        console.log(chalk.green(`✅ AMM parsing working at ${parseRate}% rate`));
      }
      
      await monitor.stop();
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    logger.error('Debug failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);