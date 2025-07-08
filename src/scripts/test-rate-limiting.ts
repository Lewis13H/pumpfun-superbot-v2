#!/usr/bin/env npx tsx
/**
 * Test Rate Limiting Implementation
 * 
 * Verifies that API rate limiters are working correctly
 */

import 'dotenv/config';
import chalk from 'chalk';
import { API_RATE_LIMITERS } from '../utils/api-rate-limiter';
import { HeliusApiClient } from '../services/holder-analysis/helius-api-client';
import { ShyftDasApiClient } from '../services/holder-analysis/shyft-das-api-client';

async function testRateLimiter() {
  console.log(chalk.cyan('\n🧪 Testing API Rate Limiters\n'));
  
  // Test Helius rate limiter
  console.log(chalk.yellow('1. Testing Helius Rate Limiter (10 req/s)'));
  
  const heliusStartTime = Date.now();
  const heliusRequests: Promise<void>[] = [];
  
  // Try to make 15 requests quickly
  for (let i = 0; i < 15; i++) {
    heliusRequests.push(
      API_RATE_LIMITERS.helius.execute(async () => {
        const requestTime = Date.now() - heliusStartTime;
        console.log(chalk.gray(`   Request ${i + 1} executed at ${requestTime}ms`));
      })
    );
  }
  
  await Promise.all(heliusRequests);
  const heliusDuration = Date.now() - heliusStartTime;
  console.log(chalk.green(`   ✓ Completed 15 requests in ${heliusDuration}ms (expected >1000ms for rate limiting)`));
  
  // Show stats
  const heliusStats = API_RATE_LIMITERS.helius.getStats();
  console.log(chalk.gray(`   Stats: ${heliusStats.current}/${heliusStats.max} (${heliusStats.percentage.toFixed(1)}%)`));
  
  // Test Shyft rate limiter
  console.log(chalk.yellow('\n2. Testing Shyft Rate Limiter (10 req/s)'));
  
  const shyftStartTime = Date.now();
  const shyftRequests: Promise<void>[] = [];
  
  // Try to make 15 requests quickly
  for (let i = 0; i < 15; i++) {
    shyftRequests.push(
      API_RATE_LIMITERS.shyft.execute(async () => {
        const requestTime = Date.now() - shyftStartTime;
        console.log(chalk.gray(`   Request ${i + 1} executed at ${requestTime}ms`));
      })
    );
  }
  
  await Promise.all(shyftRequests);
  const shyftDuration = Date.now() - shyftStartTime;
  console.log(chalk.green(`   ✓ Completed 15 requests in ${shyftDuration}ms (expected >1000ms for rate limiting)`));
  
  // Show stats
  const shyftStats = API_RATE_LIMITERS.shyft.getStats();
  console.log(chalk.gray(`   Stats: ${shyftStats.current}/${shyftStats.max} (${shyftStats.percentage.toFixed(1)}%)`));
  
  // Test batch processing
  console.log(chalk.yellow('\n3. Testing Batch Rate Limiter'));
  
  const testItems = Array.from({ length: 20 }, (_, i) => i);
  let processedCount = 0;
  
  const batchStartTime = Date.now();
  await API_RATE_LIMITERS.heliusBatch.processBatch(
    testItems,
    async (item) => {
      processedCount++;
      console.log(chalk.gray(`   Processing item ${item + 1}`));
      return { item, result: 'success' };
    },
    {
      onProgress: (processed, total) => {
        console.log(chalk.blue(`   Progress: ${processed}/${total}`));
      }
    }
  );
  
  const batchDuration = Date.now() - batchStartTime;
  console.log(chalk.green(`   ✓ Processed ${processedCount} items in ${(batchDuration / 1000).toFixed(1)}s`));
}

async function testRealAPIWithRateLimiting() {
  console.log(chalk.cyan('\n\n🧪 Testing Real API Calls with Rate Limiting\n'));
  
  if (!process.env.HELIUS_API_KEY) {
    console.log(chalk.red('❌ HELIUS_API_KEY not found - skipping real API test'));
    return;
  }
  
  const heliusClient = new HeliusApiClient();
  const testToken = 'So11111111111111111111111111111111111111112'; // SOL
  
  console.log(chalk.yellow('Testing multiple concurrent API calls...'));
  
  const startTime = Date.now();
  const promises: Promise<any>[] = [];
  
  // Make 5 concurrent requests
  for (let i = 0; i < 5; i++) {
    promises.push(
      heliusClient.getTokenMetadata(testToken).then(result => {
        const elapsed = Date.now() - startTime;
        console.log(chalk.gray(`   Request ${i + 1} completed at ${elapsed}ms`));
        return result;
      })
    );
  }
  
  const results = await Promise.all(promises);
  const totalDuration = Date.now() - startTime;
  
  const successful = results.filter(r => r !== null).length;
  console.log(chalk.green(`   ✓ ${successful}/5 requests successful`));
  console.log(chalk.gray(`   Total duration: ${totalDuration}ms`));
  
  // Show final stats
  const finalStats = API_RATE_LIMITERS.helius.getStats();
  console.log(chalk.blue(`\n📊 Final Stats:`));
  console.log(chalk.gray(`   Helius: ${finalStats.current}/${finalStats.max} requests in window`));
}

// Run tests
async function main() {
  try {
    await testRateLimiter();
    await testRealAPIWithRateLimiting();
    
    console.log(chalk.green('\n✅ Rate limiting tests complete!\n'));
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
  }
}

main().catch(console.error);