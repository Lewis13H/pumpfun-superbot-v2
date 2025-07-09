#!/usr/bin/env tsx

/**
 * Check how many tokens have market cap above 288 SOL ($8,888)
 */

import 'dotenv/config';
import { Pool } from 'pg';

async function checkHighValueTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n💎 Checking for High Value Tokens (288+ SOL)\n');
    
    // Check trades for tokens with 288+ SOL reserves
    const highValueTokens = await pool.query(`
      SELECT 
        mint_address,
        MAX(virtual_sol_reserves) / 1e9 as max_sol,
        MAX(market_cap_usd) as max_mcap,
        COUNT(*) as trade_count,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen
      FROM trades_unified
      WHERE virtual_sol_reserves >= 288e9
      GROUP BY mint_address
      ORDER BY max_sol DESC
    `);
    
    console.log(`Tokens with 288+ SOL reserves: ${highValueTokens.rows.length}`);
    
    if (highValueTokens.rows.length > 0) {
      console.log('\nHigh value tokens found:');
      for (const token of highValueTokens.rows) {
        console.log(`\n${token.mint_address}`);
        console.log(`  Max SOL: ${parseFloat(token.max_sol).toFixed(2)}`);
        console.log(`  Max Market Cap: $${parseFloat(token.max_mcap).toLocaleString()}`);
        console.log(`  Trades: ${token.trade_count}`);
        console.log(`  Time range: ${new Date(token.first_seen).toLocaleTimeString()} - ${new Date(token.last_seen).toLocaleTimeString()}`);
      }
    }
    
    // Also check by market cap directly
    const highMcapTokens = await pool.query(`
      SELECT 
        mint_address,
        MAX(market_cap_usd) as max_mcap,
        MAX(virtual_sol_reserves) / 1e9 as max_sol,
        COUNT(*) as trades
      FROM trades_unified
      WHERE market_cap_usd >= 8888
      GROUP BY mint_address
      ORDER BY max_mcap DESC
    `);
    
    console.log(`\nTokens with $8,888+ market cap: ${highMcapTokens.rows.length}`);
    
    // Check distribution
    const distribution = await pool.query(`
      WITH token_max_sol AS (
        SELECT 
          mint_address,
          MAX(virtual_sol_reserves) as max_sol
        FROM trades_unified
        GROUP BY mint_address
      )
      SELECT 
        CASE 
          WHEN max_sol >= 288e9 THEN '288+ SOL ($8,888+)'
          WHEN max_sol >= 100e9 THEN '100-288 SOL'
          WHEN max_sol >= 84e9 THEN '84-100 SOL (graduated)'
          WHEN max_sol >= 50e9 THEN '50-84 SOL'
          ELSE '<50 SOL'
        END as sol_range,
        COUNT(*) as token_count
      FROM token_max_sol
      GROUP BY sol_range
      ORDER BY 
        CASE sol_range
          WHEN '288+ SOL ($8,888+)' THEN 0
          WHEN '100-288 SOL' THEN 1
          WHEN '84-100 SOL (graduated)' THEN 2
          WHEN '50-84 SOL' THEN 3
          ELSE 4
        END
    `);
    
    console.log('\n📊 Token Distribution by SOL Reserves:');
    for (const row of distribution.rows) {
      console.log(`  ${row.sol_range}: ${row.token_count} tokens`);
    }
    
    // Summary
    const totalTokens = await pool.query(`
      SELECT COUNT(DISTINCT mint_address) as count FROM trades_unified
    `);
    
    console.log(`\n📈 Summary:`);
    console.log(`  Total unique tokens: ${totalTokens.rows[0].count}`);
    console.log(`  Tokens above $8,888: ${highMcapTokens.rows.length} (${(highMcapTokens.rows.length / totalTokens.rows[0].count * 100).toFixed(1)}%)`);
    console.log(`  Tokens graduated (84+ SOL): 7`);
    console.log(`  Highest market cap: $${highValueTokens.rows.length > 0 ? parseFloat(highValueTokens.rows[0].max_mcap).toLocaleString() : parseFloat(highMcapTokens.rows[0]?.max_mcap || 0).toLocaleString()}`);
    
  } catch (error) {
    console.error('Check failed:', error);
  } finally {
    await pool.end();
  }
}

checkHighValueTokens().catch(console.error);