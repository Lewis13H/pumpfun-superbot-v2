#!/usr/bin/env npx tsx

/**
 * Check AMM Activity
 * Comprehensive check of AMM monitoring and database
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';

async function main() {
  console.log(chalk.cyan('\n🔍 Checking AMM Activity\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // 1. Check all trades by program in last 10 minutes
    console.log(chalk.yellow('=== Trades by Program (last 10 minutes) ==='));
    const programStats = await pool.query(`
      SELECT 
        program,
        COUNT(*) as count,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM trades_unified
      WHERE created_at > NOW() - INTERVAL '10 minutes'
      GROUP BY program
      ORDER BY count DESC
    `);
    
    if (programStats.rows.length === 0) {
      console.log(chalk.red('No trades in last 10 minutes!'));
    } else {
      programStats.rows.forEach(row => {
        const age = new Date().getTime() - new Date(row.newest).getTime();
        const ageSeconds = Math.floor(age / 1000);
        console.log(`${row.program}: ${row.count} trades (newest: ${ageSeconds}s ago)`);
      });
    }
    
    // 2. Check for graduated tokens
    console.log(chalk.yellow('\n=== Graduated Tokens ==='));
    const graduatedTokens = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        graduated_to_amm,
        latest_price_usd,
        latest_market_cap_usd,
        latest_bonding_curve_progress
      FROM tokens_unified
      WHERE graduated_to_amm = true
      LIMIT 10
    `);
    
    console.log(`Total graduated tokens: ${graduatedTokens.rows.length}`);
    if (graduatedTokens.rows.length > 0) {
      console.log('\nSample graduated tokens:');
      graduatedTokens.rows.slice(0, 3).forEach(token => {
        console.log(`- ${token.symbol || 'Unknown'}: $${token.latest_price_usd || 0} (${token.mint_address.substring(0, 8)}...)`);
      });
    }
    
    // 3. Check for tokens with 100% progress but not graduated
    console.log(chalk.yellow('\n=== Tokens at 100% Progress ==='));
    const fullProgressTokens = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        graduated_to_amm,
        latest_bonding_curve_progress,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE latest_bonding_curve_progress >= 99.9
      AND graduated_to_amm = false
      LIMIT 10
    `);
    
    if (fullProgressTokens.rows.length > 0) {
      console.log(`Found ${fullProgressTokens.rows.length} tokens at ~100% progress but not graduated`);
      fullProgressTokens.rows.slice(0, 3).forEach(token => {
        console.log(`- ${token.symbol || 'Unknown'}: ${token.latest_bonding_curve_progress}% (${token.mint_address.substring(0, 8)}...)`);
      });
    }
    
    // 4. Check AMM program subscriptions
    console.log(chalk.yellow('\n=== Recent Transaction Programs ==='));
    const recentPrograms = await pool.query(`
      SELECT DISTINCT 
        t.program,
        COUNT(*) as trade_count
      FROM trades_unified t
      WHERE t.created_at > NOW() - INTERVAL '5 minutes'
      GROUP BY t.program
    `);
    
    const ammProgram = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    console.log(`\nExpected AMM program: ${ammProgram}`);
    console.log('Active programs:');
    recentPrograms.rows.forEach(row => {
      console.log(`  ${row.program}: ${row.trade_count} trades`);
    });
    
    // 5. Check for any AMM-related errors
    console.log(chalk.yellow('\n=== Checking for Issues ==='));
    
    // Check if we have any AMM pool data
    const poolCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM amm_pool_states
    `);
    console.log(`AMM pool states: ${poolCount.rows[0].count}`);
    
    // Summary
    console.log(chalk.cyan('\n=== Summary ==='));
    if (programStats.rows.find(r => r.program === 'amm_pool')) {
      console.log(chalk.green('✅ AMM trades are being detected'));
    } else {
      console.log(chalk.red('❌ No AMM trades detected'));
      console.log('\nPossible issues:');
      console.log('1. No tokens have graduated to AMM yet');
      console.log('2. TradingActivityMonitor may not be subscribed to AMM program');
      console.log('3. AMM parsing may be failing');
    }
    
  } catch (error) {
    console.error(chalk.red('Database error:'), error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);