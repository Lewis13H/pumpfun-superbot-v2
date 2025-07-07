#!/usr/bin/env npx tsx

/**
 * Debug Graduation Detection
 * Check why tokens at 100% aren't being marked as graduated
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Pool } from 'pg';

async function main() {
  console.log(chalk.cyan('\n🔍 Debugging Graduation Detection\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // 1. Check tokens at 100% progress
    console.log(chalk.yellow('=== Tokens at ~100% Progress ==='));
    const fullProgressTokens = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        graduated_to_amm,
        latest_bonding_curve_progress,
        bonding_curve_complete,
        created_at
      FROM tokens_unified
      WHERE latest_bonding_curve_progress >= 99
      ORDER BY latest_bonding_curve_progress DESC
      LIMIT 20
    `);
    
    console.log(`Found ${fullProgressTokens.rows.length} tokens at ≥99% progress\n`);
    
    let graduatedCount = 0;
    let notGraduatedCount = 0;
    
    fullProgressTokens.rows.forEach(token => {
      const status = token.graduated_to_amm ? 
        chalk.green('✅ GRADUATED') : 
        chalk.red('❌ NOT GRADUATED');
      
      if (token.graduated_to_amm) graduatedCount++;
      else notGraduatedCount++;
      
      console.log(`${status} ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)`);
      console.log(`  Progress: ${token.latest_bonding_curve_progress}%`);
      console.log(`  BC Complete: ${token.bonding_curve_complete ? 'YES' : 'NO'}`);
      console.log(`  Age: ${Math.floor((Date.now() - new Date(token.created_at).getTime()) / 1000 / 60)} minutes`);
      console.log('');
    });
    
    console.log(chalk.cyan(`Summary: ${graduatedCount} graduated, ${notGraduatedCount} not graduated`));
    
    // 2. Check for AMM activity on non-graduated tokens
    console.log(chalk.yellow('\n=== AMM Activity for Non-Graduated Tokens ==='));
    const nonGraduatedWithAMM = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.latest_bonding_curve_progress,
        COUNT(tr.id) as amm_trades
      FROM tokens_unified t
      LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address AND tr.program = 'amm_pool'
      WHERE t.graduated_to_amm = false 
      AND t.latest_bonding_curve_progress >= 99
      GROUP BY t.mint_address, t.symbol, t.latest_bonding_curve_progress
      HAVING COUNT(tr.id) > 0
    `);
    
    if (nonGraduatedWithAMM.rows.length > 0) {
      console.log(chalk.red(`Found ${nonGraduatedWithAMM.rows.length} non-graduated tokens with AMM trades!`));
      nonGraduatedWithAMM.rows.forEach(token => {
        console.log(`- ${token.symbol || 'Unknown'}: ${token.amm_trades} AMM trades`);
      });
    } else {
      console.log('No AMM trades found for non-graduated tokens');
    }
    
    // 3. Check bonding curve mappings
    console.log(chalk.yellow('\n=== Bonding Curve Mappings ==='));
    const bcMappings = await pool.query(`
      SELECT COUNT(DISTINCT bonding_curve_address) as bc_count
      FROM bonding_curve_mappings
    `);
    
    console.log(`Total bonding curve mappings: ${bcMappings.rows[0].bc_count}`);
    
    // 4. Check recent bonding curve complete flags
    console.log(chalk.yellow('\n=== Recent BC Complete Updates ==='));
    const recentCompletes = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        bonding_curve_complete,
        latest_bonding_curve_progress,
        updated_at
      FROM tokens_unified
      WHERE bonding_curve_complete = true
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    
    if (recentCompletes.rows.length > 0) {
      console.log(`Found ${recentCompletes.rows.length} tokens with complete flag:`);
      recentCompletes.rows.forEach(token => {
        const age = Math.floor((Date.now() - new Date(token.updated_at).getTime()) / 1000 / 60);
        console.log(`- ${token.symbol || 'Unknown'}: Updated ${age} minutes ago`);
      });
    } else {
      console.log(chalk.red('No tokens have bonding_curve_complete = true!'));
    }
    
    // 5. Diagnosis
    console.log(chalk.cyan('\n=== Diagnosis ==='));
    
    if (notGraduatedCount > 10) {
      console.log(chalk.red('❌ Major issue: Many tokens at 100% not marked as graduated'));
      console.log('\nPossible causes:');
      console.log('1. Bonding curve account monitoring not working');
      console.log('2. Graduation detection logic not triggering');
      console.log('3. TokenLifecycleMonitor not processing BC complete events');
      console.log('\nRecommended actions:');
      console.log('1. Check if TokenLifecycleMonitor is monitoring BC accounts');
      console.log('2. Run graduation fixer script');
      console.log('3. Check for BC account update events in logs');
    } else if (graduatedCount < 5) {
      console.log(chalk.yellow('⚠️ Very few graduations detected'));
    } else {
      console.log(chalk.green('✅ Graduation detection appears to be working'));
    }
    
  } catch (error) {
    console.error(chalk.red('Database error:'), error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);