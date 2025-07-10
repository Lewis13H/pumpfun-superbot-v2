/**
 * Test script to verify metadata enrichment is working
 */

import { config } from 'dotenv';
import chalk from 'chalk';
import { ShyftProvider } from '../services/metadata/providers/shyft-provider';
import { ShyftGraphQLClient } from '../services/metadata/providers/shyft-graphql-client';
import { TokenCreationTimeService } from '../services/token-management/token-creation-time-service';
import { EnhancedAutoEnricher } from '../services/metadata/enhanced-auto-enricher';
import { db } from '../database';

config();

async function testMetadataEnrichment() {
  console.log(chalk.cyan('🧪 Testing Metadata Enrichment Services...\n'));

  // Test tokens
  const testTokens = [
    'So11111111111111111111111111111111111111112', // Wrapped SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    // Add a pump.fun token if you have one
  ];

  // 1. Test Shyft Provider with GraphQL
  console.log(chalk.blue('1️⃣ Testing Shyft Provider (GraphQL + REST)...'));
  const shyftProvider = ShyftProvider.getInstance();
  
  for (const token of testTokens) {
    console.log(chalk.yellow(`\n🔍 Fetching metadata for ${token}...`));
    
    const metadata = await shyftProvider.getTokenMetadata(token);
    if (metadata) {
      console.log(chalk.green('✅ Basic metadata:'));
      console.log(`   Symbol: ${metadata.symbol || 'N/A'}`);
      console.log(`   Name: ${metadata.name || 'N/A'}`);
      console.log(`   Decimals: ${metadata.decimals}`);
    }
    
    const dasInfo = await shyftProvider.getTokenInfoDAS(token);
    if (dasInfo) {
      console.log(chalk.green('✅ Extended DAS info:'));
      console.log(`   Holders: ${dasInfo.current_holder_count || 'N/A'}`);
      console.log(`   Score: ${dasInfo.metadata_score || 0}/100`);
      if (dasInfo.twitter || dasInfo.telegram || dasInfo.discord) {
        console.log(`   Socials: ${[dasInfo.twitter && 'Twitter', dasInfo.telegram && 'Telegram', dasInfo.discord && 'Discord'].filter(Boolean).join(', ')}`);
      }
    }
  }

  // 2. Test GraphQL Client directly
  console.log(chalk.blue('\n\n2️⃣ Testing GraphQL Client directly...'));
  const graphqlClient = ShyftGraphQLClient.getInstance();
  
  // Test batch fetching
  console.log(chalk.yellow('\n🔍 Testing batch metadata fetch...'));
  const batchResults = await graphqlClient.getTokenMetadataBatch(testTokens);
  
  for (const [address, metadata] of batchResults) {
    if (metadata) {
      console.log(chalk.green(`✅ ${address.slice(0, 8)}...`));
      console.log(`   Symbol: ${metadata.symbol || 'N/A'}`);
      console.log(`   Holders: ${metadata.holder_count || 'N/A'}`);
    } else {
      console.log(chalk.red(`❌ ${address.slice(0, 8)}... - Not found`));
    }
  }
  
  // Show GraphQL stats
  const graphqlStats = graphqlClient.getStats();
  console.log(chalk.blue('\n📊 GraphQL Stats:'));
  console.log(`   Total requests: ${graphqlStats.totalRequests}`);
  console.log(`   Batched requests: ${graphqlStats.batchedRequests}`);
  console.log(`   Cache hits: ${graphqlStats.cacheHits}`);
  console.log(`   Cache hit rate: ${(graphqlStats.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`   Errors: ${graphqlStats.errors}`);

  // 3. Test Token Creation Time Service
  console.log(chalk.blue('\n\n3️⃣ Testing Token Creation Time Service...'));
  const creationTimeService = TokenCreationTimeService.getInstance();
  
  for (const token of testTokens.slice(0, 2)) {
    console.log(chalk.yellow(`\n🔍 Fetching creation time for ${token}...`));
    
    const creationInfo = await creationTimeService.getTokenCreationTime(token);
    if (creationInfo) {
      console.log(chalk.green('✅ Creation info:'));
      console.log(`   Created at: ${creationInfo.creationTime.toISOString()}`);
      console.log(`   Creator: ${creationInfo.creator || 'N/A'}`);
      console.log(`   Source: ${creationInfo.source}`);
    } else {
      console.log(chalk.red('❌ Could not fetch creation time'));
    }
  }

  // 4. Test Auto Enricher
  console.log(chalk.blue('\n\n4️⃣ Testing Auto Enricher...'));
  const enricher = EnhancedAutoEnricher.getInstance();
  
  // Get high-value tokens from database
  const result = await db.query(`
    SELECT mint_address, symbol, latest_market_cap_usd
    FROM tokens_unified
    WHERE latest_market_cap_usd >= 8888
    AND (symbol IS NULL OR name IS NULL OR image IS NULL)
    ORDER BY latest_market_cap_usd DESC
    LIMIT 5
  `);
  
  if (result.rows.length > 0) {
    console.log(chalk.yellow(`\n🔍 Found ${result.rows.length} high-value tokens needing enrichment:`));
    
    for (const row of result.rows) {
      console.log(`   ${row.mint_address.slice(0, 8)}... - $${row.latest_market_cap_usd.toFixed(0)}`);
    }
    
    // Start enricher (it will automatically process these tokens)
    console.log(chalk.yellow('\n🚀 Starting auto-enricher...'));
    await enricher.start();
    
    // Let it run for 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Stop and show stats
    enricher.stop();
    
    const enricherStats = enricher['stats'];
    console.log(chalk.blue('\n📊 Enricher Stats:'));
    console.log(`   Total enriched: ${enricherStats.totalEnriched}`);
    console.log(`   Shyft success: ${enricherStats.shyftSuccess}`);
    console.log(`   Helius success: ${enricherStats.heliusSuccess}`);
    console.log(`   Failures: ${enricherStats.failures}`);
  } else {
    console.log(chalk.yellow('No tokens found needing enrichment'));
  }

  // 5. Show Shyft Provider stats
  const shyftStats = shyftProvider.getStats();
  console.log(chalk.blue('\n\n📊 Shyft Provider Overall Stats:'));
  console.log(`   Total requests: ${shyftStats.totalRequests}`);
  console.log(`   Cache hits: ${shyftStats.cacheHits}`);
  console.log(`   Rate limit hits: ${shyftStats.rateLimitHits}`);
  console.log(`   Errors: ${shyftStats.errors}`);
  console.log(`   Holder counts extracted: ${shyftStats.holderCountsExtracted}`);
  console.log(`   Social links extracted: ${shyftStats.socialLinksExtracted}`);

  console.log(chalk.green('\n\n✅ Test completed!'));
  process.exit(0);
}

// Run test
testMetadataEnrichment().catch(error => {
  console.error(chalk.red('Test failed:'), error);
  process.exit(1);
});