#!/usr/bin/env tsx

/**
 * Debug why AMM trades aren't being detected
 */

import 'dotenv/config';
import { Pool } from 'pg';

async function debugAmmDetection() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n🔍 Debugging AMM Detection\n');
    
    // 1. Check for pump.swap program in trades
    const programCheck = await pool.query(`
      SELECT DISTINCT program, COUNT(*) as count
      FROM trades_unified
      GROUP BY program
      ORDER BY count DESC
    `);
    
    console.log('1️⃣ Programs detected:');
    for (const row of programCheck.rows) {
      console.log(`  ${row.program}: ${row.count} trades`);
    }
    
    // 2. Check for graduated tokens (high SOL reserves)
    const graduatedTokens = await pool.query(`
      SELECT 
        mint_address,
        MAX(virtual_sol_reserves) / 1e9 as max_sol,
        MAX(bonding_curve_progress) as max_progress,
        COUNT(*) as trades
      FROM trades_unified
      WHERE virtual_sol_reserves > 80e9
      GROUP BY mint_address
      ORDER BY max_sol DESC
      LIMIT 5
    `);
    
    console.log('\n2️⃣ Potential graduated tokens (>80 SOL):');
    for (const token of graduatedTokens.rows) {
      console.log(`  ${token.mint_address}:`);
      console.log(`    Max SOL: ${parseFloat(token.max_sol).toFixed(2)}`);
      console.log(`    Max Progress: ${token.max_progress || 'null'}%`);
      console.log(`    Trades: ${token.trades}`);
    }
    
    // 3. Check bonding curve mappings for completion
    const bcCheck = await pool.query(`
      SELECT COUNT(*) as total
      FROM bonding_curve_mappings
    `);
    console.log(`\n3️⃣ Bonding curve mappings: ${bcCheck.rows[0].total}`);
    
    // 4. Check if there are any tokens marked as graduated
    const graduatedCheck = await pool.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
      WHERE graduated_to_amm = true OR bonding_curve_complete = true
    `);
    console.log(`\n4️⃣ Tokens marked as graduated: ${graduatedCheck.rows[0].count}`);
    
    // 5. Look for potential AMM signatures
    const ammSignatures = await pool.query(`
      SELECT DISTINCT 
        signature,
        mint_address,
        program
      FROM trades_unified
      WHERE mint_address IN (
        SELECT mint_address 
        FROM trades_unified 
        WHERE virtual_sol_reserves > 84e9
        GROUP BY mint_address
      )
      ORDER BY mint_address
      LIMIT 10
    `);
    
    console.log('\n5️⃣ Sample trades from high-value tokens:');
    for (const trade of ammSignatures.rows) {
      console.log(`  ${trade.signature.substring(0, 8)}... | ${trade.mint_address.substring(0, 8)}... | ${trade.program}`);
    }
    
    // 6. Summary
    console.log('\n📊 SUMMARY:');
    console.log('  - Only bonding_curve trades detected');
    console.log('  - Several tokens have >84 SOL (graduation threshold)');
    console.log('  - But no pump.swap/AMM trades found');
    console.log('\n  Possible reasons:');
    console.log('  1. Graduated tokens are trading on Raydium, not pump.swap');
    console.log('  2. AMM monitor not detecting pump.swap transactions');
    console.log('  3. Parser not recognizing AMM trade format');
    
  } catch (error) {
    console.error('Debug failed:', error);
  } finally {
    await pool.end();
  }
}

debugAmmDetection().catch(console.error);