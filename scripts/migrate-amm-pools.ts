#!/usr/bin/env node
/**
 * Migration script for AMM pool states table
 */

import 'dotenv/config';
import { db } from '../src/database';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

async function runMigration() {
  console.log(chalk.cyan.bold('🚀 Running AMM Pool States Migration...\n'));
  
  try {
    // Check current schema
    const schemaCheck = await db.query('SELECT current_schema()');
    console.log(chalk.gray(`Current schema: ${schemaCheck.rows[0].current_schema}`));
    
    // First check if table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'amm_pool_states'
        AND table_schema = current_schema()
      );
    `);
    
    const tableExists = tableCheck.rows[0].exists;
    
    if (tableExists) {
      console.log(chalk.yellow('⚠️  Table amm_pool_states already exists'));
      
      // Check table structure
      const columnCheck = await db.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'amm_pool_states'
        ORDER BY ordinal_position;
      `);
      
      console.log(chalk.gray('\nExisting columns:'));
      columnCheck.rows.forEach(col => {
        console.log(chalk.gray(`  - ${col.column_name}: ${col.data_type}`));
      });
      
    } else {
      console.log(chalk.yellow('📋 Creating AMM pool states table...'));
      
      // Create table
      await db.query(`
        CREATE TABLE amm_pool_states (
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
        )
      `);
      console.log(chalk.green('✅ Table created'));
    }
    
    // Verify table was created/exists
    const verifyTable = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'amm_pool_states' 
      AND column_name = 'mint_address';
    `);
    
    if (verifyTable.rows.length === 0) {
      throw new Error('Table creation failed - mint_address column not found');
    }
    
    // Create indexes
    console.log(chalk.yellow('\n📋 Creating indexes...'));
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_amm_pool_states_mint 
      ON amm_pool_states(mint_address, created_at DESC)
    `);
    console.log(chalk.green('✅ Index on mint_address created'));
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_amm_pool_states_pool 
      ON amm_pool_states(pool_address, created_at DESC)
    `);
    console.log(chalk.green('✅ Index on pool_address created'));
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_amm_pool_states_slot 
      ON amm_pool_states(slot DESC)
    `);
    console.log(chalk.green('✅ Index on slot created'));
    
    // Add comments
    console.log(chalk.yellow('📋 Adding table comments...'));
    
    await db.query(`
      COMMENT ON TABLE amm_pool_states IS 'Historical snapshots of AMM pool states including reserves'
    `);
    
    await db.query(`
      COMMENT ON COLUMN amm_pool_states.virtual_sol_reserves IS 'Virtual SOL reserves in lamports from trade events'
    `);
    
    await db.query(`
      COMMENT ON COLUMN amm_pool_states.virtual_token_reserves IS 'Virtual token reserves with token decimals from trade events'
    `);
    
    await db.query(`
      COMMENT ON COLUMN amm_pool_states.real_sol_reserves IS 'Actual SOL in pool account (optional)'
    `);
    
    await db.query(`
      COMMENT ON COLUMN amm_pool_states.real_token_reserves IS 'Actual tokens in pool account (optional)'
    `);
    
    console.log(chalk.green('✅ Comments added'));
    console.log(chalk.green('\n✅ AMM pool states migration completed successfully\n'));
    
    // Show current statistics
    await showStatistics();
    
  } catch (error) {
    console.error(chalk.red('❌ Migration failed:'), error);
  } finally {
    await db.close();
  }
}

async function showStatistics() {
  console.log(chalk.cyan.bold('📊 Current Database Statistics:\n'));
  
  try {
    // Check if table exists and show stats
    const poolStates = await db.query(
      'SELECT COUNT(*) as count FROM amm_pool_states'
    ).catch(() => null);
    
    if (poolStates) {
      const count = parseInt(poolStates.rows[0].count);
      console.log(chalk.white('AMM Pool States: ') + chalk.yellow(count.toLocaleString()) + ' records');
    }
    
    // Check unique pools
    const uniquePools = await db.query(
      'SELECT COUNT(DISTINCT pool_address) as count FROM amm_pool_states'
    ).catch(() => null);
    
    if (uniquePools) {
      const count = parseInt(uniquePools.rows[0].count);
      console.log(chalk.white('Unique Pools: ') + chalk.yellow(count.toLocaleString()));
    }
    
    // Check unique tokens
    const uniqueTokens = await db.query(
      'SELECT COUNT(DISTINCT mint_address) as count FROM amm_pool_states'
    ).catch(() => null);
    
    if (uniqueTokens) {
      const count = parseInt(uniqueTokens.rows[0].count);
      console.log(chalk.white('Unique Tokens: ') + chalk.yellow(count.toLocaleString()));
    }
    
  } catch (error) {
    console.error(chalk.red('Error fetching statistics:'), error);
  }
}

// Run the migration
runMigration().catch(console.error);