#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';

async function checkAMMTokensStatus() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Check total AMM tokens
    const totalResult = await pool.query(`
      SELECT COUNT(*) as total 
      FROM tokens_unified 
      WHERE graduated_to_amm = true
    `);
    console.log(chalk.cyan(`Total AMM tokens: ${totalResult.rows[0].total}`));
    
    // Check AMM tokens with high market caps
    const highMcapResult = await pool.query(`
      SELECT COUNT(*) as total 
      FROM tokens_unified 
      WHERE graduated_to_amm = true 
        AND latest_market_cap_usd > 1000000
    `);
    console.log(chalk.yellow(`AMM tokens with market cap > $1M: ${highMcapResult.rows[0].total}`));
    
    // Check AMM tokens with reserves
    const withReservesResult = await pool.query(`
      SELECT COUNT(*) as total 
      FROM tokens_unified 
      WHERE graduated_to_amm = true 
        AND latest_virtual_sol_reserves IS NOT NULL
        AND latest_virtual_token_reserves IS NOT NULL
    `);
    console.log(chalk.green(`AMM tokens with reserves: ${withReservesResult.rows[0].total}`));
    
    // Show sample of high mcap tokens
    console.log(chalk.cyan('\nSample of high market cap AMM tokens:'));
    const sampleResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        latest_market_cap_usd,
        latest_virtual_sol_reserves,
        latest_virtual_token_reserves
      FROM tokens_unified 
      WHERE graduated_to_amm = true 
        AND latest_market_cap_usd > 1000000
      ORDER BY latest_market_cap_usd DESC
      LIMIT 5
    `);
    
    sampleResult.rows.forEach(token => {
      console.log(chalk.white(`\n${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)`));
      console.log(chalk.gray(`  Market Cap: $${(token.latest_market_cap_usd / 1e6).toFixed(2)}M`));
      console.log(chalk.gray(`  SOL Reserves: ${token.latest_virtual_sol_reserves || 'NULL'}`));
      console.log(chalk.gray(`  Token Reserves: ${token.latest_virtual_token_reserves || 'NULL'}`));
    });
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

checkAMMTokensStatus().catch(console.error);