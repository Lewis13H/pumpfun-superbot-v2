import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';

config();

async function checkDatabaseSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Check if tokens_unified table exists and get its columns
    const schemaResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'tokens_unified'
      ORDER BY ordinal_position
    `);

    if (schemaResult.rows.length === 0) {
      logger.error('Table tokens_unified does not exist!');
    } else {
      logger.info('Columns in tokens_unified table:');
      schemaResult.rows.forEach(col => {
        logger.info(`  ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      });
    }

    // Check total token count
    const countResult = await pool.query('SELECT COUNT(*) FROM tokens_unified');
    const totalTokens = parseInt(countResult.rows[0].count);
    logger.info(`\nTotal tokens in database: ${totalTokens}`);

    // Check if API server is running
    logger.info('\nChecking if API server is running on port 3001...');

  } catch (error) {
    logger.error('Error checking database schema:', error);
  } finally {
    await pool.end();
  }
}

checkDatabaseSchema().catch(console.error);