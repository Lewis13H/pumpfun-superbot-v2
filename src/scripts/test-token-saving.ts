#!/usr/bin/env tsx

/**
 * Test token saving functionality
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { createContainer } from '../core/container-factory';
import { TOKENS } from '../core/container';
import { TradeEvent, EventType } from '../utils/parsers/types';

async function testTokenSaving() {
  console.log('\n🧪 Testing Token Saving\n');
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Create container
    const container = await createContainer();
    
    // Get services
    const tradeHandler = await container.resolve(TOKENS.TradeHandler);
    const solPriceService = await container.resolve(TOKENS.SolPriceService);
    const tokenRepo = await container.resolve(TOKENS.TokenRepository);
    
    // Get current SOL price
    const solPrice = solPriceService.getCurrentPrice();
    console.log(`Current SOL price: $${solPrice}`);
    
    // Check current threshold
    const config = await container.resolve(TOKENS.ConfigService);
    const threshold = config.get('monitors').bcSaveThreshold;
    console.log(`BC save threshold: $${threshold}`);
    
    // Create a test trade that should meet the threshold
    const testTrade: TradeEvent = {
      type: EventType.BC_TRADE,
      signature: 'test-sig-' + Date.now(),
      mintAddress: 'TESTtoken' + Date.now() + 'pump',
      tradeType: 'buy',
      userAddress: 'testuser123',
      solAmount: BigInt(100 * 1e9), // 100 SOL
      tokenAmount: BigInt(1000000 * 1e6), // 1M tokens
      virtualSolReserves: BigInt(100 * 1e9), // 100 SOL reserves
      virtualTokenReserves: BigInt(500000000 * 1e6), // 500M tokens in reserves
      slot: BigInt(123456789),
      blockTime: Date.now() / 1000,
      bondingCurveKey: 'test-bc-key',
      complete: false
    };
    
    console.log('\nProcessing test trade...');
    const result = await tradeHandler.processTrade(testTrade, solPrice);
    
    console.log(`Trade processed: ${result.saved ? '✅' : '❌'}`);
    if (result.token) {
      console.log(`Token saved: ${result.token.mintAddress}`);
      console.log(`Market cap: $${result.token.currentMarketCapUsd.toLocaleString()}`);
    } else {
      console.log('No token saved');
      
      // Calculate what the market cap should be
      const solReserves = Number(testTrade.virtualSolReserves!) / 1e9;
      const tokenReserves = Number(testTrade.virtualTokenReserves!) / 1e6;
      const priceInSol = solReserves / tokenReserves;
      const priceInUsd = priceInSol * solPrice;
      const marketCap = priceInUsd * 1e9 * 0.1; // 1B supply * 10% circulating
      
      console.log(`\nCalculated market cap: $${marketCap.toLocaleString()}`);
      console.log(`Meets threshold? ${marketCap >= threshold ? 'YES' : 'NO'}`);
    }
    
    // Check if any tokens are in the database
    const tokenCount = await pool.query('SELECT COUNT(*) FROM tokens_unified');
    console.log(`\nTokens in database: ${tokenCount.rows[0].count}`);
    
    // Check trades
    const tradeCount = await pool.query('SELECT COUNT(*) FROM trades_unified');
    console.log(`Trades in database: ${tradeCount.rows[0].count}`);
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await pool.end();
  }
}

testTokenSaving().catch(console.error);