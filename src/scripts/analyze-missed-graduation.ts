#!/usr/bin/env node

/**
 * Analyze why BADASS graduation was missed
 * Comprehensive investigation of graduation detection issues
 */

import { Pool } from 'pg';
import { configService } from '../core/config';
import chalk from 'chalk';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PUMP_BC_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

async function analyzeMissedGraduation() {
  console.log(chalk.cyan('🔍 Analyzing Missed Graduation for BADASS\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  try {
    const mintAddress = 'J4UgvF1kNbZjssk8pMoXVERP2CmGfr8NDwRecmuwpump';
    const ammPoolAddress = '8s1zezd3ELtZGvGV6BEDbBWYLRJVsfi9vCYTnPTCaiVv';
    
    console.log(chalk.yellow('Token Information:'));
    console.log(`  Mint: ${mintAddress}`);
    console.log(`  AMM Pool: ${ammPoolAddress}`);
    
    // 1. Check bonding curve status
    console.log(chalk.cyan('\n1. Bonding Curve Analysis:'));
    
    const bcResult = await pool.query(`
      SELECT 
        bonding_curve_key,
        latest_bonding_curve_progress,
        bonding_curve_complete,
        latest_virtual_sol_reserves,
        latest_virtual_token_reserves,
        created_at,
        updated_at
      FROM tokens_unified
      WHERE mint_address = $1
    `, [mintAddress]);
    
    if (bcResult.rows.length > 0) {
      const bc = bcResult.rows[0];
      console.log(`  Bonding Curve Key: ${bc.bonding_curve_key || 'Not set'}`);
      console.log(`  Progress: ${bc.latest_bonding_curve_progress}%`);
      console.log(`  Complete Flag: ${bc.bonding_curve_complete}`);
      console.log(`  Last Updated: ${bc.updated_at}`);
      
      if (bc.latest_bonding_curve_progress < 100) {
        console.log(chalk.red('  ⚠️  Progress shows < 100% but token graduated!'));
        console.log(chalk.yellow('  Possible issues:'));
        console.log('    - Bonding curve account monitor not running');
        console.log('    - Account update missed during graduation');
        console.log('    - Progress calculation issue');
      }
    }
    
    // 2. Check trade history
    console.log(chalk.cyan('\n2. Trade History Analysis:'));
    
    const tradeStatsResult = await pool.query(`
      SELECT 
        program,
        COUNT(*) as trade_count,
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade,
        SUM(volume_usd) as total_volume
      FROM trades_unified
      WHERE mint_address = $1
      GROUP BY program
      ORDER BY program
    `, [mintAddress]);
    
    console.log('  Trade Statistics:');
    for (const stat of tradeStatsResult.rows) {
      console.log(`    ${stat.program}: ${stat.trade_count} trades`);
      console.log(`      First: ${new Date(stat.first_trade).toLocaleString()}`);
      console.log(`      Last: ${new Date(stat.last_trade).toLocaleString()}`);
      console.log(`      Volume: $${parseFloat(stat.total_volume).toFixed(2)}`);
    }
    
    // 3. Check if we're monitoring AMM properly
    console.log(chalk.cyan('\n3. AMM Monitoring Status:'));
    
    const recentAMMResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT mint_address) as unique_tokens,
        COUNT(*) as total_trades,
        MAX(block_time) as last_trade
      FROM trades_unified
      WHERE program = 'amm_pool'
        AND block_time > NOW() - INTERVAL '2 hours'
    `);
    
    const ammStats = recentAMMResult.rows[0];
    console.log(`  AMM Trades (last 2 hours):`);
    console.log(`    Total Trades: ${ammStats.total_trades}`);
    console.log(`    Unique Tokens: ${ammStats.unique_tokens}`);
    console.log(`    Last Trade: ${ammStats.last_trade ? new Date(ammStats.last_trade).toLocaleString() : 'None'}`);
    
    if (ammStats.total_trades === 0) {
      console.log(chalk.red('  ⚠️  No AMM trades captured recently!'));
      console.log(chalk.yellow('  Possible issues:'));
      console.log('    - AMM monitor not running');
      console.log('    - AMM parser not working');
      console.log('    - Network/connection issues');
    }
    
    // 4. Check for pool creation pattern
    console.log(chalk.cyan('\n4. Pool Creation Detection:'));
    
    // Look for the graduation transaction pattern
    const graduationTimeResult = await pool.query(`
      SELECT 
        MAX(block_time) as last_bc_trade,
        MAX(bonding_curve_progress) as max_progress
      FROM trades_unified
      WHERE mint_address = $1 
        AND program = 'bonding_curve'
    `, [mintAddress]);
    
    const lastBCTrade = graduationTimeResult.rows[0].last_bc_trade;
    const maxProgress = graduationTimeResult.rows[0].max_progress;
    
    console.log(`  Last BC Trade: ${lastBCTrade ? new Date(lastBCTrade).toLocaleString() : 'None'}`);
    console.log(`  Max BC Progress: ${maxProgress || 0}%`);
    
    if (lastBCTrade) {
      const timeSinceLastBC = Date.now() - new Date(lastBCTrade).getTime();
      const minutesSince = Math.floor(timeSinceLastBC / 1000 / 60);
      console.log(`  Time since last BC trade: ${minutesSince} minutes`);
      
      if (minutesSince < 30) {
        console.log(chalk.green('  ✓ Recent graduation - pool creation likely happened'));
      }
    }
    
    // 5. Check similar tokens that graduated successfully
    console.log(chalk.cyan('\n5. Successfully Graduated Tokens (for comparison):'));
    
    const successfulGraduationsResult = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.graduation_at,
        COUNT(DISTINCT tr.signature) FILTER (WHERE tr.program = 'amm_pool') as amm_trades
      FROM tokens_unified t
      LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
      WHERE t.graduated_to_amm = true
        AND t.graduation_at > NOW() - INTERVAL '24 hours'
      GROUP BY t.mint_address, t.symbol, t.graduation_at
      ORDER BY t.graduation_at DESC
      LIMIT 5
    `);
    
    if (successfulGraduationsResult.rows.length > 0) {
      console.log('  Recent successful graduations:');
      for (const token of successfulGraduationsResult.rows) {
        console.log(`    ${token.symbol}: ${token.amm_trades} AMM trades captured`);
      }
    } else {
      console.log(chalk.yellow('  No recent graduations found'));
    }
    
    // 6. Recommendations
    console.log(chalk.cyan('\n6. Recommendations:'));
    console.log(chalk.yellow('  To prevent missing future graduations:'));
    console.log('  1. Ensure TokenLifecycleMonitor is running with account monitoring enabled');
    console.log('  2. Ensure TradingActivityMonitor is monitoring AMM program');
    console.log('  3. Consider implementing a dedicated GraduationDetector service');
    console.log('  4. Add periodic check for tokens with AMM pools but not marked graduated');
    console.log('  5. Monitor bonding curve "complete" field more reliably');
    
    // 7. Check if there's a pattern of missed graduations
    console.log(chalk.cyan('\n7. Potentially Missed Graduations:'));
    
    const missedGraduationsResult = await pool.query(`
      SELECT DISTINCT
        t.mint_address,
        t.symbol,
        t.latest_bonding_curve_progress,
        t.graduated_to_amm,
        MAX(tr.block_time) as last_activity
      FROM tokens_unified t
      LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
      WHERE t.graduated_to_amm = false
        AND t.latest_bonding_curve_progress >= 95
      GROUP BY t.mint_address, t.symbol, t.latest_bonding_curve_progress, t.graduated_to_amm
      HAVING MAX(tr.block_time) < NOW() - INTERVAL '30 minutes'
      ORDER BY t.latest_bonding_curve_progress DESC
      LIMIT 10
    `);
    
    if (missedGraduationsResult.rows.length > 0) {
      console.log(chalk.red('  ⚠️  Tokens that might have graduated:'));
      for (const token of missedGraduationsResult.rows) {
        const age = token.last_activity ? 
          Math.floor((Date.now() - new Date(token.last_activity).getTime()) / 1000 / 60 / 60) : 0;
        console.log(`    ${token.symbol}: ${token.latest_bonding_curve_progress}% - Last activity ${age}h ago`);
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run analysis
analyzeMissedGraduation().catch(console.error);