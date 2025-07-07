/**
 * Test script for Holder Analysis Session 4: Job Queue Implementation
 */

import { Pool } from 'pg';
import { createLogger } from '../core/logger';
import { HolderAnalysisJobQueue } from '../services/holder-analysis/holder-analysis-job-queue';
import { HolderAnalysisJobProcessor } from '../services/holder-analysis/holder-analysis-job-processor';
import { HolderAnalysisJobScheduler } from '../services/holder-analysis/holder-analysis-job-scheduler';
import { HolderAnalysisJobMonitor } from '../services/holder-analysis/holder-analysis-job-monitor';
import { getDatabaseConfig } from '../config/database';

const logger = createLogger('TestSession4');

// Test token addresses (pump.fun tokens)
const TEST_TOKENS = [
  // Add some real pump.fun token addresses here
  'FwqCFRYdRVKMcUNBVmV5K7U7MWvhf3aXXn2hqpDbL2L9', // Example 1
  'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump', // Example 2
  '8Ki8DpuWNxu9VsS3kQbarsCWMcFGWkzzA8pUPto9zBd5', // Example 3
];

async function testJobQueue() {
  const pool = new Pool(getDatabaseConfig());
  
  try {
    logger.info('Testing Holder Analysis Job Queue System...\n');

    // 1. Create job queue
    logger.info('1. Creating job queue...');
    const queue = new HolderAnalysisJobQueue();

    // 2. Create job processor
    logger.info('2. Creating job processor...');
    const processor = new HolderAnalysisJobProcessor(pool, {
      maxWorkers: 2,
      heliusApiKey: process.env.HELIUS_API_KEY,
      shyftApiKey: process.env.SHYFT_API_KEY
    });

    // 3. Create job scheduler
    logger.info('3. Creating job scheduler...');
    const scheduler = new HolderAnalysisJobScheduler(queue);

    // 4. Create job monitor
    logger.info('4. Creating job monitor...');
    const monitor = new HolderAnalysisJobMonitor(queue, processor, scheduler, {
      metricsInterval: 5000, // 5 seconds for testing
      enableAlerts: true
    });

    // Set up event listeners
    queue.on('job:completed', (event) => {
      logger.info(`✅ Job completed: ${event.jobId}`);
    });

    queue.on('job:failed', (event) => {
      logger.error(`❌ Job failed: ${event.jobId} - ${event.data?.error}`);
    });

    monitor.on('alert', (alert) => {
      logger.warn(`🚨 Alert: ${alert.message}`);
    });

    monitor.on('metrics_collected', async (metrics) => {
      logger.info(`📊 Metrics: Queue=${metrics.queue.waiting}, Active=${metrics.queue.active}, Completed=${metrics.queue.completed}`);
    });

    // Start processing
    queue.process(2, processor.createProcessor());
    monitor.start();

    // Test 1: Single token analysis
    logger.info('\n📋 Test 1: Single token analysis');
    const singleJob = await queue.add({
      type: 'single_analysis',
      mintAddress: TEST_TOKENS[0],
      options: {
        forceRefresh: false,
        maxHolders: 100,
        enableTrends: true,
        classifyWallets: true,
        saveSnapshot: false
      }
    }, {
      priority: 'high'
    });
    logger.info(`Added single analysis job: ${singleJob.id}`);

    // Wait a bit
    await delay(2000);

    // Test 2: Batch analysis
    logger.info('\n📋 Test 2: Batch token analysis');
    const batchJob = await queue.add({
      type: 'batch_analysis',
      mintAddresses: TEST_TOKENS,
      options: {
        forceRefresh: false,
        maxHolders: 50,
        enableTrends: false,
        classifyWallets: true,
        saveSnapshot: false
      }
    }, {
      priority: 'normal'
    });
    logger.info(`Added batch analysis job: ${batchJob.id}`);

    // Test 3: Schedule recurring analysis
    logger.info('\n📋 Test 3: Schedule recurring analysis');
    const scheduled = scheduler.scheduleRecurringAnalysis({
      id: 'test-recurring',
      name: 'Test Recurring Analysis',
      schedule: '30s', // Every 30 seconds
      data: {
        type: 'single_analysis',
        mintAddress: TEST_TOKENS[1],
        options: {
          forceRefresh: true,
          maxHolders: 100,
          enableTrends: true,
          classifyWallets: false,
          saveSnapshot: false
        }
      },
      options: {
        priority: 'normal'
      },
      enabled: true
    });
    logger.info(`Scheduled recurring job: ${scheduled}`);

    // Start scheduler
    scheduler.start();

    // Test 4: Add jobs with different priorities
    logger.info('\n📋 Test 4: Priority queue test');
    await queue.add({
      type: 'trend_update',
      mintAddress: TEST_TOKENS[2]
    }, { priority: 'low' });

    await queue.add({
      type: 'trend_update',
      mintAddress: TEST_TOKENS[0]
    }, { priority: 'critical' });

    await queue.add({
      type: 'trend_update',
      mintAddress: TEST_TOKENS[1]
    }, { priority: 'high' });

    // Wait for processing
    logger.info('\n⏳ Processing jobs for 30 seconds...');
    await delay(30000);

    // Get final stats
    const stats = await queue.getStats();
    const dashboardData = await monitor.getDashboardData();

    logger.info('\n📊 Final Statistics:');
    logger.info(`Total jobs: ${stats.total}`);
    logger.info(`Completed: ${stats.completed}`);
    logger.info(`Failed: ${stats.failed}`);
    logger.info(`Waiting: ${stats.waiting}`);
    logger.info(`Active: ${stats.active}`);
    logger.info(`Average processing time: ${stats.averageProcessingTime ? Math.round(stats.averageProcessingTime / 1000) + 's' : 'N/A'}`);
    logger.info(`Throughput: ${stats.throughput?.toFixed(2) || 0} jobs/min`);
    logger.info(`Health score: ${dashboardData.summary.healthScore}/100`);

    logger.info('\n📊 Worker Statistics:');
    const workerStats = processor.getWorkerStats();
    workerStats.forEach(worker => {
      logger.info(`Worker ${worker.id}: ${worker.status}, Processed=${worker.jobsProcessed}, Errors=${worker.errors}`);
    });

    logger.info('\n📊 Scheduled Jobs:');
    const scheduledJobs = scheduler.getScheduledJobs();
    scheduledJobs.forEach(job => {
      logger.info(`${job.id}: ${job.enabled ? 'Enabled' : 'Disabled'}, Schedule=${job.schedule}, Last run=${job.lastRun || 'Never'}`);
    });

    // Test 5: Test job cancellation
    logger.info('\n📋 Test 5: Job cancellation');
    const cancelJob = await queue.add({
      type: 'single_analysis',
      mintAddress: TEST_TOKENS[0]
    }, { priority: 'low' });
    logger.info(`Added job to cancel: ${cancelJob.id}`);
    
    const removed = await queue.removeJob(cancelJob.id);
    logger.info(`Job removed: ${removed}`);

    // Wait a bit more
    await delay(5000);

    // Clean up
    logger.info('\n🧹 Cleaning up...');
    scheduler.stop();
    monitor.stop();
    await processor.shutdown();
    queue.destroy();
    monitor.destroy();

    logger.info('\n✅ Job queue test completed successfully!');

  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await pool.end();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run test
testJobQueue().catch(console.error);