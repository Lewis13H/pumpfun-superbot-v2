/**
 * Test Enhanced Holder Analysis
 * 
 * Demonstrates the improved holder analysis capabilities with
 * transaction history, P&L calculation, and pattern detection
 */

import { EnhancedHolderAnalyzer } from '../services/holder-analysis/enhanced-holder-analyzer';
import { AdvancedPatternDetector } from '../services/holder-analysis/advanced-pattern-detector';
import { Pool } from 'pg';
import { logger } from '../core/logger';
import * as dotenv from 'dotenv';

dotenv.config();

// Example token for testing
const TEST_TOKEN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC as example
const TEST_WALLET = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjQpKYTKjfUQ6XRG9k'; // Example wallet

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    logger.info('Testing Enhanced Holder Analysis...\n');
    
    // Initialize analyzers
    const holderAnalyzer = new EnhancedHolderAnalyzer(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      process.env.HELIUS_API_KEY
    );
    
    const patternDetector = new AdvancedPatternDetector(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    );
    
    // Test 1: Analyze individual holder with transaction history
    logger.info('=== Test 1: Individual Holder Analysis ===');
    
    const tokenContext = {
      mintAddress: TEST_TOKEN,
      creationTime: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
      currentPrice: 1.0,
      ath: 1.2,
      atl: 0.8,
      decimals: 6
    };
    
    const holderMetrics = await holderAnalyzer.analyzeHolder(TEST_WALLET, tokenContext);
    
    logger.info('Holder Metrics:', {
      address: holderMetrics.address,
      currentBalance: holderMetrics.currentBalance,
      balanceUsd: holderMetrics.balanceUsd.toFixed(2),
      transactionCount: holderMetrics.transactionCount,
      avgBuyPrice: holderMetrics.avgBuyPrice.toFixed(4),
      avgSellPrice: holderMetrics.avgSellPrice.toFixed(4),
      realizedPnL: holderMetrics.realizedPnL.toFixed(2),
      unrealizedPnL: holderMetrics.unrealizedPnL.toFixed(2),
      profitMultiple: holderMetrics.profitMultiple.toFixed(2),
      holdingDays: holderMetrics.holdingDays.toFixed(1),
      entryTiming: holderMetrics.entryTiming,
      tradingPattern: holderMetrics.tradingPattern,
      riskProfile: holderMetrics.riskProfile
    });
    
    const holderQuality = holderAnalyzer.calculateHolderQuality(holderMetrics);
    logger.info(`Holder Quality Score: ${holderQuality}/100`);
    
    // Test 2: Pattern detection
    logger.info('\n=== Test 2: Advanced Pattern Detection ===');
    
    // Mock transaction data for pattern detection
    const mockTransactions = [
      {
        wallet: TEST_WALLET,
        timestamp: Date.now() / 1000 - 3600,
        signature: 'sig1',
        type: 'buy' as const,
        amount: 1000,
        price: 0.95,
        gasPrice: 0.002,
        bundle: 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
        program: 'pump.fun'
      },
      {
        wallet: TEST_WALLET,
        timestamp: Date.now() / 1000 - 3500,
        signature: 'sig2',
        type: 'sell' as const,
        amount: 500,
        price: 0.98,
        gasPrice: 0.001,
        program: 'pump.fun'
      },
      {
        wallet: TEST_WALLET,
        timestamp: Date.now() / 1000 - 3400,
        signature: 'sig3',
        type: 'buy' as const,
        amount: 1000,
        price: 0.97,
        gasPrice: 0.003,
        bundle: 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
        program: 'pump.fun'
      }
    ];
    
    const patterns = await patternDetector.detectPatterns(
      TEST_WALLET,
      mockTransactions,
      ['wallet1', 'wallet2'] // Related wallets for coordination detection
    );
    
    logger.info('Pattern Detection Results:', {
      wallet: patterns.walletAddress,
      riskScore: patterns.riskScore,
      confidence: patterns.confidence.toFixed(2),
      mevBot: patterns.patterns.mevBot?.detected || false,
      washTrading: patterns.patterns.washTrading?.detected || false,
      coordinatedTrading: patterns.patterns.coordinatedTrading?.detected || false,
      copyTrading: patterns.patterns.copyTrading?.detected || false,
      sandwichAttack: patterns.patterns.sandwichAttack?.detected || false
    });
    
    if (patterns.patterns.mevBot?.detected) {
      logger.info('MEV Bot Details:', {
        bundleCount: patterns.patterns.mevBot.bundleCount,
        jitoUsage: patterns.patterns.mevBot.jitoUsage,
        frontrunCount: patterns.patterns.mevBot.frontrunCount,
        avgGasMultiple: patterns.patterns.mevBot.avgGasMultiple.toFixed(2)
      });
    }
    
    logger.info('Recommendations:');
    patterns.recommendations.forEach(rec => {
      logger.info(`  - ${rec}`);
    });
    
    // Test 3: Batch analysis simulation
    logger.info('\n=== Test 3: Batch Analysis Performance ===');
    
    const testHolders = [
      TEST_WALLET,
      // Add more test wallets here
    ];
    
    const startTime = Date.now();
    
    const batchResults = await holderAnalyzer.analyzeHolders(
      testHolders,
      tokenContext,
      {
        maxConcurrent: 3,
        onProgress: (progress) => {
          logger.debug(`Progress: ${progress.toFixed(0)}%`);
        }
      }
    );
    
    const duration = Date.now() - startTime;
    logger.info(`Analyzed ${batchResults.size} holders in ${duration}ms`);
    logger.info(`Average time per holder: ${(duration / batchResults.size).toFixed(0)}ms`);
    
    // Test 4: Quality distribution
    logger.info('\n=== Test 4: Holder Quality Distribution ===');
    
    const qualityScores = Array.from(batchResults.values()).map(metrics => 
      holderAnalyzer.calculateHolderQuality(metrics)
    );
    
    const distribution = {
      excellent: qualityScores.filter(s => s >= 80).length,
      good: qualityScores.filter(s => s >= 60 && s < 80).length,
      fair: qualityScores.filter(s => s >= 40 && s < 60).length,
      poor: qualityScores.filter(s => s < 40).length
    };
    
    logger.info('Quality Distribution:', distribution);
    
    // Test 5: Demonstrate improved holder score calculation
    logger.info('\n=== Test 5: Enhanced Holder Score Impact ===');
    
    // Calculate what the enhanced data would add to holder score
    const enhancedScoreFactors = {
      // Positive factors from enhanced analysis
      longTermHolders: Array.from(batchResults.values()).filter(m => m.holdingDays > 30).length,
      profitableHolders: Array.from(batchResults.values()).filter(m => m.totalPnL > 0).length,
      diamondHands: Array.from(batchResults.values()).filter(m => m.neverSold && m.holdingDays > 7).length,
      
      // Negative factors
      panicSellers: Array.from(batchResults.values()).filter(m => m.panicSold).length,
      suspiciousBots: testHolders.filter((_, i) => patterns.riskScore > 50).length,
      mevBots: testHolders.filter((_, i) => patterns.patterns.mevBot?.detected).length
    };
    
    logger.info('Enhanced Score Factors:', enhancedScoreFactors);
    
    // Show how this would improve holder score accuracy
    const baseScore = 150;
    const enhancedAdjustments = {
      qualityBonus: (enhancedScoreFactors.longTermHolders / testHolders.length) * 30,
      profitabilityBonus: (enhancedScoreFactors.profitableHolders / testHolders.length) * 20,
      diamondHandsBonus: (enhancedScoreFactors.diamondHands / testHolders.length) * 25,
      panicPenalty: -(enhancedScoreFactors.panicSellers / testHolders.length) * 20,
      botPenalty: -(enhancedScoreFactors.mevBots / testHolders.length) * 30
    };
    
    const enhancedScore = baseScore + 
      Object.values(enhancedAdjustments).reduce((sum, adj) => sum + adj, 0);
    
    logger.info('Score Calculation:', {
      baseScore,
      adjustments: enhancedAdjustments,
      enhancedScore: Math.round(enhancedScore),
      improvement: `${((enhancedScore / baseScore - 1) * 100).toFixed(1)}%`
    });
    
    logger.info('\n=== Summary ===');
    logger.info('The enhanced holder analysis provides:');
    logger.info('1. Complete transaction history for each holder');
    logger.info('2. Accurate P&L calculations and profitability metrics');
    logger.info('3. Advanced pattern detection for bots, MEV, and manipulation');
    logger.info('4. Behavioral classification based on actual trading patterns');
    logger.info('5. More accurate holder scores reflecting true holder quality');
    
  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
main().catch(console.error);