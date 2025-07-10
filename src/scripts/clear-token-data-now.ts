/**
 * Clear All Token Data - Direct Execution
 * WARNING: This will delete ALL token-related data from the database
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import chalk from 'chalk';

async function clearAllTokenData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log(chalk.red('⚠️  Clearing ALL token data...\n'));
    
    // Get list of existing tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'tokens_unified',
        'trades_unified',
        'liquidity_events',
        'holder_snapshots',
        'holder_distributions',
        'wallet_classifications',
        'holder_analysis_queue',
        'token_metrics_history'
      )
    `);
    
    const existingTables = tablesResult.rows.map(row => row.table_name);
    
    // Show current counts
    console.log('Before deletion:');
    for (const table of existingTables) {
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`- ${table}: ${countResult.rows[0].count} rows`);
    }
    
    console.log(chalk.yellow('\nDeleting data...\n'));
    
    // Delete in correct order
    const orderedTables = [
      'token_metrics_history',
      'holder_analysis_queue',
      'holder_distributions',
      'holder_snapshots',
      'wallet_classifications',
      'liquidity_events',
      'trades_unified',
      'tokens_unified'
    ].filter(table => existingTables.includes(table));
    
    for (const table of orderedTables) {
      try {
        console.log(`Deleting ${table}...`);
        const result = await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
        console.log(chalk.green(`✓ Cleared ${table}`));
      } catch (error: any) {
        console.log(chalk.yellow(`⚠ Error with ${table}: ${error.message}`));
        // Try DELETE if TRUNCATE fails
        try {
          const result = await pool.query(`DELETE FROM ${table}`);
          console.log(chalk.green(`✓ Deleted ${result.rowCount} rows from ${table}`));
        } catch (deleteError: any) {
          console.log(chalk.red(`✗ Failed to clear ${table}: ${deleteError.message}`));
        }
      }
    }
    
    // Reset sequences
    console.log(chalk.yellow('\nResetting sequences...'));
    for (const table of orderedTables) {
      try {
        await pool.query(`ALTER SEQUENCE IF EXISTS ${table}_id_seq RESTART WITH 1`);
      } catch (error) {
        // Ignore
      }
    }
    
    // Verify
    console.log(chalk.cyan('\n✅ Complete! Final counts:'));
    for (const table of existingTables) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`- ${table}: ${countResult.rows[0].count} rows`);
      } catch (error) {
        console.log(`- ${table}: Error`);
      }
    }
    
    console.log(chalk.green('\n✨ All token data cleared successfully!'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Execute immediately
console.log(chalk.yellow('Starting token data cleanup...\n'));
clearAllTokenData().catch(console.error);