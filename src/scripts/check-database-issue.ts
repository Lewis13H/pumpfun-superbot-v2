#!/usr/bin/env tsx

/**
 * Script to diagnose why tokens aren't being saved
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { logger } from '../core/logger';

async function checkDatabaseIssue() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n🔍 Investigating Database Issue\n');
    console.log('=' .repeat(60));

    // 1. Check if we have any data
    console.log('\n1️⃣ BASIC DATA CHECK:\n');
    
    // Check tokens
    const tokenCount = await pool.query('SELECT COUNT(*) FROM tokens_unified');
    console.log(`  Tokens: ${tokenCount.rows[0].count}`);
    
    // Check trades
    const tradeCount = await pool.query('SELECT COUNT(*) FROM trades_unified');
    console.log(`  Trades: ${tradeCount.rows[0].count}`);
    
    // Check bonding curves
    const bcCount = await pool.query('SELECT COUNT(*) FROM bonding_curve_mappings');
    console.log(`  Bonding Curves: ${bcCount.rows[0].count}`);

    // 2. Check trades_unified schema
    console.log('\n2️⃣ TRADES TABLE SCHEMA:\n');
    const tradeSchema = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'trades_unified'
      ORDER BY ordinal_position
    `);
    
    console.log('  Columns in trades_unified:');
    for (const col of tradeSchema.rows) {
      console.log(`    - ${col.column_name} (${col.data_type})`);
    }

    // 3. Sample trades
    console.log('\n3️⃣ SAMPLE TRADES:\n');
    const sampleTrades = await pool.query(`
      SELECT 
        id,
        signature,
        mint_address,
        trade_type,
        sol_amount,
        token_amount,
        price_sol,
        price_usd,
        market_cap_usd,
        created_at
      FROM trades_unified
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    if (sampleTrades.rows.length > 0) {
      console.log('  Recent trades:');
      for (const trade of sampleTrades.rows) {
        console.log(`    Trade ${trade.id}:`);
        console.log(`      Mint: ${trade.mint_address}`);
        console.log(`      Type: ${trade.trade_type}`);
        console.log(`      SOL: ${trade.sol_amount}`);
        console.log(`      Market Cap: $${parseFloat(trade.market_cap_usd || 0).toLocaleString()}`);
        console.log(`      Time: ${new Date(trade.created_at).toLocaleTimeString()}`);
      }
    }

    // 4. Check if tokens are being created but not saved
    console.log('\n4️⃣ TOKEN CREATION ANALYSIS:\n');
    
    // Get unique mint addresses from trades
    const uniqueMints = await pool.query(`
      SELECT DISTINCT mint_address, COUNT(*) as trade_count
      FROM trades_unified
      GROUP BY mint_address
      ORDER BY trade_count DESC
      LIMIT 10
    `);
    
    console.log(`  Unique tokens in trades: ${uniqueMints.rows.length}`);
    console.log('  Top traded tokens:');
    for (const mint of uniqueMints.rows) {
      console.log(`    ${mint.mint_address.substring(0, 8)}... : ${mint.trade_count} trades`);
    }

    // 5. Check bonding curve mappings
    console.log('\n5️⃣ BONDING CURVE MAPPINGS:\n');
    const bcMappings = await pool.query(`
      SELECT bonding_curve_address, mint_address, created_at
      FROM bonding_curve_mappings
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    if (bcMappings.rows.length > 0) {
      console.log('  Recent bonding curves:');
      for (const bc of bcMappings.rows) {
        console.log(`    BC: ${bc.bonding_curve_address.substring(0, 8)}...`);
        console.log(`    Mint: ${bc.mint_address.substring(0, 8)}...`);
        console.log(`    Created: ${new Date(bc.created_at).toLocaleTimeString()}`);
      }
    }

    // 6. Check if there's a market cap threshold issue
    console.log('\n6️⃣ MARKET CAP ANALYSIS:\n');
    
    // Calculate approximate market caps from trades
    const marketCapEstimate = await pool.query(`
      SELECT 
        mint_address,
        MAX(price_sol) as max_price,
        MAX(market_cap_usd) as max_market_cap,
        COUNT(*) as trades
      FROM trades_unified
      GROUP BY mint_address
      HAVING COUNT(*) > 5
      ORDER BY MAX(market_cap_usd) DESC NULLS LAST
      LIMIT 5
    `);
    
    console.log('  Token market cap analysis:');
    for (const token of marketCapEstimate.rows) {
      console.log(`    ${token.mint_address.substring(0, 8)}...`);
      console.log(`      Max price: ${token.max_price} SOL`);
      console.log(`      Max market cap: $${parseFloat(token.max_market_cap || 0).toLocaleString()}`);
      console.log(`      Trades: ${token.trades}`);
      console.log(`      Threshold: ${parseFloat(token.max_market_cap || 0) >= 8888 ? '✅ Meets $8,888' : '❌ Below $8,888'}`);
    }

    // 7. Check environment variables
    console.log('\n7️⃣ CONFIGURATION CHECK:\n');
    console.log(`  BC_SAVE_THRESHOLD: ${process.env.BC_SAVE_THRESHOLD || 'Not set (default: 8888)'}`);
    console.log(`  AMM_SAVE_THRESHOLD: ${process.env.AMM_SAVE_THRESHOLD || 'Not set (default: 1000)'}`);

    // 8. Check for any errors in recent logs
    console.log('\n8️⃣ POTENTIAL ISSUES:\n');
    
    if (tokenCount.rows[0].count === '0' && tradeCount.rows[0].count > 0) {
      console.log('  ⚠️  Trades are being saved but tokens are not!');
      console.log('  Possible causes:');
      console.log('    1. Market cap threshold too high ($8,888)');
      console.log('    2. Token creation logic not triggering');
      console.log('    3. Price calculation issues');
      console.log('    4. Missing SOL price data');
    }

    // 9. Check SOL prices
    console.log('\n9️⃣ SOL PRICE CHECK:\n');
    const solPrice = await pool.query(`
      SELECT price, timestamp
      FROM sol_prices
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    
    if (solPrice.rows.length > 0) {
      console.log(`  Latest SOL price: $${solPrice.rows[0].price}`);
      console.log(`  Updated: ${new Date(solPrice.rows[0].timestamp).toLocaleTimeString()}`);
    } else {
      console.log('  ❌ No SOL price data!');
    }

  } catch (error) {
    logger.error('Check failed:', error);
    console.error('\n❌ Check failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the check
checkDatabaseIssue()
  .then(() => console.log('\n✅ Check complete!'))
  .catch(console.error);