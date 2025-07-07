#!/usr/bin/env npx tsx

/**
 * Inspect AMM Trade Amounts
 * Debug why AMM trade amounts are showing as quintillions
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';

async function main() {
  console.log(chalk.cyan('\n🔍 Inspecting AMM Trade Amounts\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // Get some recent AMM trades
    const result = await pool.query(`
      SELECT 
        signature,
        mint_address,
        sol_amount::text as sol_amount,
        token_amount::text as token_amount,
        price_sol,
        price_usd,
        trade_type,
        created_at
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    console.log(chalk.yellow('Recent AMM Trades:\n'));
    
    for (const trade of result.rows) {
      console.log(chalk.cyan(`Trade ${trade.signature.substring(0, 20)}...`));
      console.log(`  Mint: ${trade.mint_address.substring(0, 20)}...`);
      console.log(`  Type: ${trade.trade_type}`);
      console.log(`  SOL Amount: ${trade.sol_amount} (${Number(trade.sol_amount) / 1e9} SOL)`);
      console.log(`  Token Amount: ${trade.token_amount}`);
      console.log(`  Price SOL: ${trade.price_sol}`);
      console.log(`  Price USD: $${trade.price_usd}`);
      console.log(`  Time: ${trade.created_at.toISOString()}`);
      console.log('');
    }
    
    // Analyze the issue
    console.log(chalk.yellow('\nAnalysis:'));
    console.log('The amounts are stored in lamports (1e9) but are extremely large.');
    console.log('This suggests the parsing is using minMaxAmount as actual amount.');
    console.log('minMaxAmount is typically a slippage parameter, not the actual trade amount.\n');
    
    // Check if any trades have reasonable amounts
    const reasonable = await pool.query(`
      SELECT COUNT(*) as count
      FROM trades_unified  
      WHERE program = 'amm_pool'
      AND sol_amount < 1000000000000  -- Less than 1000 SOL
    `);
    
    console.log(`Trades with reasonable SOL amounts: ${reasonable.rows[0].count}`);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);