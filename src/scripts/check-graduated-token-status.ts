#!/usr/bin/env tsx

/**
 * Check the status of tokens that should be graduated
 */

import 'dotenv/config';
import { Pool } from 'pg';

async function checkGraduatedTokenStatus() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n🎓 Checking Graduated Token Status\n');
    
    // Get tokens with >84 SOL (graduation threshold)
    const graduatedCandidates = await pool.query(`
      SELECT 
        mint_address,
        MAX(virtual_sol_reserves) / 1e9 as max_sol,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen,
        COUNT(*) as trade_count,
        MAX(market_cap_usd) as max_mcap
      FROM trades_unified
      WHERE virtual_sol_reserves > 84e9
      GROUP BY mint_address
      ORDER BY max_sol DESC
    `);
    
    console.log(`Found ${graduatedCandidates.rows.length} tokens that should be graduated:\n`);
    
    for (const token of graduatedCandidates.rows) {
      console.log(`Token: ${token.mint_address}`);
      console.log(`  Max SOL: ${parseFloat(token.max_sol).toFixed(2)} SOL`);
      console.log(`  Max Market Cap: $${parseFloat(token.max_mcap).toLocaleString()}`);
      console.log(`  Trades: ${token.trade_count}`);
      console.log(`  First seen: ${new Date(token.first_seen).toLocaleTimeString()}`);
      console.log(`  Last seen: ${new Date(token.last_seen).toLocaleTimeString()}`);
      
      // Check if token exists in tokens_unified
      const tokenRecord = await pool.query(`
        SELECT graduated_to_amm, bonding_curve_complete 
        FROM tokens_unified 
        WHERE mint_address = $1
      `, [token.mint_address]);
      
      if (tokenRecord.rows.length > 0) {
        console.log(`  In DB: ✅ Graduated: ${tokenRecord.rows[0].graduated_to_amm}, Complete: ${tokenRecord.rows[0].bonding_curve_complete}`);
      } else {
        console.log(`  In DB: ❌ Not saved (below $8,888 threshold)`);
      }
      console.log();
    }
    
    console.log('📊 Summary:');
    console.log('- These tokens have graduated (>84 SOL)');
    console.log('- But their market caps are still below $8,888');
    console.log('- They are likely trading on Raydium or pump.swap');
    console.log('- Need to monitor graduated DEXs to track them');
    
  } catch (error) {
    console.error('Check failed:', error);
  } finally {
    await pool.end();
  }
}

checkGraduatedTokenStatus().catch(console.error);