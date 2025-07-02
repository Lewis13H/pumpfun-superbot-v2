#!/usr/bin/env tsx
/**
 * Fix specific token graduation status
 */

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';

const MINT_ADDRESS = '7KNGUTSSqwkz5azoFeoESci83MfJC3FwKvV8oeLfpump';

async function fixGraduation() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(chalk.cyan(`🔧 Checking token ${MINT_ADDRESS}...`));
    
    // Get token info
    const tokenResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        graduated_to_amm,
        latest_bonding_curve_progress,
        current_program
      FROM tokens_unified
      WHERE mint_address = $1
    `, [MINT_ADDRESS]);
    
    if (tokenResult.rows.length === 0) {
      console.log(chalk.red('Token not found!'));
      return;
    }
    
    const token = tokenResult.rows[0];
    console.log(chalk.yellow('Current status:'));
    console.log(`  Symbol: ${token.symbol}`);
    console.log(`  Name: ${token.name}`);
    console.log(`  Graduated: ${token.graduated_to_amm}`);
    console.log(`  Progress: ${token.latest_bonding_curve_progress}%`);
    console.log(`  Program: ${token.current_program}`);
    
    if (parseFloat(token.latest_bonding_curve_progress) >= 100 && !token.graduated_to_amm) {
      console.log(chalk.green('\n✅ Token has 100% progress but not marked as graduated. Fixing...'));
      
      // Get the latest trade info for graduation timestamp
      const tradeResult = await pool.query(`
        SELECT MAX(created_at) as graduation_time, MAX(slot) as graduation_slot
        FROM trades_unified
        WHERE mint_address = $1
        AND bonding_curve_progress >= 100
      `, [MINT_ADDRESS]);
      
      const graduationTime = tradeResult.rows[0].graduation_time || new Date();
      const graduationSlot = tradeResult.rows[0].graduation_slot || null;
      
      // Update token status
      await pool.query(`
        UPDATE tokens_unified
        SET 
          graduated_to_amm = true,
          graduation_at = $2,
          graduation_slot = $3,
          current_program = 'amm_pool',
          updated_at = NOW()
        WHERE mint_address = $1
      `, [MINT_ADDRESS, graduationTime, graduationSlot]);
      
      console.log(chalk.green('✅ Token graduation status fixed!'));
      console.log(`  Graduation time: ${graduationTime}`);
      console.log(`  Graduation slot: ${graduationSlot}`);
      
      // Check if there's an AMM pool
      const ammCheck = await pool.query(`
        SELECT COUNT(*) as count
        FROM trades_unified
        WHERE mint_address = $1
        AND program = 'amm_pool'
      `, [MINT_ADDRESS]);
      
      if (ammCheck.rows[0].count === '0') {
        console.log(chalk.yellow('\n⚠️  Note: No AMM trades found. The token may have graduated but the AMM pool might not be active yet.'));
      }
    } else if (token.graduated_to_amm) {
      console.log(chalk.blue('\n✅ Token is already marked as graduated.'));
    } else {
      console.log(chalk.red(`\n❌ Token has not reached 100% progress (${token.latest_bonding_curve_progress}%)`));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run the script
fixGraduation().catch(console.error);