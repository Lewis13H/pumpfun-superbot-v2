#\!/usr/bin/env tsx

import 'dotenv/config';
import { Pool } from 'pg';

async function checkAmmTrades() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n🔍 Checking for AMM Trades\n');

    const ammTrades = await pool.query(`
      SELECT 
        program,
        COUNT(*) as trade_count,
        COUNT(DISTINCT mint_address) as unique_tokens
      FROM trades_unified
      GROUP BY program
      ORDER BY trade_count DESC
    `);

    console.log('Trade distribution by program:');
    for (const row of ammTrades.rows) {
      console.log(`  ${row.program}: ${row.trade_count} trades (${row.unique_tokens} tokens)`);
    }

    const graduatedCandidates = await pool.query(`
      SELECT 
        mint_address,
        MAX(virtual_sol_reserves) / 1e9 as max_sol,
        COUNT(*) as trades
      FROM trades_unified
      WHERE virtual_sol_reserves IS NOT NULL
      GROUP BY mint_address
      HAVING MAX(virtual_sol_reserves) > 84e9
      ORDER BY max_sol DESC
    `);

    console.log(`\nTokens that might be graduated (>84 SOL):`);
    for (const token of graduatedCandidates.rows) {
      console.log(`  ${token.mint_address}: ${parseFloat(token.max_sol).toFixed(2)} SOL`);
    }

  } catch (error) {
    console.error('Check failed:', error);
  } finally {
    await pool.end();
  }
}

checkAmmTrades().catch(console.error);
EOF < /dev/null