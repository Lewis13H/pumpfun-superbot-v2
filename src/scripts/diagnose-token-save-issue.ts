#!/usr/bin/env tsx

/**
 * Script to diagnose why tokens aren't being saved
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { logger } from '../core/logger';

async function diagnoseTokenSaveIssue() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n🔍 Diagnosing Token Save Issue\n');
    console.log('=' .repeat(60));

    // 1. Check market cap distribution
    console.log('\n1️⃣ MARKET CAP DISTRIBUTION:\n');
    
    const marketCapDistribution = await pool.query(`
      SELECT 
        CASE 
          WHEN market_cap_usd >= 8888 THEN '✅ Above $8,888'
          WHEN market_cap_usd >= 5000 THEN '$5,000 - $8,888'
          WHEN market_cap_usd >= 1000 THEN '$1,000 - $5,000'
          WHEN market_cap_usd >= 500 THEN '$500 - $1,000'
          WHEN market_cap_usd >= 100 THEN '$100 - $500'
          ELSE '< $100'
        END as range,
        COUNT(DISTINCT mint_address) as tokens,
        COUNT(*) as trades
      FROM trades_unified
      WHERE market_cap_usd IS NOT NULL
      GROUP BY range
      ORDER BY MIN(market_cap_usd) DESC
    `);
    
    console.log('  Market Cap Ranges:');
    for (const row of marketCapDistribution.rows) {
      console.log(`    ${row.range}: ${row.tokens} tokens (${row.trades} trades)`);
    }

    // 2. Check if any token has ever exceeded threshold
    const highValueTokens = await pool.query(`
      SELECT DISTINCT
        mint_address,
        MAX(market_cap_usd) as max_market_cap,
        MIN(market_cap_usd) as min_market_cap,
        COUNT(*) as trade_count
      FROM trades_unified
      WHERE market_cap_usd IS NOT NULL
      GROUP BY mint_address
      HAVING MAX(market_cap_usd) >= 1000
      ORDER BY max_market_cap DESC
    `);
    
    console.log('\n2️⃣ HIGHEST VALUE TOKENS:\n');
    if (highValueTokens.rows.length > 0) {
      for (const token of highValueTokens.rows) {
        console.log(`  ${token.mint_address.substring(0, 12)}...`);
        console.log(`    Max MCap: $${parseFloat(token.max_market_cap).toLocaleString()}`);
        console.log(`    Min MCap: $${parseFloat(token.min_market_cap).toLocaleString()}`);
        console.log(`    Trades: ${token.trade_count}`);
      }
    } else {
      console.log('  ❌ No tokens have reached $1,000 market cap');
    }

    // 3. Check bonding curve mapping schema
    console.log('\n3️⃣ BONDING CURVE MAPPING SCHEMA:\n');
    const bcSchema = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'bonding_curve_mappings'
      ORDER BY ordinal_position
    `);
    
    console.log('  Columns:');
    for (const col of bcSchema.rows) {
      console.log(`    - ${col.column_name} (${col.data_type})`);
    }

    // 4. Check sample bonding curve mappings
    const bcMappings = await pool.query(`
      SELECT * FROM bonding_curve_mappings LIMIT 3
    `);
    
    if (bcMappings.rows.length > 0) {
      console.log('\n  Sample Mappings:');
      for (const bc of bcMappings.rows) {
        console.log(`    Bonding Curve: ${bc.bonding_curve || bc.bonding_curve_key || 'N/A'}`);
        console.log(`    Mint: ${bc.mint_address}`);
      }
    }

    // 5. Check configuration
    console.log('\n4️⃣ SYSTEM CONFIGURATION:\n');
    console.log(`  BC_SAVE_THRESHOLD: $${process.env.BC_SAVE_THRESHOLD || '8,888 (default)'}`);
    console.log(`  AMM_SAVE_THRESHOLD: $${process.env.AMM_SAVE_THRESHOLD || '1,000 (default)'}`);
    console.log(`  Database URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Not set'}`);

    // 6. Check price calculation
    console.log('\n5️⃣ PRICE CALCULATION CHECK:\n');
    
    const priceCheck = await pool.query(`
      SELECT 
        mint_address,
        AVG(price_sol) as avg_price_sol,
        AVG(price_usd) as avg_price_usd,
        AVG(sol_amount) as avg_sol_amount,
        AVG(token_amount) as avg_token_amount
      FROM trades_unified
      WHERE price_sol IS NOT NULL
      GROUP BY mint_address
      LIMIT 5
    `);
    
    console.log('  Sample Price Calculations:');
    for (const token of priceCheck.rows) {
      console.log(`    ${token.mint_address.substring(0, 8)}...`);
      console.log(`      Avg Price: ${parseFloat(token.avg_price_sol).toFixed(9)} SOL`);
      console.log(`      Avg Price: $${parseFloat(token.avg_price_usd || 0).toFixed(6)} USD`);
    }

    // 7. Check the most recent high-value trade
    const recentHighValue = await pool.query(`
      SELECT 
        mint_address,
        market_cap_usd,
        sol_amount,
        token_amount,
        price_sol,
        created_at
      FROM trades_unified
      WHERE market_cap_usd IS NOT NULL
      ORDER BY market_cap_usd DESC
      LIMIT 1
    `);
    
    if (recentHighValue.rows.length > 0) {
      const trade = recentHighValue.rows[0];
      console.log('\n6️⃣ HIGHEST MARKET CAP TRADE:\n');
      console.log(`  Token: ${trade.mint_address}`);
      console.log(`  Market Cap: $${parseFloat(trade.market_cap_usd).toLocaleString()}`);
      console.log(`  Price: ${trade.price_sol} SOL`);
      console.log(`  Time: ${new Date(trade.created_at).toLocaleString()}`);
      console.log(`  Status: ${parseFloat(trade.market_cap_usd) >= 8888 ? '✅ Should be saved' : '❌ Below threshold'}`);
    }

    // 8. Summary
    console.log('\n📊 DIAGNOSIS SUMMARY:\n');
    
    const totalTokens = await pool.query(`SELECT COUNT(DISTINCT mint_address) FROM trades_unified`);
    const tokensAboveThreshold = await pool.query(`
      SELECT COUNT(DISTINCT mint_address) 
      FROM trades_unified 
      WHERE market_cap_usd >= 8888
    `);
    
    console.log(`  Total unique tokens traded: ${totalTokens.rows[0].count}`);
    console.log(`  Tokens meeting $8,888 threshold: ${tokensAboveThreshold.rows[0].count}`);
    
    if (parseInt(tokensAboveThreshold.rows[0].count) === 0) {
      console.log('\n  ⚠️  ISSUE IDENTIFIED: No tokens have reached the $8,888 threshold!');
      console.log('  This explains why no tokens are being saved.');
      console.log('\n  RECOMMENDATIONS:');
      console.log('  1. Lower the BC_SAVE_THRESHOLD to capture more tokens');
      console.log('  2. Wait for higher value tokens to appear');
      console.log('  3. Set BC_SAVE_THRESHOLD=1000 in .env to capture more data');
    }

  } catch (error) {
    logger.error('Diagnosis failed:', error);
    console.error('\n❌ Diagnosis failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the diagnosis
diagnoseTokenSaveIssue()
  .then(() => console.log('\n✅ Diagnosis complete!'))
  .catch(console.error);