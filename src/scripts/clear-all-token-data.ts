/**
 * Clear All Token Data
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
    
    // Show current data counts
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM tokens_unified) as tokens,
        (SELECT COUNT(*) FROM trades_unified) as trades,
        (SELECT COUNT(*) FROM liquidity_events) as liquidity_events,
        (SELECT COUNT(*) FROM holder_snapshots) as holder_snapshots,
        (SELECT COUNT(*) FROM holder_distributions) as holder_distributions,
        (SELECT COUNT(*) FROM wallet_classifications) as wallet_classifications,
        (SELECT COUNT(*) FROM holder_analysis_queue) as analysis_queue,
        (SELECT COUNT(*) FROM token_metrics_history) as metrics_history
    `);
    
    const data = counts.rows[0];
    console.log('Current data in database:');
    console.log(`- Tokens: ${data.tokens}`);
    console.log(`- Trades: ${data.trades}`);
    console.log(`- Liquidity Events: ${data.liquidity_events}`);
    console.log(`- Holder Snapshots: ${data.holder_snapshots}`);
    console.log(`- Holder Distributions: ${data.holder_distributions}`);
    console.log(`- Wallet Classifications: ${data.wallet_classifications}`);
    console.log(`- Analysis Queue: ${data.analysis_queue}`);
    console.log(`- Metrics History: ${data.metrics_history}`);
    
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
    const tables = [
      'token_metrics_history',
      'holder_analysis_queue',
      'holder_distributions',
      'holder_snapshots',
      'wallet_classifications',
      'liquidity_events',
      'trades_unified',
      'tokens_unified'
    ];
    
    for (const table of tables) {
      console.log(`Deleting from ${table}...`);
      const result = await pool.query(`DELETE FROM ${table}`);
      console.log(chalk.green(`✓ Deleted ${result.rowCount} rows from ${table}`));
    }
    
    // Reset sequences if they exist
    console.log(chalk.yellow('\nResetting sequences...'));
    try {
      await pool.query(`
        ALTER SEQUENCE IF EXISTS tokens_unified_id_seq RESTART WITH 1;
        ALTER SEQUENCE IF EXISTS trades_unified_id_seq RESTART WITH 1;
        ALTER SEQUENCE IF EXISTS liquidity_events_id_seq RESTART WITH 1;
        ALTER SEQUENCE IF EXISTS holder_snapshots_id_seq RESTART WITH 1;
        ALTER SEQUENCE IF EXISTS holder_distributions_id_seq RESTART WITH 1;
        ALTER SEQUENCE IF EXISTS wallet_classifications_id_seq RESTART WITH 1;
        ALTER SEQUENCE IF EXISTS holder_analysis_queue_id_seq RESTART WITH 1;
        ALTER SEQUENCE IF EXISTS token_metrics_history_id_seq RESTART WITH 1;
      `);
      console.log(chalk.green('✓ Sequences reset'));
    } catch (error) {
      console.log(chalk.gray('Note: Some sequences may not exist, which is fine'));
    }
    
    // Verify deletion
    const finalCounts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM tokens_unified) as tokens,
        (SELECT COUNT(*) FROM trades_unified) as trades,
        (SELECT COUNT(*) FROM liquidity_events) as liquidity_events,
        (SELECT COUNT(*) FROM holder_snapshots) as holder_snapshots
    `);
    
    const finalData = finalCounts.rows[0];
    console.log(chalk.cyan('\n✅ Deletion complete!'));
    console.log('\nFinal counts:');
    console.log(`- Tokens: ${finalData.tokens}`);
    console.log(`- Trades: ${finalData.trades}`);
    console.log(`- Liquidity Events: ${finalData.liquidity_events}`);
    console.log(`- Holder Snapshots: ${finalData.holder_snapshots}`);
    
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