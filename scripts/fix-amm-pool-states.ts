#!/usr/bin/env node
/**
 * Fix the existing amm_pool_states table to use correct structure
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function fixTable() {
  console.log(chalk.cyan.bold('🔧 Fixing AMM Pool States Table...\n'));
  
  try {
    // Drop the existing table and related tables
    console.log(chalk.yellow('📋 Dropping existing AMM tables...'));
    
    await db.query('DROP TABLE IF EXISTS amm_pool_states CASCADE');
    console.log(chalk.green('✅ Dropped amm_pool_states'));
    
    await db.query('DROP TABLE IF EXISTS amm_pools CASCADE');
    console.log(chalk.green('✅ Dropped amm_pools'));
    
    await db.query('DROP TABLE IF EXISTS amm_pool_states_v2 CASCADE');
    console.log(chalk.green('✅ Dropped amm_pool_states_v2'));
    
    // Create the table with correct structure
    console.log(chalk.yellow('\n📋 Creating AMM pool states table with correct structure...'));
    
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
    console.log(chalk.green('✅ Table created with correct structure'));
    
    // Create indexes
    console.log(chalk.yellow('\n📋 Creating indexes...'));
    
    await db.query(`
      CREATE INDEX idx_amm_pool_states_mint 
      ON amm_pool_states(mint_address, created_at DESC)
    `);
    console.log(chalk.green('✅ Index on mint_address created'));
    
    await db.query(`
      CREATE INDEX idx_amm_pool_states_pool 
      ON amm_pool_states(pool_address, created_at DESC)
    `);
    console.log(chalk.green('✅ Index on pool_address created'));
    
    await db.query(`
      CREATE INDEX idx_amm_pool_states_slot 
      ON amm_pool_states(slot DESC)
    `);
    console.log(chalk.green('✅ Index on slot created'));
    
    // Add comments
    console.log(chalk.yellow('\n📋 Adding table comments...'));
    
    await db.query(`
      COMMENT ON TABLE amm_pool_states IS 'Historical snapshots of AMM pool states including reserves'
    `);
    
    await db.query(`
      COMMENT ON COLUMN amm_pool_states.virtual_sol_reserves IS 'Virtual SOL reserves in lamports from trade events'
    `);
    
    await db.query(`
      COMMENT ON COLUMN amm_pool_states.virtual_token_reserves IS 'Virtual token reserves with token decimals from trade events'
    `);
    
    console.log(chalk.green('✅ Comments added'));
    
    // Verify structure
    console.log(chalk.yellow('\n🔍 Verifying table structure...'));
    
    const columnsResult = await db.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'amm_pool_states'
      ORDER BY ordinal_position;
    `);
    
    console.log(chalk.green('\n✅ Table structure:'));
    columnsResult.rows.forEach(col => {
      let type = col.data_type;
      if (col.character_maximum_length) {
        type += `(${col.character_maximum_length})`;
      }
      console.log(chalk.gray(`  ${col.column_name}: ${type}`));
    });
    
    console.log(chalk.green('\n✅ AMM pool states table fixed successfully!'));
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error);
  } finally {
    await db.close();
  }
}

// Run the fix
fixTable().catch(console.error);