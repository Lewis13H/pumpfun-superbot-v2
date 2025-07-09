#!/usr/bin/env tsx

import 'dotenv/config';
import { Pool } from 'pg';

async function check288Sol() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Check for 288+ SOL
    const result = await pool.query(`
      SELECT COUNT(DISTINCT mint_address) as count
      FROM trades_unified
      WHERE virtual_sol_reserves >= 288e9
    `);
    
    console.log(`\n💎 Tokens with 288+ SOL reserves: ${result.rows[0].count}\n`);
    
    // Check for $8,888+ market cap
    const mcapResult = await pool.query(`
      SELECT COUNT(DISTINCT mint_address) as count
      FROM trades_unified
      WHERE market_cap_usd >= 8888
    `);
    
    console.log(`💰 Tokens with $8,888+ market cap: ${mcapResult.rows[0].count}\n`);
    
    // Get highest values
    const highest = await pool.query(`
      SELECT 
        MAX(virtual_sol_reserves) / 1e9 as max_sol,
        MAX(market_cap_usd) as max_mcap
      FROM trades_unified
    `);
    
    console.log(`📊 Highest values seen:`);
    console.log(`   Max SOL: ${parseFloat(highest.rows[0].max_sol).toFixed(2)} SOL`);
    console.log(`   Max Market Cap: $${parseFloat(highest.rows[0].max_mcap).toLocaleString()}\n`);
    
  } catch (error) {
    console.error('Check failed:', error);
  } finally {
    await pool.end();
  }
}

check288Sol().catch(console.error);