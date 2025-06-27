#!/usr/bin/env node
/**
 * View tokens saved by the unified monitor
 * Works with the unified database schema
 */

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';

async function viewTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log(chalk.cyan.bold('\n📊 Tokens in Unified Database\n'));

    // Get token count
    const countResult = await pool.query(
      'SELECT COUNT(*) as total, COUNT(threshold_crossed_at) as above_threshold FROM tokens_unified'
    );
    const { total, above_threshold } = countResult.rows[0];
    
    console.log(chalk.white(`Total tokens: ${chalk.green(total)}`));
    console.log(chalk.white(`Above $8,888: ${chalk.yellow(above_threshold)}\n`));

    // Get recent tokens above threshold
    const result = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        first_price_sol,
        first_price_usd,
        first_market_cap_usd,
        threshold_crossed_at,
        graduated_to_amm,
        created_at
      FROM tokens_unified
      WHERE threshold_crossed_at IS NOT NULL
      ORDER BY threshold_crossed_at DESC
      LIMIT 20
    `);

    if (result.rows.length === 0) {
      console.log(chalk.gray('No tokens above threshold found.\n'));
      return;
    }

    console.log(chalk.white.bold('Recent Tokens Above $8,888 Threshold:\n'));

    for (const token of result.rows) {
      console.log(chalk.cyan('━'.repeat(80)));
      console.log(chalk.white.bold(`Token: ${token.symbol || 'Unknown'} (${token.name || 'No name'})`));
      console.log(chalk.gray(`Mint: ${token.mint_address}`));
      console.log();
      
      console.log(chalk.white('First Seen:'));
      console.log(`  Price: ${chalk.green(token.first_price_sol.toFixed(9))} SOL ($${token.first_price_usd.toFixed(4)})`);
      console.log(`  Market Cap: ${chalk.yellow(`$${Number(token.first_market_cap_usd).toLocaleString()}`)}`);
      
      console.log();
      console.log(chalk.white('Status:'));
      console.log(`  Threshold Crossed: ${chalk.green(new Date(token.threshold_crossed_at).toLocaleString())}`);
      console.log(`  Graduated to AMM: ${token.graduated_to_amm ? chalk.green('Yes') : chalk.gray('No')}`);
      console.log(`  First Seen: ${chalk.gray(new Date(token.created_at).toLocaleString())}`);
      console.log();
    }

    // Show trade statistics
    const tradeStats = await pool.query(`
      SELECT 
        program,
        COUNT(*) as trade_count,
        COUNT(DISTINCT mint_address) as unique_tokens
      FROM trades_unified
      GROUP BY program
    `);

    console.log(chalk.cyan('━'.repeat(80)));
    console.log(chalk.white.bold('\n📈 Trade Statistics:\n'));
    
    for (const stat of tradeStats.rows) {
      const programName = stat.program === 'bonding_curve' ? 'Pump.fun' : 'Pump.swap';
      console.log(`${chalk.white(programName)}:`);
      console.log(`  Trades: ${chalk.green(stat.trade_count.toLocaleString())}`);
      console.log(`  Unique Tokens: ${chalk.yellow(stat.unique_tokens.toLocaleString())}`);
      console.log();
    }

  } catch (error) {
    console.error(chalk.red('Error querying database:'), error);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  viewTokens().catch(console.error);
}

export { viewTokens };