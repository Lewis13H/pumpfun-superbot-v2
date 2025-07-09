#!/usr/bin/env tsx

/**
 * Test BC token threshold issue
 */

import 'dotenv/config';
import { PriceCalculator, ReserveInfo } from '../services/pricing/price-calculator';

async function testBCThreshold() {
  console.log('\n🧪 Testing BC Token Threshold\n');
  
  const priceCalculator = new PriceCalculator();
  const solPrice = 154.12;
  const threshold = 8888;
  
  console.log(`Current threshold: $${threshold}`);
  console.log(`SOL price: $${solPrice}\n`);
  
  // Test various reserve amounts
  const testCases = [
    { sol: 30, tokens: 800_000_000 },   // ~30 SOL
    { sol: 50, tokens: 600_000_000 },   // ~50 SOL
    { sol: 80, tokens: 400_000_000 },   // ~80 SOL
    { sol: 100, tokens: 300_000_000 },  // ~100 SOL
    { sol: 150, tokens: 200_000_000 },  // ~150 SOL
  ];
  
  for (const test of testCases) {
    const reserves: ReserveInfo = {
      solReserves: BigInt(test.sol * 1e9),
      tokenReserves: BigInt(test.tokens * 1e6),
      isVirtual: true
    };
    
    const priceInfo = priceCalculator.calculatePrice(reserves, solPrice, false);
    
    console.log(`${test.sol} SOL / ${test.tokens}M tokens:`);
    console.log(`  Price: $${priceInfo.priceInUsd.toFixed(8)}`);
    console.log(`  Market Cap: $${priceInfo.marketCapUsd.toLocaleString()}`);
    console.log(`  Meets threshold? ${priceInfo.marketCapUsd >= threshold ? '✅ YES' : '❌ NO'}`);
    console.log();
  }
  
  // Calculate minimum SOL needed for $8,888 market cap
  console.log('📊 Minimum requirements for $8,888 market cap:\n');
  
  // With 1B total supply, 10% circulating = 100M circulating
  // Market cap = price * 100M
  // $8,888 = price * 100M
  // price = $0.00008888
  // price in SOL = 0.00008888 / 154.12 = 0.000000577 SOL
  
  const minPriceUsd = threshold / (1_000_000_000 * 0.1);
  const minPriceSol = minPriceUsd / solPrice;
  
  console.log(`  Minimum price needed: $${minPriceUsd.toFixed(8)} (${minPriceSol.toFixed(9)} SOL)`);
  
  // For a typical token with 800M in reserves
  // price = sol_reserves / token_reserves
  // 0.000000577 = sol_reserves / 800M
  // sol_reserves = 0.000000577 * 800M = 461.6 SOL
  
  const typicalTokenReserves = 800_000_000;
  const minSolReserves = minPriceSol * typicalTokenReserves;
  
  console.log(`  With ${typicalTokenReserves / 1e6}M token reserves:`);
  console.log(`  Need ${minSolReserves.toFixed(1)} SOL in reserves`);
  console.log(`  That's ${(minSolReserves / 84 * 100).toFixed(1)}% to graduation!`);
}

testBCThreshold().catch(console.error);