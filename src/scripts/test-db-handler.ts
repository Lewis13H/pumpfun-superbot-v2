#!/usr/bin/env tsx
/**
 * Test database handler functionality
 */

import 'dotenv/config';
import { BondingCurveDbHandler, ProcessedTradeData } from '../handlers/bc-db-handler';
import { BondingCurveTradeEvent } from '../parsers/bc-event-parser';

async function testDbHandler() {
  console.log('Testing database handler...');
  
  const handler = new BondingCurveDbHandler();
  
  // Create a test trade above threshold
  const testEvent: BondingCurveTradeEvent = {
    mint: 'TestMint123456789TestMint123456789TestMint123',
    virtualSolReserves: BigInt(50_000_000_000), // 50 SOL
    virtualTokenReserves: BigInt(500_000_000_000_000), // 500M tokens
    user: 'TestUser123456789TestUser123456789TestUser123',
    solAmount: BigInt(1_000_000_000), // 1 SOL
    tokenAmount: BigInt(10_000_000_000), // 10M tokens
    isBuy: true
  };
  
  const testData: ProcessedTradeData = {
    event: testEvent,
    tradeType: 'buy',
    signature: 'TestSignature123',
    priceInSol: 0.0001,
    priceInUsd: 0.014,
    marketCapUsd: 14000, // $14K - above threshold
    progress: 58.8,
    slot: BigInt(123456789),
    blockTime: new Date()
  };
  
  console.log('Sending test trade with MC: $14,000...');
  
  try {
    await handler.processTrade(testData);
    console.log('✅ Trade processed successfully');
    
    // Check stats
    const stats = handler.getStats();
    console.log('Stats:', stats);
    
    // Wait a bit for batch processing
    console.log('Waiting 2 seconds for batch processing...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Flush
    console.log('Flushing batches...');
    await handler.flush();
    
    console.log('Final stats:', handler.getStats());
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

testDbHandler();