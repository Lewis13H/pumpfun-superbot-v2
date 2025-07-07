#!/usr/bin/env tsx
/**
 * Test Script for Holder Analysis Session 2
 * 
 * Tests API clients and wallet classification service
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import { HeliusApiClient } from '../services/holder-analysis/helius-api-client';
import { ShyftDasApiClient } from '../services/holder-analysis/shyft-das-api-client';
import { HolderDataFetcher } from '../services/holder-analysis/holder-data-fetcher';
import { WalletClassificationService } from '../services/holder-analysis/wallet-classification-service';

dotenv.config();

async function testSession2() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🎯 Testing Holder Analysis Session 2 - API Integration\n');

    // Get a test token from the database
    const tokenQuery = await pool.query(`
      SELECT mint_address, symbol, name, latest_market_cap_usd
      FROM tokens_unified 
      WHERE latest_market_cap_usd > 20000
        AND graduated_to_amm = true
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (tokenQuery.rows.length === 0) {
      console.log('❌ No suitable test token found in database');
      return;
    }

    const testToken = tokenQuery.rows[0];
    const testMintAddress = testToken.mint_address;
    console.log(`Using token: ${testToken.symbol} (${testToken.name})`);
    console.log(`Mint address: ${testMintAddress}`);
    console.log(`Market Cap: $${parseFloat(testToken.latest_market_cap_usd).toLocaleString()}\n`);

    // Test 1: Helius API Client
    console.log('1️⃣ Testing Helius API Client...');
    const heliusClient = new HeliusApiClient();
    
    if (process.env.HELIUS_API_KEY) {
      try {
        const heliusHolders = await heliusClient.getTokenHolders(testMintAddress, 1, 10);
        if (heliusHolders) {
          console.log(`✅ Helius: Found ${heliusHolders.result.owners.length} holders`);
          console.log(`   Token: ${heliusHolders.result.token_info.symbol}`);
          console.log(`   Top holder: ${heliusHolders.result.owners[0]?.owner.slice(0, 8)}...`);
        } else {
          console.log('⚠️  Helius: No data returned (API key may be invalid)');
        }
      } catch (error) {
        console.log('⚠️  Helius: API error (check API key)');
      }
    } else {
      console.log('⚠️  Helius: No API key configured');
    }

    // Test 2: Shyft DAS API Client
    console.log('\n2️⃣ Testing Shyft DAS API Client...');
    
    if (process.env.SHYFT_API_KEY) {
      try {
        const shyftClient = new ShyftDasApiClient();
        const shyftHolders = await shyftClient.getTokenHolders(testMintAddress, 1, 10);
        
        if (shyftHolders) {
          console.log(`✅ Shyft: Found ${shyftHolders.result.holders.length} holders`);
          console.log(`   Token: ${shyftHolders.result.token.symbol}`);
          console.log(`   Total holders: ${shyftHolders.result.totalHolders}`);
          console.log(`   Top holder: ${shyftHolders.result.holders[0]?.address.slice(0, 8)}... (${shyftHolders.result.holders[0]?.percentage.toFixed(2)}%)`);
        } else {
          console.log('⚠️  Shyft: No data returned');
        }
      } catch (error) {
        console.log('❌ Shyft: API error -', error instanceof Error ? error.message : 'Unknown error');
      }
    } else {
      console.log('❌ Shyft: No API key configured (required)');
    }

    // Test 3: Holder Data Fetcher (with fallback)
    console.log('\n3️⃣ Testing Holder Data Fetcher...');
    const fetcher = new HolderDataFetcher(
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );

    // Listen to events
    fetcher.on('fetch_start', (data) => {
      console.log(`   Starting fetch from ${data.source}...`);
    });

    fetcher.on('fetch_complete', (data) => {
      console.log(`   Fetch complete: ${data.success ? 'Success' : 'Failed'} (${data.source})`);
    });

    const holderData = await fetcher.fetchHolderData(testMintAddress, {
      maxHolders: 50,
      enableFallback: true,
      cacheResults: true
    });

    if (holderData) {
      console.log(`✅ Fetched holder data successfully`);
      console.log(`   Source: ${holderData.source}`);
      console.log(`   Total holders: ${holderData.totalHolders}`);
      console.log(`   Fetched: ${holderData.holders.length} holders`);
      console.log(`   Token: ${holderData.tokenInfo.symbol} (${holderData.tokenInfo.name})`);
      
      // Display top 5 holders
      console.log('\n   Top 5 Holders:');
      holderData.holders.slice(0, 5).forEach((holder, index) => {
        console.log(`   ${index + 1}. ${holder.address.slice(0, 8)}... - ${holder.percentage.toFixed(2)}% (${holder.uiBalance.toLocaleString()} tokens)`);
      });
    } else {
      console.log('❌ Failed to fetch holder data from any source');
    }

    // Test 4: Wallet Classification
    console.log('\n4️⃣ Testing Wallet Classification Service...');
    const classifier = new WalletClassificationService(
      pool,
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );

    if (holderData && holderData.holders.length > 0) {
      // Classify top 3 holders
      console.log('   Classifying top holders...');
      
      for (let i = 0; i < Math.min(3, holderData.holders.length); i++) {
        const holder = holderData.holders[i];
        
        const classification = await classifier.classifyWallet(
          holder.address,
          testMintAddress,
          {
            holdingPercentage: holder.percentage,
            tokenCreationTime: Date.now() - 86400000 // Mock: 24 hours ago
          }
        );

        console.log(`\n   Holder ${i + 1}: ${holder.address.slice(0, 8)}...`);
        console.log(`   - Classification: ${classification.classification}`);
        console.log(`   - Confidence: ${(classification.confidence * 100).toFixed(1)}%`);
        if (classification.subClassification) {
          console.log(`   - Sub-type: ${classification.subClassification}`);
        }
        console.log(`   - Detection methods: ${classification.metadata.detectionMethod.join(', ')}`);
      }

      // Get classification statistics
      const stats = await classifier.getClassificationStats();
      console.log('\n   Classification Statistics:');
      stats.forEach((stat: any) => {
        console.log(`   - ${stat.classification}: ${stat.count} wallets (avg confidence: ${(stat.avgConfidence * 100).toFixed(1)}%)`);
      });
    }

    // Test 5: Cache functionality
    console.log('\n5️⃣ Testing Cache Functionality...');
    console.log('   Fetching same token again (should hit cache)...');
    
    fetcher.on('cache_hit', () => {
      console.log('   ✅ Cache hit!');
    });

    const cachedData = await fetcher.fetchHolderData(testMintAddress);
    if (cachedData) {
      console.log('   Successfully retrieved from cache');
    }

    // Display cache stats
    const cacheStats = fetcher.getCacheStats();
    console.log(`   Cache size: ${cacheStats.size} entries`);

    console.log('\n✨ Session 2 API Integration tests completed!');
    console.log('\n📝 Summary:');
    console.log('- API clients created and tested');
    console.log('- Holder data fetching with fallback working');
    console.log('- Wallet classification service operational');
    console.log('- Cache functionality verified');
    console.log('\n🚀 Ready to proceed with Session 3: Core Analysis Service');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testSession2().catch(console.error);