/**
 * Test script for AMM Reserves Fetcher
 */

import 'dotenv/config';
import chalk from 'chalk';
import { EventBus } from '../core/event-bus';
import { AmmReservesFetcher } from '../services/amm/amm-reserves-fetcher';
import { AMMTradeEvent, EventType } from '../utils/parsers/types';
import { db } from '../database';

async function testAmmReservesFetcher() {
  console.log(chalk.cyan('Testing AMM Reserves Fetcher...'));
  
  try {
    // Initialize EventBus and AmmReservesFetcher
    const eventBus = new EventBus();
    const reservesFetcher = AmmReservesFetcher.getInstance(eventBus);
    
    // Listen for AMM_RESERVES_FETCHED events
    eventBus.on('AMM_RESERVES_FETCHED', (data) => {
      console.log(chalk.green('\n✅ AMM Reserves Fetched:'));
      console.log(chalk.gray(`  Mint: ${data.mintAddress}`));
      console.log(chalk.gray(`  Pool: ${data.poolAddress}`));
      console.log(chalk.gray(`  SOL Reserves: ${Number(data.solReserves) / 1e9} SOL`));
      console.log(chalk.gray(`  Token Reserves: ${Number(data.tokenReserves) / 1e6}`));
      console.log(chalk.gray(`  Price USD: $${data.priceInUsd.toFixed(9)}`));
      console.log(chalk.gray(`  Market Cap: $${data.marketCapUsd.toFixed(2)}`));
    });
    
    // Find a recent AMM token without reserves
    console.log(chalk.yellow('\nLooking for AMM tokens without reserves...'));
    
    const result = await db.query(`
      SELECT DISTINCT t.mint_address, t.symbol, t.name, t.latest_market_cap_usd
      FROM trades_unified tr
      JOIN tokens_unified t ON tr.mint_address = t.mint_address
      WHERE tr.program = 'amm_pool'
        AND tr.created_at > NOW() - INTERVAL '24 hours'
        AND (t.latest_virtual_sol_reserves IS NULL OR t.latest_virtual_token_reserves IS NULL)
        AND t.graduated_to_amm = true
      ORDER BY tr.created_at DESC
      LIMIT 5
    `);
    
    if (result.rows.length === 0) {
      console.log(chalk.yellow('No AMM tokens without reserves found.'));
      console.log(chalk.yellow('Trying recent AMM tokens to test the fetcher...'));
      
      // Get any recent AMM token
      const recentResult = await db.query(`
        SELECT DISTINCT t.mint_address, t.symbol, t.name, t.latest_market_cap_usd
        FROM trades_unified tr
        JOIN tokens_unified t ON tr.mint_address = t.mint_address
        WHERE tr.program = 'amm_pool'
          AND tr.created_at > NOW() - INTERVAL '1 hour'
        ORDER BY tr.created_at DESC
        LIMIT 5
      `);
      
      if (recentResult.rows.length === 0) {
        console.log(chalk.red('No recent AMM trades found.'));
        process.exit(0);
      }
      
      result.rows = recentResult.rows;
    }
    
    console.log(chalk.cyan(`\nFound ${result.rows.length} tokens to test:`));
    for (const token of result.rows) {
      console.log(chalk.gray(`  ${token.symbol || 'UNKNOWN'} (${token.mint_address.substring(0, 8)}...) - Market Cap: $${token.latest_market_cap_usd?.toFixed(2) || 'N/A'}`));
    }
    
    // Test with the first token
    const testToken = result.rows[0];
    console.log(chalk.yellow(`\nTesting with token: ${testToken.symbol || 'UNKNOWN'} (${testToken.mint_address})`));
    
    // Create a mock AMM trade event
    const mockTradeEvent: AMMTradeEvent = {
      type: EventType.AMM_TRADE,
      signature: 'test-signature',
      slot: 123456789n,
      blockTime: Math.floor(Date.now() / 1000),
      programId: '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg',
      tradeType: 'buy',
      mintAddress: testToken.mint_address,
      userAddress: '11111111111111111111111111111111',
      solAmount: 1000000000n, // 1 SOL
      tokenAmount: 1000000000n, // 1000 tokens
      poolAddress: 'test-pool-address',
      inputMint: 'So11111111111111111111111111111111111111112',
      inAmount: 1000000000n,
      outputMint: testToken.mint_address,
      outAmount: 1000000000n
    };
    
    console.log(chalk.yellow('\nEmitting AMM_TRADE event...'));
    eventBus.emit('AMM_TRADE', mockTradeEvent);
    
    // Also test manual fetch
    console.log(chalk.yellow('\nTesting manual fetch...'));
    const success = await reservesFetcher.fetchReservesForToken(testToken.mint_address);
    
    if (success) {
      console.log(chalk.green('✅ Manual fetch successful!'));
    } else {
      console.log(chalk.red('❌ Manual fetch failed'));
    }
    
    // Wait a bit for async operations
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check if the token was updated
    const updatedToken = await db.query(
      'SELECT latest_virtual_sol_reserves, latest_virtual_token_reserves, latest_price_usd, latest_market_cap_usd FROM tokens_unified WHERE mint_address = $1',
      [testToken.mint_address]
    );
    
    if (updatedToken.rows.length > 0) {
      const token = updatedToken.rows[0];
      console.log(chalk.cyan('\nToken after update:'));
      console.log(chalk.gray(`  SOL Reserves: ${token.latest_virtual_sol_reserves || 'null'}`));
      console.log(chalk.gray(`  Token Reserves: ${token.latest_virtual_token_reserves || 'null'}`));
      console.log(chalk.gray(`  Price USD: $${token.latest_price_usd || 'null'}`));
      console.log(chalk.gray(`  Market Cap: $${token.latest_market_cap_usd || 'null'}`));
    }
    
    // Get service stats
    const stats = reservesFetcher.getStats();
    console.log(chalk.cyan('\nService Stats:'));
    console.log(chalk.gray(`  Cached tokens: ${stats.cachedTokens}`));
    if (stats.cacheEntries.length > 0) {
      console.log(chalk.gray('  Cache entries:'));
      for (const entry of stats.cacheEntries) {
        console.log(chalk.gray(`    ${entry.mint.substring(0, 8)}... - ${entry.lastFetched}`));
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the test
testAmmReservesFetcher().catch(console.error);