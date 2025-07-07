#!/usr/bin/env npx tsx

/**
 * Force Graduation Check
 * Manually update tokens that should be graduated
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';

async function main() {
  console.log(chalk.cyan('\n🔧 Force Graduation Check\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // 1. Find tokens at 100% that aren't graduated
    console.log(chalk.yellow('Finding tokens at 100% progress...'));
    const candidateTokens = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_bonding_curve_progress
      FROM tokens_unified
      WHERE latest_bonding_curve_progress >= 99.9
      AND graduated_to_amm = false
      AND bonding_curve_complete = false
    `);
    
    console.log(`Found ${candidateTokens.rows.length} candidate tokens\n`);
    
    if (candidateTokens.rows.length === 0) {
      console.log('No tokens need graduation update');
      return;
    }
    
    // 2. Check if these tokens have AMM activity
    console.log(chalk.yellow('Checking for AMM evidence...'));
    const tokensWithAMM = [];
    
    for (const token of candidateTokens.rows) {
      // Check for AMM trades
      const ammCheck = await pool.query(`
        SELECT COUNT(*) as amm_trades
        FROM trades_unified
        WHERE mint_address = $1
        AND program = 'amm_pool'
      `, [token.mint_address]);
      
      // Check for AMM pool states
      const poolCheck = await pool.query(`
        SELECT COUNT(*) as pool_states
        FROM amm_pool_states
        WHERE mint_address = $1
      `, [token.mint_address]);
      
      const hasAMM = ammCheck.rows[0].amm_trades > 0 || poolCheck.rows[0].pool_states > 0;
      
      if (hasAMM || token.latest_bonding_curve_progress === 100) {
        tokensWithAMM.push({
          ...token,
          amm_trades: ammCheck.rows[0].amm_trades,
          pool_states: poolCheck.rows[0].pool_states
        });
      }
    }
    
    console.log(`\nFound ${tokensWithAMM.length} tokens that should be graduated:`);
    tokensWithAMM.forEach(token => {
      console.log(`- ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)`);
      console.log(`  Progress: ${token.latest_bonding_curve_progress}%`);
      console.log(`  AMM trades: ${token.amm_trades}, Pool states: ${token.pool_states}`);
    });
    
    if (tokensWithAMM.length === 0) {
      console.log(chalk.yellow('\nNo tokens found with AMM evidence'));
      return;
    }
    
    // 3. Ask for confirmation
    console.log(chalk.yellow('\n⚠️  This will mark these tokens as graduated.'));
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 4. Update tokens
    console.log(chalk.yellow('\nUpdating tokens...'));
    
    for (const token of tokensWithAMM) {
      await pool.query(`
        UPDATE tokens_unified
        SET 
          graduated_to_amm = true,
          bonding_curve_complete = true,
          updated_at = NOW()
        WHERE mint_address = $1
      `, [token.mint_address]);
      
      console.log(chalk.green(`✅ Updated ${token.symbol || token.mint_address.substring(0, 8)}`));
    }
    
    console.log(chalk.green(`\n✅ Successfully updated ${tokensWithAMM.length} tokens`));
    
    // 5. Show updated stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE graduated_to_amm = false AND latest_bonding_curve_progress >= 99) as pending
      FROM tokens_unified
    `);
    
    console.log(chalk.cyan('\nUpdated Statistics:'));
    console.log(`Graduated tokens: ${stats.rows[0].graduated}`);
    console.log(`Pending graduation: ${stats.rows[0].pending}`);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);