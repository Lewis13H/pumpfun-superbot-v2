#!/usr/bin/env tsx

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function getDatabaseStats() {
  try {
    // Get token statistics
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN graduated_to_amm = true THEN 1 END) as graduated_tokens,
        COUNT(CASE WHEN graduated_to_amm = false THEN 1 END) as bonding_curve_tokens,
        COUNT(CASE WHEN latest_price_usd IS NOT NULL THEN 1 END) as tokens_with_prices,
        COUNT(CASE WHEN latest_market_cap_usd > 10000 THEN 1 END) as above_10k,
        COUNT(CASE WHEN latest_market_cap_usd > 100000 THEN 1 END) as above_100k,
        COUNT(CASE WHEN latest_market_cap_usd > 1000000 THEN 1 END) as above_1m
      FROM tokens_unified
    `);
    
    // Get trade statistics
    const trades = await db.query(`
      SELECT 
        COUNT(*) as total_trades,
        COUNT(DISTINCT mint_address) as tokens_with_trades,
        COUNT(CASE WHEN program = 'bonding_curve' THEN 1 END) as bc_trades,
        COUNT(CASE WHEN program = 'amm_pool' THEN 1 END) as amm_trades
      FROM trades_unified
    `);
    
    // Get date range
    const dateRange = await db.query(`
      SELECT 
        MIN(created_at) as first_token,
        MAX(created_at) as last_token,
        MIN(updated_at) as oldest_update,
        MAX(updated_at) as newest_update
      FROM tokens_unified
    `);
    
    // Get top tokens by market cap
    const topTokens = await db.query(`
      SELECT 
        symbol,
        name,
        latest_market_cap_usd,
        graduated_to_amm
      FROM tokens_unified
      WHERE latest_market_cap_usd IS NOT NULL
      ORDER BY latest_market_cap_usd DESC
      LIMIT 5
    `);
    
    console.log(chalk.cyan.bold('\n📊 Database Token Statistics'));
    console.log(chalk.gray('============================\n'));
    
    console.log(chalk.white.bold('Total Tokens: ') + chalk.green(stats.rows[0].total_tokens));
    console.log('');
    
    console.log(chalk.yellow('By Status:'));
    console.log(chalk.gray('  • Bonding Curve: ') + stats.rows[0].bonding_curve_tokens);
    console.log(chalk.gray('  • Graduated to AMM: ') + stats.rows[0].graduated_tokens);
    console.log('');
    
    console.log(chalk.yellow('By Market Cap:'));
    console.log(chalk.gray('  • Above $10K: ') + stats.rows[0].above_10k);
    console.log(chalk.gray('  • Above $100K: ') + stats.rows[0].above_100k);
    console.log(chalk.gray('  • Above $1M: ') + stats.rows[0].above_1m);
    console.log('');
    
    console.log(chalk.yellow('Price Data:'));
    console.log(chalk.gray('  • Tokens with prices: ') + stats.rows[0].tokens_with_prices);
    console.log('');
    
    console.log(chalk.yellow('Trade Data:'));
    console.log(chalk.gray('  • Total trades: ') + trades.rows[0].total_trades.toLocaleString());
    console.log(chalk.gray('  • Unique tokens traded: ') + trades.rows[0].tokens_with_trades);
    console.log(chalk.gray('  • Bonding curve trades: ') + trades.rows[0].bc_trades.toLocaleString());
    console.log(chalk.gray('  • AMM trades: ') + trades.rows[0].amm_trades.toLocaleString());
    console.log('');
    
    console.log(chalk.yellow('Date Range:'));
    console.log(chalk.gray('  • First token: ') + new Date(dateRange.rows[0].first_token).toLocaleString());
    console.log(chalk.gray('  • Last token: ') + new Date(dateRange.rows[0].last_token).toLocaleString());
    console.log(chalk.gray('  • Newest update: ') + new Date(dateRange.rows[0].newest_update).toLocaleString());
    console.log('');
    
    if (topTokens.rows.length > 0) {
      console.log(chalk.yellow('Top 5 Tokens by Market Cap:'));
      topTokens.rows.forEach((token, i) => {
        const marketCap = parseFloat(token.latest_market_cap_usd);
        const status = token.graduated_to_amm ? chalk.green('AMM') : chalk.blue('BC');
        console.log(chalk.gray(`  ${i + 1}. ${token.symbol || token.name || 'Unknown'}: $${marketCap.toLocaleString()} [${status}]`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('Error getting stats:'), error);
  } finally {
    await db.close();
  }
}

getDatabaseStats();