#!/usr/bin/env tsx

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function checkGraduatedToken() {
  const mintAddress = '46dKYuQzaQGQUUwDy72qLW2gLBojv1MQB2EjTgHJpump';
  
  try {
    // Check if token exists
    const tokenResult = await db.query(`
      SELECT * FROM tokens_unified WHERE mint_address = $1
    `, [mintAddress]);
    
    if (tokenResult.rows.length > 0) {
      const token = tokenResult.rows[0];
      console.log(chalk.cyan('\n✅ Token found in database:'));
      console.log(chalk.gray('  Mint: ') + token.mint_address);
      console.log(chalk.gray('  Symbol: ') + (token.symbol || 'Unknown'));
      console.log(chalk.gray('  Graduated: ') + chalk.yellow(token.graduated_to_amm));
      console.log(chalk.gray('  Market Cap: $') + (token.latest_market_cap_usd || 'N/A'));
      console.log(chalk.gray('  Updated: ') + (token.updated_at || 'Never'));
    } else {
      console.log(chalk.red('\n❌ Token NOT found in database'));
      console.log(chalk.yellow('This graduated token was never tracked by our monitors'));
    }
    
    // Check trades
    const tradesResult = await db.query(`
      SELECT 
        COUNT(*) as trade_count, 
        MAX(block_time) as last_trade,
        COUNT(CASE WHEN program = 'bonding_curve' THEN 1 END) as bc_trades,
        COUNT(CASE WHEN program = 'amm_pool' THEN 1 END) as amm_trades
      FROM trades_unified 
      WHERE mint_address = $1
    `, [mintAddress]);
    
    const trades = tradesResult.rows[0];
    console.log(chalk.cyan('\n📊 Trade Statistics:'));
    console.log(chalk.gray('  Total trades: ') + trades.trade_count);
    console.log(chalk.gray('  Bonding curve trades: ') + trades.bc_trades);
    console.log(chalk.gray('  AMM trades: ') + trades.amm_trades);
    console.log(chalk.gray('  Last trade: ') + (trades.last_trade || 'Never'));
    
    // Check ALL graduated tokens
    console.log(chalk.cyan('\n🎓 Checking ALL graduated tokens...'));
    const graduatedResult = await db.query(`
      SELECT 
        COUNT(*) as total_graduated,
        COUNT(CASE WHEN latest_market_cap_usd > 1000 THEN 1 END) as above_1k,
        COUNT(CASE WHEN latest_market_cap_usd > 5000 THEN 1 END) as above_5k,
        COUNT(CASE WHEN latest_market_cap_usd > 10000 THEN 1 END) as above_10k
      FROM tokens_unified
      WHERE graduated_to_amm = true
    `);
    
    const graduated = graduatedResult.rows[0];
    console.log(chalk.gray('  Total graduated tokens: ') + chalk.bold(graduated.total_graduated));
    console.log(chalk.gray('  Above $1k: ') + graduated.above_1k);
    console.log(chalk.gray('  Above $5k: ') + graduated.above_5k);
    console.log(chalk.gray('  Above $10k: ') + graduated.above_10k);
    
    // Check for tokens with high bonding curve progress
    console.log(chalk.cyan('\n🔍 Checking tokens with high bonding curve progress...'));
    const highProgressResult = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.latest_market_cap_usd,
        t.graduated_to_amm,
        MAX(tr.bonding_curve_progress) as max_progress
      FROM tokens_unified t
      JOIN trades_unified tr ON t.mint_address = tr.mint_address
      WHERE tr.bonding_curve_progress > 80
      GROUP BY t.mint_address, t.symbol, t.latest_market_cap_usd, t.graduated_to_amm
      ORDER BY max_progress DESC
      LIMIT 10
    `);
    
    if (highProgressResult.rows.length > 0) {
      console.log(chalk.yellow('\nTokens with >80% bonding curve progress:'));
      highProgressResult.rows.forEach((token, i) => {
        const progress = parseFloat(token.max_progress);
        const graduated = token.graduated_to_amm ? '✅' : '❌';
        console.log(chalk.gray(
          `  ${i + 1}. ${token.symbol || 'Unknown'}: ${progress.toFixed(1)}% ${graduated} - $${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`
        ));
      });
    }
    
    console.log(chalk.yellow('\n⚠️  Conclusion:'));
    console.log(chalk.white('The issue is that graduated tokens are either:'));
    console.log(chalk.gray('1. Never tracked by our monitors (graduated before monitoring started)'));
    console.log(chalk.gray('2. Graduation detection is not working properly'));
    console.log(chalk.gray('3. AMM trades are not updating token prices after graduation'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await db.close();
  }
}

checkGraduatedToken();