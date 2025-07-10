#!/usr/bin/env npx tsx
/**
 * Test Token-Based Bonding Curve Progress Calculation
 * Verifies that our calculations match pump.fun's display
 */

import { PriceCalculator } from '../services/pricing/price-calculator';

// Test cases from the screenshots
const testCases = [
  {
    name: 'Gollum Putin (GPT)',
    mintAddress: '95ifG7SAJfSzRSTqZ4p9KGUoZvvebxJMpR16WLHFuTr4',
    tokensAvailable: 33.6e6, // 33.6M tokens
    expectedProgress: 96,
    solInCurve: 72.67
  },
  {
    name: '50% cat dog',
    tokensAvailable: 349.8e6, // 349.8M tokens
    expectedProgress: 56,
    solInCurve: 21.119
  },
  {
    name: 'pil',
    tokensAvailable: 137.1e6, // 137.1M tokens
    expectedProgress: 83,
    solInCurve: 47.195
  },
  {
    name: 'eBBQ...',
    tokensAvailable: 115.0e6, // 115.0M tokens
    expectedProgress: 86,
    solInCurve: 51.507
  },
  {
    name: 'MN...',
    tokensAvailable: 72.7e6, // 72.7M tokens
    expectedProgress: 91,
    solInCurve: 61.286
  },
  {
    name: 'FN-W...',
    tokensAvailable: 44.1e6, // 44.1M tokens
    expectedProgress: 95,
    solInCurve: 69.30
  }
];

const priceCalculator = new PriceCalculator();
const TOKEN_DECIMALS = 6;

console.log('Testing Token-Based Bonding Curve Progress Calculation\n');
console.log('Initial BC Tokens: 793M');
console.log('Formula: Progress = (793M - tokensRemaining) / 793M × 100\n');

let allPassed = true;

for (const testCase of testCases) {
  // Convert tokens available to bigint with decimals
  const virtualTokenReserves = BigInt(Math.floor(testCase.tokensAvailable * Math.pow(10, TOKEN_DECIMALS)));
  
  // Calculate progress using our new token-based method
  const calculatedProgress = priceCalculator.calculateBondingCurveProgress(virtualTokenReserves);
  
  // Check if it matches expected
  const matches = Math.abs(calculatedProgress - testCase.expectedProgress) < 1; // Allow 1% tolerance
  
  console.log(`${testCase.name}:`);
  console.log(`  Tokens Available: ${testCase.tokensAvailable / 1e6}M`);
  console.log(`  SOL in Curve: ${testCase.solInCurve}`);
  console.log(`  Expected Progress: ${testCase.expectedProgress}%`);
  console.log(`  Calculated Progress: ${calculatedProgress.toFixed(1)}%`);
  console.log(`  Status: ${matches ? '✅ PASS' : '❌ FAIL'}`);
  console.log();
  
  if (!matches) {
    allPassed = false;
  }
}

// Also test the old SOL-based calculation to show the difference
console.log('\n--- Comparison with OLD SOL-based calculation ---\n');

for (const testCase of testCases) {
  const solInLamports = BigInt(Math.floor(testCase.solInCurve * 1e9));
  // Using 105 SOL as threshold (old way)
  const oldProgress = Math.min((testCase.solInCurve / 105) * 100, 100);
  
  console.log(`${testCase.name}:`);
  console.log(`  SOL-based (old): ${oldProgress.toFixed(1)}%`);
  console.log(`  Token-based (new): ${testCase.expectedProgress}%`);
  console.log(`  Difference: ${Math.abs(oldProgress - testCase.expectedProgress).toFixed(1)}%`);
}

console.log(`\n${allPassed ? '✅ All tests passed!' : '❌ Some tests failed!'}`);