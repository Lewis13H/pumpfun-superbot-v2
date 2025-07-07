#!/usr/bin/env node

/**
 * Check for recent graduations that we might have missed
 */

import { Pool } from 'pg';
import { configService } from '../core/config';
import chalk from 'chalk';

async function checkRecentGraduations() {
  console.log(chalk.cyan('🔍 Checking for Recent Graduations\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  try {
    // Check tokens that were investigated earlier
    const tokensToCheck = [
      { mint: '4UfTYHPXA1JKnG2mi6eQPv3s5vhiVP358Ko9MDxxpump', symbol: 'parallax' },
      { mint: 'B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump', symbol: 'ALPACU' },
      { mint: 'BgoBs6JQDU1fZqiheJX2aWFj9XvtWtu8755uhVvNpump', symbol: 'CoW3' }
    ];
    
    for (const token of tokensToCheck) {
      console.log(chalk.yellow(`\nChecking ${token.symbol} (${token.mint}):`));
      console.log('='.repeat(60));
      
      // 1. Check current database state
      const dbResult = await pool.query(`
        SELECT 
          graduated_to_amm,
          bonding_curve_complete,
          latest_bonding_curve_progress,
          updated_at
        FROM tokens_unified
        WHERE mint_address = $1
      `, [token.mint]);
      
      if (dbResult.rows.length > 0) {
        const row = dbResult.rows[0];
        console.log(chalk.cyan('Current DB State:'));
        console.log(`  Graduated: ${row.graduated_to_amm}`);
        console.log(`  Complete: ${row.bonding_curve_complete}`);
        console.log(`  Progress: ${row.latest_bonding_curve_progress}%`);
        console.log(`  Last Update: ${new Date(row.updated_at).toISOString()}`);
      }
      
      // 2. Check for ANY AMM trades (not just pump.fun AMM)
      const ammTradesResult = await pool.query(`
        SELECT 
          COUNT(*) as count,
          MIN(block_time) as first_trade,
          MAX(block_time) as last_trade
        FROM trades_unified
        WHERE mint_address = $1 
          AND program = 'amm_pool'
      `, [token.mint]);
      
      const trades = ammTradesResult.rows[0];
      console.log(chalk.cyan('\nAMM Trading Activity:'));
      console.log(`  Total AMM trades: ${trades.count}`);
      
      if (trades.count > 0) {
        console.log(`  First AMM trade: ${new Date(trades.first_trade).toISOString()}`);
        console.log(`  Last AMM trade: ${new Date(trades.last_trade).toISOString()}`);
        console.log(chalk.green('  ✅ Token IS trading on AMM!'));
        
        // Check if we need to update graduation status
        if (!dbResult.rows[0]?.graduated_to_amm) {
          console.log(chalk.red('  ❌ But graduated_to_amm is FALSE - needs fixing!'));
        }
      } else {
        console.log(chalk.gray('  No AMM trades found'));
      }
      
      // 3. Check recent trades to see activity pattern
      const recentTradesResult = await pool.query(`
        SELECT 
          program,
          COUNT(*) as count,
          MAX(block_time) as last_trade
        FROM trades_unified
        WHERE mint_address = $1
          AND block_time > NOW() - INTERVAL '1 hour'
        GROUP BY program
        ORDER BY last_trade DESC
      `, [token.mint]);
      
      if (recentTradesResult.rows.length > 0) {
        console.log(chalk.cyan('\nRecent Trading (last hour):'));
        for (const activity of recentTradesResult.rows) {
          const lastTrade = new Date(activity.last_trade);
          const minutesAgo = Math.floor((Date.now() - lastTrade.getTime()) / 1000 / 60);
          console.log(`  ${activity.program}: ${activity.count} trades (last ${minutesAgo}m ago)`);
        }
      }
    }
    
    // 4. Check for ANY recent graduations system-wide
    console.log(chalk.cyan('\n\n📊 System-wide Graduation Check:'));
    
    const recentGraduationsResult = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.graduated_to_amm,
        t.bonding_curve_complete,
        MIN(tr.block_time) as first_amm_trade
      FROM tokens_unified t
      INNER JOIN trades_unified tr ON t.mint_address = tr.mint_address
      WHERE tr.program = 'amm_pool'
        AND tr.block_time > NOW() - INTERVAL '30 minutes'
        AND t.graduated_to_amm = false
      GROUP BY t.mint_address, t.symbol, t.graduated_to_amm, t.bonding_curve_complete
      ORDER BY first_amm_trade DESC
      LIMIT 10
    `);
    
    if (recentGraduationsResult.rows.length > 0) {
      console.log(chalk.yellow(`\n⚠️  Found ${recentGraduationsResult.rows.length} tokens with recent AMM trades but not marked as graduated:`));
      
      for (const token of recentGraduationsResult.rows) {
        const minutesAgo = Math.floor((Date.now() - new Date(token.first_amm_trade).getTime()) / 1000 / 60);
        console.log(`  ${token.symbol || 'Unknown'} - First AMM trade ${minutesAgo}m ago`);
      }
      
      console.log(chalk.green('\n💡 Fix: Run the graduation fixer to update these:'));
      console.log('  npx tsx src/scripts/fix-graduated-tokens.ts');
    } else {
      console.log(chalk.green('  ✅ All recent AMM trading tokens are properly marked as graduated'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run check
checkRecentGraduations().catch(console.error);