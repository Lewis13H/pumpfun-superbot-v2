#!/usr/bin/env node

/**
 * Fix BADASS token graduation that was missed
 * Token: J4UgvF1kNbZjssk8pMoXVERP2CmGfr8NDwRecmuwpump
 * Pool: 8s1zezd3ELtZGvGV6BEDbBWYLRJVsfi9vCYTnPTCaiVv
 */

import { Pool } from 'pg';
import { configService } from '../core/config';
import chalk from 'chalk';

async function fixBadassGraduation() {
  console.log(chalk.cyan('🔧 Manual Graduation Fix for BADASS\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  try {
    const mintAddress = 'J4UgvF1kNbZjssk8pMoXVERP2CmGfr8NDwRecmuwpump';
    const ammPoolAddress = '8s1zezd3ELtZGvGV6BEDbBWYLRJVsfi9vCYTnPTCaiVv';
    
    console.log(chalk.yellow('Fixing graduation for:'));
    console.log(`  Token: BADASS (${mintAddress})`);
    console.log(`  AMM Pool: ${ammPoolAddress}`);
    
    // First, let's check the current state
    const currentStateResult = await pool.query(`
      SELECT 
        symbol, 
        name,
        graduated_to_amm,
        bonding_curve_complete,
        latest_bonding_curve_progress,
        current_program,
        bonding_curve_key,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE mint_address = $1
    `, [mintAddress]);
    
    if (currentStateResult.rows.length === 0) {
      console.log(chalk.red('❌ Token not found in database'));
      return;
    }
    
    const currentState = currentStateResult.rows[0];
    console.log(chalk.cyan('\nCurrent state:'));
    console.log(`  Symbol: ${currentState.symbol}`);
    console.log(`  Name: ${currentState.name}`);
    console.log(`  Graduated: ${currentState.graduated_to_amm}`);
    console.log(`  BC Complete: ${currentState.bonding_curve_complete}`);
    console.log(`  Progress: ${currentState.latest_bonding_curve_progress}%`);
    console.log(`  Program: ${currentState.current_program}`);
    console.log(`  Market Cap: $${currentState.latest_market_cap_usd}`);
    
    // Update the token to graduated status
    const updateResult = await pool.query(`
      UPDATE tokens_unified
      SET 
        graduated_to_amm = true,
        bonding_curve_complete = true,
        latest_bonding_curve_progress = 100,
        current_program = 'amm_pool',
        graduation_at = NOW(),
        updated_at = NOW()
      WHERE mint_address = $1
      RETURNING symbol, name, latest_market_cap_usd
    `, [mintAddress]);
    
    if (updateResult.rows.length > 0) {
      const token = updateResult.rows[0];
      console.log(chalk.green('\n✅ Successfully updated BADASS:'));
      console.log(`  Symbol: ${token.symbol}`);
      console.log(`  Name: ${token.name}`);
      console.log(`  Status: Graduated to AMM`);
      console.log(`  Market Cap: $${token.latest_market_cap_usd}`);
      
      // Check if bonding curve mapping exists
      if (currentState.bonding_curve_key) {
        const mappingResult = await pool.query(`
          SELECT COUNT(*) as count
          FROM bonding_curve_mappings
          WHERE mint_address = $1
        `, [mintAddress]);
        
        if (mappingResult.rows[0].count === 0) {
          // Insert mapping
          await pool.query(`
            INSERT INTO bonding_curve_mappings (bonding_curve_key, mint_address)
            VALUES ($1, $2)
            ON CONFLICT (bonding_curve_key) DO NOTHING
          `, [currentState.bonding_curve_key, mintAddress]);
          console.log('  Added bonding curve mapping');
        }
      }
      
      // Log graduation event
      console.log(chalk.magenta('\n🎉 Graduation event would be emitted:'));
      console.log(`  Event: TOKEN_GRADUATED`);
      console.log(`  Method: manual_fix`);
      
      console.log(chalk.cyan('\n🔍 Investigating why this was missed:'));
      
      // Check for any pump.fun AMM trades
      const ammTradesResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM trades_unified
        WHERE mint_address = $1 
          AND program = 'amm_pool'
      `, [mintAddress]);
      
      console.log(`  AMM trades in database: ${ammTradesResult.rows[0].count}`);
      
      // Check last BC trade time
      const lastBCTradeResult = await pool.query(`
        SELECT MAX(block_time) as last_trade
        FROM trades_unified
        WHERE mint_address = $1 
          AND program = 'bonding_curve'
      `, [mintAddress]);
      
      if (lastBCTradeResult.rows[0].last_trade) {
        const timeSinceLastBCTrade = Date.now() - new Date(lastBCTradeResult.rows[0].last_trade).getTime();
        console.log(`  Last BC trade: ${Math.floor(timeSinceLastBCTrade / 1000 / 60)} minutes ago`);
      }
      
      if (ammTradesResult.rows[0].count === 0) {
        console.log(chalk.yellow('\n⚠️  No AMM trades captured - possible reasons:'));
        console.log(chalk.yellow('  1. AMM monitor not running or not properly configured'));
        console.log(chalk.yellow('  2. Graduation happened during monitor downtime'));
        console.log(chalk.yellow('  3. Pool creation event was not detected'));
        console.log(chalk.yellow('  4. AMM trade parsing issues'));
      }
      
      // Check if we're monitoring the AMM program
      console.log(chalk.cyan('\n📊 Checking AMM monitoring status:'));
      
      // Check for recent AMM trades for other tokens
      const recentAMMResult = await pool.query(`
        SELECT 
          COUNT(DISTINCT mint_address) as tokens_traded,
          COUNT(*) as total_trades,
          MAX(block_time) as last_trade
        FROM trades_unified
        WHERE program = 'amm_pool'
          AND block_time > NOW() - INTERVAL '1 hour'
      `);
      
      const ammStats = recentAMMResult.rows[0];
      if (ammStats.tokens_traded > 0) {
        console.log(`  AMM trades in last hour: ${ammStats.total_trades}`);
        console.log(`  Tokens traded on AMM: ${ammStats.tokens_traded}`);
        console.log(`  Last AMM trade: ${ammStats.last_trade ? new Date(ammStats.last_trade).toLocaleString() : 'None'}`);
      } else {
        console.log(chalk.red('  ❌ No AMM trades captured in the last hour'));
        console.log(chalk.red('  ❌ AMM monitoring may not be working'));
      }
      
    } else {
      console.log(chalk.red('❌ Failed to update token'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Run fix
fixBadassGraduation().catch(console.error);