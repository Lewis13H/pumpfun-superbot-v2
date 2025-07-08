#!/usr/bin/env npx tsx

/**
 * Check if AMM monitoring is working live
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { AMM_PROGRAM } from '../utils/config/constants';
import bs58 from 'bs58';

async function main() {
  const logger = new Logger({ context: 'AMMMonitorCheck', color: chalk.blue });
  
  console.log(chalk.cyan('\n🔍 Checking AMM Monitoring Status\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    let ammTransactionCount = 0;
    let ammTradesParsed = 0;
    let lastAmmTrade: any = null;
    
    // Listen for AMM transactions
    eventBus.on('stream:data', (data) => {
      if (!data?.transaction?.transaction?.transaction) return;
      
      const tx = data.transaction.transaction.transaction;
      const accounts = tx.message?.accountKeys || [];
      const hasAMM = accounts.some((acc: any) => {
        const accStr = typeof acc === 'string' ? acc : 
                       Buffer.isBuffer(acc) ? bs58.encode(acc) : '';
        return accStr.includes('pAMMBay6');
      });
      
      if (hasAMM) {
        ammTransactionCount++;
        const sig = data.transaction.signature ? bs58.encode(data.transaction.signature) : 'unknown';
        console.log(chalk.yellow(`\n🔄 AMM Transaction detected: ${sig.substring(0, 20)}...`));
      }
    });
    
    // Listen for parsed AMM trades
    eventBus.on('AMM_TRADE', (data) => {
      ammTradesParsed++;
      lastAmmTrade = data.trade;
      console.log(chalk.green(`\n✅ AMM Trade parsed:`));
      console.log(`   Type: ${data.trade.tradeType}`);
      console.log(`   SOL: ${(Number(data.trade.solAmount) / 1e9).toFixed(6)}`);
      console.log(`   Token: ${data.trade.mintAddress.substring(0, 8)}...`);
    });
    
    // Start the TradingActivityMonitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring for AMM activity for 60 seconds...\n');
    
    // Check database for recent AMM trades
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    const recentTrades = await pool.query(`
      SELECT 
        COUNT(*) as count,
        MAX(created_at) as latest,
        MIN(created_at) as earliest
      FROM trades_unified 
      WHERE program = 'amm_pool' 
        AND created_at > NOW() - INTERVAL '30 minutes'
    `);
    
    const stats = recentTrades.rows[0];
    console.log(chalk.cyan('📊 Database AMM trades (last 30 min):'));
    console.log(`   Count: ${stats.count}`);
    console.log(`   Latest: ${stats.latest ? new Date(stats.latest).toLocaleTimeString() : 'None'}`);
    console.log(`   Earliest: ${stats.earliest ? new Date(stats.earliest).toLocaleTimeString() : 'None'}`);
    
    await pool.end();
    
    // Run for 60 seconds
    setTimeout(async () => {
      console.log(chalk.yellow('\n\n📊 Final Results:\n'));
      console.log(`AMM Transactions seen: ${ammTransactionCount}`);
      console.log(`AMM Trades parsed: ${ammTradesParsed}`);
      
      if (ammTransactionCount === 0) {
        console.log(chalk.red('\n❌ No AMM transactions detected!'));
        console.log('Possible issues:');
        console.log('- No AMM trading activity on pump.swap');
        console.log('- AMM subscription not working');
        console.log('- Network/connection issues');
      } else if (ammTradesParsed === 0) {
        console.log(chalk.red('\n❌ AMM transactions detected but not parsed!'));
        console.log('This suggests a parser issue.');
      } else {
        console.log(chalk.green('\n✅ AMM monitoring is working correctly'));
        if (lastAmmTrade) {
          console.log(`\nLast trade: ${(Number(lastAmmTrade.solAmount) / 1e9).toFixed(6)} SOL`);
        }
      }
      
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    logger.error('Check failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);