#!/usr/bin/env node
/**
 * Migration script for AMM pool states - Version 2
 * Works with existing database schema
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function runMigration() {
  console.log(chalk.cyan.bold('🚀 Running AMM Pool States Migration V2...\n'));
  
  try {
    // Check if our new table already exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'amm_pool_states_v2'
        AND table_schema = 'public'
      );
    `);
    
    const tableExists = tableCheck.rows[0].exists;
    
    if (!tableExists) {
      console.log(chalk.yellow('📋 Creating new AMM pool states table (v2)...'));
      
      // Create our new table with a different name to avoid conflicts
      await db.query(`
        CREATE TABLE amm_pool_states_v2 (
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
      console.log(chalk.green('✅ Table amm_pool_states_v2 created'));
      
      // Create indexes
      console.log(chalk.yellow('📋 Creating indexes...'));
      
      await db.query(`
        CREATE INDEX idx_amm_pool_states_v2_mint 
        ON amm_pool_states_v2(mint_address, created_at DESC)
      `);
      console.log(chalk.green('✅ Index on mint_address created'));
      
      await db.query(`
        CREATE INDEX idx_amm_pool_states_v2_pool 
        ON amm_pool_states_v2(pool_address, created_at DESC)
      `);
      console.log(chalk.green('✅ Index on pool_address created'));
      
      await db.query(`
        CREATE INDEX idx_amm_pool_states_v2_slot 
        ON amm_pool_states_v2(slot DESC)
      `);
      console.log(chalk.green('✅ Index on slot created'));
      
      // Add comments
      console.log(chalk.yellow('📋 Adding table comments...'));
      
      await db.query(`
        COMMENT ON TABLE amm_pool_states_v2 IS 'Historical snapshots of AMM pool states including reserves (v2)'
      `);
      
      await db.query(`
        COMMENT ON COLUMN amm_pool_states_v2.virtual_sol_reserves IS 'Virtual SOL reserves in lamports from trade events'
      `);
      
      await db.query(`
        COMMENT ON COLUMN amm_pool_states_v2.virtual_token_reserves IS 'Virtual token reserves with token decimals from trade events'
      `);
      
      console.log(chalk.green('✅ Comments added'));
      
    } else {
      console.log(chalk.yellow('⚠️  Table amm_pool_states_v2 already exists'));
    }
    
    console.log(chalk.green('\n✅ AMM pool states migration completed successfully\n'));
    
    // Show statistics
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
    // Check new table
    const poolStates = await db.query(
      'SELECT COUNT(*) as count FROM amm_pool_states_v2'
    ).catch(() => null);
    
    if (poolStates) {
      const count = parseInt(poolStates.rows[0].count);
      console.log(chalk.white('AMM Pool States V2: ') + chalk.yellow(count.toLocaleString()) + ' records');
    }
    
    // Check existing tables for reference
    const existingPools = await db.query(
      'SELECT COUNT(*) as count FROM amm_pools'
    ).catch(() => null);
    
    if (existingPools) {
      const count = parseInt(existingPools.rows[0].count);
      console.log(chalk.gray('Existing AMM Pools: ') + chalk.gray(count.toLocaleString()) + ' records');
    }
    
    const existingStates = await db.query(
      'SELECT COUNT(*) as count FROM amm_pool_states'
    ).catch(() => null);
    
    if (existingStates) {
      const count = parseInt(existingStates.rows[0].count);
      console.log(chalk.gray('Existing AMM Pool States: ') + chalk.gray(count.toLocaleString()) + ' records');
    }
    
  } catch (error) {
    console.error(chalk.red('Error fetching statistics:'), error);
  }
}

// Run the migration
runMigration().catch(console.error);