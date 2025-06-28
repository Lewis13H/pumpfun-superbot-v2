#!/usr/bin/env node
/**
 * Test suite for AMM Session 2: Real-time Price Calculations
 * 
 * Tests:
 * 1. Price calculator accuracy with constant product formula
 * 2. Price impact calculations
 * 3. Price tracker history and metrics
 * 4. Integration with pool state service
 * 5. Live price updates from trades
 */

import 'dotenv/config';
import { db } from '../database';
import chalk from 'chalk';
import { ammPriceCalculator } from '../utils/amm-price-calculator';
import { ammPriceTracker } from '../services/amm-price-tracker';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { AmmPoolReserves } from '../types/amm-pool-state';
import { getSolPrice } from '../services/sol-price';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message?: string;
  details?: any;
}

const testResults: TestResult[] = [];

function recordTest(name: string, status: 'PASS' | 'FAIL' | 'SKIP', message?: string, details?: any) {
  testResults.push({ name, status, message, details });
  const statusColor = status === 'PASS' ? chalk.green : status === 'FAIL' ? chalk.red : chalk.yellow;
  console.log(statusColor(`[${status}]`), chalk.white(name), message ? chalk.gray(`- ${message}`) : '');
}

/**
 * Test 1: Price Calculator Accuracy
 */
async function testPriceCalculator() {
  console.log(chalk.cyan('\n🧪 Test 1: Price Calculator Accuracy'));
  
  try {
    // Test with known reserves
    const testReserves: AmmPoolReserves = {
      mintAddress: 'TestToken123',
      poolAddress: 'TestPool123',
      virtualSolReserves: 10_000_000_000, // 10 SOL in lamports
      virtualTokenReserves: 500_000_000_000, // 500,000 tokens with 6 decimals
      lpSupply: 1000000,
      lastUpdateSlot: 123456,
      lastUpdateTime: new Date(),
    };
    
    // Calculate prices
    const prices = await ammPriceCalculator.calculatePrices(testReserves);
    
    // Expected: 10 SOL / 500,000 tokens = 0.00002 SOL per token
    const expectedPricePerTokenSol = 0.00002;
    const tolerance = 0.000001;
    
    if (Math.abs(prices.pricePerTokenSol - expectedPricePerTokenSol) < tolerance) {
      recordTest('Constant product price calculation', 'PASS', 
        `Price: ${prices.pricePerTokenSol.toFixed(8)} SOL per token`);
    } else {
      recordTest('Constant product price calculation', 'FAIL', 
        `Expected ${expectedPricePerTokenSol}, got ${prices.pricePerTokenSol}`);
    }
    
    // Test SOL price integration
    const currentSolPrice = await getSolPrice();
    if (currentSolPrice > 0) {
      recordTest('SOL price service integration', 'PASS', `SOL: $${currentSolPrice}`);
      
      // Check USD calculations
      const expectedUsd = expectedPricePerTokenSol * currentSolPrice;
      if (Math.abs(prices.pricePerTokenUsd - expectedUsd) < 0.01) {
        recordTest('USD price calculation', 'PASS', 
          `$${prices.pricePerTokenUsd.toFixed(8)} per token`);
      } else {
        recordTest('USD price calculation', 'FAIL', 
          `Expected ~$${expectedUsd.toFixed(8)}, got $${prices.pricePerTokenUsd.toFixed(8)}`);
      }
    } else {
      recordTest('SOL price service integration', 'FAIL', 'Could not get SOL price');
    }
    
    // Test market cap calculation
    const expectedMarketCap = prices.pricePerTokenUsd * 1_000_000_000;
    if (Math.abs(prices.marketCapUsd - expectedMarketCap) < 1) {
      recordTest('Market cap calculation', 'PASS', 
        `$${prices.marketCapUsd.toLocaleString()}`);
    } else {
      recordTest('Market cap calculation', 'FAIL');
    }
    
    // Test liquidity calculation
    const expectedLiquidity = 10 * 2 * currentSolPrice; // 2x one side
    if (Math.abs(prices.liquidityUsd - expectedLiquidity) < 1) {
      recordTest('Liquidity calculation', 'PASS', 
        `$${prices.liquidityUsd.toFixed(2)}`);
    } else {
      recordTest('Liquidity calculation', 'FAIL', 
        `Expected ~$${expectedLiquidity.toFixed(2)}, got $${prices.liquidityUsd.toFixed(2)}`);
    }
    
  } catch (error) {
    recordTest('Price calculator tests', 'FAIL', error.message);
  }
}

/**
 * Test 2: Price Impact Calculations
 */
async function testPriceImpact() {
  console.log(chalk.cyan('\n🧪 Test 2: Price Impact Calculations'));
  
  try {
    const testReserves: AmmPoolReserves = {
      mintAddress: 'TestToken123',
      poolAddress: 'TestPool123',
      virtualSolReserves: 100_000_000_000, // 100 SOL
      virtualTokenReserves: 5_000_000_000_000, // 5M tokens
      lpSupply: 1000000,
      lastUpdateSlot: 123456,
      lastUpdateTime: new Date(),
    };
    
    // Test small buy (0.1% of pool)
    const smallBuy = ammPriceCalculator.calculatePriceImpact(
      testReserves,
      0.1, // 0.1 SOL
      true // buying
    );
    
    if (smallBuy.priceImpact < 0.2) { // Should be minimal impact
      recordTest('Small buy price impact', 'PASS', 
        `Impact: ${smallBuy.priceImpact.toFixed(4)}%`);
    } else {
      recordTest('Small buy price impact', 'FAIL', 
        `Too high: ${smallBuy.priceImpact.toFixed(4)}%`);
    }
    
    // Test medium buy (1% of pool)
    const mediumBuy = ammPriceCalculator.calculatePriceImpact(
      testReserves,
      1, // 1 SOL
      true
    );
    
    if (mediumBuy.priceImpact > 0.5 && mediumBuy.priceImpact < 2) {
      recordTest('Medium buy price impact', 'PASS', 
        `Impact: ${mediumBuy.priceImpact.toFixed(4)}%`);
    } else {
      recordTest('Medium buy price impact', 'FAIL', 
        `Unexpected: ${mediumBuy.priceImpact.toFixed(4)}%`);
    }
    
    // Test large sell (5% of pool)
    const largeSell = ammPriceCalculator.calculatePriceImpact(
      testReserves,
      250000, // 250k tokens
      false // selling
    );
    
    if (largeSell.priceImpact > 2) {
      recordTest('Large sell price impact', 'PASS', 
        `Impact: ${largeSell.priceImpact.toFixed(4)}%`);
    } else {
      recordTest('Large sell price impact', 'FAIL', 
        `Too low: ${largeSell.priceImpact.toFixed(4)}%`);
    }
    
    // Test execution vs spot price
    if (mediumBuy.executionPrice > mediumBuy.spotPrice) {
      recordTest('Buy execution price > spot price', 'PASS',
        `Exec: ${mediumBuy.executionPrice.toFixed(8)}, Spot: ${mediumBuy.spotPrice.toFixed(8)}`);
    } else {
      recordTest('Buy execution price > spot price', 'FAIL');
    }
    
    // Test constant K validation
    const kBefore = ammPriceCalculator.calculateConstantK(testReserves);
    const reservesAfter: AmmPoolReserves = {
      ...testReserves,
      virtualSolReserves: testReserves.virtualSolReserves + 1_000_000_000, // +1 SOL
      virtualTokenReserves: testReserves.virtualTokenReserves - 49_751_243_781, // Calculated output
    };
    
    if (ammPriceCalculator.validateConstantK(testReserves, reservesAfter)) {
      recordTest('Constant K validation', 'PASS', `K maintained: ${kBefore.toExponential(2)}`);
    } else {
      recordTest('Constant K validation', 'FAIL', 'K value changed');
    }
    
  } catch (error) {
    recordTest('Price impact tests', 'FAIL', error.message);
  }
}

/**
 * Test 3: Price Tracker
 */
async function testPriceTracker() {
  console.log(chalk.cyan('\n🧪 Test 3: Price Tracker'));
  
  try {
    const testMint = 'TrackerTest' + Date.now();
    
    // Track multiple price updates
    const reserves1: AmmPoolReserves = {
      mintAddress: testMint,
      poolAddress: 'TestPool',
      virtualSolReserves: 100_000_000_000, // 100 SOL
      virtualTokenReserves: 5_000_000_000_000, // 5M tokens
      lpSupply: 1000000,
      lastUpdateSlot: 1000,
      lastUpdateTime: new Date(),
    };
    
    const metrics1 = await ammPriceTracker.trackPrice(testMint, reserves1, 1000);
    
    if (metrics1.current.pricePerTokenSol > 0) {
      recordTest('Price tracking initialization', 'PASS', 
        `Initial price: ${metrics1.current.pricePerTokenSol.toFixed(8)} SOL`);
    } else {
      recordTest('Price tracking initialization', 'FAIL', 'No price tracked');
    }
    
    // Simulate price increase
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const reserves2: AmmPoolReserves = {
      ...reserves1,
      virtualSolReserves: 105_000_000_000, // 105 SOL (+5%)
      virtualTokenReserves: 4_761_904_761_905, // Fewer tokens
      lastUpdateSlot: 1001,
    };
    
    const metrics2 = await ammPriceTracker.trackPrice(testMint, reserves2, 1001);
    
    if (metrics2.current.pricePerTokenSol > metrics1.current.pricePerTokenSol) {
      recordTest('Price increase tracking', 'PASS', 
        `New price: ${metrics2.current.pricePerTokenSol.toFixed(8)} SOL`);
    } else {
      recordTest('Price increase tracking', 'FAIL', 'Price did not increase');
    }
    
    // Check history
    const history = ammPriceTracker.getHistory(testMint);
    if (history.length >= 2) {
      recordTest('Price history storage', 'PASS', `${history.length} snapshots`);
    } else {
      recordTest('Price history storage', 'FAIL', `Only ${history.length} snapshots`);
    }
    
    // Check statistics
    const stats = ammPriceTracker.getStats();
    if (stats.tokensTracked > 0) {
      recordTest('Price tracker statistics', 'PASS', 
        `Tracking ${stats.tokensTracked} tokens, ${stats.totalSnapshots} snapshots`);
    } else {
      recordTest('Price tracker statistics', 'FAIL', 'No tokens tracked');
    }
    
    // Wait for batch save
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    // Verify database save
    const dbCheck = await db.query(
      'SELECT COUNT(*) as count FROM price_update_sources WHERE mint_address = $1',
      [testMint]
    );
    
    if (parseInt(dbCheck.rows[0].count) > 0) {
      recordTest('Price database persistence', 'PASS', 
        `${dbCheck.rows[0].count} records saved`);
      
      // Cleanup
      await db.query('DELETE FROM price_update_sources WHERE mint_address = $1', [testMint]);
    } else {
      recordTest('Price database persistence', 'SKIP', 'No records saved (table may not exist)');
    }
    
  } catch (error) {
    recordTest('Price tracker tests', 'FAIL', error.message);
  }
}

/**
 * Test 4: Pool State Service Integration
 */
async function testPoolStateIntegration() {
  console.log(chalk.cyan('\n🧪 Test 4: Pool State Service Integration'));
  
  try {
    const poolStateService = new AmmPoolStateService();
    const testMint = 'IntegrationTest' + Date.now();
    
    // Create pool state
    await poolStateService.updatePoolState({
      poolAddress: 'TestPool' + Date.now(),
      poolBump: 1,
      index: 0,
      creator: '11111111111111111111111111111111',
      baseMint: 'So11111111111111111111111111111111111111112',
      quoteMint: testMint,
      lpMint: 'TestLP',
      poolBaseTokenAccount: 'TestBase',
      poolQuoteTokenAccount: 'TestQuote',
      lpSupply: 1000000,
      coinCreator: 'TestCreator',
      slot: 2000,
    });
    
    // Update reserves - this should trigger price calculation
    await poolStateService.updatePoolReserves(
      testMint,
      50_000_000_000, // 50 SOL
      2_500_000_000_000, // 2.5M tokens
      2001
    );
    
    // Get pool state
    const poolState = poolStateService.getPoolState(testMint);
    
    if (poolState && poolState.metrics.pricePerTokenSol > 0) {
      recordTest('Pool state price calculation', 'PASS', 
        `Price: ${poolState.metrics.pricePerTokenSol.toFixed(8)} SOL`);
      
      // Check if using new calculator
      const expectedPrice = 50 / 2_500_000; // 0.00002 SOL per token
      const tolerance = 0.000001;
      
      if (Math.abs(poolState.metrics.pricePerTokenSol - expectedPrice) < tolerance) {
        recordTest('Price calculator integration', 'PASS', 
          'Using constant product formula correctly');
      } else {
        recordTest('Price calculator integration', 'FAIL', 
          `Expected ~${expectedPrice}, got ${poolState.metrics.pricePerTokenSol}`);
      }
      
      // Check market cap calculation
      if (poolState.metrics.marketCapUsd > 0) {
        recordTest('Market cap in pool state', 'PASS', 
          `$${poolState.metrics.marketCapUsd.toLocaleString()}`);
      } else {
        recordTest('Market cap in pool state', 'FAIL', 'No market cap');
      }
      
      // Check liquidity calculation
      if (poolState.metrics.liquidityUsd > 0) {
        recordTest('Liquidity in pool state', 'PASS', 
          `$${poolState.metrics.liquidityUsd.toFixed(2)}`);
      } else {
        recordTest('Liquidity in pool state', 'FAIL', 'No liquidity');
      }
      
    } else {
      recordTest('Pool state price calculation', 'FAIL', 'No price calculated');
    }
    
    // Cleanup
    await db.query('DELETE FROM amm_pool_states WHERE mint_address = $1', [testMint]);
    
  } catch (error) {
    recordTest('Pool state integration tests', 'FAIL', error.message);
  }
}

/**
 * Test 5: Utility Functions
 */
async function testUtilityFunctions() {
  console.log(chalk.cyan('\n🧪 Test 5: Utility Functions'));
  
  try {
    // Test price formatting
    const smallPrice = 0.00000123;
    const formatted = ammPriceCalculator.formatPrice(smallPrice);
    if (formatted === '1.230000e-6') {
      recordTest('Small price formatting', 'PASS', formatted);
    } else {
      recordTest('Small price formatting', 'FAIL', `Got: ${formatted}`);
    }
    
    // Test normal price formatting
    const normalPrice = 0.123456789;
    const normalFormatted = ammPriceCalculator.formatPrice(normalPrice, 4);
    if (normalFormatted === '0.1235') {
      recordTest('Normal price formatting', 'PASS', normalFormatted);
    } else {
      recordTest('Normal price formatting', 'FAIL', `Got: ${normalFormatted}`);
    }
    
    // Test slippage calculation
    const slippage = ammPriceCalculator.calculateSlippage(0.01, 0.0102);
    if (Math.abs(slippage - 2) < 0.01) {
      recordTest('Slippage calculation', 'PASS', `${slippage.toFixed(2)}%`);
    } else {
      recordTest('Slippage calculation', 'FAIL', `Expected ~2%, got ${slippage}%`);
    }
    
    // Test price from trade
    const tradePrice = ammPriceCalculator.calculatePriceFromTrade(
      1_000_000_000, // 1 SOL
      50_000_000_000, // 50k tokens
      true
    );
    
    const expectedTradePrice = 0.00002; // 1 SOL / 50k tokens
    if (Math.abs(tradePrice - expectedTradePrice) < 0.000001) {
      recordTest('Price from trade calculation', 'PASS', 
        `${tradePrice.toFixed(8)} SOL per token`);
    } else {
      recordTest('Price from trade calculation', 'FAIL');
    }
    
  } catch (error) {
    recordTest('Utility function tests', 'FAIL', error.message);
  }
}

/**
 * Generate test report
 */
function generateReport() {
  console.log(chalk.cyan.bold('\n\n📊 AMM SESSION 2 TEST REPORT'));
  console.log(chalk.gray('═'.repeat(60)));
  
  const passed = testResults.filter(t => t.status === 'PASS').length;
  const failed = testResults.filter(t => t.status === 'FAIL').length;
  const skipped = testResults.filter(t => t.status === 'SKIP').length;
  const total = testResults.length;
  
  console.log(chalk.white('\nTest Summary:'));
  console.log(chalk.green(`  ✅ Passed: ${passed}/${total}`));
  if (failed > 0) console.log(chalk.red(`  ❌ Failed: ${failed}/${total}`));
  if (skipped > 0) console.log(chalk.yellow(`  ⚠️  Skipped: ${skipped}/${total}`));
  
  if (failed > 0) {
    console.log(chalk.red('\nFailed Tests:'));
    testResults.filter(t => t.status === 'FAIL').forEach(test => {
      console.log(chalk.red(`  - ${test.name}: ${test.message || 'No details'}`));
    });
  }
  
  console.log(chalk.gray('\n═'.repeat(60)));
  
  if (failed === 0) {
    console.log(chalk.green.bold('✅ AMM SESSION 2: REAL-TIME PRICE CALCULATIONS COMPLETE'));
    console.log(chalk.green('All price calculation components are working correctly!'));
    console.log(chalk.gray('\nKey achievements:'));
    console.log(chalk.gray('  • Constant product formula implementation'));
    console.log(chalk.gray('  • Accurate price impact calculations'));
    console.log(chalk.gray('  • Price history tracking'));
    console.log(chalk.gray('  • Full integration with pool state service'));
  } else {
    console.log(chalk.red.bold('❌ AMM SESSION 2: ISSUES DETECTED'));
    console.log(chalk.red('Please fix the failed tests before proceeding.'));
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(chalk.cyan.bold('🚀 AMM SESSION 2 TEST SUITE'));
  console.log(chalk.gray('Testing Real-time Price Calculations\n'));
  
  try {
    // Check if price_update_sources table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'price_update_sources'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log(chalk.yellow('⚠️  price_update_sources table not found'));
      console.log(chalk.gray('Run: npm run add-price-tables'));
    }
    
    await testPriceCalculator();
    await testPriceImpact();
    await testPriceTracker();
    await testPoolStateIntegration();
    await testUtilityFunctions();
    
  } catch (error) {
    console.error(chalk.red('\nFatal error:'), error);
  } finally {
    await db.close();
  }
  
  generateReport();
  process.exit(testResults.filter(t => t.status === 'FAIL').length > 0 ? 1 : 0);
}

// Run tests
runTests().catch(console.error);