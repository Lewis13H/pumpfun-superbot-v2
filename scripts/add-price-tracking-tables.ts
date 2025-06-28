#!/usr/bin/env node
/**
 * Add price tracking tables for AMM Session 2
 */

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function migrate() {
  try {
    console.log(chalk.cyan('🔄 Adding price tracking tables...'));
    
    // Create price_update_sources table
    await db.query(`
      CREATE TABLE IF NOT EXISTS price_update_sources (
        id BIGSERIAL PRIMARY KEY,
        mint_address VARCHAR(64) NOT NULL,
        update_source VARCHAR(20) NOT NULL CHECK (update_source IN ('amm_trade', 'websocket', 'graphql', 'manual')),
        price_sol DECIMAL(20,12),
        price_usd DECIMAL(20,4),
        market_cap_usd DECIMAL(20,4),
        reserves_sol BIGINT,
        reserves_token BIGINT,
        latency_ms INTEGER,
        slot BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    console.log(chalk.green('✅ Created price_update_sources table'));
    
    // Add indexes for performance
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_price_update_sources_mint_time 
      ON price_update_sources(mint_address, created_at DESC);
    `);
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_price_update_sources_source 
      ON price_update_sources(update_source, created_at DESC);
    `);
    
    console.log(chalk.green('✅ Created indexes'));
    
    // Add columns to tokens_unified if they don't exist
    await db.query(`
      ALTER TABLE tokens_unified 
      ADD COLUMN IF NOT EXISTS latest_price_sol DECIMAL(20,12),
      ADD COLUMN IF NOT EXISTS latest_price_usd DECIMAL(20,4),
      ADD COLUMN IF NOT EXISTS latest_market_cap_usd DECIMAL(20,4),
      ADD COLUMN IF NOT EXISTS latest_virtual_sol_reserves BIGINT,
      ADD COLUMN IF NOT EXISTS latest_virtual_token_reserves BIGINT,
      ADD COLUMN IF NOT EXISTS latest_update_slot BIGINT,
      ADD COLUMN IF NOT EXISTS price_change_1h DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS price_change_24h DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);
    
    console.log(chalk.green('✅ Updated tokens_unified table'));
    
    // Create trigger to update updated_at
    await db.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    
    await db.query(`
      DROP TRIGGER IF EXISTS update_tokens_unified_updated_at ON tokens_unified;
      
      CREATE TRIGGER update_tokens_unified_updated_at 
      BEFORE UPDATE ON tokens_unified 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
    `);
    
    console.log(chalk.green('✅ Created update trigger'));
    
    console.log(chalk.green('\n✅ Price tracking tables migration complete!'));
    
  } catch (error) {
    console.error(chalk.red('Error during migration:'), error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run migration
migrate().catch(console.error);