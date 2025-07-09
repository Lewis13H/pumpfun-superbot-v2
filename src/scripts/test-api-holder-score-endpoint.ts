#!/usr/bin/env tsx

/**
 * Test API endpoint for holder scores
 */

import 'dotenv/config';
import axios from 'axios';
import { Logger } from '../core/logger';

const logger = new Logger({ context: 'TestAPIHolderScore' });

async function testAPIEndpoint() {
  try {
    const API_BASE = 'http://localhost:3001';
    
    logger.info('Testing API endpoint for holder scores...\n');
    
    // Test the /api/tokens endpoint
    const response = await axios.get(`${API_BASE}/api/tokens`);
    
    logger.info(`Received ${response.data.length} tokens from API`);
    
    // Check first 5 tokens
    const tokensToCheck = response.data.slice(0, 5);
    
    logger.info('\nFirst 5 tokens:');
    tokensToCheck.forEach((token: any) => {
      logger.info(`  ${token.symbol || 'NULL'}: holder_score = ${token.holder_score || 'NULL'} (mint: ${token.mint_address.substring(0, 8)}...)`);
    });
    
    // Check if holder_score field is included in response
    const tokensWithScores = response.data.filter((t: any) => t.holder_score !== null && t.holder_score !== undefined);
    logger.info(`\nTokens with holder scores: ${tokensWithScores.length} out of ${response.data.length}`);
    
    // Show some tokens with scores
    if (tokensWithScores.length > 0) {
      logger.info('\nExample tokens with scores:');
      tokensWithScores.slice(0, 5).forEach((token: any) => {
        logger.info(`  ${token.symbol}: score = ${token.holder_score}`);
      });
    }
    
    // Check the raw SQL query result
    logger.info('\n--- Raw API Response Sample ---');
    if (response.data.length > 0) {
      const sampleToken = response.data[0];
      logger.info('First token object keys:', Object.keys(sampleToken));
      logger.info('holder_score value:', sampleToken.holder_score);
      logger.info('holder_score type:', typeof sampleToken.holder_score);
    }
    
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      logger.error('API server is not running on port 3001!');
      logger.error('Please start the API server with: npm run dashboard');
    } else {
      logger.error('API test failed:', error);
    }
  }
}

// Run test
testAPIEndpoint().then(() => {
  logger.info('\nAPI test completed');
  process.exit(0);
}).catch(error => {
  logger.error('Script error:', error);
  process.exit(1);
});