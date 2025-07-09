#!/usr/bin/env tsx

/**
 * Debug holder analysis data flow
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { Logger } from '../core/logger';

const logger = new Logger({ context: 'DebugHolderAnalysis' });

async function debugHolderAnalysis() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    logger.info('Debugging holder analysis data flow...\n');

    // 1. Check if tables exist
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('holder_snapshots', 'wallet_classifications', 'holder_distributions')
      ORDER BY table_name
    `);
    
    logger.info('Holder analysis tables found:');
    tables.rows.forEach(row => {
      logger.info(`  - ${row.table_name}`);
    });

    // 2. Check holder_snapshots structure
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'holder_snapshots'
      ORDER BY ordinal_position
    `);
    
    logger.info('\nholder_snapshots columns:');
    columns.rows.forEach(row => {
      logger.info(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

    // 3. Check if any analysis is running
    logger.info('\n--- Checking current state ---');
    
    // Count snapshots
    const snapshotCount = await pool.query('SELECT COUNT(*) FROM holder_snapshots');
    logger.info(`Total snapshots: ${snapshotCount.rows[0].count}`);
    
    // Get a high-value token without analysis
    const eligibleTokens = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        t.threshold_crossed_at,
        EXISTS(
          SELECT 1 FROM holder_snapshots hs 
          WHERE hs.mint_address = t.mint_address
        ) as has_analysis
      FROM tokens_unified t
      WHERE t.latest_market_cap_usd > 18888
        AND t.threshold_crossed_at IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC
      LIMIT 10
    `);
    
    logger.info('\nEligible tokens for analysis:');
    eligibleTokens.rows.forEach(row => {
      logger.info(`  ${row.symbol}: $${parseFloat(row.latest_market_cap_usd || 0).toFixed(2)} - Has analysis: ${row.has_analysis}`);
    });

    // 4. Test a manual holder analysis trigger
    if (eligibleTokens.rows.length > 0) {
      const testToken = eligibleTokens.rows.find(t => !t.has_analysis) || eligibleTokens.rows[0];
      logger.info(`\nTesting token: ${testToken.symbol} (${testToken.mint_address})`);
      
      // Check if holder analysis service is processing
      logger.info('Checking if holder analysis integration is active...');
      
      // Look for recent holder analysis attempts
      const recentAttempts = await pool.query(`
        SELECT 
          mint_address,
          created_at,
          snapshot_time
        FROM holder_snapshots
        WHERE created_at > NOW() - INTERVAL '1 hour'
        ORDER BY created_at DESC
        LIMIT 5
      `);
      
      if (recentAttempts.rows.length > 0) {
        logger.info('Recent holder analysis attempts found:');
        recentAttempts.rows.forEach(row => {
          logger.info(`  ${row.mint_address.substring(0, 8)}... at ${row.created_at}`);
        });
      } else {
        logger.warn('NO RECENT HOLDER ANALYSIS ATTEMPTS FOUND!');
        logger.warn('The holder analysis system may not be running.');
      }
    }

    // 5. Check the API query
    logger.info('\n--- Testing API query ---');
    const apiResult = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.latest_market_cap_usd,
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as holder_score
      FROM tokens_unified t
      WHERE t.threshold_crossed_at IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC NULLS LAST
      LIMIT 5
    `);
    
    logger.info('API query results:');
    apiResult.rows.forEach(row => {
      logger.info(`  ${row.symbol}: score = ${row.holder_score || 'NULL'} (mcap: $${parseFloat(row.latest_market_cap_usd || 0).toFixed(2)})`);
    });

  } catch (error) {
    logger.error('Debug failed:', error);
  } finally {
    await pool.end();
  }
}

// Run debug
debugHolderAnalysis().then(() => {
  logger.info('\nDebug completed');
  process.exit(0);
}).catch(error => {
  logger.error('Script error:', error);
  process.exit(1);
});