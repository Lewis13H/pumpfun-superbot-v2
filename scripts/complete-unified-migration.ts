#!/usr/bin/env node
/**
 * Complete the unified migration
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function completeMigration() {
  console.log(chalk.cyan.bold('🔧 Completing Unified Migration...\n'));
  
  try {
    // Drop existing view if it exists
    await db.query('DROP VIEW IF EXISTS active_tokens CASCADE');
    console.log(chalk.yellow('  ✓ Dropped existing view'));
    
    // Create the view
    await db.query(`
      CREATE OR REPLACE VIEW active_tokens AS
      SELECT 
        t.*,
        CASE 
          WHEN t.graduated_to_amm THEN 'graduated'
          WHEN t.current_program = 'amm_pool' THEN 'amm'
          WHEN t.latest_bonding_curve_progress >= 100 THEN 'completing'
          WHEN t.latest_bonding_curve_progress >= 50 THEN 'trending'
          ELSE 'active'
        END as status,
        (SELECT COUNT(*) FROM trades_unified WHERE mint_address = t.mint_address AND block_time > NOW() - INTERVAL '1 hour') as trades_1h,
        (SELECT COUNT(*) FROM trades_unified WHERE mint_address = t.mint_address AND block_time > NOW() - INTERVAL '24 hours') as trades_24h
      FROM tokens_unified t
      WHERE t.threshold_crossed_at IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC NULLS LAST
    `);
    console.log(chalk.green('  ✓ Created view: active_tokens'));
    
    // Show statistics
    console.log(chalk.cyan.bold('\n📊 Database Statistics:\n'));
    
    const tables = [
      'tokens_unified',
      'trades_unified',
      'price_snapshots_unified',
      'account_states_unified',
      'token_holders_unified',
      'sol_prices'
    ];
    
    for (const table of tables) {
      const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = parseInt(result.rows[0].count);
      console.log(chalk.white(`${table}: `) + chalk.yellow(count.toLocaleString()) + ' records');
    }
    
    console.log(chalk.green('\n✅ Migration completed successfully!'));
    console.log(chalk.cyan('\nYou can now run the unified monitor with: ') + chalk.yellow('npm run unified-v2'));
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error);
  } finally {
    await db.close();
  }
}

// Run completion
completeMigration().catch(console.error);