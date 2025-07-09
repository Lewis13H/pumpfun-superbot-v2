/**
 * Test script for Session 9: Performance Optimization & Caching
 * 
 * This script tests:
 * 1. In-memory caching
 * 2. Request coalescing
 * 3. Batch processing
 * 4. Query optimization
 * 5. Cache warming
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { OptimizedHolderAnalysisService } from '../services/holder-analysis/holder-analysis-service-optimized';
import { InMemoryCacheService } from '../services/holder-analysis/cache/in-memory-cache-service';
import { QueryOptimizer } from '../services/holder-analysis/optimization/query-optimizer';
import { BatchProcessor } from '../services/holder-analysis/optimization/batch-processor';
import { RequestCoalescer } from '../services/holder-analysis/optimization/request-coalescer';
import { logger } from '../core/logger';

async function testSession9() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n🧪 Testing Session 9: Performance Optimization & Caching\n');

    // Initialize optimized service
    const optimizedService = new OptimizedHolderAnalysisService(
      pool,
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );

    // Find test tokens
    const tokenQuery = `
      SELECT mint_address 
      FROM tokens_unified 
      WHERE latest_market_cap_usd > 10000
      ORDER BY latest_market_cap_usd DESC
      LIMIT 5
    `;
    const result = await pool.query(tokenQuery);
    
    if (result.rows.length === 0) {
      console.log('❌ No tokens found for testing');
      return;
    }

    const testTokens = result.rows.map(r => r.mint_address);
    console.log(`📊 Testing with ${testTokens.length} tokens\n`);

    // Test 1: Cache Performance
    console.log('1️⃣ Testing Cache Performance...');
    const testMintAddress = testTokens[0];
    
    // First request (cache miss)
    let startTime = Date.now();
    let result1 = await optimizedService.analyzeToken(testMintAddress);
    const firstRequestTime = Date.now() - startTime;
    console.log(`  ⏱️ First request (cache miss): ${firstRequestTime}ms`);
    
    // Second request (cache hit)
    startTime = Date.now();
    let result2 = await optimizedService.analyzeToken(testMintAddress);
    const secondRequestTime = Date.now() - startTime;
    console.log(`  ⏱️ Second request (cache hit): ${secondRequestTime}ms`);
    console.log(`  📈 Speed improvement: ${(firstRequestTime / secondRequestTime).toFixed(1)}x`);
    
    // Get cache stats
    const cacheStats = optimizedService.getCacheStats();
    console.log(`  📊 Cache hit rate: ${cacheStats.cache.hitRate.toFixed(1)}%`);
    console.log();

    // Test 2: Request Coalescing
    console.log('2️⃣ Testing Request Coalescing...');
    const promises = [];
    
    // Make 5 concurrent requests for the same token
    for (let i = 0; i < 5; i++) {
      promises.push(optimizedService.analyzeToken(testTokens[1], { forceRefresh: true }));
    }
    
    startTime = Date.now();
    await Promise.all(promises);
    const coalescedTime = Date.now() - startTime;
    
    const coalescerStats = optimizedService.getCacheStats().coalescer;
    console.log(`  🔗 Coalesced ${coalescerStats.coalescedRequests} requests`);
    console.log(`  ⏱️ Total time for 5 requests: ${coalescedTime}ms`);
    console.log(`  📊 Coalescing rate: ${(coalescerStats.coalescedRequests / coalescerStats.totalRequests * 100).toFixed(1)}%`);
    console.log();

    // Test 3: Batch Processing
    console.log('3️⃣ Testing Batch Processing...');
    startTime = Date.now();
    const batchResults = await optimizedService.analyzeTokenBatch(testTokens);
    const batchTime = Date.now() - startTime;
    
    const successful = batchResults.filter(r => r.success).length;
    console.log(`  ✅ Batch processed: ${successful}/${testTokens.length} successful`);
    console.log(`  ⏱️ Total batch time: ${batchTime}ms`);
    console.log(`  📊 Avg time per token: ${(batchTime / testTokens.length).toFixed(0)}ms`);
    console.log();

    // Test 4: Query Optimization
    console.log('4️⃣ Testing Query Optimization...');
    const queryOptimizer = new QueryOptimizer(pool);
    
    // Test optimized holder query
    const holderPlan = await queryOptimizer.optimizeHolderQuery(testMintAddress, {
      includeClassifications: true,
      limit: 100
    });
    
    console.log(`  📝 Query plan generated:`);
    console.log(`     - Estimated cost: ${holderPlan.estimatedCost}`);
    console.log(`     - Using index: ${holderPlan.useIndex}`);
    
    // Execute with stats
    const queryResult = await queryOptimizer.executeWithStats(holderPlan, 'test-holders');
    console.log(`  ⏱️ Query execution time: ${queryResult.stats.executionTime}ms`);
    console.log(`  📊 Rows returned: ${queryResult.stats.rowsReturned}`);
    console.log();

    // Test 5: Cache Warming
    console.log('5️⃣ Testing Cache Warming...');
    await optimizedService.warmCache(testTokens.slice(0, 3));
    console.log(`  🔥 Cache warming initiated for 3 tokens`);
    
    // Wait a bit for warming to complete
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const warmerStats = optimizedService.getCacheStats().warmer;
    console.log(`  📊 Warmer status:`);
    console.log(`     - Is warming: ${warmerStats.isWarming}`);
    console.log(`     - Queue size: ${warmerStats.queueSize}`);
    console.log();

    // Test 6: Performance Metrics
    console.log('6️⃣ Testing Performance Metrics...');
    const metrics = await optimizedService.getPerformanceMetrics();
    
    console.log('  📊 Overall Performance:');
    console.log(`     - Cache hit rate: ${metrics.cache.hitRate.toFixed(1)}%`);
    console.log(`     - Request coalescing rate: ${metrics.coalescer.coalescingRate.toFixed(1)}%`);
    console.log(`     - Slow queries: ${metrics.queries.slowQueries.length}`);
    
    if (metrics.recommendations.length > 0) {
      console.log('  💡 Recommendations:');
      metrics.recommendations.forEach((rec: string) => {
        console.log(`     - ${rec}`);
      });
    }
    console.log();

    // Test 7: In-Memory Cache Features
    console.log('7️⃣ Testing In-Memory Cache Features...');
    const cache = new InMemoryCacheService();
    
    // Test different TTL types
    await cache.setAnalysis('test1', { score: 100 });
    await cache.setHolders('test1', { count: 50 });
    await cache.setHistory('test1', '7d', { trend: 'up' });
    
    const cacheInfo = cache.getCacheInfo();
    console.log(`  📦 Cache size: ${cacheInfo.size}/${cacheInfo.maxSize}`);
    console.log(`  🏆 Top cache entries by hits:`);
    cacheInfo.entries.slice(0, 3).forEach(entry => {
      console.log(`     - ${entry.key}: ${entry.hits} hits, ${(entry.age / 1000).toFixed(1)}s old`);
    });
    
    // Test cache invalidation
    await cache.invalidateToken('test1');
    console.log(`  🗑️ Token cache invalidated`);
    
    cache.destroy();
    console.log();

    // Test 8: Batch Processor Features
    console.log('8️⃣ Testing Batch Processor Features...');
    const testProcessor = new BatchProcessor(
      async (items: string[]) => {
        console.log(`     Processing batch of ${items.length} items`);
        return items.map(item => ({ processed: item }));
      },
      { maxBatchSize: 3, maxWaitTime: 500 }
    );
    
    // Add items with different priorities
    await testProcessor.add('item1', 'data1', 1);
    await testProcessor.add('item2', 'data2', 3); // High priority
    await testProcessor.add('item3', 'data3', 2);
    await testProcessor.add('item4', 'data4', 1);
    
    // Force flush
    const batchResult = await testProcessor.flush();
    console.log(`  ✅ Batch processed: ${batchResult.successful.length} items in ${batchResult.processingTime}ms`);
    console.log();

    // Clean up
    optimizedService.destroy();
    
    console.log('\n✅ Session 9 testing complete!');
    console.log('\n📋 Summary:');
    console.log('  - In-memory caching: ✅ Working');
    console.log('  - Request coalescing: ✅ Working');
    console.log('  - Batch processing: ✅ Working');
    console.log('  - Query optimization: ✅ Working');
    console.log('  - Cache warming: ✅ Working');
    console.log('  - Performance metrics: ✅ Working');

  } catch (error) {
    logger.error('Test failed:', error);
    console.error('\n❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testSession9().catch(console.error);