#!/usr/bin/env node
/**
 * Simplified migration script for unified monitoring schema
 * Runs the migration directly without complex parsing
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function runMigration() {
  console.log(chalk.cyan.bold('🚀 Running Unified Monitoring Schema Migration...\n'));
  
  try {
    // Run the migration as a single transaction
    await db.query('BEGIN');
    
    console.log(chalk.yellow('Creating tables and indexes...'));
    
    // Enable UUID extension
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    console.log(chalk.green('  ✓ UUID extension enabled'));
    
    // Create main tokens table
    await db.query(`
      CREATE TABLE IF NOT EXISTS tokens_unified (
        mint_address VARCHAR(64) PRIMARY KEY,
        symbol VARCHAR(32),
        name VARCHAR(128),
        uri VARCHAR(512),
        image_uri VARCHAR(512),
        description TEXT,
        creator VARCHAR(64),
        
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        first_seen_slot BIGINT NOT NULL,
        first_program VARCHAR(20) NOT NULL CHECK (first_program IN ('bonding_curve', 'amm_pool')),
        first_price_sol DECIMAL(20, 12) NOT NULL,
        first_price_usd DECIMAL(20, 4) NOT NULL,
        first_market_cap_usd DECIMAL(20, 4) NOT NULL,
        
        threshold_crossed_at TIMESTAMPTZ,
        threshold_price_sol DECIMAL(20, 12),
        threshold_price_usd DECIMAL(20, 4),
        threshold_market_cap_usd DECIMAL(20, 4),
        threshold_slot BIGINT,
        
        current_program VARCHAR(20) CHECK (current_program IN ('bonding_curve', 'amm_pool')),
        graduated_to_amm BOOLEAN DEFAULT FALSE,
        graduation_at TIMESTAMPTZ,
        graduation_slot BIGINT,
        
        total_trades INTEGER DEFAULT 0,
        total_buys INTEGER DEFAULT 0,
        total_sells INTEGER DEFAULT 0,
        volume_24h_sol DECIMAL(20, 9) DEFAULT 0,
        volume_24h_usd DECIMAL(20, 4) DEFAULT 0,
        unique_traders_24h INTEGER DEFAULT 0,
        
        latest_price_sol DECIMAL(20, 12),
        latest_price_usd DECIMAL(20, 4),
        latest_market_cap_usd DECIMAL(20, 4),
        latest_virtual_sol_reserves BIGINT,
        latest_virtual_token_reserves BIGINT,
        latest_bonding_curve_progress DECIMAL(5, 2),
        latest_update_slot BIGINT,
        
        holder_count INTEGER DEFAULT 0,
        top_holder_percentage DECIMAL(5, 2) DEFAULT 0,
        metadata_enriched BOOLEAN DEFAULT FALSE,
        metadata_enriched_at TIMESTAMPTZ,
        helius_metadata JSONB,
        
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log(chalk.green('  ✓ Created table: tokens_unified'));
    
    // Create trades table
    await db.query(`
      CREATE TABLE IF NOT EXISTS trades_unified (
        id BIGSERIAL PRIMARY KEY,
        mint_address VARCHAR(64) NOT NULL,
        signature VARCHAR(128) NOT NULL,
        program VARCHAR(20) NOT NULL CHECK (program IN ('bonding_curve', 'amm_pool')),
        trade_type VARCHAR(10) NOT NULL CHECK (trade_type IN ('buy', 'sell')),
        user_address VARCHAR(64) NOT NULL,
        
        sol_amount BIGINT NOT NULL,
        token_amount BIGINT NOT NULL,
        price_sol DECIMAL(20, 12) NOT NULL,
        price_usd DECIMAL(20, 4) NOT NULL,
        market_cap_usd DECIMAL(20, 4) NOT NULL,
        
        virtual_sol_reserves BIGINT,
        virtual_token_reserves BIGINT,
        bonding_curve_progress DECIMAL(5, 2),
        
        slot BIGINT NOT NULL,
        block_time TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log(chalk.green('  ✓ Created table: trades_unified'));
    
    // Create price snapshots table
    await db.query(`
      CREATE TABLE IF NOT EXISTS price_snapshots_unified (
        id BIGSERIAL PRIMARY KEY,
        mint_address VARCHAR(64) NOT NULL,
        price_sol DECIMAL(20, 12) NOT NULL,
        price_usd DECIMAL(20, 4) NOT NULL,
        market_cap_usd DECIMAL(20, 4) NOT NULL,
        virtual_sol_reserves BIGINT,
        virtual_token_reserves BIGINT,
        bonding_curve_progress DECIMAL(5, 2),
        program VARCHAR(20) NOT NULL,
        slot BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log(chalk.green('  ✓ Created table: price_snapshots_unified'));
    
    // Create account states table
    await db.query(`
      CREATE TABLE IF NOT EXISTS account_states_unified (
        id BIGSERIAL PRIMARY KEY,
        mint_address VARCHAR(64) NOT NULL,
        program VARCHAR(20) NOT NULL,
        account_type VARCHAR(20) NOT NULL,
        virtual_sol_reserves BIGINT,
        virtual_token_reserves BIGINT,
        real_sol_reserves BIGINT,
        real_token_reserves BIGINT,
        bonding_curve_complete BOOLEAN,
        slot BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log(chalk.green('  ✓ Created table: account_states_unified'));
    
    // Create token holders table
    await db.query(`
      CREATE TABLE IF NOT EXISTS token_holders_unified (
        mint_address VARCHAR(64) NOT NULL,
        wallet_address VARCHAR(64) NOT NULL,
        balance NUMERIC(20, 0) NOT NULL,
        percentage DECIMAL(5, 2) NOT NULL,
        rank INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (mint_address, wallet_address)
      )
    `);
    console.log(chalk.green('  ✓ Created table: token_holders_unified'));
    
    // Create SOL prices table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS sol_prices (
        id SERIAL PRIMARY KEY,
        price_usd DECIMAL(10, 4) NOT NULL,
        source VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log(chalk.green('  ✓ Created table: sol_prices'));
    
    // Create schema migrations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log(chalk.green('  ✓ Created table: schema_migrations'));
    
    console.log(chalk.yellow('\nCreating indexes...'));
    
    // Create indexes
    const indexes = [
      {
        name: 'idx_tokens_unified_threshold',
        query: 'CREATE INDEX IF NOT EXISTS idx_tokens_unified_threshold ON tokens_unified(threshold_crossed_at) WHERE threshold_crossed_at IS NOT NULL'
      },
      {
        name: 'idx_tokens_unified_graduated',
        query: 'CREATE INDEX IF NOT EXISTS idx_tokens_unified_graduated ON tokens_unified(graduated_to_amm) WHERE graduated_to_amm = TRUE'
      },
      {
        name: 'idx_tokens_unified_volume',
        query: 'CREATE INDEX IF NOT EXISTS idx_tokens_unified_volume ON tokens_unified(volume_24h_usd DESC)'
      },
      {
        name: 'idx_tokens_unified_latest_mcap',
        query: 'CREATE INDEX IF NOT EXISTS idx_tokens_unified_latest_mcap ON tokens_unified(latest_market_cap_usd DESC) WHERE latest_market_cap_usd IS NOT NULL'
      },
      {
        name: 'idx_tokens_unified_created',
        query: 'CREATE INDEX IF NOT EXISTS idx_tokens_unified_created ON tokens_unified(created_at DESC)'
      },
      {
        name: 'idx_tokens_unified_program',
        query: 'CREATE INDEX IF NOT EXISTS idx_tokens_unified_program ON tokens_unified(current_program)'
      },
      {
        name: 'idx_tokens_unified_enrichment',
        query: 'CREATE INDEX IF NOT EXISTS idx_tokens_unified_enrichment ON tokens_unified(metadata_enriched, created_at)'
      },
      {
        name: 'idx_trades_unified_signature',
        query: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_unified_signature ON trades_unified(signature)'
      },
      {
        name: 'idx_trades_unified_mint_time',
        query: 'CREATE INDEX IF NOT EXISTS idx_trades_unified_mint_time ON trades_unified(mint_address, block_time DESC)'
      },
      {
        name: 'idx_trades_unified_user',
        query: 'CREATE INDEX IF NOT EXISTS idx_trades_unified_user ON trades_unified(user_address)'
      },
      {
        name: 'idx_trades_unified_slot',
        query: 'CREATE INDEX IF NOT EXISTS idx_trades_unified_slot ON trades_unified(slot DESC)'
      },
      {
        name: 'idx_price_snapshots_unified_lookup',
        query: 'CREATE INDEX IF NOT EXISTS idx_price_snapshots_unified_lookup ON price_snapshots_unified(mint_address, created_at DESC)'
      },
      {
        name: 'idx_account_states_unified_lookup',
        query: 'CREATE INDEX IF NOT EXISTS idx_account_states_unified_lookup ON account_states_unified(mint_address, created_at DESC)'
      },
      {
        name: 'idx_token_holders_unified_mint',
        query: 'CREATE INDEX IF NOT EXISTS idx_token_holders_unified_mint ON token_holders_unified(mint_address)'
      },
      {
        name: 'idx_token_holders_unified_percentage',
        query: 'CREATE INDEX IF NOT EXISTS idx_token_holders_unified_percentage ON token_holders_unified(percentage DESC)'
      },
      {
        name: 'idx_sol_prices_created',
        query: 'CREATE INDEX IF NOT EXISTS idx_sol_prices_created ON sol_prices(created_at DESC)'
      }
    ];
    
    for (const index of indexes) {
      try {
        await db.query(index.query);
        console.log(chalk.green(`  ✓ Created index: ${index.name}`));
      } catch (error: any) {
        if (error.message.includes('already exists')) {
          console.log(chalk.gray(`  - Index already exists: ${index.name}`));
        } else {
          throw error;
        }
      }
    }
    
    console.log(chalk.yellow('\nCreating functions...'));
    
    // Create update function
    await db.query(`
      CREATE OR REPLACE FUNCTION update_token_stats(
        p_mint_address VARCHAR(64)
      ) RETURNS void AS $$
      BEGIN
        UPDATE tokens_unified t
        SET 
          volume_24h_sol = COALESCE((
            SELECT SUM(sol_amount) / 1e9
            FROM trades_unified
            WHERE mint_address = p_mint_address
            AND block_time > NOW() - INTERVAL '24 hours'
          ), 0),
          volume_24h_usd = COALESCE((
            SELECT SUM(sol_amount * price_usd / price_sol) / 1e9
            FROM trades_unified
            WHERE mint_address = p_mint_address
            AND block_time > NOW() - INTERVAL '24 hours'
          ), 0),
          unique_traders_24h = COALESCE((
            SELECT COUNT(DISTINCT user_address)
            FROM trades_unified
            WHERE mint_address = p_mint_address
            AND block_time > NOW() - INTERVAL '24 hours'
          ), 0),
          total_trades = COALESCE((
            SELECT COUNT(*)
            FROM trades_unified
            WHERE mint_address = p_mint_address
          ), 0),
          total_buys = COALESCE((
            SELECT COUNT(*)
            FROM trades_unified
            WHERE mint_address = p_mint_address
            AND trade_type = 'buy'
          ), 0),
          total_sells = COALESCE((
            SELECT COUNT(*)
            FROM trades_unified
            WHERE mint_address = p_mint_address
            AND trade_type = 'sell'
          ), 0),
          updated_at = NOW()
        WHERE mint_address = p_mint_address;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log(chalk.green('  ✓ Created function: update_token_stats'));
    
    console.log(chalk.yellow('\nCreating views...'));
    
    // Skip view creation for now - will create separately
    console.log(chalk.gray('  - Skipping view creation (will create separately)'));
    
    // Record migration
    await db.query(`
      INSERT INTO schema_migrations (version, name) 
      VALUES (1, 'unified_monitoring_schema') 
      ON CONFLICT (version) DO NOTHING
    `);
    
    await db.query('COMMIT');
    
    console.log(chalk.green('\n✅ Migration completed successfully!\n'));
    
    // Show statistics
    await showStatistics();
    
  } catch (error) {
    await db.query('ROLLBACK');
    console.error(chalk.red('❌ Migration failed:'), error);
    throw error;
  } finally {
    await db.close();
  }
}

async function showStatistics() {
  console.log(chalk.cyan.bold('📊 Current Database Statistics:\n'));
  
  try {
    const tables = [
      'tokens_unified',
      'trades_unified',
      'price_snapshots_unified',
      'account_states_unified',
      'token_holders_unified'
    ];
    
    for (const table of tables) {
      const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = parseInt(result.rows[0].count);
      console.log(chalk.white(`${table}: `) + chalk.yellow(count.toLocaleString()) + ' records');
    }
    
    console.log(chalk.green('\n✨ Database is ready for unified monitoring!'));
    
  } catch (error) {
    console.error(chalk.red('Error fetching statistics:'), error);
  }
}

// Run the migration
runMigration().catch(console.error);