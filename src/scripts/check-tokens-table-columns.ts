#!/usr/bin/env tsx

/**
 * Check tokens_unified table columns
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { Logger } from '../core/logger';

const logger = new Logger({ context: 'CheckColumns' });

async function checkColumns() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    logger.info('Checking tokens_unified table columns...\n');
    
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tokens_unified' 
        AND column_name LIKE '%market_cap%' OR column_name LIKE '%price%'
      ORDER BY ordinal_position
    `);
    
    logger.info('Price/Market cap related columns:');
    result.rows.forEach(row => {
      logger.info(`  ${row.column_name}: ${row.data_type}`);
    });
    
  } catch (error) {
    logger.error('Check failed:', error);
  } finally {
    await pool.end();
  }
}

checkColumns().then(() => {
  process.exit(0);
}).catch(error => {
  logger.error('Script error:', error);
  process.exit(1);
});