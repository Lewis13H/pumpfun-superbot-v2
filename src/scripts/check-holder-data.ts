#!/usr/bin/env node
/**
 * Check holder analysis data in database
 */

import { db } from '../database';

async function checkData() {
  const pool = db.getPool();
  
  try {
    // Check holder_analysis_metadata
    const metadataResult = await pool.query('SELECT COUNT(*) as count, status FROM holder_analysis_metadata GROUP BY status');
    console.log('\nHolder Analysis Metadata by status:');
    console.log(metadataResult.rows);
    
    // Check holder_snapshots
    const snapshotsResult = await pool.query('SELECT COUNT(*) as count FROM holder_snapshots');
    console.log('\nTotal Holder Snapshots:', snapshotsResult.rows[0].count);
    
    // Check tokens with high market cap
    const tokensResult = await pool.query(`
      SELECT mint_address, symbol, name, latest_market_cap_usd 
      FROM tokens_unified 
      WHERE latest_market_cap_usd > 18888 
      ORDER BY latest_market_cap_usd DESC 
      LIMIT 10
    `);
    console.log('\nTop 10 tokens by market cap (> $18,888):');
    tokensResult.rows.forEach((token: any, i: number) => {
      console.log(`${i+1}. ${token.symbol} (${token.mint_address}) - $${parseFloat(token.latest_market_cap_usd).toLocaleString()}`);
    });
    
    // Check if we have any holder score data in metadata
    const scoreResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM holder_analysis_metadata 
      WHERE holder_score IS NOT NULL
    `);
    console.log('\nMetadata entries with holder scores:', scoreResult.rows[0].count);
    
    // Check snapshots with scores
    const snapshotScoreResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM holder_snapshots 
      WHERE holder_score IS NOT NULL
    `);
    console.log('Snapshots with holder scores:', snapshotScoreResult.rows[0].count);
    
    // Get sample of completed analyses
    const sampleResult = await pool.query(`
      SELECT 
        ham.mint_address,
        ham.status,
        ham.holder_score,
        ham.holder_count,
        ham.created_at,
        t.symbol,
        t.latest_market_cap_usd
      FROM holder_analysis_metadata ham
      LEFT JOIN tokens_unified t ON ham.mint_address = t.mint_address
      WHERE ham.status = 'completed'
      ORDER BY ham.created_at DESC
      LIMIT 5
    `);
    console.log('\nRecent completed analyses:');
    sampleResult.rows.forEach((row: any) => {
      console.log(`- ${row.symbol || row.mint_address}: Score=${row.holder_score || 'N/A'}, Holders=${row.holder_count || 'N/A'}, Market Cap=$${row.latest_market_cap_usd ? parseFloat(row.latest_market_cap_usd).toLocaleString() : 'N/A'}`);
    });
    
    // Check latest snapshots with scores
    const latestSnapshotsResult = await pool.query(`
      SELECT 
        hs.mint_address,
        hs.holder_score,
        hs.total_holders,
        hs.top_10_percentage,
        hs.created_at,
        t.symbol,
        t.latest_market_cap_usd
      FROM holder_snapshots hs
      LEFT JOIN tokens_unified t ON hs.mint_address = t.mint_address
      WHERE hs.holder_score IS NOT NULL
      ORDER BY hs.created_at DESC
      LIMIT 5
    `);
    console.log('\nRecent snapshots with scores:');
    latestSnapshotsResult.rows.forEach((row: any) => {
      console.log(`- ${row.symbol || row.mint_address}: Score=${row.holder_score}, Holders=${row.total_holders}, Top10=${row.top_10_percentage}%`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.close();
  }
}

checkData();