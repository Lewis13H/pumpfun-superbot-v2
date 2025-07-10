/**
 * Test script to verify complete holder fetching is working
 */

import { config } from 'dotenv';
import { Pool } from 'pg';
import { HolderAnalysisService } from '../services/holder-analysis/holder-analysis-service';
import { createLogger } from '../core/logger';

config();

const logger = createLogger('TestCompleteHolderFetching');

async function testCompleteHolderFetching() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  try {
    logger.info('Starting complete holder fetching test...');

    // Initialize holder analysis service
    const analysisService = new HolderAnalysisService(
      pool,
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );

    // Test tokens that might have more than 20 holders
    const testTokens = [
      'So11111111111111111111111111111111111111112', // Wrapped SOL (should have many holders)
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (should have many holders)
      // Add any token from your database that shows 20 holders
    ];

    for (const mintAddress of testTokens) {
      logger.info(`\nTesting token: ${mintAddress}`);

      // Test without complete data (should be limited to 20)
      logger.info('Testing WITHOUT completeData flag...');
      const resultWithoutComplete = await analysisService.analyzeToken(mintAddress, {
        forceRefresh: true,
        maxHolders: 100,
        enableTrends: false,
        classifyWallets: false,
        saveSnapshot: false,
        completeData: false
      });

      if (resultWithoutComplete.success && resultWithoutComplete.analysis) {
        logger.info(`Without completeData: ${resultWithoutComplete.analysis.holderCounts.total} holders`);
      }

      // Test with complete data (should fetch all holders)
      logger.info('Testing WITH completeData flag...');
      const resultWithComplete = await analysisService.analyzeToken(mintAddress, {
        forceRefresh: true,
        maxHolders: 100,
        enableTrends: false,
        classifyWallets: false,
        saveSnapshot: false,
        completeData: true
      });

      if (resultWithComplete.success && resultWithComplete.analysis) {
        logger.info(`With completeData: ${resultWithComplete.analysis.holderCounts.total} holders`);
      }

      // Compare results
      if (resultWithoutComplete.success && resultWithComplete.success) {
        const withoutCount = resultWithoutComplete.analysis!.holderCounts.total;
        const withCount = resultWithComplete.analysis!.holderCounts.total;
        
        logger.info(`\nComparison for ${mintAddress}:`);
        logger.info(`- Without completeData: ${withoutCount} holders`);
        logger.info(`- With completeData: ${withCount} holders`);
        logger.info(`- Difference: ${withCount - withoutCount} additional holders found`);
      }
    }

    logger.info('\nTest completed successfully!');

  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testCompleteHolderFetching().catch(console.error);