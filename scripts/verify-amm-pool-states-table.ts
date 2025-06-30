#!/usr/bin/env tsx
/**
 * Verify the amm_pool_states table exists and check its structure
 */

import chalk from 'chalk';
import { db } from '../src/database';
import dotenv from 'dotenv';

dotenv.config();

async function verifyTable() {
  try {
    console.log(chalk.cyan.bold('Verifying amm_pool_states table\n'));
    
    // Check if table exists
    const tableExists = await db.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_name = 'amm_pool_states'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log(chalk.red('✗ Table amm_pool_states does not exist!'));
      console.log(chalk.yellow('\nCreating table...'));
      
      // Create the table
      await db.query(`
        CREATE TABLE IF NOT EXISTS amm_pool_states (
          id BIGSERIAL PRIMARY KEY,
          mint_address VARCHAR(64) NOT NULL,
          pool_address VARCHAR(64) NOT NULL,
          virtual_sol_reserves BIGINT NOT NULL,
          virtual_token_reserves BIGINT NOT NULL,
          real_sol_reserves BIGINT,
          real_token_reserves BIGINT,
          pool_open BOOLEAN DEFAULT TRUE,
          slot BIGINT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_amm_pool_states_mint ON amm_pool_states(mint_address, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_amm_pool_states_pool ON amm_pool_states(pool_address, created_at DESC);
      `);
      
      console.log(chalk.green('✓ Table created successfully'));
    } else {
      console.log(chalk.green('✓ Table exists'));
    }
    
    // Get table structure
    const columns = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'amm_pool_states'
      ORDER BY ordinal_position;
    `);
    
    console.log(chalk.yellow('\nTable structure:'));
    for (const col of columns.rows) {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
    }
    
    // Get row count
    const count = await db.query('SELECT COUNT(*) as count FROM amm_pool_states');
    console.log(chalk.yellow(`\nTotal rows: ${count.rows[0].count}`));
    
    // Get recent entries
    if (parseInt(count.rows[0].count) > 0) {
      const recent = await db.query(`
        SELECT mint_address, pool_address, created_at
        FROM amm_pool_states
        ORDER BY created_at DESC
        LIMIT 5;
      `);
      
      console.log(chalk.yellow('\nRecent entries:'));
      for (const row of recent.rows) {
        console.log(`  - Mint: ${row.mint_address.substring(0, 8)}... | Pool: ${row.pool_address.substring(0, 8)}... | ${new Date(row.created_at).toLocaleString()}`);
      }
    }
    
    // db is a pool, not a client - pools don't have .end()
    console.log(chalk.green('\n✓ Verification complete'));
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

verifyTable();