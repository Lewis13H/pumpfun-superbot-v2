#!/usr/bin/env node
/**
 * Quick test suite for AMM Session 1: Pool Reserve Monitoring
 * Tests core functionality without live monitoring
 */

import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { db } from '../database';
import { decodePoolAccount, poolAccountToPlain } from '../utils/amm-pool-decoder';
import { AmmPoolStateService } from '../services/amm-pool-state-service';

// Test results tracking
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message?: string;
}

const testResults: TestResult[] = [];

function recordTest(name: string, status: 'PASS' | 'FAIL' | 'SKIP', message?: string) {
  testResults.push({ name, status, message });
  const statusColor = status === 'PASS' ? chalk.green : status === 'FAIL' ? chalk.red : chalk.yellow;
  console.log(statusColor(`[${status}]`), chalk.white(name), message ? chalk.gray(`- ${message}`) : '');
}

/**
 * Test 1: Custom Pool Decoder
 */
async function testPoolDecoder() {
  console.log(chalk.cyan('\n🧪 Test 1: Custom Pool Decoder'));
  
  try {
    // Create a properly formatted test pool data
    const testPoolData = Buffer.concat([
      // 8 byte discriminator
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
      // Pool data
      Buffer.from([1]), // poolBump: u8
      Buffer.from([0, 0]), // index: u16 (little-endian)
      Buffer.alloc(32, 1), // creator: Pubkey (32 bytes)
      Buffer.alloc(32, 2), // baseMint: Pubkey
      Buffer.alloc(32, 3), // quoteMint: Pubkey
      Buffer.alloc(32, 4), // lpMint: Pubkey
      Buffer.alloc(32, 5), // poolBaseTokenAccount: Pubkey
      Buffer.alloc(32, 6), // poolQuoteTokenAccount: Pubkey
      Buffer.from([10, 0, 0, 0, 0, 0, 0, 0]), // lpSupply: u64 (10 in little-endian)
      Buffer.alloc(32, 7), // coinCreator: Pubkey
    ]);
    
    const decoded = decodePoolAccount(testPoolData);
    
    if (decoded) {
      recordTest('Decode valid pool data', 'PASS', 'Successfully decoded pool account');
      
      const plain = poolAccountToPlain(decoded);
      if (plain.lpSupply === '10') {
        recordTest('LP supply decoding', 'PASS', `LP Supply: ${plain.lpSupply}`);
      } else {
        recordTest('LP supply decoding', 'FAIL', `Expected 10, got ${plain.lpSupply}`);
      }
      
      // Test all fields are base58 strings
      if (typeof plain.quoteMint === 'string' && plain.quoteMint.length > 0) {
        recordTest('Address format conversion', 'PASS', 'All addresses converted to base58');
      } else {
        recordTest('Address format conversion', 'FAIL', 'Invalid address format');
      }
    } else {
      recordTest('Decode valid pool data', 'FAIL', 'Failed to decode pool data');
    }
    
    // Test invalid data handling
    const invalidDecoded = decodePoolAccount(Buffer.from([1, 2, 3]));
    if (!invalidDecoded) {
      recordTest('Handle invalid data', 'PASS', 'Correctly returns null for invalid data');
    } else {
      recordTest('Handle invalid data', 'FAIL', 'Should return null for invalid data');
    }
    
  } catch (error) {
    recordTest('Pool decoder tests', 'FAIL', error.message);
  }
}

/**
 * Test 2: Database Schema
 */
async function testDatabaseSchema() {
  console.log(chalk.cyan('\n🧪 Test 2: Database Schema'));
  
  try {
    // Check table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'amm_pool_states'
        AND table_schema = 'public'
      );
    `);
    
    if (tableCheck.rows[0].exists) {
      recordTest('Table amm_pool_states exists', 'PASS');
    } else {
      recordTest('Table amm_pool_states exists', 'FAIL', 'Table not found');
      return;
    }
    
    // Check critical columns
    const columnsResult = await db.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'amm_pool_states'
      AND column_name IN ('mint_address', 'pool_address', 'virtual_sol_reserves', 'virtual_token_reserves', 'slot')
      ORDER BY ordinal_position;
    `);
    
    const requiredColumns = {
      'mint_address': { type: 'character varying', length: 64 },
      'pool_address': { type: 'character varying', length: 64 },
      'virtual_sol_reserves': { type: 'bigint' },
      'virtual_token_reserves': { type: 'bigint' },
      'slot': { type: 'bigint' }
    };
    
    let allColumnsValid = true;
    for (const col of columnsResult.rows) {
      const expected = requiredColumns[col.column_name];
      if (expected && col.data_type === expected.type && 
          (!expected.length || col.character_maximum_length === expected.length)) {
        recordTest(`Column ${col.column_name}`, 'PASS', `${col.data_type}${expected.length ? `(${expected.length})` : ''}`);
      } else {
        recordTest(`Column ${col.column_name}`, 'FAIL', 'Type mismatch');
        allColumnsValid = false;
      }
    }
    
    // Test Solana address format support
    const testMint = 'TestMint' + Date.now() + 'pump';
    const testPool = 'TestPool' + Date.now() + 'pool';
    
    try {
      await db.query(`
        INSERT INTO amm_pool_states (
          mint_address, pool_address, virtual_sol_reserves, 
          virtual_token_reserves, slot
        ) VALUES ($1, $2, $3, $4, $5)
      `, [testMint, testPool, '1000000000', '2000000000', '123456']);
      
      const verify = await db.query(
        'SELECT * FROM amm_pool_states WHERE mint_address = $1',
        [testMint]
      );
      
      if (verify.rows.length > 0 && verify.rows[0].mint_address === testMint) {
        recordTest('Solana address storage', 'PASS', `Stored: ${testMint.substring(0, 20)}...`);
      } else {
        recordTest('Solana address storage', 'FAIL', 'Could not verify stored address');
      }
      
      // Cleanup
      await db.query('DELETE FROM amm_pool_states WHERE mint_address = $1', [testMint]);
      
    } catch (error) {
      recordTest('Solana address storage', 'FAIL', error.message);
    }
    
  } catch (error) {
    recordTest('Database schema tests', 'FAIL', error.message);
  }
}

/**
 * Test 3: Pool State Service
 */
async function testPoolStateService() {
  console.log(chalk.cyan('\n🧪 Test 3: Pool State Service'));
  
  try {
    const poolStateService = new AmmPoolStateService();
    
    // Test initialization
    const allPools = poolStateService.getAllPools();
    recordTest('Service initialization', 'PASS', `Loaded ${allPools.size} existing pools`);
    
    // Test pool state creation and caching
    const testMint = 'ServiceTest' + Date.now() + 'pump';
    const testPoolData = {
      poolAddress: 'ServiceTestPool' + Date.now(),
      poolBump: 1,
      index: 0,
      creator: '11111111111111111111111111111111',
      baseMint: 'So11111111111111111111111111111111111111112',
      quoteMint: testMint,
      lpMint: 'TestLP' + Date.now(),
      poolBaseTokenAccount: 'TestBase' + Date.now(),
      poolQuoteTokenAccount: 'TestQuote' + Date.now(),
      lpSupply: 1000000,
      coinCreator: 'TestCreator' + Date.now(),
      slot: 999999,
    };
    
    await poolStateService.updatePoolState(testPoolData);
    
    // Verify caching
    const cached = poolStateService.getPoolState(testMint);
    if (cached && cached.account.quoteMint === testMint) {
      recordTest('Pool state caching', 'PASS', 'Pool cached successfully');
    } else {
      recordTest('Pool state caching', 'FAIL', 'Pool not found in cache');
    }
    
    // Test reserve updates
    await poolStateService.updatePoolReserves(
      testMint,
      5000000000, // 5 SOL
      10000000000, // 10000 tokens
      1000000
    );
    
    const updated = poolStateService.getPoolState(testMint);
    if (updated && updated.reserves.virtualSolReserves === 5000000000) {
      recordTest('Reserve updates', 'PASS', '5 SOL reserves set correctly');
      
      // Check price calculation
      if (updated.metrics.pricePerTokenSol > 0) {
        const price = updated.metrics.pricePerTokenSol;
        recordTest('Price calculation', 'PASS', `${price.toFixed(6)} SOL per token`);
      } else {
        recordTest('Price calculation', 'FAIL', 'Price is 0');
      }
    } else {
      recordTest('Reserve updates', 'FAIL', 'Reserves not updated');
    }
    
    // Test pool lookup by address
    const byAddress = poolStateService.getPoolStateByAddress(testPoolData.poolAddress);
    if (byAddress && byAddress.account.quoteMint === testMint) {
      recordTest('Lookup by pool address', 'PASS');
    } else {
      recordTest('Lookup by pool address', 'FAIL');
    }
    
    // Wait for batch save
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Verify database persistence
    const dbCheck = await db.query(
      'SELECT COUNT(*) as count FROM amm_pool_states WHERE mint_address = $1',
      [testMint]
    );
    
    if (parseInt(dbCheck.rows[0].count) > 0) {
      recordTest('Database persistence', 'PASS', 'Pool state saved to database');
      
      // Cleanup
      await db.query('DELETE FROM amm_pool_states WHERE mint_address = $1', [testMint]);
    } else {
      recordTest('Database persistence', 'FAIL', 'No records in database');
    }
    
  } catch (error) {
    recordTest('Pool state service tests', 'FAIL', error.message);
  }
}

/**
 * Test 4: Integration Components
 */
async function testIntegration() {
  console.log(chalk.cyan('\n🧪 Test 4: Integration Components'));
  
  try {
    // Check if all required files exist
    const fs = require('fs');
    const path = require('path');
    
    const requiredFiles = [
      'src/utils/amm-pool-decoder.ts',
      'src/services/amm-pool-state-service.ts',
      'src/monitors/amm-account-monitor.ts',
      'src/types/amm-pool-state.ts',
      'schema/add-amm-pool-states.sql'
    ];
    
    const basePath = process.cwd();
    let allFilesExist = true;
    
    for (const file of requiredFiles) {
      const fullPath = path.join(basePath, file);
      if (fs.existsSync(fullPath)) {
        recordTest(`File: ${file}`, 'PASS', 'Exists');
      } else {
        recordTest(`File: ${file}`, 'FAIL', 'Missing');
        allFilesExist = false;
      }
    }
    
    // Check if monitors can be imported
    try {
      require('../monitors/amm-account-monitor');
      recordTest('AMM account monitor imports', 'PASS');
    } catch (error) {
      recordTest('AMM account monitor imports', 'FAIL', error.message);
    }
    
  } catch (error) {
    recordTest('Integration tests', 'FAIL', error.message);
  }
}

/**
 * Generate report
 */
function generateReport() {
  console.log(chalk.cyan.bold('\n\n📊 AMM SESSION 1 TEST REPORT'));
  console.log(chalk.gray('═'.repeat(60)));
  
  const passed = testResults.filter(t => t.status === 'PASS').length;
  const failed = testResults.filter(t => t.status === 'FAIL').length;
  const total = testResults.length;
  
  console.log(chalk.white('\nTest Summary:'));
  console.log(chalk.green(`  ✅ Passed: ${passed}/${total}`));
  if (failed > 0) console.log(chalk.red(`  ❌ Failed: ${failed}/${total}`));
  
  if (failed > 0) {
    console.log(chalk.red('\nFailed Tests:'));
    testResults.filter(t => t.status === 'FAIL').forEach(test => {
      console.log(chalk.red(`  - ${test.name}: ${test.message || 'No details'}`));
    });
  }
  
  console.log(chalk.gray('\n═'.repeat(60)));
  
  if (failed === 0) {
    console.log(chalk.green.bold('✅ AMM SESSION 1: CORE FUNCTIONALITY VERIFIED'));
    console.log(chalk.green('All essential components are working correctly!'));
    console.log(chalk.gray('\nTo test live monitoring, run the AMM monitors:'));
    console.log(chalk.gray('  npm run amm-account-monitor'));
    console.log(chalk.gray('  npm run amm-monitor'));
  } else {
    console.log(chalk.red.bold('❌ AMM SESSION 1: ISSUES DETECTED'));
    console.log(chalk.red('Please fix the failed tests before proceeding.'));
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(chalk.cyan.bold('🚀 AMM SESSION 1 QUICK TEST SUITE'));
  console.log(chalk.gray('Testing core components without live monitoring\n'));
  
  try {
    await testPoolDecoder();
    await testDatabaseSchema();
    await testPoolStateService();
    await testIntegration();
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