/**
 * Fix 100% Progress Tokens
 * Check if 100% progress tokens have AMM trades and update graduation status
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import chalk from 'chalk';

async function fix100PercentTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log(chalk.cyan('🔧 Checking 100% Progress Tokens\n'));
    
    // Find all 100% progress tokens that aren't graduated
    const tokensResult = await pool.query(`
      SELECT 
        t.mint_address, 
        t.symbol, 
        t.name,
        t.latest_market_cap_usd,
        t.latest_bonding_curve_progress,
        t.bonding_curve_complete,
        t.graduated_to_amm,
        COUNT(tr.signature) as amm_trade_count
      FROM tokens_unified t
      LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address AND tr.program = 'amm_pool'
      WHERE t.latest_bonding_curve_progress >= 100 
        AND t.graduated_to_amm = false
      GROUP BY t.mint_address, t.symbol, t.name, t.latest_market_cap_usd, 
               t.latest_bonding_curve_progress, t.bonding_curve_complete, t.graduated_to_amm
      ORDER BY t.latest_market_cap_usd DESC
    `);
    
    console.log(`Found ${tokensResult.rows.length} tokens at 100% progress not marked as graduated\n`);
    
    let tokensWithAmmTrades = 0;
    let tokensFixed = 0;
    
    for (const token of tokensResult.rows) {
      console.log(`${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
      console.log(`  Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
      console.log(`  BC Complete: ${token.bonding_curve_complete}`);
      console.log(`  AMM Trades: ${token.amm_trade_count}`);
      
      if (token.amm_trade_count > 0) {
        tokensWithAmmTrades++;
        console.log(chalk.yellow('  → Has AMM trades, marking as graduated...'));
        
        // Update to graduated
        await pool.query(`
          UPDATE tokens_unified
          SET graduated_to_amm = true,
              bonding_curve_complete = true,
              current_program = 'amm_pool',
              updated_at = NOW()
          WHERE mint_address = $1
        `, [token.mint_address]);
        
        tokensFixed++;
        console.log(chalk.green('  ✅ Fixed!\n'));
      } else {
        console.log(chalk.gray('  → No AMM trades, keeping as bonding curve\n'));
      }
    }
    
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(`- Total 100% tokens not graduated: ${tokensResult.rows.length}`);
    console.log(`- Tokens with AMM trades: ${tokensWithAmmTrades}`);
    console.log(`- Tokens fixed: ${tokensFixed}`);
    
    // Show final state
    const finalState = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE latest_bonding_curve_progress >= 100) as at_100_percent,
        COUNT(*) FILTER (WHERE latest_bonding_curve_progress >= 100 AND graduated_to_amm = false) as at_100_not_graduated
      FROM tokens_unified
    `);
    
    console.log(chalk.cyan('\n📈 Final Database State:'));
    console.log(`- Total graduated tokens: ${finalState.rows[0].graduated}`);
    console.log(`- Tokens at 100% progress: ${finalState.rows[0].at_100_percent}`);
    console.log(`- Tokens at 100% not graduated: ${finalState.rows[0].at_100_not_graduated}`);
    
    console.log(chalk.gray('\nNote: Tokens at 100% that haven\'t graduated are waiting for someone to create the AMM pool.'));
    console.log(chalk.gray('This is normal behavior in the pump.fun ecosystem.'));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

fix100PercentTokens().catch(console.error);