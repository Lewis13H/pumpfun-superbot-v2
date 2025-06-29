#!/usr/bin/env tsx
/**
 * Test AMM Token Creation
 * Verifies that AMM trades create token entries automatically
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🧪 Testing AMM Token Creation'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get initial counts
  const initialTokens = await db.query(`
    SELECT COUNT(*) as count
    FROM tokens_unified
    WHERE first_program = 'amm_pool'
      AND created_at > NOW() - INTERVAL '1 hour'
  `);
  
  const initialTrades = await db.query(`
    SELECT COUNT(*) as count
    FROM trades_unified
    WHERE program = 'amm_pool'
      AND block_time > NOW() - INTERVAL '1 hour'
  `);
  
  console.log(chalk.yellow(`Initial AMM tokens (last hour): ${initialTokens.rows[0].count}`));
  console.log(chalk.yellow(`Initial AMM trades (last hour): ${initialTrades.rows[0].count}`));
  
  // Start the monitor
  console.log(chalk.cyan('\nStarting AMM monitor for 5 minutes...'));
  
  const monitor = spawn('npm', ['run', 'amm-monitor'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  let createdTokens = [];
  
  monitor.stdout.on('data', (data) => {
    const text = data.toString();
    
    // Show key events
    if (text.includes('Creating new AMM token')) {
      const match = text.match(/Creating new AMM token: ([A-Za-z0-9]+)/);
      if (match) {
        createdTokens.push(match[1]);
        console.log(chalk.green('✅'), text.trim());
      }
    }
    if (text.includes('Connected') || text.includes('Listening')) {
      console.log(chalk.blue('🔗'), text.trim());
    }
  });
  
  monitor.stderr.on('data', (data) => {
    console.error(chalk.red('Error:'), data.toString());
  });
  
  // Run for 5 minutes
  await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
  
  // Stop the monitor
  console.log(chalk.yellow('\nStopping monitor...'));
  monitor.kill('SIGINT');
  
  // Wait a bit for final writes
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Check results
  const finalTokens = await db.query(`
    SELECT COUNT(*) as count
    FROM tokens_unified
    WHERE first_program = 'amm_pool'
      AND created_at > NOW() - INTERVAL '10 minutes'
  `);
  
  const finalTrades = await db.query(`
    SELECT COUNT(*) as count
    FROM trades_unified
    WHERE program = 'amm_pool'
      AND block_time > NOW() - INTERVAL '10 minutes'
  `);
  
  const newTokens = parseInt(finalTokens.rows[0].count) - parseInt(initialTokens.rows[0].count);
  const newTrades = parseInt(finalTrades.rows[0].count) - parseInt(initialTrades.rows[0].count);
  
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Results:'));
  console.log(chalk.white(`New AMM tokens created: ${newTokens}`));
  console.log(chalk.white(`New AMM trades captured: ${newTrades}`));
  console.log(chalk.white(`Tokens created in session: ${createdTokens.length}`));
  
  // Show recently created tokens
  if (newTokens > 0) {
    const recentTokens = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_price_usd,
        t.latest_market_cap_usd,
        t.graduated_to_amm,
        COUNT(tr.signature) as trade_count
      FROM tokens_unified t
      LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
      WHERE t.first_program = 'amm_pool'
        AND t.created_at > NOW() - INTERVAL '10 minutes'
      GROUP BY t.mint_address, t.symbol, t.name, t.latest_price_usd, 
               t.latest_market_cap_usd, t.graduated_to_amm
      ORDER BY t.created_at DESC
      LIMIT 10
    `);
    
    console.log(chalk.green('\n✅ Successfully created AMM tokens:'));
    console.log(chalk.gray('Token                Symbol    Price         Market Cap      Trades  Graduated'));
    console.log(chalk.gray('─'.repeat(80)));
    
    for (const token of recentTokens.rows) {
      console.log(
        chalk.white(`${token.mint_address.slice(0, 12)}...`),
        chalk.cyan((token.symbol || 'N/A').padEnd(10)),
        chalk.yellow(`$${parseFloat(token.latest_price_usd || 0).toFixed(8)}`.padEnd(14)),
        chalk.green(`$${(parseFloat(token.latest_market_cap_usd || 0) / 1000).toFixed(1)}k`.padEnd(15)),
        chalk.blue(token.trade_count.toString().padEnd(7)),
        token.graduated_to_amm ? chalk.green('✓') : chalk.red('✗')
      );
    }
  } else {
    console.log(chalk.yellow('\n⚠️  No new AMM tokens created during test period'));
  }
  
  // Check if created tokens are being tracked
  if (createdTokens.length > 0) {
    console.log(chalk.gray('\n' + '─'.repeat(80)));
    console.log(chalk.cyan('Checking created tokens:'));
    
    for (const mint of createdTokens.slice(0, 5)) {
      const tokenData = await db.query(`
        SELECT 
          symbol,
          name,
          graduated_to_amm,
          latest_price_usd,
          latest_market_cap_usd
        FROM tokens_unified
        WHERE mint_address = $1
      `, [mint]);
      
      if (tokenData.rows.length > 0) {
        const token = tokenData.rows[0];
        console.log(
          chalk.green('✓'),
          chalk.white(`${mint.slice(0, 8)}...`),
          chalk.gray('→'),
          chalk.cyan(token.symbol || 'No symbol'),
          chalk.yellow(`$${parseFloat(token.latest_price_usd || 0).toFixed(8)}`),
          token.graduated_to_amm ? chalk.green('Graduated') : chalk.red('Not graduated')
        );
      } else {
        console.log(chalk.red('✗'), chalk.white(`${mint.slice(0, 8)}... NOT FOUND`));
      }
    }
  }
  
  await db.close();
}

main().catch(console.error);