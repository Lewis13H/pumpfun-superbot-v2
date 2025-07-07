#!/usr/bin/env node

/**
 * Fix graduated tokens that aren't marked as graduated
 * Finds tokens with AMM trades and updates their graduation status
 */

import { Pool } from 'pg';
import { configService } from '../core/config';
import chalk from 'chalk';

async function fixGraduatedTokens() {
  console.log(chalk.cyan('🔧 Fixing Graduated Tokens\n'));
  
  const pool = new Pool({
    connectionString: configService.get('database').url
  });
  
  try {
    // Find tokens with AMM trades that aren't marked as graduated
    console.log(chalk.yellow('Finding tokens with AMM trades...'));
    
    const graduatedTokensResult = await pool.query(`
      WITH amm_tokens AS (
        SELECT DISTINCT 
          t.mint_address,
          t.symbol,
          t.bonding_curve_key,
          t.graduated_to_amm,
          t.bonding_curve_complete,
          MIN(tr.block_time) as first_amm_trade,
          COUNT(tr.signature) as amm_trade_count
        FROM tokens_unified t
        INNER JOIN trades_unified tr ON t.mint_address = tr.mint_address
        WHERE tr.program = 'amm_pool'
        GROUP BY t.mint_address, t.symbol, t.bonding_curve_key, 
                 t.graduated_to_amm, t.bonding_curve_complete
      )
      SELECT * FROM amm_tokens
      WHERE graduated_to_amm = false
      ORDER BY first_amm_trade DESC
    `);
    
    const tokensToFix = graduatedTokensResult.rows;
    
    if (tokensToFix.length === 0) {
      console.log(chalk.green('✅ All tokens with AMM trades are already marked as graduated!'));
      return;
    }
    
    console.log(chalk.yellow(`Found ${tokensToFix.length} tokens to fix:\n`));
    
    // Display tokens to be fixed
    for (const token of tokensToFix) {
      const minutesAgo = Math.floor((Date.now() - new Date(token.first_amm_trade).getTime()) / 1000 / 60);
      console.log(`  ${(token.symbol || 'Unknown').padEnd(10)} - ${token.amm_trade_count} AMM trades - First trade ${minutesAgo}m ago`);
    }
    
    // Fix each token
    console.log(chalk.cyan('\n🔄 Updating tokens...'));
    
    let fixed = 0;
    let errors = 0;
    
    for (const token of tokensToFix) {
      try {
        const updateResult = await pool.query(`
          UPDATE tokens_unified
          SET 
            graduated_to_amm = true,
            bonding_curve_complete = true,
            latest_bonding_curve_progress = 100,
            current_program = 'amm_pool',
            updated_at = NOW()
          WHERE mint_address = $1
          RETURNING mint_address
        `, [token.mint_address]);
        
        if (updateResult.rowCount > 0) {
          fixed++;
          console.log(chalk.green(`  ✅ Fixed ${token.symbol || token.mint_address.substring(0, 8) + '...'}`));
        }
      } catch (error) {
        errors++;
        console.log(chalk.red(`  ❌ Failed to fix ${token.symbol || token.mint_address.substring(0, 8) + '...'}: ${error.message}`));
      }
    }
    
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(`  Total tokens found: ${tokensToFix.length}`);
    console.log(`  Successfully fixed: ${fixed}`);
    console.log(`  Errors: ${errors}`);
    
    // Verify fix
    console.log(chalk.cyan('\n🔍 Verifying fix...'));
    
    const verifyResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated_count,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as complete_count,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM trades_unified tr 
          WHERE tr.mint_address = tokens_unified.mint_address 
          AND tr.program = 'amm_pool'
        ) AND graduated_to_amm = false) as still_not_graduated
      FROM tokens_unified
    `);
    
    const stats = verifyResult.rows[0];
    console.log(`  Total graduated tokens: ${stats.graduated_count}`);
    console.log(`  Total complete tokens: ${stats.complete_count}`);
    console.log(`  Tokens still needing fix: ${stats.still_not_graduated}`);
    
    if (stats.still_not_graduated > 0) {
      console.log(chalk.yellow('\n⚠️  Some tokens still need fixing. They may have been added during the fix process.'));
      console.log('Run this script again to fix any remaining tokens.');
    } else {
      console.log(chalk.green('\n✅ All tokens with AMM trades are now properly marked as graduated!'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixGraduatedTokens().catch(console.error);