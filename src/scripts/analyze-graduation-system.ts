/**
 * Analyze Graduation System
 * Comprehensive analysis of the graduation detection system
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import chalk from 'chalk';

async function analyzeGraduationSystem() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log(chalk.cyan('🔍 Analyzing Graduation System\n'));
    
    // 1. Check the specific token mentioned by user
    const specificToken = 'J4UgvF1kNbZjssk8pMoXVERP2CmGfr8NDwRecmuwpump';
    console.log(chalk.yellow(`1. Checking specific token: ${specificToken}`));
    
    const tokenResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        latest_bonding_curve_progress,
        bonding_curve_complete,
        graduated_to_amm,
        current_program,
        created_at,
        updated_at,
        amm_pool_address,
        graduation_signature,
        graduation_timestamp
      FROM tokens_unified
      WHERE mint_address = $1
    `, [specificToken]);
    
    if (tokenResult.rows.length > 0) {
      const token = tokenResult.rows[0];
      console.log(chalk.green('✓ Token found in database:'));
      console.log(`  Symbol: ${token.symbol || 'Unknown'}`);
      console.log(`  Name: ${token.name || 'Unknown'}`);
      console.log(`  Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
      console.log(`  Progress: ${token.latest_bonding_curve_progress}%`);
      console.log(`  BC Complete: ${token.bonding_curve_complete}`);
      console.log(`  Graduated: ${token.graduated_to_amm}`);
      console.log(`  Current Program: ${token.current_program}`);
      console.log(`  Pool Address: ${token.amm_pool_address || 'Not set'}`);
      console.log(`  Graduation Sig: ${token.graduation_signature || 'Not set'}`);
      console.log(`  Created: ${token.created_at}`);
      console.log(`  Updated: ${token.updated_at}`);
      
      // Check for AMM trades
      const ammTrades = await pool.query(
        'SELECT COUNT(*) as count, MIN(created_at) as first, MAX(created_at) as last FROM trades_unified WHERE mint_address = $1 AND program = $2',
        [specificToken, 'amm_pool']
      );
      console.log(`  AMM Trades: ${ammTrades.rows[0].count}`);
      if (ammTrades.rows[0].count > 0) {
        console.log(`  First AMM Trade: ${ammTrades.rows[0].first}`);
        console.log(`  Last AMM Trade: ${ammTrades.rows[0].last}`);
      }
    } else {
      console.log(chalk.red('✗ Token not found in database'));
    }
    
    // 2. Overall graduation detection analysis
    console.log(chalk.yellow('\n2. Overall Graduation Detection Analysis:'));
    
    const overallStats = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as bc_complete,
        COUNT(*) FILTER (WHERE latest_bonding_curve_progress >= 100) as at_100_percent,
        COUNT(*) FILTER (WHERE current_program = 'amm_pool') as amm_program,
        COUNT(DISTINCT mint_address) FILTER (WHERE mint_address IN (
          SELECT DISTINCT mint_address FROM trades_unified WHERE program = 'amm_pool'
        )) as has_amm_trades
      FROM tokens_unified
    `);
    
    const stats = overallStats.rows[0];
    console.log(`Total tokens: ${stats.total_tokens}`);
    console.log(`Graduated (graduated_to_amm = true): ${stats.graduated}`);
    console.log(`BC Complete (bonding_curve_complete = true): ${stats.bc_complete}`);
    console.log(`At 100% progress: ${stats.at_100_percent}`);
    console.log(`Current program = AMM: ${stats.amm_program}`);
    console.log(`Has AMM trades: ${stats.has_amm_trades}`);
    
    // 3. Find discrepancies
    console.log(chalk.yellow('\n3. Finding Discrepancies:'));
    
    // Tokens with AMM trades but not graduated
    const notGraduatedWithAmm = await pool.query(`
      SELECT t.mint_address, t.symbol, t.graduated_to_amm, COUNT(tr.signature) as amm_trades
      FROM tokens_unified t
      INNER JOIN trades_unified tr ON t.mint_address = tr.mint_address
      WHERE tr.program = 'amm_pool'
        AND (t.graduated_to_amm = false OR t.graduated_to_amm IS NULL)
      GROUP BY t.mint_address, t.symbol, t.graduated_to_amm
    `);
    
    if (notGraduatedWithAmm.rows.length > 0) {
      console.log(chalk.red(`\n⚠️  ${notGraduatedWithAmm.rows.length} tokens have AMM trades but aren't marked as graduated:`));
      for (const token of notGraduatedWithAmm.rows) {
        console.log(`  - ${token.symbol || token.mint_address.slice(0, 8)} (${token.amm_trades} AMM trades)`);
      }
    }
    
    // 4. Recent AMM activity
    console.log(chalk.yellow('\n4. Recent AMM Activity:'));
    
    const recentAmm = await pool.query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(DISTINCT mint_address) as unique_tokens,
        COUNT(*) as trade_count
      FROM trades_unified
      WHERE program = 'amm_pool'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
      LIMIT 10
    `);
    
    console.log('AMM trades in last 24 hours:');
    for (const row of recentAmm.rows) {
      console.log(`  ${row.hour}: ${row.unique_tokens} tokens, ${row.trade_count} trades`);
    }
    
    // 5. Graduation detection recommendations
    console.log(chalk.cyan('\n5. Recommendations:'));
    console.log('✓ Implement dedicated pool creation monitor (monitors create_pool instruction)');
    console.log('✓ Implement BC completion monitor (monitors complete flag via account subscription)');
    console.log('✓ Add periodic reconciliation to catch missed graduations');
    console.log('✓ Track graduation method (pool_creation vs first_amm_trade)');
    console.log('✓ Store pool address and graduation signature for verification');
    
    // 6. Current monitoring status
    console.log(chalk.yellow('\n6. Current Monitoring Status:'));
    
    const monitoringStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM trades_unified WHERE created_at >= NOW() - INTERVAL '1 hour' AND program = 'bonding_curve') as bc_trades_1h,
        (SELECT COUNT(*) FROM trades_unified WHERE created_at >= NOW() - INTERVAL '1 hour' AND program = 'amm_pool') as amm_trades_1h,
        (SELECT COUNT(*) FROM tokens_unified WHERE created_at >= NOW() - INTERVAL '1 hour') as new_tokens_1h,
        (SELECT COUNT(*) FROM tokens_unified WHERE updated_at >= NOW() - INTERVAL '1 hour' AND graduated_to_amm = true) as graduations_1h
    `);
    
    const monitoring = monitoringStats.rows[0];
    console.log(`Last hour activity:`);
    console.log(`  BC trades: ${monitoring.bc_trades_1h}`);
    console.log(`  AMM trades: ${monitoring.amm_trades_1h}`);
    console.log(`  New tokens: ${monitoring.new_tokens_1h}`);
    console.log(`  Graduations: ${monitoring.graduations_1h}`);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

analyzeGraduationSystem().catch(console.error);