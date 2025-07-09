/**
 * Test IDL Event Parsing
 * Verifies the implementation of IDL-based event parsing
 * Part of High Priority Week 1 implementation
 */

import { IDLEventParser } from '../services/parsing/idl-event-parser';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import * as chalk from 'chalk';

// Mock transaction data generator
class TestDataGenerator {
  /**
   * Generate a mock pump.fun create transaction
   */
  generatePumpFunCreateTransaction(): any {
    // Note: These were PublicKey objects but caused issues
    const mintPubkey = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const bondingCurvePubkey = '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf';
    const creatorPubkey = '11111111111111111111111111111111';
    
    return {
      signature: 'mock-create-signature',
      slot: 123456789,
      blockTime: Date.now() / 1000,
      success: true,
      fee: 5000,
      accounts: [
        { pubkey: creatorPubkey., isSigner: true, isWritable: true },
        { pubkey: mintPubkey., isSigner: false, isWritable: true },
        { pubkey: bondingCurvePubkey., isSigner: false, isWritable: true },
      ],
      instructions: [{
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun program
        accounts: [creatorPubkey., mintPubkey., bondingCurvePubkey.],
        data: 'create_instruction_data'
      }],
      innerInstructions: [],
      logs: [
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
        'Program log: Instruction: Create',
        'Program data: ' + Buffer.from(JSON.stringify({
          name: 'Create',
          data: {
            mint: mintPubkey.,
            bondingCurve: bondingCurvePubkey,
            creator: creatorPubkey.,
            name: 'Test Token',
            symbol: 'TEST',
            uri: 'https://test.com/metadata.json',
            decimals: 6,
            bondingCurveType: 0
          }
        })).toString('base64'),
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
      ],
      meta: {
        err: null,
        fee: 5000,
        logMessages: [] // Will be populated from logs
      }
    };
  }
  
  /**
   * Generate a mock pump.fun trade transaction
   */
  generatePumpFunTradeTransaction(isBuy: boolean = true): any {
    // Note: Using string addresses instead of PublicKey objects
    const mintPubkey = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const traderPubkey = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
    const bondingCurvePubkey = '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf';
    
    return {
      signature: `mock-${isBuy ? 'buy' : 'sell'}-signature`,
      slot: 123456790,
      blockTime: Date.now() / 1000,
      success: true,
      fee: 5000,
      accounts: [
        { pubkey: traderPubkey., isSigner: true, isWritable: true },
        { pubkey: mintPubkey., isSigner: false, isWritable: true },
        { pubkey: bondingCurvePubkey., isSigner: false, isWritable: true },
      ],
      instructions: [{
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        accounts: [traderPubkey., mintPubkey., bondingCurvePubkey.],
        data: 'trade_instruction_data'
      }],
      innerInstructions: [],
      logs: [
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
        'Program log: Instruction: Trade',
        'Program data: ' + Buffer.from(JSON.stringify({
          name: 'Trade',
          data: {
            mint: mintPubkey.,
            trader: traderPubkey.,
            tokenAmount: '1000000000', // 1000 tokens
            solAmount: '100000000', // 0.1 SOL
            isBuy: isBuy,
            virtualSolReserves: '50000000000', // 50 SOL
            virtualTokenReserves: '950000000000000', // 950k tokens
            realSolReserves: '45000000000',
            realTokenReserves: '900000000000000',
            bondingCurve: bondingCurvePubkey
          }
        })).toString('base64'),
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
      ],
      meta: {
        err: null,
        fee: 5000,
        logMessages: [] // Will be populated from logs
      }
    };
  }
  
  /**
   * Generate a mock AMM swap transaction
   */
  generateAMMSwapTransaction(): any {
    // Note: Using valid pool and trader addresses
    const poolPubkey = '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj';
    const traderPubkey = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
    const baseMintPubkey = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const quoteMintPubkey = 'So11111111111111111111111111111111111111112';
    
    return {
      signature: 'mock-amm-swap-signature',
      slot: 123456791,
      blockTime: Date.now() / 1000,
      success: true,
      fee: 5000,
      accounts: [
        { pubkey: traderPubkey., isSigner: true, isWritable: true },
        { pubkey: poolPubkey., isSigner: false, isWritable: true },
        { pubkey: baseMintPubkey., isSigner: false, isWritable: false },
        { pubkey: quoteMintPubkey., isSigner: false, isWritable: false },
      ],
      instructions: [{
        programId: 'PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP', // Pump.swap AMM
        accounts: [traderPubkey., poolPubkey.],
        data: 'swap_instruction_data'
      }],
      innerInstructions: [],
      logs: [
        'Program PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP invoke [1]',
        'Program log: Instruction: Buy',
        'Program data: ' + Buffer.from(JSON.stringify({
          name: 'Buy',
          data: {
            pool: poolPubkey.,
            trader: traderPubkey.,
            baseAmountOut: '2000000000', // 2000 tokens
            quoteAmountIn: '200000000', // 0.2 SOL
            poolBaseReserves: '500000000000', // 500k tokens
            poolQuoteReserves: '100000000000', // 100 SOL
            lpFee: '600000', // 0.0006 SOL
            protocolFee: '400000', // 0.0004 SOL
            userBaseAccount: 'base-token-account',
            userQuoteAccount: 'quote-token-account'
          }
        })).toString('base64'),
        'Program PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP success'
      ],
      meta: {
        err: null,
        fee: 5000,
        logMessages: [] // Will be populated from logs
      }
    };
  }
}

async function testIDLEventParsing() {
  console.log(chalk.bold.cyan('\n🚀 Testing IDL Event Parsing Implementation\n'));
  
  const parser = new IDLEventParser();
  const generator = new TestDataGenerator();
  
  // Test 1: Parse pump.fun create event
  console.log(chalk.bold('Test 1: Pump.fun Create Event'));
  try {
    const createTx = generator.generatePumpFunCreateTransaction();
    // Copy logs to logMessages for parser
    createTx.meta.logMessages = createTx.logs;
    
    const createEvents = parser.parseTransaction(createTx);
    
    if (createEvents.length > 0) {
      console.log(chalk.green(`✅ Parsed ${createEvents.length} create event(s)`));
      console.log('Event details:', JSON.stringify(createEvents[0], null, 2));
    } else {
      console.log(chalk.yellow('⚠️  No create events parsed'));
    }
  } catch (error) {
    console.log(chalk.red('❌ Failed to parse create event:'), error);
  }
  
  // Test 2: Parse pump.fun trade events
  console.log(chalk.bold('\nTest 2: Pump.fun Trade Events'));
  try {
    // Test buy
    const buyTx = generator.generatePumpFunTradeTransaction(true);
    buyTx.meta.logMessages = buyTx.logs;
    const buyEvents = parser.parseTransaction(buyTx);
    
    if (buyEvents.length > 0) {
      console.log(chalk.green(`✅ Parsed ${buyEvents.length} buy event(s)`));
      console.log('Buy event:', buyEvents[0].name);
    }
    
    // Test sell
    const sellTx = generator.generatePumpFunTradeTransaction(false);
    sellTx.meta.logMessages = sellTx.logs;
    const sellEvents = parser.parseTransaction(sellTx);
    
    if (sellEvents.length > 0) {
      console.log(chalk.green(`✅ Parsed ${sellEvents.length} sell event(s)`));
      console.log('Sell event:', sellEvents[0].name);
    }
  } catch (error) {
    console.log(chalk.red('❌ Failed to parse trade events:'), error);
  }
  
  // Test 3: Parse AMM swap event
  console.log(chalk.bold('\nTest 3: AMM Swap Event'));
  try {
    const swapTx = generator.generateAMMSwapTransaction();
    swapTx.meta.logMessages = swapTx.logs;
    const swapEvents = parser.parseTransaction(swapTx);
    
    if (swapEvents.length > 0) {
      console.log(chalk.green(`✅ Parsed ${swapEvents.length} swap event(s)`));
      console.log('Swap event details:', JSON.stringify(swapEvents[0], null, 2));
    } else {
      console.log(chalk.yellow('⚠️  No swap events parsed'));
    }
  } catch (error) {
    console.log(chalk.red('❌ Failed to parse swap event:'), error);
  }
  
  // Test 4: Performance test
  console.log(chalk.bold('\nTest 4: Performance Test'));
  const iterations = 1000;
  const tradeTx = generator.generatePumpFunTradeTransaction();
  tradeTx.meta.logMessages = tradeTx.logs;
  
  const start = Date.now();
  let successCount = 0;
  
  for (let i = 0; i < iterations; i++) {
    const events = parser.parseTransaction(tradeTx);
    if (events.length > 0) successCount++;
  }
  
  const elapsed = Date.now() - start;
  const tps = (iterations / elapsed) * 1000;
  
  console.log(chalk.green(`✅ Parsed ${iterations} transactions in ${elapsed}ms`));
  console.log(chalk.green(`   Performance: ${tps.toFixed(0)} TPS`));
  console.log(chalk.green(`   Success rate: ${(successCount / iterations * 100).toFixed(1)}%`));
  
  // Test 5: Parser statistics
  console.log(chalk.bold('\nTest 5: Parser Statistics'));
  const stats = parser.getStats();
  console.log('Parser stats:', stats);
  
  // Test 6: Event type helpers
  console.log(chalk.bold('\nTest 6: Event Type Helpers'));
  const events = parser.parseTransaction(tradeTx);
  if (events.length > 0) {
    const event = events[0];
    console.log(`Is trade event: ${parser.isTradeEvent(event)}`);
    console.log(`Is liquidity event: ${parser.isLiquidityEvent(event)}`);
    console.log(`Is graduation event: ${parser.isGraduationEvent(event)}`);
  }
  
  // Summary
  console.log(chalk.bold.cyan('\n📊 Test Summary:'));
  const finalStats = parser.getStats();
  for (const [programId, stat] of Object.entries(finalStats)) {
    console.log(`${programId}: ${stat.successRate.toFixed(1)}% success rate`);
  }
  
  // Note about real testing
  console.log(chalk.yellow('\n⚠️  Note: This test uses mock data. For real testing:'));
  console.log('1. The IDL events need to match the actual on-chain program events');
  console.log('2. Real transaction logs will have different formats');
  console.log('3. Enable USE_IDL_PARSING=true to use in production');
}

// Run the test
testIDLEventParsing().catch(console.error);