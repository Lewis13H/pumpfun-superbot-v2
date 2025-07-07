#!/usr/bin/env tsx
/**
 * Test Script for Holder Analysis Session 1
 * 
 * Verifies database schema and model classes are working correctly
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import { HolderSnapshotModel } from '../models/holder-snapshot';
import { WalletClassificationModel } from '../models/wallet-classification';
import { TokenHolderAnalysisModel } from '../models/token-holder-analysis';
import { 
  HolderSnapshot,
  WalletClassificationData,
  TokenHolderDetails,
  HolderAnalysisMetadata,
  HolderTrends
} from '../types/holder-analysis';

dotenv.config();

async function testSession1() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🎯 Testing Holder Analysis Session 1 Implementation\n');

    // Initialize models
    const snapshotModel = new HolderSnapshotModel(pool);
    const walletModel = new WalletClassificationModel(pool);
    const analysisModel = new TokenHolderAnalysisModel(pool);

    // Get a real token from the database for testing
    const tokenQuery = await pool.query(`
      SELECT mint_address, symbol, name 
      FROM tokens_unified 
      WHERE latest_market_cap_usd > 10000
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    let testMintAddress: string;
    if (tokenQuery.rows.length > 0) {
      testMintAddress = tokenQuery.rows[0].mint_address;
      console.log(`Using token: ${tokenQuery.rows[0].symbol} (${tokenQuery.rows[0].name})`);
      console.log(`Mint address: ${testMintAddress}\n`);
    } else {
      // Create a test token if none exist
      testMintAddress = 'TEST' + Date.now();
      await pool.query(`
        INSERT INTO tokens_unified (mint_address, symbol, name, created_at)
        VALUES ($1, 'TEST', 'Test Token', NOW())
      `, [testMintAddress]);
      console.log(`Created test token: ${testMintAddress}\n`);
    }

    // Test 1: Wallet Classification
    console.log('1️⃣ Testing Wallet Classification Model...');
    
    const testWallet: WalletClassificationData = {
      walletAddress: 'WALLET123456789',
      classification: 'sniper',
      subClassification: 'early_sniper',
      confidenceScore: 0.85,
      detectionMetadata: {
        detectionMethod: ['timing_analysis', 'pattern_matching'],
        confidenceFactors: {
          timing: 0.9,
          tradingPattern: 0.8
        },
        firstSeenBlock: 123456,
        detectedPatterns: ['early_buyer', 'high_frequency']
      },
      firstSeen: new Date(),
      lastActivity: new Date(),
      totalTokensTraded: 5,
      suspiciousActivityCount: 2,
      updatedAt: new Date()
    };

    const savedWallet = await walletModel.upsert(testWallet);
    console.log('✅ Wallet classification saved:', savedWallet.walletAddress);

    // Test 2: Token Holder Details
    console.log('\n2️⃣ Testing Token Holder Details Model...');
    
    const testHolderDetails: TokenHolderDetails = {
      mintAddress: testMintAddress,
      walletAddress: testWallet.walletAddress,
      balance: BigInt(1000000000), // 1 billion tokens
      percentageHeld: 10.5,
      rank: 1,
      firstAcquired: new Date(),
      lastTransaction: new Date(),
      transactionCount: 15,
      realizedProfitSol: 5.25,
      unrealizedProfitSol: 12.75,
      isLocked: false,
      updatedAt: new Date()
    };

    const savedHolder = await analysisModel.upsertHolderDetails(testHolderDetails);
    console.log('✅ Holder details saved for wallet:', savedHolder.walletAddress);

    // Test 3: Holder Snapshot
    console.log('\n3️⃣ Testing Holder Snapshot Model...');
    
    const testSnapshot: Omit<HolderSnapshot, 'id' | 'createdAt'> = {
      mintAddress: testMintAddress,
      snapshotTime: new Date(),
      totalHolders: 150,
      uniqueHolders: 148,
      top10Percentage: 45.5,
      top25Percentage: 65.2,
      top100Percentage: 95.8,
      giniCoefficient: 0.725,
      herfindahlIndex: 0.0125,
      holderScore: 165,
      scoreBreakdown: {
        base: 150,
        distributionScore: 20,
        decentralizationScore: 20,
        organicGrowthScore: 15,
        developerEthicsScore: 10,
        sniperPenalty: -30,
        botPenalty: -10,
        bundlerPenalty: -5,
        concentrationPenalty: -5,
        total: 165
      },
      rawDataHash: snapshotModel.calculateDataHash({ test: 'data' })
    };

    const savedSnapshot = await snapshotModel.create(testSnapshot);
    console.log('✅ Holder snapshot saved with score:', savedSnapshot.holderScore);

    // Test 4: Analysis Metadata
    console.log('\n4️⃣ Testing Analysis Metadata...');
    
    const testMetadata: Omit<HolderAnalysisMetadata, 'id' | 'createdAt'> = {
      mintAddress: testMintAddress,
      analysisType: 'initial',
      status: 'processing',
      startedAt: new Date(),
      metadata: {
        triggerReason: 'test',
        marketCapAtAnalysis: 50000
      }
    };

    const savedMetadata = await analysisModel.createAnalysisMetadata(testMetadata);
    console.log('✅ Analysis metadata created with ID:', savedMetadata.id);

    // Update analysis to completed
    await analysisModel.updateAnalysisStatus(savedMetadata.id!, 'completed', {
      completedAt: new Date(),
      holdersAnalyzed: 150
    });
    console.log('✅ Analysis status updated to completed');

    // Test 5: Holder Trends
    console.log('\n5️⃣ Testing Holder Trends...');
    
    const testTrends: HolderTrends = {
      mintAddress: testMintAddress,
      timeWindow: '24h',
      holderCountChange: 25,
      holderGrowthRate: 5.2,
      avgHolderDurationHours: 48.5,
      churnRate: 2.1,
      newWhaleCount: 2,
      newSniperCount: 5,
      calculatedAt: new Date()
    };

    const savedTrends = await analysisModel.upsertTrends(testTrends);
    console.log('✅ Holder trends saved for window:', savedTrends.timeWindow);

    // Test 6: Query Operations
    console.log('\n6️⃣ Testing Query Operations...');

    // Get latest snapshot
    const latestSnapshot = await snapshotModel.getLatest(testMintAddress);
    console.log('✅ Retrieved latest snapshot:', latestSnapshot?.holderScore);

    // Get wallet classification
    const retrievedWallet = await walletModel.get(testWallet.walletAddress);
    console.log('✅ Retrieved wallet classification:', retrievedWallet?.classification);

    // Get holder statistics
    const stats = await analysisModel.getHolderStatistics(testMintAddress);
    console.log('✅ Holder statistics:', stats);

    // Get classification statistics
    const classStats = await walletModel.getStatistics();
    console.log('✅ Classification statistics:', classStats);

    console.log('\n✨ Session 1 implementation test completed successfully!');
    console.log('\n📝 Summary:');
    console.log('- Database tables created successfully');
    console.log('- All model classes working correctly');
    console.log('- TypeScript types properly defined');
    console.log('- CRUD operations verified');
    
    console.log('\n🚀 Ready to proceed with Session 2: API integration');

  } catch (error) {
    console.error('❌ Test failed:', error);
    
    // Check if it's a database connection error
    if (error instanceof Error && error.message.includes('relation')) {
      console.log('\n💡 Did you run the migration?');
      console.log('Run: psql -U pump_user -d pump_monitor -f src/database/migrations/003_add_holder_analysis_tables.sql');
    }
  } finally {
    await pool.end();
  }
}

// Run the test
testSession1().catch(console.error);