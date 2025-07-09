#!/usr/bin/env tsx

import { PriceCalculator, ReserveInfo } from '../services/pricing/price-calculator';

const priceCalculator = new PriceCalculator();
const solPrice = 154.12; // Current SOL price

// Typical bonding curve with 65 SOL
const reserves: ReserveInfo = {
  solReserves: BigInt(65 * 1e9), // 65 SOL
  tokenReserves: BigInt(500_000_000 * 1e6), // 500M tokens (typical)
  isVirtual: true
};

const priceInfo = priceCalculator.calculatePrice(reserves, solPrice, false);

console.log('\n💰 Market Cap Calculation for 65 SOL:\n');
console.log(`SOL Price: $${solPrice}`);
console.log(`SOL Reserves: 65 SOL`);
console.log(`Token Reserves: 500M tokens`);
console.log('\nResults:');
console.log(`Price per token: $${priceInfo.priceInUsd.toFixed(8)}`);
console.log(`Market Cap: $${priceInfo.marketCapUsd.toLocaleString()}`);
console.log(`\n✅ Meets $2,000 threshold: ${priceInfo.marketCapUsd >= 2000 ? 'YES' : 'NO'}`);