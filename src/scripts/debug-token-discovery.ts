#!/usr/bin/env tsx

/**
 * Script to debug token discovery and saving issues
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { logger } from '../core/logger';

async function debugTokenDiscovery() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n🔍 Debugging Token Discovery Issue\n');
    console.log('=' .repeat(60));

    // 1. Check raw trade data
    console.log('\n1️⃣ RAW TRADE DATA ANALYSIS:\n');
    
    // Get trade count and market cap range
    const tradeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_trades,
        COUNT(DISTINCT mint_address) as unique_tokens,
        MAX(market_cap_usd) as max_market_cap,
        MIN(market_cap_usd) as min_market_cap,
        AVG(market_cap_usd) as avg_market_cap,
        COUNT(CASE WHEN market_cap_usd > 8888 THEN 1 END) as trades_above_threshold,
        COUNT(DISTINCT CASE WHEN market_cap_usd > 8888 THEN mint_address END) as tokens_above_threshold
      FROM trades_unified
    `);
    
    const stats = tradeStats.rows[0];
    console.log(`  Total Trades: ${stats.total_trades}`);
    console.log(`  Unique Tokens: ${stats.unique_tokens}`);
    console.log(`  Max Market Cap: $${parseFloat(stats.max_market_cap || 0).toLocaleString()}`);
    console.log(`  Avg Market Cap: $${parseFloat(stats.avg_market_cap || 0).toLocaleString()}`);
    console.log(`  Trades Above $8,888: ${stats.trades_above_threshold}`);
    console.log(`  Tokens Above $8,888: ${stats.tokens_above_threshold}`);

    // 2. Check if market_cap_usd is being calculated correctly
    console.log('\n2️⃣ MARKET CAP CALCULATION CHECK:\n');
    
    const nullMarketCaps = await pool.query(`
      SELECT COUNT(*) as null_count
      FROM trades_unified
      WHERE market_cap_usd IS NULL
    `);
    
    console.log(`  Trades with NULL market cap: ${nullMarketCaps.rows[0].null_count}`);
    
    // Sample some trades to see the data
    const sampleTrades = await pool.query(`
      SELECT 
        mint_address,
        sol_amount,
        token_amount,
        price_sol,
        price_usd,
        market_cap_usd,
        virtual_sol_reserves,
        virtual_token_reserves
      FROM trades_unified
      WHERE market_cap_usd IS NOT NULL
      ORDER BY market_cap_usd DESC
      LIMIT 5
    `);
    
    console.log('\n  Top 5 trades by market cap:');
    for (const trade of sampleTrades.rows) {
      console.log(`\n  Token: ${trade.mint_address.substring(0, 12)}...`);
      console.log(`    SOL Amount: ${trade.sol_amount}`);
      console.log(`    Token Amount: ${trade.token_amount}`);
      console.log(`    Price (SOL): ${trade.price_sol}`);
      console.log(`    Price (USD): $${trade.price_usd}`);
      console.log(`    Market Cap: $${parseFloat(trade.market_cap_usd).toLocaleString()}`);
      console.log(`    Reserves: ${trade.virtual_sol_reserves} SOL / ${trade.virtual_token_reserves} tokens`);
    }

    // 3. Check token discovery events
    console.log('\n3️⃣ TOKEN LIFECYCLE EVENTS:\n');
    
    // Check if bonding curve mappings exist
    const bcMappings = await pool.query(`
      SELECT COUNT(*) as count FROM bonding_curve_mappings
    `);
    console.log(`  Bonding Curve Mappings: ${bcMappings.rows[0].count}`);

    // 4. Check for any graduated tokens
    console.log('\n4️⃣ GRADUATION STATUS:\n');
    
    // Check programs
    const programs = await pool.query(`
      SELECT program, COUNT(*) as count
      FROM trades_unified
      GROUP BY program
    `);
    
    console.log('  Programs found:');
    for (const prog of programs.rows) {
      console.log(`    ${prog.program}: ${prog.count} trades`);
    }
    
    const graduatedCheck = await pool.query(`
      SELECT 
        COUNT(DISTINCT mint_address) as graduated_count
      FROM trades_unified
      WHERE program = 'pump.swap' OR program LIKE '%pump.swap%' OR program LIKE '%amm%'
    `);
    
    console.log(`  Graduated tokens (AMM trades): ${graduatedCheck.rows[0].count}`);

    // 5. Check if this is a price calculation issue
    console.log('\n5️⃣ PRICE CALCULATION DEEP DIVE:\n');
    
    // Get a specific token with many trades
    const activeToken = await pool.query(`
      SELECT mint_address, COUNT(*) as trade_count
      FROM trades_unified
      GROUP BY mint_address
      ORDER BY trade_count DESC
      LIMIT 1
    `);
    
    if (activeToken.rows.length > 0) {
      const tokenAddress = activeToken.rows[0].mint_address;
      console.log(`  Analyzing token: ${tokenAddress}`);
      console.log(`  Trade count: ${activeToken.rows[0].trade_count}`);
      
      // Get price progression
      const priceProgression = await pool.query(`
        SELECT 
          created_at,
          price_sol,
          price_usd,
          market_cap_usd,
          sol_amount,
          token_amount,
          virtual_sol_reserves
        FROM trades_unified
        WHERE mint_address = $1
        ORDER BY created_at DESC
        LIMIT 10
      `, [tokenAddress]);
      
      console.log('\n  Recent price progression:');
      for (const trade of priceProgression.rows) {
        const time = new Date(trade.created_at).toLocaleTimeString();
        console.log(`    ${time}: $${parseFloat(trade.price_usd || 0).toFixed(6)} | MCap: $${parseFloat(trade.market_cap_usd || 0).toLocaleString()}`);
      }
    }

    // 6. Check configuration
    console.log('\n6️⃣ ENVIRONMENT CONFIGURATION:\n');
    console.log(`  BC_SAVE_THRESHOLD: ${process.env.BC_SAVE_THRESHOLD || '8888 (default)'}`);
    console.log(`  AMM_SAVE_THRESHOLD: ${process.env.AMM_SAVE_THRESHOLD || '1000 (default)'}`);
    
    // 7. SQL to manually check what should be saved
    console.log('\n7️⃣ TOKENS THAT SHOULD BE SAVED:\n');
    
    const shouldBeSaved = await pool.query(`
      SELECT 
        mint_address,
        MAX(market_cap_usd) as max_mcap,
        COUNT(*) as trades,
        MAX(created_at) as last_trade
      FROM trades_unified
      GROUP BY mint_address
      HAVING MAX(market_cap_usd) >= 8888
      ORDER BY max_mcap DESC
      LIMIT 10
    `);
    
    if (shouldBeSaved.rows.length > 0) {
      console.log('  Tokens that meet the $8,888 threshold:');
      for (const token of shouldBeSaved.rows) {
        console.log(`    ${token.mint_address}`);
        console.log(`      Max MCap: $${parseFloat(token.max_mcap).toLocaleString()}`);
        console.log(`      Trades: ${token.trades}`);
        console.log(`      Last seen: ${new Date(token.last_trade).toLocaleTimeString()}`);
      }
    } else {
      console.log('  ❌ No tokens found above $8,888 threshold');
    }

    // 8. Check if it's a data type issue
    console.log('\n8️⃣ DATA TYPE CHECK:\n');
    
    const dataTypeCheck = await pool.query(`
      SELECT 
        data_type,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'trades_unified'
      AND column_name = 'market_cap_usd'
    `);
    
    if (dataTypeCheck.rows.length > 0) {
      const dt = dataTypeCheck.rows[0];
      console.log(`  market_cap_usd column type: ${dt.data_type}`);
      console.log(`  Precision: ${dt.numeric_precision}, Scale: ${dt.numeric_scale}`);
    }

  } catch (error) {
    logger.error('Debug failed:', error);
    console.error('\n❌ Debug failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the debug
debugTokenDiscovery()
  .then(() => console.log('\n✅ Debug complete!'))
  .catch(console.error);