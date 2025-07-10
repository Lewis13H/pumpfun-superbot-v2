/**
 * Check Dashboard Graduation Display
 * Verifies how graduated tokens appear on dashboard
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import chalk from 'chalk';

async function checkDashboardDisplay() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log(chalk.cyan('📊 Dashboard Graduation Display Check\n'));
    
    // Get all graduated tokens
    const graduatedResult = await pool.query(`
      SELECT 
        mint_address, symbol, name, 
        latest_market_cap_usd, latest_bonding_curve_progress,
        graduated_to_amm, bonding_curve_complete, current_program,
        created_at, updated_at
      FROM tokens_unified
      WHERE graduated_to_amm = true
      ORDER BY latest_market_cap_usd DESC
    `);
    
    console.log(chalk.green(`Found ${graduatedResult.rows.length} graduated tokens:\n`));
    
    for (const token of graduatedResult.rows) {
      console.log(`${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
      console.log(`  Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
      console.log(`  Progress: ${token.latest_bonding_curve_progress}%`);
      console.log(`  BC Complete: ${token.bonding_curve_complete}`);
      console.log(`  Current Program: ${token.current_program}`);
      console.log(`  Created: ${new Date(token.created_at).toLocaleDateString()}`);
      console.log(`  Updated: ${new Date(token.updated_at).toLocaleDateString()}\n`);
    }
    
    // Check tokens that are BC complete but not graduated
    const bcCompleteResult = await pool.query(`
      SELECT 
        mint_address, symbol, name, 
        latest_market_cap_usd, latest_bonding_curve_progress,
        graduated_to_amm, bonding_curve_complete, current_program
      FROM tokens_unified
      WHERE bonding_curve_complete = true
        AND graduated_to_amm = false
      ORDER BY latest_market_cap_usd DESC
      LIMIT 10
    `);
    
    if (bcCompleteResult.rows.length > 0) {
      console.log(chalk.yellow(`\nFound ${bcCompleteResult.rows.length} tokens with BC complete but not graduated:\n`));
      
      for (const token of bcCompleteResult.rows) {
        console.log(`${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
        console.log(`  Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
        console.log(`  Progress: ${token.latest_bonding_curve_progress}%`);
        
        // Check if has AMM trades
        const ammCheck = await pool.query(
          'SELECT COUNT(*) as count FROM trades_unified WHERE mint_address = $1 AND program = $2',
          [token.mint_address, 'amm_pool']
        );
        console.log(`  AMM Trades: ${ammCheck.rows[0].count}`);
        
        if (ammCheck.rows[0].count > 0) {
          console.log(chalk.red('  ⚠️  Has AMM trades but not marked as graduated!'));
        }
        console.log('');
      }
    }
    
    // Check high progress tokens
    const highProgressResult = await pool.query(`
      SELECT 
        mint_address, symbol, name, 
        latest_market_cap_usd, latest_bonding_curve_progress,
        graduated_to_amm, bonding_curve_complete
      FROM tokens_unified
      WHERE graduated_to_amm = false
        AND latest_bonding_curve_progress >= 95
      ORDER BY latest_bonding_curve_progress DESC
      LIMIT 10
    `);
    
    if (highProgressResult.rows.length > 0) {
      console.log(chalk.blue(`\nHigh progress tokens (≥95%) not graduated:\n`));
      
      for (const token of highProgressResult.rows) {
        console.log(`${token.symbol || 'Unknown'} - ${token.latest_bonding_curve_progress}% - $${Number(token.latest_market_cap_usd).toLocaleString()}`);
      }
    }
    
    // Dashboard display rules summary
    console.log(chalk.cyan('\n📋 Dashboard Display Rules:'));
    console.log('- "New Tokens" tab: graduated_to_amm = false');
    console.log('- "Graduated" tab: graduated_to_amm = true');
    console.log('- Progress bar: Shows 100% for graduated tokens');
    console.log('- Progress text: Shows "GRAD" for graduated tokens');
    
    // API endpoint check
    console.log(chalk.cyan('\n🔗 API Endpoints:'));
    console.log('- All tokens: http://localhost:3001/api/tokens');
    console.log('- Graduated only: http://localhost:3001/api/tokens?graduated=true');
    console.log('- New only: http://localhost:3001/api/tokens?graduated=false');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkDashboardDisplay().catch(console.error);