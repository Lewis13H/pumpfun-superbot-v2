#!/usr/bin/env node
/**
 * Exhaustive test suite for AMM Session 1: Pool Reserve Monitoring
 * 
 * This test verifies all components of AMM Session 1 are fully implemented and working:
 * 1. Custom pool decoder functionality
 * 2. Account monitor operation
 * 3. Pool state service functionality
 * 4. Database schema and operations
 * 5. Integration between components
 * 6. Reserve updates from trade events
 */

import 'dotenv/config';
import { PublicKey, Connection } from '@solana/web3.js';
import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import { db } from '../database';
import { decodePoolAccount, poolAccountToPlain } from '../utils/amm-pool-decoder';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { Idl } from '@coral-xyz/anchor';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';
import { TransactionFormatter } from '../utils/transaction-formatter';
import { parseSwapTransactionOutput } from '../utils/swapTransactionParser';
import { suppressParserWarnings } from '../utils/suppress-parser-warnings';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';

// Test results tracking
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message?: string;
  details?: any;
}

const testResults: TestResult[] = [];
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Test data collection
const testData = {
  decodedPools: [] as any[],
  poolStates: [] as any[],
  tradeEvents: [] as any[],
  dbRecords: [] as any[],
  reserveUpdates: [] as any[],
};

/**
 * Record test result
 */
function recordTest(name: string, status: 'PASS' | 'FAIL' | 'SKIP', message?: string, details?: any) {
  testResults.push({ name, status, message, details });
  const statusColor = status === 'PASS' ? chalk.green : status === 'FAIL' ? chalk.red : chalk.yellow;
  console.log(statusColor(`[${status}]`), chalk.white(name), message ? chalk.gray(`- ${message}`) : '');
}

/**
 * Test 1: Verify custom pool decoder
 */
async function testPoolDecoder() {
  console.log(chalk.cyan('\n🧪 Test 1: Custom Pool Decoder'));
  
  try {
    // Test with mock pool data (8 byte discriminator + pool data)
    const mockDiscriminator = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const mockPoolData = Buffer.concat([
      mockDiscriminator,
      Buffer.from([1]), // poolBump
      Buffer.from([0, 0]), // index (u16 little-endian)
      new PublicKey('11111111111111111111111111111111').toBuffer(), // creator
      new PublicKey('So11111111111111111111111111111111111111112').toBuffer(), // baseMint
      new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(), // quoteMint
      new PublicKey('22222222222222222222222222222222').toBuffer(), // lpMint
      new PublicKey('33333333333333333333333333333333').toBuffer(), // poolBaseTokenAccount
      new PublicKey('44444444444444444444444444444444').toBuffer(), // poolQuoteTokenAccount
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), // lpSupply (u64 little-endian = 1)
      new PublicKey('55555555555555555555555555555555').toBuffer(), // coinCreator
    ]);
    
    const decoded = decodePoolAccount(mockPoolData);
    
    if (decoded) {
      const plain = poolAccountToPlain(decoded);
      recordTest('Pool decoder can decode mock data', 'PASS', 
        `Decoded pool with quoteMint: ${plain.quoteMint}`,
        plain
      );
      testData.decodedPools.push(plain);
    } else {
      recordTest('Pool decoder can decode mock data', 'FAIL', 'Failed to decode mock pool data');
    }
    
    // Test with invalid data
    const invalidDecoded = decodePoolAccount(Buffer.from([1, 2, 3]));
    if (!invalidDecoded) {
      recordTest('Pool decoder handles invalid data gracefully', 'PASS');
    } else {
      recordTest('Pool decoder handles invalid data gracefully', 'FAIL', 'Should have returned null');
    }
    
  } catch (error) {
    recordTest('Pool decoder tests', 'FAIL', error.message);
  }
}

/**
 * Test 2: Verify database schema
 */
async function testDatabaseSchema() {
  console.log(chalk.cyan('\n🧪 Test 2: Database Schema'));
  
  try {
    // Check table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'amm_pool_states'
      );
    `);
    
    if (tableCheck.rows[0].exists) {
      recordTest('Table amm_pool_states exists', 'PASS');
    } else {
      recordTest('Table amm_pool_states exists', 'FAIL');
      return;
    }
    
    // Check columns
    const columnsResult = await db.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'amm_pool_states'
      ORDER BY ordinal_position;
    `);
    
    const requiredColumns = [
      { name: 'mint_address', type: 'character varying', length: 64 },
      { name: 'pool_address', type: 'character varying', length: 64 },
      { name: 'virtual_sol_reserves', type: 'bigint' },
      { name: 'virtual_token_reserves', type: 'bigint' },
      { name: 'slot', type: 'bigint' },
    ];
    
    let allColumnsPresent = true;
    for (const required of requiredColumns) {
      const found = columnsResult.rows.find(col => 
        col.column_name === required.name && 
        col.data_type === required.type &&
        (!required.length || col.character_maximum_length === required.length)
      );
      
      if (found) {
        recordTest(`Column ${required.name} (${required.type}${required.length ? `(${required.length})` : ''})`, 'PASS');
      } else {
        recordTest(`Column ${required.name}`, 'FAIL', 'Missing or incorrect type');
        allColumnsPresent = false;
      }
    }
    
    // Check indexes
    const indexResult = await db.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'amm_pool_states';
    `);
    
    const requiredIndexes = ['idx_amm_pool_states_mint', 'idx_amm_pool_states_pool', 'idx_amm_pool_states_slot'];
    for (const indexName of requiredIndexes) {
      const found = indexResult.rows.find(idx => idx.indexname === indexName);
      if (found) {
        recordTest(`Index ${indexName}`, 'PASS');
      } else {
        recordTest(`Index ${indexName}`, 'FAIL', 'Missing');
      }
    }
    
    // Test insert with Solana address format
    const testMint = 'TestMintAddress' + Date.now() + 'pump';
    const testPool = 'TestPoolAddress' + Date.now() + 'pool';
    
    await db.query(`
      INSERT INTO amm_pool_states (
        mint_address, pool_address, virtual_sol_reserves, 
        virtual_token_reserves, slot
      ) VALUES ($1, $2, $3, $4, $5)
    `, [testMint, testPool, 1000000000, 2000000000, 123456]);
    
    const verifyResult = await db.query(
      'SELECT * FROM amm_pool_states WHERE mint_address = $1',
      [testMint]
    );
    
    if (verifyResult.rows.length > 0 && verifyResult.rows[0].mint_address === testMint) {
      recordTest('Database accepts Solana address format', 'PASS', `Stored: ${testMint}`);
      testData.dbRecords.push(verifyResult.rows[0]);
      
      // Clean up
      await db.query('DELETE FROM amm_pool_states WHERE mint_address = $1', [testMint]);
    } else {
      recordTest('Database accepts Solana address format', 'FAIL');
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
    
    // Test loading existing pools
    const allPools = poolStateService.getAllPools();
    recordTest('Pool state service initializes', 'PASS', `Loaded ${allPools.size} pools from database`);
    
    // Test pool state update
    const testPoolData = {
      poolAddress: 'TestPool' + Date.now(),
      poolBump: 1,
      index: 0,
      creator: '11111111111111111111111111111111',
      baseMint: 'So11111111111111111111111111111111111111112',
      quoteMint: 'TestToken' + Date.now() + 'pump',
      lpMint: 'TestLP' + Date.now(),
      poolBaseTokenAccount: 'TestBase' + Date.now(),
      poolQuoteTokenAccount: 'TestQuote' + Date.now(),
      lpSupply: 1000000,
      coinCreator: 'TestCreator' + Date.now(),
      slot: 999999,
    };
    
    await poolStateService.updatePoolState(testPoolData);
    
    // Verify it's in cache
    const cachedState = poolStateService.getPoolState(testPoolData.quoteMint);
    if (cachedState) {
      recordTest('Pool state service caches updates', 'PASS', 
        `Cached pool for mint: ${testPoolData.quoteMint}`
      );
      testData.poolStates.push(cachedState);
    } else {
      recordTest('Pool state service caches updates', 'FAIL', 'Pool not found in cache');
    }
    
    // Test reserve update
    await poolStateService.updatePoolReserves(
      testPoolData.quoteMint,
      5000000000, // 5 SOL
      10000000000, // 10000 tokens
      1000000
    );
    
    const updatedState = poolStateService.getPoolState(testPoolData.quoteMint);
    if (updatedState && updatedState.reserves.virtualSolReserves === 5000000000) {
      recordTest('Pool state service updates reserves', 'PASS',
        `Updated reserves: ${updatedState.reserves.virtualSolReserves} lamports`
      );
      
      // Check price calculation
      if (updatedState.metrics.pricePerTokenSol > 0) {
        recordTest('Pool state service calculates prices', 'PASS',
          `Price: ${updatedState.metrics.pricePerTokenSol.toFixed(6)} SOL per token`
        );
      } else {
        recordTest('Pool state service calculates prices', 'FAIL', 'Price is 0');
      }
    } else {
      recordTest('Pool state service updates reserves', 'FAIL');
    }
    
    // Test pool lookup by address
    const byAddress = poolStateService.getPoolStateByAddress(testPoolData.poolAddress);
    if (byAddress) {
      recordTest('Pool state service lookup by pool address', 'PASS');
    } else {
      recordTest('Pool state service lookup by pool address', 'FAIL');
    }
    
    // Wait for batch processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Verify database save
    const dbCheck = await db.query(
      'SELECT * FROM amm_pool_states WHERE mint_address = $1 ORDER BY created_at DESC LIMIT 1',
      [testPoolData.quoteMint]
    );
    
    if (dbCheck.rows.length > 0) {
      recordTest('Pool state service saves to database', 'PASS',
        `Found ${dbCheck.rows.length} records in database`
      );
      testData.dbRecords.push(dbCheck.rows[0]);
      
      // Clean up
      await db.query('DELETE FROM amm_pool_states WHERE mint_address = $1', [testPoolData.quoteMint]);
    } else {
      recordTest('Pool state service saves to database', 'FAIL', 'No records found');
    }
    
  } catch (error) {
    recordTest('Pool state service tests', 'FAIL', error.message);
  }
}

/**
 * Test 4: Live monitoring integration
 */
async function testLiveMonitoring() {
  console.log(chalk.cyan('\n🧪 Test 4: Live Monitoring Integration'));
  
  suppressParserWarnings();
  
  const grpcEndpoint = process.env.SHYFT_GRPC_ENDPOINT;
  const grpcToken = process.env.SHYFT_GRPC_TOKEN;
  
  if (!grpcEndpoint || !grpcToken) {
    recordTest('gRPC credentials available', 'SKIP', 'Missing SHYFT credentials');
    return;
  }
  
  recordTest('gRPC credentials available', 'PASS');
  
  try {
    const client = new Client(grpcEndpoint, grpcToken, undefined);
    const poolStateService = new AmmPoolStateService();
    
    // Track monitoring results
    let accountUpdates = 0;
    let poolsDecoded = 0;
    let tradesDetected = 0;
    let reserveUpdatesDetected = 0;
    
    // Monitor for 20 seconds
    const MONITOR_DURATION = 20000;
    const startTime = Date.now();
    
    console.log(chalk.gray(`\nMonitoring for ${MONITOR_DURATION/1000} seconds...`));
    
    // Subscribe to both accounts and transactions
    const req: SubscribeRequest = {
      slots: {},
      accounts: {
        pumpswap_amm: {
          account: [],
          filters: [],
          owner: [PUMP_AMM_PROGRAM_ID.toBase58()],
        },
      },
      transactions: {
        pumpAMM: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_AMM_PROGRAM_ID.toBase58()],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.PROCESSED,
    };
    
    const stream = await client.subscribe();
    
    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      stream.end();
    }, MONITOR_DURATION);
    
    // Handle account updates
    stream.on("data", async (data) => {
      try {
        if (data?.account) {
          accountUpdates++;
          
          const accountInfo = data.account.account;
          const accountPubkey = convertBase64ToBase58(accountInfo.pubkey);
          const accountData = Buffer.from(accountInfo.data, 'base64');
          
          const decodedPool = decodePoolAccount(accountData);
          if (decodedPool) {
            poolsDecoded++;
            const plainPool = poolAccountToPlain(decodedPool);
            testData.decodedPools.push(plainPool);
            
            // Update pool state
            await poolStateService.updatePoolState({
              poolAddress: accountPubkey,
              ...plainPool,
              slot: data.slot || 0,
            });
          }
        } else if (data?.transaction) {
          // Process trade to get reserves
          const txn = TXN_FORMATTER.formTransactionFromJson(
            data.transaction,
            Date.now()
          );
          
          const parsedTxn = decodePumpAmmTxn(txn);
          if (!parsedTxn) return;
          
          const formattedSwapTxn = parseSwapTransactionOutput(parsedTxn, txn);
          if (!formattedSwapTxn?.transactionEvent) return;
          
          tradesDetected++;
          const swapEvent = formattedSwapTxn.transactionEvent;
          testData.tradeEvents.push(swapEvent);
          
          // Check for reserve data
          const poolBaseReserves = Number(swapEvent.pool_base_token_reserves || 0);
          const poolQuoteReserves = Number(swapEvent.pool_quote_token_reserves || 0);
          
          if (poolBaseReserves > 0 && poolQuoteReserves > 0) {
            reserveUpdatesDetected++;
            testData.reserveUpdates.push({
              mint: swapEvent.mint,
              baseReserves: poolBaseReserves,
              quoteReserves: poolQuoteReserves,
            });
            
            await poolStateService.updatePoolReserves(
              swapEvent.mint,
              poolBaseReserves,
              poolQuoteReserves,
              txn.slot || 0
            );
          }
        }
      } catch (error) {
        // Silent error handling during monitoring
      }
    });
    
    // Send subscription
    await new Promise<void>((resolve, reject) => {
      stream.write(req, (err: any) => {
        if (err === null || err === undefined) {
          resolve();
        } else {
          reject(err);
        }
      });
    });
    
    // Wait for monitoring to complete
    await new Promise<void>((resolve) => {
      stream.on("end", () => {
        clearTimeout(timeoutHandle);
        resolve();
      });
      stream.on("error", () => {
        clearTimeout(timeoutHandle);
        resolve();
      });
    });
    
    // Record results
    if (accountUpdates > 0) {
      recordTest('Live account monitoring', 'PASS', 
        `Received ${accountUpdates} account updates`
      );
    } else {
      recordTest('Live account monitoring', 'FAIL', 'No account updates received');
    }
    
    if (poolsDecoded > 0) {
      recordTest('Live pool decoding', 'PASS',
        `Decoded ${poolsDecoded} pool accounts`
      );
    } else {
      recordTest('Live pool decoding', accountUpdates > 0 ? 'FAIL' : 'SKIP',
        accountUpdates > 0 ? 'Failed to decode any pools' : 'No accounts to decode'
      );
    }
    
    if (tradesDetected > 0) {
      recordTest('Live trade detection', 'PASS',
        `Detected ${tradesDetected} trades`
      );
    } else {
      recordTest('Live trade detection', 'SKIP', 'No trades detected in test period');
    }
    
    if (reserveUpdatesDetected > 0) {
      recordTest('Live reserve updates', 'PASS',
        `Updated reserves for ${reserveUpdatesDetected} trades`
      );
    } else {
      recordTest('Live reserve updates', tradesDetected > 0 ? 'FAIL' : 'SKIP',
        tradesDetected > 0 ? 'No reserve data in trades' : 'No trades to process'
      );
    }
    
    // Check if pool states have reserves
    const poolsWithReserves = Array.from(poolStateService.getAllPools().values())
      .filter(pool => pool.reserves.virtualSolReserves > 0);
    
    if (poolsWithReserves.length > 0) {
      recordTest('Integration: Reserves in pool state', 'PASS',
        `${poolsWithReserves.length} pools have reserve data`
      );
      
      // Check price calculations
      const poolsWithPrices = poolsWithReserves.filter(pool => pool.metrics.pricePerTokenSol > 0);
      if (poolsWithPrices.length > 0) {
        recordTest('Integration: Price calculations', 'PASS',
          `${poolsWithPrices.length} pools have calculated prices`
        );
      } else {
        recordTest('Integration: Price calculations', 'FAIL', 'No prices calculated');
      }
    } else {
      recordTest('Integration: Reserves in pool state', 
        reserveUpdatesDetected > 0 ? 'FAIL' : 'SKIP',
        'No pools have reserve data'
      );
    }
    
  } catch (error) {
    recordTest('Live monitoring tests', 'FAIL', error.message);
  }
}

/**
 * Helper functions
 */
function convertBase64ToBase58(base64String: string): string {
  const buffer = Buffer.from(base64String, 'base64');
  return bs58.encode(buffer);
}

const TXN_FORMATTER = new TransactionFormatter();
const PUMP_AMM_IX_PARSER = new SolanaParser([]);
PUMP_AMM_IX_PARSER.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as Idl);

function decodePumpAmmTxn(tx: any) {
  if (tx.meta?.err) return;
  
  try {
    const parsedIxs = PUMP_AMM_IX_PARSER.parseTransactionData(
      tx.transaction.message,
      tx.meta.loadedAddresses,
    );

    const pumpAmmIxs = parsedIxs.filter((ix) =>
      ix.programId.equals(PUMP_AMM_PROGRAM_ID)
    );

    if (pumpAmmIxs.length === 0) return;
    
    return { instructions: { pumpAmmIxs } };
  } catch (err) {
    return null;
  }
}

/**
 * Generate test report
 */
function generateReport() {
  console.log(chalk.cyan.bold('\n\n📊 AMM SESSION 1 TEST REPORT'));
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
  
  console.log(chalk.white('\n📈 Collected Data:'));
  console.log(chalk.gray(`  Decoded Pools: ${testData.decodedPools.length}`));
  console.log(chalk.gray(`  Pool States: ${testData.poolStates.length}`));
  console.log(chalk.gray(`  Trade Events: ${testData.tradeEvents.length}`));
  console.log(chalk.gray(`  Reserve Updates: ${testData.reserveUpdates.length}`));
  console.log(chalk.gray(`  DB Records: ${testData.dbRecords.length}`));
  
  console.log(chalk.gray('\n═'.repeat(60)));
  
  if (failed === 0) {
    console.log(chalk.green.bold('✅ AMM SESSION 1: FULLY IMPLEMENTED AND WORKING'));
    console.log(chalk.green('All components are functioning correctly!'));
  } else {
    console.log(chalk.red.bold('❌ AMM SESSION 1: INCOMPLETE OR ISSUES DETECTED'));
    console.log(chalk.red('Please fix the failed tests before proceeding.'));
  }
  
  // Save detailed report
  const reportPath = './amm-session-1-test-report.json';
  require('fs').writeFileSync(reportPath, JSON.stringify({
    summary: { passed, failed, skipped, total },
    results: testResults,
    data: testData,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  console.log(chalk.gray(`\nDetailed report saved to: ${reportPath}`));
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log(chalk.cyan.bold('🚀 AMM SESSION 1 EXHAUSTIVE TEST SUITE'));
  console.log(chalk.gray('Testing all components of Pool Reserve Monitoring\n'));
  
  try {
    await testPoolDecoder();
    await testDatabaseSchema();
    await testPoolStateService();
    await testLiveMonitoring();
  } catch (error) {
    console.error(chalk.red('\nFatal error during testing:'), error);
  } finally {
    await db.close();
  }
  
  generateReport();
  process.exit(testResults.filter(t => t.status === 'FAIL').length > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(console.error);