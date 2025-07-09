#!/usr/bin/env tsx

/**
 * Test holder analysis rate limiting fixes
 */

import { HeliusApiClient } from '../services/holder-analysis/helius-api-client';
import { WalletClassificationService } from '../services/holder-analysis/wallet-classification-service';
import { Logger } from '../core/logger';
import { API_RATE_LIMITERS } from '../utils/api-rate-limiter';

const logger = new Logger({ context: 'TestRateLimiting' });

async function testRateLimiting() {
  try {
    logger.info('Testing holder analysis rate limiting fixes...');
    
    // Show current rate limiter stats
    const stats = API_RATE_LIMITERS.helius.getStats();
    logger.info('Helius rate limiter stats:', stats);
    
    // Test wallet address
    const testWallet = '3tEaZVtwjNduEYnA4yywnuvQMYYQ6k2MjcZd8aV4qtJP';
    
    // Test 1: Single wallet analysis
    logger.info('Test 1: Analyzing single wallet...');
    const heliusClient = new HeliusApiClient();
    
    const walletInfo = await heliusClient.getWalletInfo(testWallet);
    logger.info('Wallet info result:', walletInfo ? 'Success' : 'Failed');
    
    const patterns = await heliusClient.analyzeWalletPatterns(testWallet);
    logger.info('Wallet patterns result:', patterns ? 'Success' : 'Failed');
    
    // Test 2: Batch wallet classification
    logger.info('\nTest 2: Testing batch wallet classification...');
    const classificationService = new WalletClassificationService();
    
    const testWallets = [
      { address: testWallet, holdingPercentage: 5.0 },
      { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', holdingPercentage: 3.0 },
      { address: 'CookbookDerivedAccount11111111111111111111', holdingPercentage: 2.0 },
      { address: '11111111111111111111111111111111', holdingPercentage: 1.0 }
    ];
    
    const results = await classificationService.classifyBatch(
      testWallets,
      'TestTokenMint11111111111111111111111111111',
      new Date()
    );
    
    logger.info(`Classified ${results.size} wallets:`);
    results.forEach((result, address) => {
      logger.info(`  ${address}: ${result.classification} (confidence: ${result.confidence})`);
    });
    
    // Show final rate limiter stats
    const finalStats = API_RATE_LIMITERS.helius.getStats();
    logger.info('\nFinal Helius rate limiter stats:', finalStats);
    
    logger.info('\nRate limiting test completed successfully!');
    
  } catch (error) {
    logger.error('Test failed:', error);
  }
}

// Run test
testRateLimiting().then(() => {
  logger.info('Test script finished');
  process.exit(0);
}).catch(error => {
  logger.error('Test script error:', error);
  process.exit(1);
});