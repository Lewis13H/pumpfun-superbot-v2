#!/usr/bin/env tsx

/**
 * Fix tokens with NULL symbols
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { Logger } from '../core/logger';

const logger = new Logger({ context: 'FixNullSymbols' });

async function fixNullSymbols() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    logger.info('Checking for tokens with NULL symbols...\n');
    
    // Find tokens with NULL symbols
    const nullSymbols = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        threshold_crossed_at
      FROM tokens_unified
      WHERE symbol IS NULL
        AND threshold_crossed_at IS NOT NULL
      ORDER BY latest_market_cap_usd DESC
      LIMIT 10
    `);
    
    logger.info(`Found ${nullSymbols.rows.length} tokens with NULL symbols`);
    
    if (nullSymbols.rows.length > 0) {
      logger.info('\nTokens with NULL symbols:');
      nullSymbols.rows.forEach(row => {
        logger.info(`  ${row.mint_address}: ${row.name || 'NO NAME'} - $${parseFloat(row.latest_market_cap_usd || 0).toFixed(2)}`);
      });
      
      // Try to enrich these tokens
      logger.info('\nAttempting to enrich metadata for these tokens...');
      
      // Just mark them for enrichment
      const updateResult = await pool.query(`
        UPDATE tokens_unified
        SET is_enriched = false,
            enrichment_attempts = 0
        WHERE symbol IS NULL
          AND threshold_crossed_at IS NOT NULL
      `);
      
      logger.info(`Marked ${updateResult.rowCount} tokens for re-enrichment`);
      logger.info('The auto-enricher should pick these up and fetch their metadata');
    }
    
    // Also check why holder analysis system analyzed tokens with score 85
    logger.info('\n--- Checking tokens with holder score 85 ---');
    const score85Tokens = await pool.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        hs.holder_score,
        hs.total_holders,
        hs.snapshot_time
      FROM tokens_unified t
      INNER JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE hs.holder_score = 85
      ORDER BY hs.snapshot_time DESC
    `);
    
    logger.info(`\nTokens with score 85 (${score85Tokens.rows.length} found):`);
    score85Tokens.rows.forEach(row => {
      logger.info(`  ${row.symbol}: ${row.total_holders} holders (analyzed at ${row.snapshot_time})`);
    });
    
  } catch (error) {
    logger.error('Fix failed:', error);
  } finally {
    await pool.end();
  }
}

// Run fix
fixNullSymbols().then(() => {
  logger.info('\nFix completed');
  process.exit(0);
}).catch(error => {
  logger.error('Script error:', error);
  process.exit(1);
});