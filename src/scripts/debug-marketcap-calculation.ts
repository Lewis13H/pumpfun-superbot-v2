#!/usr/bin/env tsx

/**
 * Script to debug market cap calculation issues
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { PriceCalculator, ReserveInfo } from '../services/pricing/price-calculator';
import { logger } from '../core/logger';

async function debugMarketCapCalculation() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const priceCalculator = new PriceCalculator();

  try {
    console.log('\n🔍 Debugging Market Cap Calculation\n');
    console.log('=' .repeat(60));

    // 1. Get sample trades with reserves
    const sampleTrades = await pool.query(`
      SELECT 
        mint_address,
        sol_amount,
        token_amount,
        price_sol,
        price_usd,
        market_cap_usd,
        virtual_sol_reserves,
        virtual_token_reserves,
        program
      FROM trades_unified
      WHERE virtual_sol_reserves IS NOT NULL
      AND virtual_token_reserves IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 5
    `);

    console.log('\n1️⃣ RECALCULATING MARKET CAPS:\n');
    
    for (const trade of sampleTrades.rows) {
      console.log(`\nToken: ${trade.mint_address.substring(0, 12)}...`);
      console.log(`Program: ${trade.program}`);
      
      // Show current values from database
      console.log('\nDatabase values:');
      console.log(`  Price USD: $${trade.price_usd}`);
      console.log(`  Market Cap: $${parseFloat(trade.market_cap_usd).toLocaleString()}`);
      console.log(`  SOL Reserves: ${trade.virtual_sol_reserves}`);
      console.log(`  Token Reserves: ${trade.virtual_token_reserves}`);
      
      // Recalculate using PriceCalculator
      const reserves: ReserveInfo = {
        solReserves: BigInt(trade.virtual_sol_reserves),
        tokenReserves: BigInt(trade.virtual_token_reserves),
        isVirtual: trade.program === 'bonding_curve'
      };
      
      const isAmmToken = trade.program !== 'bonding_curve';
      const priceInfo = priceCalculator.calculatePrice(reserves, 154.12, isAmmToken);
      
      console.log('\nRecalculated values:');
      console.log(`  Price USD: $${priceInfo.priceInUsd.toFixed(6)}`);
      console.log(`  Market Cap: $${priceInfo.marketCapUsd.toLocaleString()}`);
      
      // Show the difference
      const mcapDiff = priceInfo.marketCapUsd - parseFloat(trade.market_cap_usd);
      console.log(`\nDifference: $${mcapDiff.toLocaleString()} (${(mcapDiff / parseFloat(trade.market_cap_usd) * 100).toFixed(1)}%)`);
      
      // Manual calculation to verify
      const solReserves = Number(trade.virtual_sol_reserves) / 1e9; // to SOL
      const tokenReserves = Number(trade.virtual_token_reserves) / 1e6; // token decimals
      const pricePerToken = solReserves / tokenReserves;
      const priceUsd = pricePerToken * 154.12;
      
      console.log('\nManual calculation:');
      console.log(`  SOL reserves: ${solReserves.toFixed(2)} SOL`);
      console.log(`  Token reserves: ${tokenReserves.toLocaleString()} tokens`);
      console.log(`  Price per token: ${pricePerToken.toFixed(9)} SOL`);
      console.log(`  Price USD: $${priceUsd.toFixed(6)}`);
      
      // For BC tokens: 1B total supply * 10% circulating
      // For AMM tokens: use tokens in pool
      let manualMarketCap;
      if (isAmmToken) {
        manualMarketCap = priceUsd * tokenReserves;
      } else {
        manualMarketCap = priceUsd * (1_000_000_000 * 0.1); // 100M circulating
      }
      
      console.log(`  Market Cap (manual): $${manualMarketCap.toLocaleString()}`);
      console.log(`  Should save? ${manualMarketCap >= 8888 ? '✅ YES' : '❌ NO'}`);
    }

    // 2. Check if there's a pattern
    console.log('\n\n2️⃣ MARKET CAP PATTERNS:\n');
    
    const patterns = await pool.query(`
      SELECT 
        program,
        COUNT(*) as trade_count,
        AVG(market_cap_usd) as avg_mcap,
        MAX(market_cap_usd) as max_mcap,
        MIN(market_cap_usd) as min_mcap,
        AVG(virtual_sol_reserves) as avg_sol_reserves
      FROM trades_unified
      WHERE market_cap_usd IS NOT NULL
      GROUP BY program
    `);
    
    for (const row of patterns.rows) {
      console.log(`\nProgram: ${row.program}`);
      console.log(`  Trades: ${row.trade_count}`);
      console.log(`  Avg Market Cap: $${parseFloat(row.avg_mcap).toLocaleString()}`);
      console.log(`  Max Market Cap: $${parseFloat(row.max_mcap).toLocaleString()}`);
      console.log(`  Min Market Cap: $${parseFloat(row.min_mcap).toLocaleString()}`);
      console.log(`  Avg SOL Reserves: ${(Number(row.avg_sol_reserves) / 1e9).toFixed(2)} SOL`);
    }

    // 3. Find tokens that SHOULD be above threshold
    console.log('\n\n3️⃣ TOKENS THAT SHOULD BE SAVED:\n');
    
    const shouldBeSaved = await pool.query(`
      SELECT DISTINCT
        mint_address,
        MAX(virtual_sol_reserves) as max_sol_reserves,
        MAX(virtual_token_reserves) as max_token_reserves,
        MAX(market_cap_usd) as db_max_mcap,
        COUNT(*) as trades
      FROM trades_unified
      WHERE virtual_sol_reserves IS NOT NULL
      GROUP BY mint_address
      HAVING MAX(virtual_sol_reserves) > 30000000000 -- > 30 SOL
      ORDER BY MAX(virtual_sol_reserves) DESC
      LIMIT 10
    `);
    
    console.log('Tokens with significant SOL reserves:');
    for (const token of shouldBeSaved.rows) {
      const reserves: ReserveInfo = {
        solReserves: BigInt(token.max_sol_reserves),
        tokenReserves: BigInt(token.max_token_reserves),
        isVirtual: true
      };
      
      const priceInfo = priceCalculator.calculatePrice(reserves, 154.12, false);
      
      console.log(`\n${token.mint_address}`);
      console.log(`  SOL Reserves: ${(Number(token.max_sol_reserves) / 1e9).toFixed(2)} SOL`);
      console.log(`  DB Market Cap: $${parseFloat(token.db_max_mcap).toLocaleString()}`);
      console.log(`  Recalc Market Cap: $${priceInfo.marketCapUsd.toLocaleString()}`);
      console.log(`  Status: ${priceInfo.marketCapUsd >= 8888 ? '✅ Should be saved!' : '❌ Still below threshold'}`);
    }

  } catch (error) {
    logger.error('Debug failed:', error);
    console.error('\n❌ Debug failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the debug
debugMarketCapCalculation()
  .then(() => console.log('\n✅ Debug complete!'))
  .catch(console.error);