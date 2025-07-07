#!/usr/bin/env npx tsx

/**
 * Check AMM System Status
 * Comprehensive check of AMM monitoring system
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';

async function main() {
  console.log(chalk.cyan('\n🔍 AMM System Status Check\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // 1. Check recent trades by program
    console.log(chalk.yellow('=== Recent Trades (last 5 minutes) ==='));
    const recentTrades = await pool.query(`
      SELECT 
        program,
        COUNT(*) as count,
        MAX(created_at) as latest
      FROM trades_unified
      WHERE created_at > NOW() - INTERVAL '5 minutes'
      GROUP BY program
      ORDER BY count DESC
    `);
    
    if (recentTrades.rows.length === 0) {
      console.log(chalk.red('No trades in last 5 minutes!'));
    } else {
      recentTrades.rows.forEach(row => {
        const age = Math.floor((Date.now() - new Date(row.latest).getTime()) / 1000);
        console.log(`${row.program}: ${row.count} trades (latest: ${age}s ago)`);
      });
    }
    
    // 2. Check specific AMM trades
    console.log(chalk.yellow('\n=== AMM Trade Details ==='));
    const ammTrades = await pool.query(`
      SELECT 
        signature,
        mint_address,
        trade_type,
        sol_amount::text,
        token_amount::text,
        virtual_sol_reserves::text,
        virtual_token_reserves::text,
        created_at
      FROM trades_unified
      WHERE program = 'amm_pool'
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    console.log(`Total AMM trades found: ${ammTrades.rows.length}`);
    if (ammTrades.rows.length > 0) {
      ammTrades.rows.forEach((trade, i) => {
        console.log(chalk.green(`\nAMM Trade #${i + 1}:`));
        console.log(`  Signature: ${trade.signature.substring(0, 20)}...`);
        console.log(`  Type: ${trade.trade_type}`);
        console.log(`  SOL: ${trade.sol_amount}`);
        console.log(`  Token: ${trade.token_amount}`);
        console.log(`  Reserves: SOL=${trade.virtual_sol_reserves || 'NULL'}, Token=${trade.virtual_token_reserves || 'NULL'}`);
      });
    }
    
    // 3. Check graduations
    console.log(chalk.yellow('\n=== Graduations Status ==='));
    const graduationStats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE graduated_to_amm = false AND latest_bonding_curve_progress >= 99) as ready,
        COUNT(*) FILTER (WHERE graduated_to_amm = false AND latest_bonding_curve_progress >= 90) as close
      FROM tokens_unified
    `);
    
    const stats = graduationStats.rows[0];
    console.log(`Graduated tokens: ${stats.graduated}`);
    console.log(`Ready to graduate (≥99%): ${stats.ready}`);
    console.log(`Close to graduation (≥90%): ${stats.close}`);
    
    // 4. Check AMM pool states
    console.log(chalk.yellow('\n=== AMM Pool States ==='));
    const poolStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT pool_address) as pools,
        COUNT(DISTINCT token_mint) as tokens,
        MAX(last_updated) as latest_update
      FROM amm_pool_states
    `);
    
    const poolData = poolStats.rows[0];
    console.log(`Total pools: ${poolData.pools}`);
    console.log(`Total tokens: ${poolData.tokens}`);
    if (poolData.latest_update) {
      const age = Math.floor((Date.now() - new Date(poolData.latest_update).getTime()) / 1000 / 60);
      console.log(`Latest update: ${age} minutes ago`);
    }
    
    // 5. Check for parsing errors
    console.log(chalk.yellow('\n=== Potential Issues ==='));
    
    // Check for trades with extreme values
    const extremeTrades = await pool.query(`
      SELECT COUNT(*) as count
      FROM trades_unified
      WHERE program = 'amm_pool'
      AND (sol_amount > 1000000000000000 OR token_amount > 1000000000000000000)
    `);
    
    if (extremeTrades.rows[0].count > 0) {
      console.log(chalk.yellow(`⚠️ ${extremeTrades.rows[0].count} AMM trades with extreme values (might be parsing issues)`));
    }
    
    // Summary
    console.log(chalk.cyan('\n=== Summary ==='));
    const bcCount = recentTrades.rows.find(r => r.program === 'bonding_curve')?.count || 0;
    const ammCount = recentTrades.rows.find(r => r.program === 'amm_pool')?.count || 0;
    
    if (ammCount === 0 && bcCount > 0) {
      console.log(chalk.red('❌ No AMM trades despite BC activity'));
      console.log('\nPossible causes:');
      console.log('1. No tokens have graduated yet');
      console.log('2. AMM parsing is failing');
      console.log('3. Database writes are failing');
    } else if (ammCount > 0) {
      const ratio = ((ammCount / (bcCount + ammCount)) * 100).toFixed(1);
      console.log(chalk.green(`✅ AMM trades detected: ${ammCount} (${ratio}% of total)`));
    } else {
      console.log(chalk.yellow('⚠️ No trading activity detected'));
    }
    
  } catch (error) {
    console.error(chalk.red('Database error:'), error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);