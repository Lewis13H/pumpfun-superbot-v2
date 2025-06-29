#!/usr/bin/env tsx
/**
 * Quick AMM Monitor Test
 * Runs the AMM monitor briefly to verify it's working
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🧪 Quick AMM Monitor Test'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get initial trade count
  const initialResult = await db.query(`
    SELECT COUNT(*) as count
    FROM trades_unified
    WHERE program = 'amm_pool'
      AND block_time > NOW() - INTERVAL '1 hour'
  `);
  
  const initialCount = parseInt(initialResult.rows[0].count);
  console.log(chalk.yellow(`Initial AMM trades (last hour): ${initialCount}`));
  
  // Start the monitor
  console.log(chalk.cyan('\nStarting AMM monitor for 30 seconds...'));
  
  const monitor = spawn('npm', ['run', 'amm-monitor'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  let output = '';
  let errorOutput = '';
  
  monitor.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    
    // Show key events
    if (text.includes('Connected') || text.includes('AMM')) {
      console.log(chalk.green('✓'), text.trim());
    }
    if (text.includes('Buy') || text.includes('Sell')) {
      console.log(chalk.blue('📊'), text.trim());
    }
  });
  
  monitor.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  
  // Run for 30 seconds
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // Stop the monitor
  console.log(chalk.yellow('\nStopping monitor...'));
  monitor.kill('SIGINT');
  
  // Wait a bit for final writes
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check results
  const finalResult = await db.query(`
    SELECT COUNT(*) as count
    FROM trades_unified
    WHERE program = 'amm_pool'
      AND block_time > NOW() - INTERVAL '5 minutes'
  `);
  
  const finalCount = parseInt(finalResult.rows[0].count);
  const newTrades = finalCount - initialCount;
  
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Results:'));
  console.log(chalk.white(`New AMM trades captured: ${newTrades}`));
  
  // Show recent trades
  if (newTrades > 0) {
    const recentTrades = await db.query(`
      SELECT 
        block_time,
        trade_type,
        mint_address,
        price_usd,
        sol_amount::numeric / 1e9 as sol_amount
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY block_time DESC
      LIMIT 5
    `);
    
    console.log(chalk.green('\n✅ Monitor is working! Recent trades:'));
    for (const trade of recentTrades.rows) {
      console.log(
        chalk.gray(new Date(trade.block_time).toLocaleTimeString()),
        trade.trade_type === 'buy' ? chalk.green('BUY') : chalk.red('SELL'),
        chalk.white(`${trade.mint_address.slice(0, 8)}...`),
        chalk.yellow(`$${parseFloat(trade.price_usd).toFixed(8)}`),
        chalk.cyan(`${parseFloat(trade.sol_amount).toFixed(4)} SOL`)
      );
    }
  } else {
    console.log(chalk.yellow('\n⚠️  No trades captured during test period'));
    
    if (output.includes('Connected') || output.includes('Listening')) {
      console.log(chalk.green('✓ Monitor connected successfully'));
      console.log(chalk.yellow('  Possible reasons for no trades:'));
      console.log(chalk.gray('  - Low AMM trading activity'));
      console.log(chalk.gray('  - All activity is on bonding curves'));
      console.log(chalk.gray('  - Need to wait longer'));
    } else {
      console.log(chalk.red('❌ Monitor may have connection issues'));
      if (errorOutput) {
        console.log(chalk.red('\nErrors:'));
        console.log(errorOutput);
      }
    }
  }
  
  // Check AMM account monitor data
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Checking AMM Account Monitor Data:'));
  
  const poolStates = await db.query(`
    SELECT 
      COUNT(DISTINCT pool_address) as pools,
      COUNT(*) FILTER (WHERE virtual_sol_reserves > 0) as with_reserves,
      MAX(created_at) as latest
    FROM amm_pool_states
    WHERE created_at > NOW() - INTERVAL '1 hour'
  `);
  
  const poolData = poolStates.rows[0];
  console.log(chalk.white(`Active pools: ${poolData.pools}`));
  console.log(chalk.white(`With reserves: ${poolData.with_reserves}`));
  console.log(chalk.white(`Latest update: ${poolData.latest ? new Date(poolData.latest).toLocaleTimeString() : 'None'}`));
  
  await db.close();
}

main().catch(console.error);