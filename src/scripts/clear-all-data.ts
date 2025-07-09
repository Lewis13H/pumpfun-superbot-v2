#!/usr/bin/env tsx

/**
 * Script to clear all data from the database while preserving schema
 * 
 * WARNING: This will delete ALL data from all tables!
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { logger } from '../core/logger';

async function clearAllData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n⚠️  WARNING: This will DELETE ALL DATA from the database!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    
    // Give user time to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('🗑️  Starting database cleanup...\n');

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Disable foreign key checks temporarily
      await pool.query('SET session_replication_role = replica');

      // List of tables to truncate in order (respecting dependencies)
      const tables = [
        // Holder analysis tables
        'holder_alerts',
        'holder_trends',
        'token_holder_details',
        'holder_snapshots',
        'holder_analysis_metadata',
        'wallet_classifications',
        
        // Trading and liquidity tables
        'trades_unified',
        'liquidity_events',
        'amm_fee_events',
        'lp_positions',
        'amm_pool_metrics_hourly',
        
        // Token tables
        'bonding_curve_mappings',
        'tokens_unified',
        
        // Any other tables that might exist
        'token_metadata',
        'price_history',
        'graduation_events'
      ];

      for (const table of tables) {
        try {
          const result = await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
          console.log(`✅ Cleared table: ${table}`);
        } catch (error: any) {
          if (error.code === '42P01') {
            console.log(`⏭️  Skipped table: ${table} (does not exist)`);
          } else {
            throw error;
          }
        }
      }

      // Re-enable foreign key checks
      await pool.query('SET session_replication_role = DEFAULT');

      // Reset sequences
      console.log('\n🔄 Resetting sequences...');
      const sequences = await pool.query(`
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_schema = 'public'
      `);

      for (const row of sequences.rows) {
        await pool.query(`ALTER SEQUENCE ${row.sequence_name} RESTART WITH 1`);
        console.log(`✅ Reset sequence: ${row.sequence_name}`);
      }

      // Commit transaction
      await pool.query('COMMIT');
      
      console.log('\n✅ Database cleared successfully!');
      console.log('All data has been removed, but the schema remains intact.');

      // Show table counts to confirm
      console.log('\n📊 Table record counts:');
      for (const table of tables) {
        try {
          const count = await pool.query(`SELECT COUNT(*) FROM ${table}`);
          console.log(`  ${table}: ${count.rows[0].count} records`);
        } catch (error) {
          // Skip if table doesn't exist
        }
      }

    } catch (error) {
      // Rollback on error
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    logger.error('Failed to clear database:', error);
    console.error('\n❌ Failed to clear database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
clearAllData()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });