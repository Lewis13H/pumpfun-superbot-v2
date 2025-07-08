#!/usr/bin/env npx tsx

/**
 * Debug AMM_TRADE event emission
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';

async function main() {
  const logger = new Logger({ context: 'AMMEventDebug', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🔍 Debugging AMM_TRADE Event Emission\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    let bcTradeEvents = 0;
    let ammTradeEvents = 0;
    let tradeProcessedEvents = 0;
    
    // Listen for trade events
    eventBus.on(EVENTS.BC_TRADE, (data) => {
      bcTradeEvents++;
      console.log(chalk.green(`\n✅ BC_TRADE event received:`));
      console.log(`   SOL: ${(Number(data.trade.solAmount) / 1e9).toFixed(6)}`);
      console.log(`   Token: ${data.trade.mintAddress.substring(0, 8)}...`);
    });
    
    eventBus.on(EVENTS.AMM_TRADE, (data) => {
      ammTradeEvents++;
      console.log(chalk.blue(`\n✅ AMM_TRADE event received:`));
      console.log(`   SOL: ${(Number(data.trade.solAmount) / 1e9).toFixed(6)}`);
      console.log(`   Token: ${data.trade.mintAddress.substring(0, 8)}...`);
      console.log(`   Type: ${data.trade.tradeType}`);
    });
    
    eventBus.on(EVENTS.TRADE_PROCESSED, () => {
      tradeProcessedEvents++;
    });
    
    // Start TradingActivityMonitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring for trade events for 30 seconds...\n');
    
    // Check database
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    const dbStats = await pool.query(`
      SELECT 
        program,
        COUNT(*) as count,
        MAX(created_at) as latest
      FROM trades_unified 
      WHERE created_at > NOW() - INTERVAL '10 minutes'
      GROUP BY program
    `);
    
    console.log(chalk.cyan('📊 Database trades (last 10 min):'));
    dbStats.rows.forEach(row => {
      console.log(`   ${row.program}: ${row.count} trades (latest: ${new Date(row.latest).toLocaleTimeString()})`);
    });
    
    await pool.end();
    
    // Run for 30 seconds
    setTimeout(async () => {
      console.log(chalk.yellow('\n\n📊 Event Emission Results:\n'));
      console.log(`BC_TRADE events: ${bcTradeEvents}`);
      console.log(`AMM_TRADE events: ${ammTradeEvents}`);
      console.log(`TRADE_PROCESSED events: ${tradeProcessedEvents}`);
      
      if (ammTradeEvents === 0 && tradeProcessedEvents > 0) {
        console.log(chalk.red('\n❌ AMM trades are being processed but AMM_TRADE events are not being emitted!'));
        console.log('This explains why the counter shows 0.');
      } else if (ammTradeEvents > 0) {
        console.log(chalk.green('\n✅ AMM_TRADE events are being emitted correctly'));
        console.log('The issue might be with the event listener in index.ts');
      }
      
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    logger.error('Debug failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);