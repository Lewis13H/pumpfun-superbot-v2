#!/usr/bin/env tsx
/**
 * Fix AMM Pool Mint Mapping
 * Removes incorrect SOL mint entries from amm_pool_states
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🔧 Fixing AMM Pool Mint Mapping'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // First, check how many SOL mint entries we have
  const solMintCheck = await db.query(`
    SELECT COUNT(*) as count
    FROM amm_pool_states
    WHERE mint_address = 'So11111111111111111111111111111111111111112'
  `);
  
  console.log(chalk.yellow(`Found ${solMintCheck.rows[0].count} entries with SOL mint address`));
  
  if (parseInt(solMintCheck.rows[0].count) > 0) {
    // Delete SOL mint entries
    console.log(chalk.yellow('\nDeleting SOL mint entries...'));
    
    const deleteResult = await db.query(`
      DELETE FROM amm_pool_states
      WHERE mint_address = 'So11111111111111111111111111111111111111112'
    `);
    
    console.log(chalk.green(`✅ Deleted ${deleteResult.rowCount} SOL mint entries`));
  }
  
  // Check for any duplicate pool addresses with different mint addresses
  console.log(chalk.yellow('\nChecking for duplicate pool addresses...'));
  
  const duplicates = await db.query(`
    SELECT 
      pool_address,
      COUNT(DISTINCT mint_address) as mint_count,
      array_agg(DISTINCT mint_address) as mint_addresses
    FROM amm_pool_states
    GROUP BY pool_address
    HAVING COUNT(DISTINCT mint_address) > 1
    ORDER BY mint_count DESC
    LIMIT 10
  `);
  
  if (duplicates.rows.length > 0) {
    console.log(chalk.red(`\n⚠️  Found ${duplicates.rows.length} pools with multiple mint addresses:`));
    
    for (const row of duplicates.rows) {
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.white('Pool:'), row.pool_address);
      console.log(chalk.white('Mint addresses:'), row.mint_addresses);
    }
    
    console.log(chalk.yellow('\nThese need manual investigation'));
  } else {
    console.log(chalk.green('✅ No duplicate pool addresses found'));
  }
  
  // Show final statistics
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Final Statistics:'));
  
  const stats = await db.query(`
    SELECT 
      COUNT(DISTINCT pool_address) as unique_pools,
      COUNT(DISTINCT mint_address) as unique_mints,
      COUNT(*) as total_records
    FROM amm_pool_states
  `);
  
  console.log(chalk.white('Unique pools:'), stats.rows[0].unique_pools);
  console.log(chalk.white('Unique mints:'), stats.rows[0].unique_mints);
  console.log(chalk.white('Total records:'), stats.rows[0].total_records);
  
  // Verify no SOL mints remain
  const finalCheck = await db.query(`
    SELECT COUNT(*) as count
    FROM amm_pool_states
    WHERE mint_address = 'So11111111111111111111111111111111111111112'
  `);
  
  if (parseInt(finalCheck.rows[0].count) === 0) {
    console.log(chalk.green('\n✅ All SOL mint entries have been removed'));
  } else {
    console.log(chalk.red(`\n⚠️  ${finalCheck.rows[0].count} SOL mint entries still remain`));
  }
  
  await db.close();
}

main().catch(console.error);