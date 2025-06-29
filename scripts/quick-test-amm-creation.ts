#!/usr/bin/env tsx
/**
 * Quick Test AMM Token Creation (1 minute)
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🧪 Quick AMM Token Creation Test (1 minute)'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get baseline
  const baseline = await db.query(`
    SELECT 
      (SELECT COUNT(*) FROM tokens_unified WHERE first_program = 'amm_pool') as amm_tokens,
      (SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND block_time > NOW() - INTERVAL '5 minutes') as recent_trades
  `);
  
  console.log(chalk.yellow(`Baseline AMM tokens: ${baseline.rows[0].amm_tokens}`));
  console.log(chalk.yellow(`Recent AMM trades: ${baseline.rows[0].recent_trades}`));
  
  // Start monitor
  console.log(chalk.cyan('\nStarting AMM monitor...'));
  
  const monitor = spawn('npm', ['run', 'amm-monitor'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  let output = '';
  let tokenCreations = 0;
  let trades = 0;
  
  monitor.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    
    if (text.includes('Creating new AMM token')) {
      tokenCreations++;
      console.log(chalk.green('✅ Token created:'), text.trim());
    }
    if (text.includes('[AMM Buy]') || text.includes('[AMM Sell]')) {
      trades++;
      if (trades <= 5) { // Show first 5 trades
        console.log(chalk.blue('📊'), text.trim());
      }
    }
  });
  
  monitor.stderr.on('data', (data) => {
    console.error(chalk.red('Error:'), data.toString());
  });
  
  // Run for 1 minute
  await new Promise(resolve => setTimeout(resolve, 60000));
  
  // Stop monitor
  console.log(chalk.yellow('\nStopping monitor...'));
  monitor.kill('SIGINT');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check results
  const final = await db.query(`
    SELECT 
      (SELECT COUNT(*) FROM tokens_unified WHERE first_program = 'amm_pool') as amm_tokens,
      (SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND block_time > NOW() - INTERVAL '2 minutes') as recent_trades
  `);
  
  const newTokens = parseInt(final.rows[0].amm_tokens) - parseInt(baseline.rows[0].amm_tokens);
  
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Results:'));
  console.log(chalk.white(`New AMM tokens in DB: ${newTokens}`));
  console.log(chalk.white(`Token creations logged: ${tokenCreations}`));
  console.log(chalk.white(`Trades captured: ${trades}`));
  
  if (tokenCreations > 0 && newTokens === 0) {
    console.log(chalk.red('\n❌ Tokens were created but not saved to DB!'));
  } else if (newTokens > 0) {
    console.log(chalk.green('\n✅ AMM token creation is working!'));
    
    // Show newest tokens
    const newest = await db.query(`
      SELECT mint_address, symbol, name, latest_price_usd, graduated_to_amm
      FROM tokens_unified
      WHERE first_program = 'amm_pool'
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    console.log(chalk.gray('\nNewest AMM tokens:'));
    for (const token of newest.rows) {
      console.log(
        chalk.white(`• ${token.mint_address.slice(0, 8)}...`),
        chalk.cyan(token.symbol || 'No symbol'),
        chalk.yellow(`$${parseFloat(token.latest_price_usd || 0).toFixed(8)}`),
        token.graduated_to_amm ? chalk.green('✓') : chalk.red('✗')
      );
    }
  } else if (trades === 0) {
    console.log(chalk.yellow('\n⚠️  No AMM trades captured - low activity period'));
  } else {
    console.log(chalk.yellow('\n⚠️  Trades captured but no new tokens (all existing tokens)'));
  }
  
  await db.close();
}

main().catch(console.error);