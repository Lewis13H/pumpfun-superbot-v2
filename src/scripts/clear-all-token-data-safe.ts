/**
 * Clear All Token Data (Safe Version)
 * WARNING: This will delete ALL token-related data from the database
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import chalk from 'chalk';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function clearAllTokenData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log(chalk.red('⚠️  WARNING: This will DELETE ALL token data!\n'));
    
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
    console.log('Found tables:', existingTables.join(', '));
    
    // Show current data counts for existing tables
    console.log('\nCurrent data in database:');
    for (const table of existingTables) {
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`- ${table}: ${countResult.rows[0].count} rows`);
    }
    
    console.log(chalk.red('\nThis operation will delete ALL of the above data!'));
    
    const answer = await askQuestion('\nType "DELETE ALL TOKEN DATA" to confirm: ');
    
    if (answer !== 'DELETE ALL TOKEN DATA') {
      console.log(chalk.yellow('\nOperation cancelled.'));
      rl.close();
      await pool.end();
      return;
    }
    
    console.log(chalk.yellow('\nStarting deletion...\n'));
    
    // Delete in correct order to respect foreign key constraints
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
      console.log(`Deleting from ${table}...`);
      try {
        const result = await pool.query(`DELETE FROM ${table}`);
        console.log(chalk.green(`✓ Deleted ${result.rowCount} rows from ${table}`));
      } catch (error) {
        console.log(chalk.yellow(`⚠ Error deleting from ${table}:`, error.message));
      }
    }
    
    // Reset sequences if they exist
    console.log(chalk.yellow('\nResetting sequences...'));
    for (const table of orderedTables) {
      try {
        await pool.query(`ALTER SEQUENCE IF EXISTS ${table}_id_seq RESTART WITH 1`);
      } catch (error) {
        // Ignore sequence errors
      }
    }
    console.log(chalk.green('✓ Sequences reset'));
    
    // Verify deletion
    console.log(chalk.cyan('\n✅ Deletion complete!'));
    console.log('\nFinal counts:');
    for (const table of existingTables) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`- ${table}: ${countResult.rows[0].count} rows`);
      } catch (error) {
        console.log(`- ${table}: Error checking count`);
      }
    }
    
    console.log(chalk.green('\n✨ All token data has been cleared!'));
    console.log(chalk.gray('The monitors will start collecting fresh data when restarted.'));
    
  } catch (error) {
    console.error(chalk.red('\nError during deletion:'), error);
  } finally {
    rl.close();
    await pool.end();
  }
}

clearAllTokenData().catch(console.error);