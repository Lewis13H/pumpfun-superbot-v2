#!/usr/bin/env tsx

/**
 * Check holder analysis data in database
 */

import { db } from '../database';
import { Logger } from '../core/logger';

const logger = new Logger({ context: 'CheckHolderAnalysisDB' });

async function checkHolderAnalysisData() {
  try {
    logger.info('Checking holder analysis data in database...\n');

    // 1. Check if holder_snapshots table exists and has data
    const snapshotCount = await db.query(`
      SELECT COUNT(*) as count FROM holder_snapshots
    `);
    logger.info(`Total holder snapshots: ${snapshotCount.rows[0].count}`);

    // 2. Check recent holder snapshots
    const recentSnapshots = await db.query(`
      SELECT 
        hs.mint_address,
        hs.holder_score,
        hs.total_holders,
        hs.snapshot_time,
        t.symbol,
        t.name
      FROM holder_snapshots hs
      LEFT JOIN tokens_unified t ON t.mint_address = hs.mint_address
      ORDER BY hs.snapshot_time DESC
      LIMIT 10
    `);
    
    logger.info('\nRecent holder snapshots:');
    recentSnapshots.rows.forEach(row => {
      logger.info(`  ${row.symbol || 'Unknown'} (${row.mint_address.substring(0, 8)}...): Score=${row.holder_score}, Holders=${row.total_holders}, Time=${row.snapshot_time}`);
    });

    // 3. Check tokens with holder scores
    const tokensWithScores = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        hs.holder_score,
        hs.total_holders,
        hs.snapshot_time
      FROM tokens_unified t
      INNER JOIN (
        SELECT DISTINCT ON (mint_address) 
          mint_address, 
          holder_score, 
          total_holders, 
          snapshot_time
        FROM holder_snapshots
        ORDER BY mint_address, snapshot_time DESC
      ) hs ON hs.mint_address = t.mint_address
      WHERE t.threshold_crossed_at IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC NULLS LAST
      LIMIT 20
    `);

    logger.info(`\nTokens with holder scores (${tokensWithScores.rows.length} found):`);
    tokensWithScores.rows.forEach(row => {
      logger.info(`  ${row.symbol}: Score=${row.holder_score}, Market Cap=$${row.latest_market_cap_usd?.toFixed(2)}, Holders=${row.total_holders}`);
    });

    // 4. Check wallet classifications
    const walletClassCount = await db.query(`
      SELECT 
        classification,
        COUNT(*) as count
      FROM wallet_classifications
      GROUP BY classification
      ORDER BY count DESC
    `);

    logger.info('\nWallet classification distribution:');
    walletClassCount.rows.forEach(row => {
      logger.info(`  ${row.classification}: ${row.count} wallets`);
    });

    // 5. Check holder analysis job queue
    const jobStats = await db.query(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM holder_analysis_jobs
      GROUP BY status
    `);

    logger.info('\nHolder analysis job queue status:');
    jobStats.rows.forEach(row => {
      logger.info(`  ${row.status}: ${row.count} jobs (oldest: ${row.oldest}, newest: ${row.newest})`);
    });

    // 6. Check specific token example
    const exampleToken = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        t.threshold_crossed_at
      FROM tokens_unified t
      WHERE t.threshold_crossed_at IS NOT NULL
        AND t.latest_market_cap_usd > 18888
      ORDER BY t.latest_market_cap_usd DESC
      LIMIT 1
    `);

    if (exampleToken.rows.length > 0) {
      const token = exampleToken.rows[0];
      logger.info(`\nChecking specific token: ${token.symbol} (${token.mint_address})`);
      
      // Check if it has holder analysis
      const holderData = await db.query(`
        SELECT * FROM holder_snapshots 
        WHERE mint_address = $1 
        ORDER BY snapshot_time DESC 
        LIMIT 1
      `, [token.mint_address]);

      if (holderData.rows.length > 0) {
        logger.info('  Has holder analysis:', holderData.rows[0]);
      } else {
        logger.warn('  NO HOLDER ANALYSIS FOUND!');
        
        // Check if it's in the job queue
        const jobData = await db.query(`
          SELECT * FROM holder_analysis_jobs 
          WHERE mint_address = $1
          ORDER BY created_at DESC
          LIMIT 1
        `, [token.mint_address]);
        
        if (jobData.rows.length > 0) {
          logger.info('  Job status:', jobData.rows[0]);
        } else {
          logger.warn('  NOT IN JOB QUEUE!');
        }
      }
    }

    // 7. Check API query that dashboard uses
    logger.info('\nTesting API query used by dashboard:');
    const apiQuery = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
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

    apiQuery.rows.forEach(row => {
      logger.info(`  ${row.symbol}: holder_score = ${row.holder_score || 'NULL'}`);
    });

  } catch (error) {
    logger.error('Database check failed:', error);
  } finally {
    await db.end();
  }
}

// Run check
checkHolderAnalysisData().then(() => {
  logger.info('\nDatabase check completed');
  process.exit(0);
}).catch(error => {
  logger.error('Script error:', error);
  process.exit(1);
});