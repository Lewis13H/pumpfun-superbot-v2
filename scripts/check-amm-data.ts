#!/usr/bin/env node
/**
 * Check AMM pool states data
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function checkData() {
  try {
    // Count pool states
    const countResult = await db.query('SELECT COUNT(*) as count FROM amm_pool_states');
    console.log(chalk.cyan('AMM Pool States:'), chalk.yellow(countResult.rows[0].count));
    
    // Get recent pool states
    const recentResult = await db.query(`
      SELECT 
        mint_address,
        pool_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        slot,
        created_at
      FROM amm_pool_states
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    if (recentResult.rows.length > 0) {
      console.log(chalk.cyan('\nRecent Pool States:'));
      recentResult.rows.forEach(row => {
        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.white('Mint:'), row.mint_address);
        console.log(chalk.white('Pool:'), row.pool_address);
        console.log(chalk.white('SOL Reserves:'), row.virtual_sol_reserves);
        console.log(chalk.white('Token Reserves:'), row.virtual_token_reserves);
        console.log(chalk.white('Slot:'), row.slot);
        console.log(chalk.white('Time:'), row.created_at);
      });
    }
    
    // Count unique tokens
    const uniqueResult = await db.query('SELECT COUNT(DISTINCT mint_address) as count FROM amm_pool_states');
    console.log(chalk.cyan('\nUnique Tokens:'), chalk.yellow(uniqueResult.rows[0].count));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await db.close();
  }
}

checkData().catch(console.error);