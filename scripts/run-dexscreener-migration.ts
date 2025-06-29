#!/usr/bin/env tsx
/**
 * Run DexScreener migration
 */

import { db } from '../src/database';

async function main() {
  try {
    // Add DexScreener timestamp column
    await db.query(`
      ALTER TABLE tokens_unified 
      ADD COLUMN IF NOT EXISTS last_dexscreener_update TIMESTAMP
    `);
    
    console.log('✅ Added last_dexscreener_update column');
    
    // Add index for stale graduated tokens
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_tokens_graduated_stale 
      ON tokens_unified(graduated_to_amm, updated_at) 
      WHERE graduated_to_amm = TRUE
    `);
    
    console.log('✅ Added index for stale graduated tokens');
    
    await db.close();
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

main();