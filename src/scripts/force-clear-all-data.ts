#!/usr/bin/env tsx

/**
 * Script to forcefully clear ALL data from the database
 * 
 * WARNING: This will DELETE ALL DATA from all tables!
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { logger } from '../core/logger';

async function forceClearAllData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n⚠️  WARNING: This will FORCEFULLY DELETE ALL DATA from the database!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    
    // Give user time to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('🗑️  Starting forceful database cleanup...\n');

    // Get all tables
    const tablesQuery = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename NOT LIKE 'pg_%'
      ORDER BY tablename
    `);

    const tables = tablesQuery.rows.map(row => row.tablename);
    console.log(`Found ${tables.length} tables to clear.\n`);

    // Clear each table individually with CASCADE
    for (const table of tables) {
      try {
        // Use DELETE instead of TRUNCATE for tables with foreign keys
        const deleteResult = await pool.query(`DELETE FROM ${table}`);
        console.log(`✅ Cleared table: ${table} (${deleteResult.rowCount} rows deleted)`);
      } catch (error: any) {
        console.error(`❌ Failed to clear ${table}:`, error.message);
        
        // Try TRUNCATE with CASCADE as fallback
        try {
          await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
          console.log(`✅ Cleared table: ${table} (using CASCADE)`);
        } catch (truncateError: any) {
          console.error(`❌ Also failed with CASCADE:`, truncateError.message);
        }
      }
    }

    // Reset all sequences
    console.log('\n🔄 Resetting sequences...');
    const sequences = await pool.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public'
    `);

    for (const row of sequences.rows) {
      try {
        await pool.query(`ALTER SEQUENCE ${row.sequence_name} RESTART WITH 1`);
        console.log(`✅ Reset sequence: ${row.sequence_name}`);
      } catch (error: any) {
        console.error(`❌ Failed to reset sequence ${row.sequence_name}:`, error.message);
      }
    }

    // Verify all tables are empty
    console.log('\n📊 Verifying tables are empty:');
    let totalRecords = 0;
    
    for (const table of tables) {
      try {
        const count = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        const recordCount = parseInt(count.rows[0].count);
        totalRecords += recordCount;
        
        if (recordCount > 0) {
          console.log(`⚠️  ${table}: ${recordCount} records remaining`);
        } else {
          console.log(`✅ ${table}: 0 records`);
        }
      } catch (error) {
        console.error(`❌ Could not count ${table}:`, error);
      }
    }

    if (totalRecords === 0) {
      console.log('\n✅ All tables successfully cleared!');
    } else {
      console.log(`\n⚠️  Warning: ${totalRecords} records still remain in the database.`);
      console.log('You may need to manually drop and recreate the database.');
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
forceClearAllData()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });