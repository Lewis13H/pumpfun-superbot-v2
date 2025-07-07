#!/usr/bin/env node

/**
 * Run migration to add bonding_curve_complete column
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { configService } from '../core/config';

async function runMigration() {
  const pool = new Pool({
    connectionString: configService.get('database').url
  });

  try {
    console.log('🚀 Running bonding curve complete status migration...');
    
    // Read migration SQL
    const migrationPath = path.join(__dirname, '../database/migrations/add-bonding-curve-complete-status.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await pool.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify the column was added
    const result = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'tokens_unified' 
        AND column_name = 'bonding_curve_complete'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Column verified:', result.rows[0]);
    } else {
      console.error('❌ Column not found after migration');
    }
    
    // Check how many tokens were updated
    const updateResult = await pool.query(`
      SELECT COUNT(*) as graduated_updated 
      FROM tokens_unified 
      WHERE graduated_to_amm = true 
        AND bonding_curve_complete = true
    `);
    
    console.log(`✅ Updated ${updateResult.rows[0].graduated_updated} graduated tokens with complete = true`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
runMigration().catch(console.error);