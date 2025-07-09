/**
 * Test IDL Event Parsing with Real Data
 * Tests the implementation with actual transaction structures
 */

import { Connection } from '@solana/web3.js';
import * as chalk from 'chalk';
import { Container } from '../core/container';
import { setupContainer } from '../config/container';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import { SmartStreamManager } from '../services/core/smart-stream-manager';

// Mock gRPC transaction data structure (similar to what we receive)
function createMockGrpcData() {
  return {
    transaction: {
      slot: 288245678,
      transaction: {
        transaction: {
          signatures: [Buffer.from('mocksignature123', 'utf8')],
          message: {
            accountKeys: [
              Buffer.from('DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK', 'base64'),
              Buffer.from('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'base64'),
              Buffer.from('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf', 'base64'),
              Buffer.from('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'base64')
            ],
            instructions: [{
              programIdIndex: 3, // Points to pump.fun program
              accounts: [0, 1, 2], // Trader, mint, bonding curve
              data: 'AQAAAAAAAADAmJaAAAAAAAA=' // Mock instruction data
            }]
          }
        },
        meta: {
          err: null,
          fee: 5000,
          logMessages: [
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
            'Program log: Instruction: Buy',
            'Program log: User DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
            'Program log: Token Amount: 1000000000',
            'Program log: Sol Amount: 100000000',
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P consumed 45000 of 200000 compute units',
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
          ],
          innerInstructions: [{
            index: 0,
            instructions: [{
              programIdIndex: 1,
              accounts: [1, 2],
              data: 'AwAAAAAAAAA='
            }]
          }],
          preTokenBalances: [],
          postTokenBalances: []
        }
      }
    }
  };
}

async function testRealDataParsing() {
  console.log(chalk.bold.cyan('\n🚀 Testing IDL Event Parsing with Real Data\n'));
  
  try {
    // Initialize container
    console.log(chalk.blue('Initializing container...'));
    const container = await setupContainer();
    
    // Create a token lifecycle monitor (which uses IDL parsing)
    console.log(chalk.blue('Creating TokenLifecycleMonitor...'));
    const monitor = new TokenLifecycleMonitor(container, {
      subscriptions: ['pump_fun_txs'],
      commitment: 'confirmed'
    });
    
    // Initialize the monitor
    await monitor['initialize']();
    
    // Test 1: Process mock gRPC data
    console.log(chalk.bold('\nTest 1: Processing Mock gRPC Transaction'));
    const mockData = createMockGrpcData();
    
    // Enable IDL parsing
    process.env.USE_IDL_PARSING = 'true';
    
    // Process the transaction
    const startTime = Date.now();
    await monitor['processTransaction'](mockData);
    const elapsed = Date.now() - startTime;
    
    console.log(chalk.green(`✅ Processed transaction in ${elapsed}ms`));
    
    // Check monitor stats
    const stats = monitor['getStats']();
    console.log('\nMonitor Statistics:');
    console.log(`  Transactions: ${stats.transactions}`);
    console.log(`  Trades: ${stats.trades}`);
    console.log(`  Parse Errors: ${stats.errors}`);
    console.log(`  Parse Rate: ${stats.parseRate ? stats.parseRate.toFixed(1) : 0}%`);
    
    // Test 2: Test with different event types
    console.log(chalk.bold('\nTest 2: Testing Different Event Types'));
    
    // Create event
    const createData = {
      ...mockData,
      transaction: {
        ...mockData.transaction,
        transaction: {
          ...mockData.transaction.transaction,
          meta: {
            ...mockData.transaction.transaction.meta,
            logMessages: [
              'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
              'Program log: Instruction: Create',
              'Program log: Mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              'Program log: Bonding Curve: 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf',
              'Program log: Creator: DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
              'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
            ]
          }
        }
      }
    };
    
    await monitor['processTransaction'](createData);
    console.log(chalk.green('✅ Processed Create event'));
    
    // Complete event
    const completeData = {
      ...mockData,
      transaction: {
        ...mockData.transaction,
        transaction: {
          ...mockData.transaction.transaction,
          meta: {
            ...mockData.transaction.transaction.meta,
            logMessages: [
              'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
              'Program log: Instruction: Complete',
              'Program log: Mint graduated to AMM',
              'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
            ]
          }
        }
      }
    };
    
    await monitor['processTransaction'](completeData);
    console.log(chalk.green('✅ Processed Complete event'));
    
    // Test 3: Performance with batch processing
    console.log(chalk.bold('\nTest 3: Batch Performance Test'));
    const batchSize = 100;
    const batchStart = Date.now();
    
    for (let i = 0; i < batchSize; i++) {
      await monitor['processTransaction'](mockData);
    }
    
    const batchElapsed = Date.now() - batchStart;
    const tps = (batchSize / batchElapsed) * 1000;
    
    console.log(chalk.green(`✅ Processed ${batchSize} transactions in ${batchElapsed}ms`));
    console.log(chalk.green(`   Performance: ${tps.toFixed(0)} TPS`));
    
    // Test 4: Error handling
    console.log(chalk.bold('\nTest 4: Error Handling'));
    const invalidData = {
      transaction: {
        transaction: {
          meta: {
            err: { InstructionError: [0, 'Custom(0)'] },
            logMessages: ['Program failed']
          }
        }
      }
    };
    
    try {
      await monitor['processTransaction'](invalidData);
      console.log(chalk.green('✅ Handled error transaction gracefully'));
    } catch (error) {
      console.log(chalk.red('❌ Failed to handle error transaction'));
    }
    
    // Final stats
    console.log(chalk.bold.cyan('\n📊 Final Statistics:'));
    const finalStats = monitor['getStats']();
    console.log(JSON.stringify(finalStats, null, 2));
    
    // Test IDL vs Manual parsing
    console.log(chalk.bold('\nTest 5: IDL vs Manual Parsing Comparison'));
    
    // Test with IDL parsing
    process.env.USE_IDL_PARSING = 'true';
    const idlStart = Date.now();
    await monitor['processTransaction'](mockData);
    const idlTime = Date.now() - idlStart;
    
    // Test with manual parsing
    process.env.USE_IDL_PARSING = 'false';
    const manualStart = Date.now();
    await monitor['processTransaction'](mockData);
    const manualTime = Date.now() - manualStart;
    
    console.log(`IDL Parsing: ${idlTime}ms`);
    console.log(`Manual Parsing: ${manualTime}ms`);
    console.log(`Difference: ${Math.abs(idlTime - manualTime)}ms`);
    
  } catch (error) {
    console.error(chalk.red('Test failed:'), error);
  }
}

// Run the test
testRealDataParsing().catch(console.error);