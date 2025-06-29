#!/usr/bin/env tsx
/**
 * Fix graduated tokens that have 100% bonding curve progress but aren't marked as graduated
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('Fixing graduated tokens...'));
  
  try {
    // Find tokens with 100% progress that aren't marked as graduated
    const result = await db.query(`
      SELECT DISTINCT 
        t.mint_address,
        tk.symbol,
        tk.name,
        MAX(t.bonding_curve_progress) as max_progress,
        tk.graduated_to_amm,
        COUNT(*) as trade_count
      FROM trades_unified t
      JOIN tokens_unified tk ON t.mint_address = tk.mint_address
      WHERE t.program = 'bonding_curve'
      AND t.bonding_curve_progress >= 100
      AND tk.graduated_to_amm = false
      GROUP BY t.mint_address, tk.symbol, tk.name, tk.graduated_to_amm
      ORDER BY max_progress DESC
    `);
    
    console.log(chalk.yellow(`Found ${result.rows.length} tokens with >=100% progress not marked as graduated`));
    
    if (result.rows.length === 0) {
      console.log(chalk.green('✓ No tokens need fixing'));
      return;
    }
    
    // Update each token
    let updated = 0;
    for (const row of result.rows) {
      console.log(chalk.gray(`  ${row.symbol || 'Unknown'} (${row.mint_address.slice(0, 8)}...) - Progress: ${row.max_progress}%`));
      
      const updateResult = await db.query(`
        UPDATE tokens_unified
        SET 
          graduated_to_amm = TRUE,
          graduation_at = NOW(),
          current_program = 'amm_pool',
          updated_at = NOW()
        WHERE mint_address = $1
        AND graduated_to_amm = false
      `, [row.mint_address]);
      
      if (updateResult.rowCount > 0) {
        updated++;
      }
    }
    
    console.log(chalk.green(`✓ Updated ${updated} tokens as graduated`));
    
    // Show current stats
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated_count,
        COUNT(*) FILTER (WHERE graduated_to_amm = false) as not_graduated_count,
        COUNT(*) as total_count
      FROM tokens_unified
    `);
    
    const stats = statsResult.rows[0];
    console.log(chalk.blue('\nCurrent token stats:'));
    console.log(chalk.white(`  Total tokens: ${stats.total_count}`));
    console.log(chalk.green(`  Graduated: ${stats.graduated_count}`));
    console.log(chalk.yellow(`  Not graduated: ${stats.not_graduated_count}`));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main().catch(console.error);