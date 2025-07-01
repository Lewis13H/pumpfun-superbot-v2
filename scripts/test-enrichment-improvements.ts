/**
 * Test the improved metadata enrichment system
 * Shows rate limiting, caching, and efficient batch processing
 */

import { config } from 'dotenv';
import chalk from 'chalk';
import { ShyftMetadataService } from '../src/services/shyft-metadata-service';
import { EnhancedAutoEnricher } from '../src/services/enhanced-auto-enricher';
import { graphqlMetadataEnricher } from '../src/services/graphql-metadata-enricher';
import { db } from '../src/database';

config();

async function testEnrichmentImprovements() {
  console.log(chalk.cyan.bold('\n🧪 Testing Improved Metadata Enrichment System\n'));
  
  // Test 1: Show GraphQL is properly disabled
  console.log(chalk.yellow('1️⃣ Testing GraphQL metadata enricher (should be disabled)...'));
  const testMints = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'So11111111111111111111111111111111111111112', // SOL
  ];
  
  const graphqlResults = await graphqlMetadataEnricher.batchFetchMetadata(testMints);
  console.log(`   GraphQL results: ${graphqlResults.size} tokens (should be 0)`);
  
  // Test 2: Test Shyft rate limiting and caching
  console.log(chalk.yellow('\n2️⃣ Testing Shyft API with rate limiting...'));
  const shyftService = ShyftMetadataService.getInstance();
  
  // First fetch - should hit API
  console.time('First fetch');
  const firstResult = await shyftService.getTokenMetadata(testMints[0]);
  console.timeEnd('First fetch');
  console.log(`   First result: ${firstResult?.symbol || 'Not found'}`);
  
  // Second fetch - should use cache
  console.time('Cached fetch');
  const cachedResult = await shyftService.getTokenMetadata(testMints[0]);
  console.timeEnd('Cached fetch');
  console.log(`   Cached result: ${cachedResult?.symbol || 'Not found'} (should be instant)`);
  
  // Test 3: Test bulk fetching with mixed cache/API
  console.log(chalk.yellow('\n3️⃣ Testing bulk fetch with caching...'));
  const bulkTestMints = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (cached)
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
    '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETH
  ];
  
  const bulkResults = await shyftService.getBulkMetadata(bulkTestMints);
  console.log(`   Fetched ${bulkResults.size}/${bulkTestMints.length} tokens`);
  
  // Show cache stats
  const cacheStats = shyftService.getCacheStats();
  console.log(`   Cache size: ${cacheStats.size}, Request count: ${cacheStats.requestCount}`);
  
  // Test 4: Test auto enricher with queue processing
  console.log(chalk.yellow('\n4️⃣ Testing enhanced auto enricher...'));
  const enricher = EnhancedAutoEnricher.getInstance();
  
  // Get some tokens that need enrichment
  const needsEnrichment = await db.query(`
    SELECT mint_address 
    FROM tokens_unified 
    WHERE (symbol IS NULL OR name IS NULL OR symbol = 'Unknown' OR name = 'Unknown')
      AND first_market_cap_usd >= 8888
    LIMIT 5
  `);
  
  console.log(`   Found ${needsEnrichment.rows.length} tokens needing enrichment`);
  
  if (needsEnrichment.rows.length > 0) {
    const mints = needsEnrichment.rows.map(r => r.mint_address);
    await enricher.addTokens(mints);
    
    // Get stats
    const stats = enricher.getStats();
    console.log(`   Enrichment stats:`, stats);
  }
  
  // Test 5: Test rate limit enforcement
  console.log(chalk.yellow('\n5️⃣ Testing rate limit enforcement...'));
  console.log('   Making rapid requests to test rate limiting...');
  
  const rapidMints = Array(5).fill(0).map((_, i) => `test${i}11111111111111111111111111111111111111`);
  console.time('Rate limited requests');
  
  for (const mint of rapidMints) {
    await shyftService.getTokenMetadata(mint);
    process.stdout.write('.');
  }
  
  console.timeEnd('Rate limited requests');
  console.log(`\n   Should show delays between requests`);
  
  console.log(chalk.green.bold('\n✅ Enrichment improvements test complete!\n'));
  
  // Summary
  console.log(chalk.cyan('📊 Summary of improvements:'));
  console.log('  1. GraphQL disabled to prevent "spl_Token not found" errors');
  console.log('  2. Shyft API with proper rate limiting (200ms between requests)');
  console.log('  3. Efficient caching reduces API calls');
  console.log('  4. Sequential processing prevents rate limit errors');
  console.log('  5. Fallback to Helius only when configured');
  
  process.exit(0);
}

// Run the test
testEnrichmentImprovements().catch(error => {
  console.error(chalk.red('Test failed:'), error);
  process.exit(1);
});