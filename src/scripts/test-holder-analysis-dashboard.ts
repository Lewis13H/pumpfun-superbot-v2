/**
 * Test script for Holder Analysis Dashboard
 * Tests API endpoints and basic functionality
 */

import 'dotenv/config';
import { createLogger } from '../core/logger';
import axios from 'axios';

const logger = createLogger('TestDashboard');

const API_BASE = process.env.API_URL || 'http://localhost:3001';

// Test token addresses
const TEST_TOKENS = [
  'FwqCFRYdRVKMcUNBVmV5K7U7MWvhf3aXXn2hqpDbL2L9',
  'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump',
  '8Ki8DpuWNxu9VsS3kQbarsCWMcFGWkzzA8pUPto9zBd5'
];

async function testDashboard() {
  logger.info('Testing Holder Analysis Dashboard API...\n');

  try {
    // Test 1: Check API health
    logger.info('Test 1: Checking API health...');
    try {
      await axios.get(`${API_BASE}/api/holder-analysis/metrics`);
      logger.info('✅ API is accessible');
    } catch (error) {
      logger.error('❌ API health check failed:', error.message);
      return;
    }

    // Test 2: Get top tokens
    logger.info('\nTest 2: Getting top tokens...');
    try {
      const response = await axios.get(`${API_BASE}/api/holder-analysis/top-tokens?limit=5`);
      if (response.data.success) {
        logger.info(`✅ Retrieved ${response.data.tokens.length} top tokens`);
        response.data.tokens.forEach((token: any) => {
          logger.info(`  - ${token.symbol}: Score ${Math.round(token.holder_score)}/300`);
        });
      }
    } catch (error) {
      logger.error('❌ Failed to get top tokens:', error.message);
    }

    // Test 3: Queue analysis job
    logger.info('\nTest 3: Queueing analysis job...');
    try {
      const response = await axios.post(`${API_BASE}/api/holder-analysis/analyze`, {
        mintAddress: TEST_TOKENS[0],
        priority: 'high'
      });
      
      if (response.data.success) {
        logger.info(`✅ Analysis queued: Job ID ${response.data.jobId}`);
        
        // Monitor job progress
        await monitorJob(response.data.jobId);
      }
    } catch (error) {
      logger.error('❌ Failed to queue analysis:', error.message);
    }

    // Test 4: Get job queue status
    logger.info('\nTest 4: Getting job queue status...');
    try {
      const response = await axios.get(`${API_BASE}/api/holder-analysis/jobs`);
      if (response.data.success) {
        const stats = response.data.stats;
        logger.info('✅ Job queue status:');
        logger.info(`  - Waiting: ${stats.waiting}`);
        logger.info(`  - Active: ${stats.active}`);
        logger.info(`  - Completed: ${stats.completed}`);
        logger.info(`  - Failed: ${stats.failed}`);
      }
    } catch (error) {
      logger.error('❌ Failed to get job status:', error.message);
    }

    // Test 5: Get system metrics
    logger.info('\nTest 5: Getting system metrics...');
    try {
      const response = await axios.get(`${API_BASE}/api/holder-analysis/metrics`);
      if (response.data.success) {
        const summary = response.data.summary;
        logger.info('✅ System metrics:');
        logger.info(`  - Health Score: ${summary.healthScore}/100`);
        logger.info(`  - Total Processed: ${summary.totalProcessed}`);
        logger.info(`  - Average Processing Time: ${Math.round(summary.averageProcessingTime / 1000)}s`);
        logger.info(`  - Uptime: ${Math.round(summary.uptime / 60000)} minutes`);
      }
    } catch (error) {
      logger.error('❌ Failed to get metrics:', error.message);
    }

    // Test 6: Check dashboard accessibility
    logger.info('\nTest 6: Checking dashboard accessibility...');
    try {
      const response = await axios.get(`${API_BASE}/holder-analysis.html`);
      if (response.status === 200) {
        logger.info('✅ Dashboard HTML is accessible');
      }
    } catch (error) {
      logger.error('❌ Dashboard not accessible:', error.message);
    }

    logger.info('\n🎉 Dashboard tests completed!');
    logger.info(`\nTo view the dashboard, open: ${API_BASE}/holder-analysis.html`);

  } catch (error) {
    logger.error('Test failed:', error);
  }
}

async function monitorJob(jobId: string): Promise<void> {
  logger.info('  Monitoring job progress...');
  
  for (let i = 0; i < 10; i++) {
    await delay(2000);
    
    try {
      const response = await axios.get(`${API_BASE}/api/holder-analysis/jobs/${jobId}`);
      if (response.data.success && response.data.job) {
        const job = response.data.job;
        
        if (job.status === 'completed') {
          logger.info('  ✅ Job completed successfully');
          return;
        } else if (job.status === 'failed') {
          logger.error(`  ❌ Job failed: ${job.error}`);
          return;
        } else {
          logger.info(`  Job status: ${job.status}${job.progress ? ` (${job.progress}%)` : ''}`);
        }
      }
    } catch (error) {
      logger.error('  Error checking job:', error.message);
      return;
    }
  }
  
  logger.info('  Job still running after timeout');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run test
testDashboard().catch(console.error);