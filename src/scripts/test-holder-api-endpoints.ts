#!/usr/bin/env node
/**
 * Test Holder Analysis API Endpoints
 * 
 * This script demonstrates how to fetch comprehensive holder metrics
 * via the API endpoints.
 */

import axios from 'axios';
import { createLogger } from '../core/logger';

const logger = createLogger('HolderAPITest');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Test 1: Get top tokens by holder score
 */
async function testGetTopTokens() {
  try {
    logger.info('Testing GET /api/holder-analysis/top-tokens...');
    
    const response = await axios.get<ApiResponse<any>>(`${API_BASE_URL}/holder-analysis/top-tokens`, {
      params: { limit: 10 }
    });
    
    if (response.data.success && response.data.tokens) {
      logger.info(`Fetched ${response.data.tokens.length} top tokens`);
      
      console.log('\n=== Top Tokens by Holder Score ===');
      response.data.tokens.forEach((token: any, index: number) => {
        console.log(`${index + 1}. ${token.symbol} (${token.mint_address})`);
        console.log(`   - Holder Score: ${token.holder_score}/300`);
        console.log(`   - Market Cap: $${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`);
        console.log(`   - Holders: ${token.holder_count}`);
        console.log(`   - Top 10%: ${token.top_10_percentage}%`);
        console.log(`   - Bot %: ${token.bot_percentage}%`);
        console.log(`   - Sniper %: ${token.sniper_percentage}%`);
      });
      
      return response.data.tokens;
    } else {
      logger.error('Failed to fetch top tokens:', response.data.error);
    }
  } catch (error) {
    logger.error('Error testing top tokens endpoint:', error);
  }
}

/**
 * Test 2: Get holder analysis for specific token
 */
async function testGetTokenAnalysis(mintAddress: string) {
  try {
    logger.info(`Testing GET /api/holder-analysis/${mintAddress}...`);
    
    const response = await axios.get<ApiResponse<any>>(`${API_BASE_URL}/holder-analysis/${mintAddress}`);
    
    if (response.data.success) {
      const data = response.data.data;
      
      if (data) {
        console.log(`\n=== Holder Analysis for ${data.symbol || mintAddress} ===`);
        console.log(`- Holder Score: ${data.holder_score}/300`);
        console.log(`- Total Holders: ${data.holder_count || data.total_holders}`);
        console.log(`- Unique Holders: ${data.unique_holders}`);
        console.log(`- Top 10 Hold: ${data.top_10_percentage}%`);
        console.log(`- Top 25 Hold: ${data.top_25_percentage}%`);
        console.log(`- Gini Coefficient: ${data.gini_coefficient}`);
        console.log(`- Analysis Date: ${data.created_at}`);
        
        if (data.score_breakdown) {
          console.log('\nScore Breakdown:');
          const breakdown = typeof data.score_breakdown === 'string' 
            ? JSON.parse(data.score_breakdown) 
            : data.score_breakdown;
          
          Object.entries(breakdown).forEach(([key, value]) => {
            console.log(`  - ${key}: ${value}`);
          });
        }
      } else if (response.data.jobId) {
        console.log(`Analysis queued with job ID: ${response.data.jobId}`);
      }
      
      return data;
    } else {
      logger.error('Failed to fetch token analysis:', response.data.error);
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      logger.info('Token analysis not found, would need to queue new analysis');
    } else {
      logger.error('Error testing token analysis endpoint:', error.message);
    }
  }
}

/**
 * Test 3: Get batch analysis for multiple tokens
 */
async function testBatchAnalysis(mintAddresses: string[]) {
  try {
    logger.info('Testing POST /api/holder-analysis/batch...');
    
    const response = await axios.post<ApiResponse<any>>(`${API_BASE_URL}/holder-analysis/batch`, {
      mintAddresses
    });
    
    if (response.data.success && response.data.data) {
      logger.info(`Fetched analysis for ${response.data.data.length} tokens`);
      
      console.log('\n=== Batch Analysis Results ===');
      response.data.data.forEach((token: any) => {
        console.log(`\n${token.symbol || token.mint_address}:`);
        console.log(`  - Score: ${token.holder_score}/300`);
        console.log(`  - Holders: ${token.holder_count}`);
        console.log(`  - Market Cap: $${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`);
      });
      
      return response.data.data;
    } else {
      logger.error('Failed to fetch batch analysis:', response.data.error);
    }
  } catch (error) {
    logger.error('Error testing batch analysis endpoint:', error);
  }
}

/**
 * Test 4: Get holder distribution for a token
 */
async function testGetDistribution(mintAddress: string) {
  try {
    logger.info(`Testing GET /api/holder-analysis/distribution/${mintAddress}...`);
    
    const response = await axios.get<ApiResponse<any>>(`${API_BASE_URL}/holder-analysis/distribution/${mintAddress}`);
    
    if (response.data.success && response.data.holders) {
      logger.info(`Fetched distribution for ${response.data.holders.length} holders`);
      
      console.log('\n=== Top 10 Holders Distribution ===');
      response.data.holders.slice(0, 10).forEach((holder: any) => {
        console.log(`Rank ${holder.rank}: ${holder.wallet_address.slice(0, 8)}...`);
        console.log(`  - Balance: ${parseFloat(holder.balance).toLocaleString()}`);
        console.log(`  - Percentage: ${holder.percentage}%`);
        
        if (holder.classification) {
          console.log(`  - Type: ${holder.classification.classification} (confidence: ${holder.classification.confidence_score})`);
        }
      });
      
      return response.data.holders;
    } else {
      logger.error('Failed to fetch distribution:', response.data.error);
    }
  } catch (error) {
    logger.error('Error testing distribution endpoint:', error);
  }
}

/**
 * Test 5: Get system metrics
 */
async function testGetMetrics() {
  try {
    logger.info('Testing GET /api/holder-analysis/metrics...');
    
    const response = await axios.get<ApiResponse<any>>(`${API_BASE_URL}/holder-analysis/metrics`);
    
    if (response.data.success) {
      console.log('\n=== System Metrics ===');
      console.log('Queue Stats:', response.data.queueStats);
      console.log('Worker Stats:', response.data.workerStats);
      console.log('Processing Stats:', response.data.processingStats);
      
      return response.data;
    } else {
      logger.error('Failed to fetch metrics:', response.data.error);
    }
  } catch (error) {
    logger.error('Error testing metrics endpoint:', error);
  }
}

/**
 * Main test runner
 */
async function main() {
  logger.info('Starting Holder Analysis API tests...');
  
  try {
    // Test 1: Get top tokens
    const topTokens = await testGetTopTokens();
    
    if (topTokens && topTokens.length > 0) {
      // Test 2: Get analysis for the top token
      const topToken = topTokens[0];
      await testGetTokenAnalysis(topToken.mint_address);
      
      // Test 3: Batch analysis for top 3 tokens
      const top3Addresses = topTokens.slice(0, 3).map((t: any) => t.mint_address);
      await testBatchAnalysis(top3Addresses);
      
      // Test 4: Get distribution for top token
      await testGetDistribution(topToken.mint_address);
    }
    
    // Test 5: Get system metrics
    await testGetMetrics();
    
    logger.info('All API tests completed');
    
  } catch (error) {
    logger.error('Test failed:', error);
  }
}

// Check if API server is running
async function checkApiServer() {
  try {
    await axios.get(`${API_BASE_URL}/health`);
    return true;
  } catch (error) {
    return false;
  }
}

// Run tests
(async () => {
  const isApiRunning = await checkApiServer();
  
  if (!isApiRunning) {
    logger.warn(`API server not running at ${API_BASE_URL}`);
    logger.info('Start the API server with: npm run api');
    process.exit(1);
  }
  
  await main();
})();