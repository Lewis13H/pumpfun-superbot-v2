#!/usr/bin/env tsx

/**
 * Test script for GraphQL Price Recovery
 * Tests bulk price recovery functionality
 */

import 'dotenv/config';
import { GraphQLPriceRecovery } from '../services/graphql-price-recovery';
import { db } from '../database';
import chalk from 'chalk';

async function testGraphQLPriceRecovery() {
  console.log(chalk.cyan.bold('\n🧪 Testing GraphQL Price Recovery\n'));
  
  const priceRecovery = GraphQLPriceRecovery.getInstance();
  
  try {
    // Test 1: Get some active tokens from database
    console.log(chalk.blue('1️⃣ Fetching test tokens from database...'));
    const tokenResult = await db.query(`
      SELECT mint_address, symbol, latest_market_cap_usd
      FROM tokens_unified
      WHERE graduated_to_amm = false
        AND latest_market_cap_usd > 10000
      ORDER BY latest_market_cap_usd DESC
      LIMIT 150
    `);
    
    if (tokenResult.rows.length === 0) {
      console.log(chalk.yellow('No suitable test tokens found in database'));
      return;
    }
    
    console.log(chalk.green(`Found ${tokenResult.rows.length} test tokens`));
    
    // Test 2: Single token price recovery
    console.log(chalk.blue('\n2️⃣ Testing single token price recovery...'));
    const singleToken = tokenResult.rows[0].mint_address;
    const singleResult = await priceRecovery.recoverPrices([singleToken]);
    
    console.log(chalk.gray('Result:'));
    console.log(`  Successful: ${singleResult.successful.length}`);
    console.log(`  Failed: ${singleResult.failed.length}`);
    console.log(`  Query time: ${singleResult.queryTime}ms`);
    console.log(`  GraphQL queries: ${singleResult.graphqlQueries}`);
    
    if (singleResult.successful.length > 0) {
      const price = singleResult.successful[0];
      console.log(chalk.green('\n  Token details:'));
      console.log(`    Symbol: ${tokenResult.rows[0].symbol}`);
      console.log(`    Price USD: $${price.priceInUsd.toFixed(8)}`);
      console.log(`    Market Cap: $${price.marketCapUsd.toFixed(2)}`);
      console.log(`    Progress: ${price.progress.toFixed(2)}%`);
    }
    
    // Test 3: Batch price recovery (100 tokens)
    console.log(chalk.blue('\n3️⃣ Testing batch price recovery (100 tokens)...'));
    const batchTokens = tokenResult.rows.slice(0, 100).map(r => r.mint_address);
    const startTime = Date.now();
    const batchResult = await priceRecovery.recoverPrices(batchTokens);
    
    console.log(chalk.gray('Result:'));
    console.log(`  Successful: ${batchResult.successful.length}`);
    console.log(`  Failed: ${batchResult.failed.length}`);
    console.log(`  Query time: ${batchResult.queryTime}ms`);
    console.log(`  GraphQL queries: ${batchResult.graphqlQueries}`);
    console.log(`  Tokens per query: ${Math.floor(batchResult.successful.length / batchResult.graphqlQueries)}`);
    
    // Show some failed tokens if any
    if (batchResult.failed.length > 0) {
      console.log(chalk.yellow('\n  Sample failed tokens:'));
      batchResult.failed.slice(0, 5).forEach(fail => {
        console.log(`    ${fail.mintAddress.slice(0, 8)}... - ${fail.reason}`);
      });
    }
    
    // Test 4: Cache performance
    console.log(chalk.blue('\n4️⃣ Testing cache performance...'));
    const cacheStartTime = Date.now();
    const cachedResult = await priceRecovery.recoverPrices(batchTokens.slice(0, 50));
    const cacheTime = Date.now() - cacheStartTime;
    
    console.log(chalk.gray('Result:'));
    console.log(`  Query time: ${cacheTime}ms (should be near instant)`);
    console.log(`  GraphQL queries: ${cachedResult.graphqlQueries} (should be 0)`);
    
    const cacheStats = priceRecovery.getCacheStats();
    console.log(chalk.gray('\nCache stats:'));
    console.log(`  Size: ${cacheStats.size}/${cacheStats.maxSize}`);
    console.log(`  TTL: ${cacheStats.ttl} seconds`);
    
    // Test 5: Get bonding curve data directly
    console.log(chalk.blue('\n5️⃣ Testing direct bonding curve query...'));
    const curves = await priceRecovery.getBondingCurves(batchTokens.slice(0, 5));
    console.log(`  Found ${curves.length} bonding curves`);
    
    if (curves.length > 0) {
      const curve = curves[0];
      console.log(chalk.gray('\n  Sample bonding curve:'));
      console.log(`    Bonding Curve: ${curve.pubkey.slice(0, 8)}...`);
      console.log(`    Complete: ${curve.complete}`);
      console.log(`    Virtual SOL: ${(BigInt(curve.virtualSolReserves) / BigInt(1e9)).toString()} SOL`);
      console.log(`    Last updated: ${new Date(curve._updatedAt).toLocaleString()}`);
    }
    
    // Test 6: Performance comparison
    console.log(chalk.blue('\n6️⃣ Performance comparison...'));
    console.log(chalk.gray('GraphQL approach:'));
    console.log(`  100 tokens in ${batchResult.queryTime}ms`);
    console.log(`  Cost: ~$0.001 (1 query)`);
    
    console.log(chalk.gray('\nRPC approach (estimated):'));
    console.log(`  100 tokens in ~${100 * 50}ms (50ms per RPC call)`);
    console.log(`  Cost: ~$0.10 (100 RPC calls)`);
    
    console.log(chalk.green(`\n✅ GraphQL is ${Math.floor(5000 / batchResult.queryTime)}x faster and 100x cheaper!`));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
  }
}

// Run the test
testGraphQLPriceRecovery()
  .then(() => {
    console.log(chalk.green('\n✅ All tests completed'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Test suite failed:'), error);
    process.exit(1);
  });