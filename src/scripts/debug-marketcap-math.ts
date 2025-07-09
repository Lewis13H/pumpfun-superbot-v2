#!/usr/bin/env tsx

/**
 * Debug market cap calculations
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { PriceCalculator, ReserveInfo } from '../services/pricing/price-calculator';

async function debugMarketCapMath() {
  console.log('\n🔍 Debugging Market Cap Math\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  const priceCalculator = new PriceCalculator();
  const solPrice = 154.12;
  
  try {
    // Get the highest value token
    const highestToken = await pool.query(`
      SELECT 
        mint_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        market_cap_usd,
        price_usd
      FROM trades_unified
      WHERE virtual_sol_reserves IS NOT NULL
      ORDER BY virtual_sol_reserves DESC
      LIMIT 1
    `);
    
    if (highestToken.rows.length > 0) {
      const token = highestToken.rows[0];
      console.log('Highest value token:');
      console.log(`  Mint: ${token.mint_address}`);
      console.log(`  SOL Reserves: ${Number(token.virtual_sol_reserves) / 1e9} SOL`);
      console.log(`  Token Reserves: ${Number(token.virtual_token_reserves) / 1e6} tokens`);
      console.log(`  DB Market Cap: $${parseFloat(token.market_cap_usd).toLocaleString()}`);
      
      // Recalculate
      const reserves: ReserveInfo = {
        solReserves: BigInt(token.virtual_sol_reserves),
        tokenReserves: BigInt(token.virtual_token_reserves),
        isVirtual: true
      };
      
      const priceInfo = priceCalculator.calculatePrice(reserves, solPrice, false);
      console.log(`\nRecalculated:`);
      console.log(`  Price: $${priceInfo.priceInUsd.toFixed(8)}`);
      console.log(`  Market Cap: $${priceInfo.marketCapUsd.toLocaleString()}`);
      
      // Manual calculation to verify
      const solReserves = Number(token.virtual_sol_reserves) / 1e9;
      const tokenReserves = Number(token.virtual_token_reserves) / 1e6;
      const pricePerToken = solReserves / tokenReserves;
      const priceUsd = pricePerToken * solPrice;
      
      console.log(`\nManual calculation:`);
      console.log(`  Price per token: ${pricePerToken.toFixed(9)} SOL`);
      console.log(`  Price USD: $${priceUsd.toFixed(8)}`);
      console.log(`  Total Supply: 1,000,000,000 tokens`);
      console.log(`  Circulating (10%): 100,000,000 tokens`);
      console.log(`  Market Cap: $${(priceUsd * 100_000_000).toLocaleString()}`);
    }
    
    // Now check what market cap we should expect at different SOL levels
    console.log('\n\nExpected market caps at different reserve levels:');
    console.log('(Assuming typical 500M tokens in reserves)\n');
    
    const testLevels = [30, 50, 70, 84, 100];
    for (const sol of testLevels) {
      const reserves: ReserveInfo = {
        solReserves: BigInt(sol * 1e9),
        tokenReserves: BigInt(500_000_000 * 1e6), // 500M tokens
        isVirtual: true
      };
      
      const priceInfo = priceCalculator.calculatePrice(reserves, solPrice, false);
      console.log(`${sol} SOL: $${priceInfo.marketCapUsd.toLocaleString()} market cap`);
    }
    
    // Calculate minimum SOL for $8,888
    console.log('\n\nFor $8,888 market cap with 500M token reserves:');
    const targetMcap = 8888;
    const circulatingSupply = 100_000_000; // 10% of 1B
    const neededPrice = targetMcap / circulatingSupply;
    const neededPriceSol = neededPrice / solPrice;
    const tokenReserves = 500_000_000;
    const neededSolReserves = neededPriceSol * tokenReserves;
    
    console.log(`  Need price: $${neededPrice.toFixed(8)} per token`);
    console.log(`  Need price: ${neededPriceSol.toFixed(9)} SOL per token`);
    console.log(`  Need SOL reserves: ${neededSolReserves.toFixed(2)} SOL`);
    
  } catch (error) {
    console.error('Debug failed:', error);
  } finally {
    await pool.end();
  }
}

debugMarketCapMath().catch(console.error);