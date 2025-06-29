#!/usr/bin/env tsx

/**
 * Test script for Stale Token Detection System
 */

import 'dotenv/config';
import { StaleTokenDetector } from '../services/stale-token-detector';
import { db } from '../database';
import chalk from 'chalk';

async function testStaleDetection() {
  console.log(chalk.cyan.bold('\n🧪 Testing Stale Token Detection System\n'));
  
  const detector = StaleTokenDetector.getInstance({
    staleThresholdMinutes: 30,
    scanIntervalMinutes: 1, // Fast scanning for testing
    batchSize: 50,
  });
  
  try {
    // Test 1: Check current stale tokens
    console.log(chalk.blue('1️⃣ Checking current stale tokens...'));
    const staleStats = await db.query('SELECT * FROM get_stale_token_stats(30)');
    const stats = staleStats.rows[0];
    
    console.log(chalk.gray('Current status:'));
    console.log(`  Total active tokens: ${stats.total_active_tokens}`);
    console.log(`  Stale tokens (>30 min): ${stats.stale_tokens}`);
    console.log(`  Critical stale (>60 min): ${stats.critical_stale_tokens}`);
    console.log(`  Average staleness: ${parseFloat(stats.avg_minutes_since_update).toFixed(1)} minutes`);
    
    // Test 2: Manually scan for stale tokens
    console.log(chalk.blue('\n2️⃣ Running manual stale token scan...'));
    await detector.scanForStaleTokens();
    
    const detectorStats = detector.getStats();
    console.log(chalk.gray('Scan results:'));
    console.log(`  Tokens scanned: ${detectorStats.totalTokensScanned}`);
    console.log(`  Stale tokens found: ${detectorStats.staleTokensFound}`);
    console.log(`  Queue depth: ${detectorStats.currentQueueDepth}`);
    
    // Test 3: Get sample stale tokens
    console.log(chalk.blue('\n3️⃣ Sample stale tokens...'));
    const staleTokens = await db.query(`
      SELECT 
        mint_address,
        symbol,
        latest_market_cap_usd,
        minutes_since_update
      FROM stale_tokens_view
      WHERE minutes_since_update > 30
      LIMIT 5
    `);
    
    if (staleTokens.rows.length > 0) {
      console.log(chalk.gray('Top 5 stale tokens:'));
      staleTokens.rows.forEach((token, i) => {
        const marketCap = parseFloat(token.latest_market_cap_usd);
        const staleness = parseFloat(token.minutes_since_update);
        console.log(chalk.gray(
          `  ${i + 1}. ${token.symbol || 'Unknown'} - $${marketCap.toLocaleString()} - ${staleness.toFixed(0)} min old`
        ));
      });
    } else {
      console.log(chalk.green('  No stale tokens found!'));
    }
    
    // Test 4: Test manual recovery
    if (staleTokens.rows.length > 0) {
      console.log(chalk.blue('\n4️⃣ Testing manual recovery...'));
      const testTokens = staleTokens.rows.slice(0, 3).map(r => r.mint_address);
      
      const startTime = Date.now();
      const results = await detector.recoverTokens(testTokens);
      const duration = Date.now() - startTime;
      
      console.log(chalk.gray(`Recovery completed in ${(duration / 1000).toFixed(1)}s`));
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(chalk.gray(`  Successful: ${successful}`));
      console.log(chalk.gray(`  Failed: ${failed}`));
      
      if (successful > 0) {
        // Check if prices were updated
        const updated = await db.query(`
          SELECT 
            mint_address,
            symbol,
            latest_price_usd,
            latest_market_cap_usd,
            updated_at
          FROM tokens_unified
          WHERE mint_address = ANY($1)
          AND updated_at > NOW() - INTERVAL '1 minute'
        `, [testTokens]);
        
        console.log(chalk.green(`\n✅ Successfully updated ${updated.rows.length} tokens:`));
        updated.rows.forEach(token => {
          const price = parseFloat(token.latest_price_usd);
          const marketCap = parseFloat(token.latest_market_cap_usd);
          console.log(chalk.gray(
            `  ${token.symbol || 'Unknown'}: $${price < 0.01 ? price.toExponential(2) : price.toFixed(6)} (MC: $${marketCap.toLocaleString()})`
          ));
        });
      }
    }
    
    // Test 5: Start the service briefly
    console.log(chalk.blue('\n5️⃣ Testing service startup...'));
    await detector.start();
    
    console.log(chalk.gray('Service started. Waiting 10 seconds...'));
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Get final stats
    const finalStats = detector.getStats();
    console.log(chalk.gray('\nFinal statistics:'));
    console.log(`  Total tokens recovered: ${finalStats.tokensRecovered}`);
    console.log(`  Recovery success rate: ${(finalStats.recoverySuccessRate * 100).toFixed(1)}%`);
    console.log(`  GraphQL queries used: ${finalStats.graphqlQueriesUsed}`);
    console.log(`  Current queue depth: ${finalStats.currentQueueDepth}`);
    
    // Stop the service
    detector.stop();
    
    // Test 6: Check recovery logs
    console.log(chalk.blue('\n6️⃣ Recent recovery logs...'));
    const logs = await db.query(`
      SELECT 
        recovery_type,
        tokens_checked,
        tokens_recovered,
        tokens_failed,
        graphql_queries,
        total_duration_ms,
        status,
        created_at
      FROM stale_token_recovery
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    if (logs.rows.length > 0) {
      console.log(chalk.gray(`Found ${logs.rows.length} recent recovery logs:`));
      logs.rows.forEach((log, i) => {
        const duration = log.total_duration_ms ? (log.total_duration_ms / 1000).toFixed(1) : 'N/A';
        const successRate = log.tokens_checked > 0 
          ? ((log.tokens_recovered / log.tokens_checked) * 100).toFixed(1)
          : '0';
        console.log(chalk.gray(
          `  ${i + 1}. ${log.recovery_type} - ${log.tokens_recovered}/${log.tokens_checked} recovered (${successRate}%) in ${duration}s`
        ));
      });
    }
    
    console.log(chalk.green('\n✅ All tests completed successfully!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
    detector.stop();
  } finally {
    await db.close();
  }
}

// Run tests
testStaleDetection()
  .then(() => {
    console.log(chalk.green('\n✨ Test suite completed!'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Fatal error:'), error);
    process.exit(1);
  });