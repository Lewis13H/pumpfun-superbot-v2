/**
 * Fix graduation logic issues
 * 1. Reset incorrectly graduated tokens
 * 2. Only mark as graduated when AMM trades are detected
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

async function fixGraduationLogic() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔧 Fixing Graduation Logic\n');

    // 1. Check current state
    const currentState = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated_count,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as complete_count,
        COUNT(*) FILTER (WHERE current_program = 'amm_pool') as amm_count,
        COUNT(*) as total_count
      FROM tokens_unified
    `);

    console.log('Current State:');
    console.log(`- Total tokens: ${currentState.rows[0].total_count}`);
    console.log(`- Marked as graduated: ${currentState.rows[0].graduated_count}`);
    console.log(`- Bonding curve complete: ${currentState.rows[0].complete_count}`);
    console.log(`- Current program = AMM: ${currentState.rows[0].amm_count}\n`);

    // 2. Find tokens that are incorrectly marked as graduated (no AMM trades)
    const incorrectlyGraduated = await pool.query(`
      SELECT t.mint_address, t.symbol, t.name, t.latest_market_cap_usd,
             t.bonding_curve_complete, t.graduated_to_amm,
             (SELECT COUNT(*) FROM trades_unified tr 
              WHERE tr.mint_address = t.mint_address 
              AND tr.program = 'amm_pool') as amm_trade_count
      FROM tokens_unified t
      WHERE t.graduated_to_amm = true
      AND NOT EXISTS (
        SELECT 1 FROM trades_unified tr 
        WHERE tr.mint_address = t.mint_address 
        AND tr.program = 'amm_pool'
      )
    `);

    if (incorrectlyGraduated.rows.length > 0) {
      console.log(`Found ${incorrectlyGraduated.rows.length} incorrectly graduated tokens:\n`);
      
      for (const token of incorrectlyGraduated.rows) {
        console.log(`- ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
        console.log(`  Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
        console.log(`  BC Complete: ${token.bonding_curve_complete}`);
        console.log(`  AMM Trades: ${token.amm_trade_count}\n`);
      }

      // Reset these tokens
      const resetResult = await pool.query(`
        UPDATE tokens_unified
        SET graduated_to_amm = false,
            current_program = 'bonding_curve',
            updated_at = NOW()
        WHERE graduated_to_amm = true
        AND NOT EXISTS (
          SELECT 1 FROM trades_unified tr 
          WHERE tr.mint_address = tokens_unified.mint_address 
          AND tr.program = 'amm_pool'
        )
        RETURNING mint_address, symbol
      `);

      console.log(`✅ Reset ${resetResult.rowCount} incorrectly graduated tokens\n`);
    }

    // 3. Find tokens with AMM trades that aren't marked as graduated
    const unmarkGraduated = await pool.query(`
      SELECT t.mint_address, t.symbol, t.name, t.latest_market_cap_usd,
             COUNT(tr.signature) as amm_trade_count,
             MIN(tr.created_at) as first_amm_trade
      FROM tokens_unified t
      INNER JOIN trades_unified tr ON t.mint_address = tr.mint_address
      WHERE tr.program = 'amm_pool'
      AND (t.graduated_to_amm = false OR t.graduated_to_amm IS NULL)
      GROUP BY t.mint_address, t.symbol, t.name, t.latest_market_cap_usd
    `);

    if (unmarkGraduated.rows.length > 0) {
      console.log(`Found ${unmarkGraduated.rows.length} tokens with AMM trades not marked as graduated:\n`);
      
      for (const token of unmarkGraduated.rows) {
        console.log(`- ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
        console.log(`  Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
        console.log(`  AMM Trades: ${token.amm_trade_count}`);
        console.log(`  First AMM Trade: ${token.first_amm_trade}\n`);
      }

      // Mark these as graduated
      const markResult = await pool.query(`
        UPDATE tokens_unified
        SET graduated_to_amm = true,
            bonding_curve_complete = true,
            current_program = 'amm_pool',
            updated_at = NOW()
        WHERE mint_address IN (
          SELECT DISTINCT t.mint_address
          FROM tokens_unified t
          INNER JOIN trades_unified tr ON t.mint_address = tr.mint_address
          WHERE tr.program = 'amm_pool'
          AND (t.graduated_to_amm = false OR t.graduated_to_amm IS NULL)
        )
        RETURNING mint_address, symbol
      `);

      console.log(`✅ Marked ${markResult.rowCount} tokens as graduated\n`);
    }

    // 4. Final state
    const finalState = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated_count,
        COUNT(*) FILTER (WHERE bonding_curve_complete = true) as complete_count,
        COUNT(*) FILTER (WHERE current_program = 'amm_pool') as amm_count,
        (SELECT COUNT(DISTINCT mint_address) FROM trades_unified WHERE program = 'amm_pool') as tokens_with_amm_trades
      FROM tokens_unified
    `);

    console.log('Final State:');
    console.log(`- Tokens marked as graduated: ${finalState.rows[0].graduated_count}`);
    console.log(`- Tokens with AMM trades: ${finalState.rows[0].tokens_with_amm_trades}`);
    console.log(`- Bonding curve complete: ${finalState.rows[0].complete_count}`);
    console.log(`- Current program = AMM: ${finalState.rows[0].amm_count}`);

    // 5. Show current graduated tokens with proper market caps
    const graduatedTokens = await pool.query(`
      SELECT t.mint_address, t.symbol, t.name, t.latest_market_cap_usd,
             COUNT(tr.signature) as trade_count,
             MAX(tr.created_at) as last_trade
      FROM tokens_unified t
      LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address AND tr.program = 'amm_pool'
      WHERE t.graduated_to_amm = true
      GROUP BY t.mint_address, t.symbol, t.name, t.latest_market_cap_usd
      ORDER BY t.latest_market_cap_usd DESC
    `);

    console.log(`\n📊 Current Graduated Tokens (${graduatedTokens.rows.length} total):\n`);
    for (const token of graduatedTokens.rows) {
      console.log(`${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
      console.log(`  Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
      console.log(`  AMM Trades: ${token.trade_count}`);
      console.log(`  Last Trade: ${token.last_trade || 'Never'}\n`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

fixGraduationLogic().catch(console.error);