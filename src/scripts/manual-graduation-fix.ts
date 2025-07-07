#!/usr/bin/env node

/**
 * Manually fix ALPACU graduation based on Solscan evidence
 */

import { Pool } from 'pg';
import { configService } from '../core/config';
import chalk from 'chalk';

async function manualGraduationFix() {
  console.log(chalk.cyan('🔧 Manual Graduation Fix for ALPACU\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  try {
    // ALPACU graduated to Pump.fun AMM at 2025-07-07 12:48:15 UTC
    const mintAddress = 'B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump';
    const ammPoolAddress = 'HHJRicsGhSec8vkLDgQtSb5cVx2oVspuWE98wL56rSgB';
    const graduationTime = '2025-07-07 12:48:15+00';
    
    console.log(chalk.yellow('Evidence from Solscan:'));
    console.log(`  Token: ALPACU (${mintAddress})`);
    console.log(`  AMM Pool: ${ammPoolAddress}`);
    console.log(`  Graduation Time: ${graduationTime}`);
    console.log(`  Pool Type: Pump.fun AMM (ALPACU-WSOL) Market`);
    
    // Update the token
    const updateResult = await pool.query(`
      UPDATE tokens_unified
      SET 
        graduated_to_amm = true,
        bonding_curve_complete = true,
        latest_bonding_curve_progress = 100,
        current_program = 'amm_pool',
        updated_at = NOW()
      WHERE mint_address = $1
      RETURNING symbol, bonding_curve_key
    `, [mintAddress]);
    
    if (updateResult.rows.length > 0) {
      const token = updateResult.rows[0];
      console.log(chalk.green('\n✅ Successfully updated ALPACU:'));
      console.log(`  Symbol: ${token.symbol}`);
      console.log(`  Bonding Curve: ${token.bonding_curve_key}`);
      console.log(`  Status: Graduated to AMM`);
      
      // Check if bonding curve mapping exists
      const mappingResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM bonding_curve_mappings
        WHERE mint = $1
      `, [mintAddress]);
      
      if (mappingResult.rows[0].count === 0 && token.bonding_curve_key) {
        // Insert mapping
        await pool.query(`
          INSERT INTO bonding_curve_mappings (bonding_curve, mint)
          VALUES ($1, $2)
          ON CONFLICT (bonding_curve) DO NOTHING
        `, [token.bonding_curve_key, mintAddress]);
        console.log('  Added bonding curve mapping');
      }
      
      // Let's also check why we might have missed this
      console.log(chalk.cyan('\n🔍 Investigating why this was missed:'));
      
      // Check for any pump.fun AMM trades
      const ammTradesResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM trades_unified
        WHERE mint_address = $1 
          AND program = 'amm_pool'
      `, [mintAddress]);
      
      console.log(`  AMM trades in database: ${ammTradesResult.rows[0].count}`);
      
      if (ammTradesResult.rows[0].count === 0) {
        console.log(chalk.yellow('  ⚠️  No AMM trades captured - monitors may not be running'));
        console.log(chalk.yellow('  ⚠️  Or graduation happened during monitor downtime'));
      }
      
    } else {
      console.log(chalk.red('❌ Token not found in database'));
    }
    
    // Check other tokens that might have graduated
    console.log(chalk.cyan('\n📊 Checking for other potential graduations:'));
    
    const potentialGraduationsResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        latest_bonding_curve_progress,
        created_at
      FROM tokens_unified
      WHERE graduated_to_amm = false
        AND latest_bonding_curve_progress >= 90
      ORDER BY latest_bonding_curve_progress DESC
      LIMIT 5
    `);
    
    if (potentialGraduationsResult.rows.length > 0) {
      console.log('\nTokens near graduation (90%+):');
      for (const token of potentialGraduationsResult.rows) {
        const age = Math.floor((Date.now() - new Date(token.created_at).getTime()) / 1000 / 60);
        console.log(`  ${token.symbol || 'Unknown'} - ${token.latest_bonding_curve_progress}% - Age: ${age}m`);
      }
      
      console.log(chalk.yellow('\n💡 These tokens should be monitored closely for graduation'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run fix
manualGraduationFix().catch(console.error);