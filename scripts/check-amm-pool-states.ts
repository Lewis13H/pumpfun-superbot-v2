#!/usr/bin/env tsx
import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('Checking AMM Pool States'));
  
  // Check a sample of pool states
  const result = await db.query(`
    SELECT 
      mint_address,
      pool_address,
      created_at
    FROM amm_pool_states
    ORDER BY created_at DESC
    LIMIT 10
  `);
  
  console.log(chalk.yellow(`\nFound ${result.rows.length} recent pool states:`));
  
  for (const row of result.rows) {
    console.log(chalk.gray('─'.repeat(80)));
    console.log(chalk.white('Mint Address:'), row.mint_address);
    console.log(chalk.white('Pool Address:'), row.pool_address);
    console.log(chalk.white('Created:'), row.created_at);
    
    // Check if mint_address looks like SOL
    if (row.mint_address === 'So11111111111111111111111111111111111111112') {
      console.log(chalk.red('⚠️  This is the SOL mint!'));
    }
  }
  
  // Check how many have SOL mint
  const solMintCount = await db.query(`
    SELECT COUNT(*) as count
    FROM amm_pool_states
    WHERE mint_address = 'So11111111111111111111111111111111111111112'
  `);
  
  console.log(chalk.gray('─'.repeat(80)));
  console.log(chalk.yellow(`\nTotal pool states with SOL mint: ${solMintCount.rows[0].count}`));
  
  // Check distinct mint addresses
  const distinctMints = await db.query(`
    SELECT COUNT(DISTINCT mint_address) as count
    FROM amm_pool_states
  `);
  
  console.log(chalk.yellow(`Total distinct mint addresses: ${distinctMints.rows[0].count}`));
  
  await db.close();
}

main().catch(console.error);