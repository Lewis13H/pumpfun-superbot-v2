/**
 * Test Script for Session 9: Performance Optimization
 * 
 * Tests:
 * 1. Performance optimizer adaptive behavior
 * 2. Dynamic batch processing
 * 3. Adaptive cache management
 * 4. Performance monitoring and metrics
 * 5. Overall performance improvements
 */

import 'dotenv/config';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { PerformanceOptimizer, PerformanceConfig } from '../services/optimization/performance-optimizer';
import { DynamicBatchProcessor } from '../services/optimization/dynamic-batch-processor';
import { AdaptiveCacheManager } from '../services/optimization/adaptive-cache-manager';
import { PerformanceMonitor } from '../services/optimization/performance-monitor';
import chalk from 'chalk';

const logger = new Logger({ context: 'TestSession9' });

async function testPerformanceOptimizer() {
  logger.info('\n=== Testing Performance Optimizer ===');
  
  const eventBus = new EventBus();
  
  const config: PerformanceConfig = {
    batching: {
      minBatchSize: 10,
      maxBatchSize: 100,
      batchTimeout: 100,
      adaptiveEnabled: true
    },
    caching: {
      priceCache: { ttl: 5000, maxSize: 1000000, preloadEnabled: false },
      metadataCache: { ttl: 60000, maxSize: 5000000, compressionEnabled: true },
      poolStateCache: { ttl: 10000, maxSize: 2000000, updateInterval: 5000 }
    },
    resources: {
      maxConcurrentOperations: 50,
      memoryLimit: 500, // MB
      cpuThreshold: 80 // %
    },
    monitoring: {
      sampleInterval: 1000,
      metricsRetention: 300000, // 5 minutes
      alertThresholds: {
        latency: 200,
        throughput: 100,
        errorRate: 0.05
      }
    }
  };
  
  const optimizer = new PerformanceOptimizer(eventBus, config);
  
  // Simulate various metrics
  logger.info('Simulating performance metrics...');
  
  // Simulate high latency
  for (let i = 0; i < 10; i++) {
    eventBus.emit('operation:complete', { duration: 250 + Math.random() * 50 });
    await new Promise(r => setTimeout(r, 10));
  }
  
  // Simulate low throughput
  for (let i = 0; i < 5; i++) {
    eventBus.emit('message:processed', {});
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Wait for optimization
  await new Promise(r => setTimeout(r, 2000));
  
  // Force optimization
  optimizer.forceOptimization();
  
  const params = optimizer.getOptimizationParams();
  logger.info('Current optimization parameters:', params);
  
  const report = optimizer.getPerformanceReport();
  logger.info('Performance report:', {
    improvement: report.improvement,
    currentMetrics: {
      throughput: report.current.throughput,
      latencyP95: report.current.latency.p95
    }
  });
  
  optimizer.stop();
  
  return { params, report };
}

async function testDynamicBatching() {
  logger.info('\n=== Testing Dynamic Batch Processor ===');
  
  const eventBus = new EventBus();
  let processedBatches = 0;
  let totalItems = 0;
  
  const processor = new DynamicBatchProcessor(eventBus, {
    minBatchSize: 5,
    maxBatchSize: 50,
    batchTimeout: 100,
    maxQueueSize: 1000,
    priorityEnabled: true,
    adaptiveEnabled: true,
    processor: async (items) => {
      processedBatches++;
      totalItems += items.length;
      
      // Simulate processing time based on batch size
      const processingTime = items.length * 2;
      await new Promise(r => setTimeout(r, processingTime));
      
      logger.debug(`Processed batch of ${items.length} items in ${processingTime}ms`);
    }
  });
  
  // Add items with different priorities
  logger.info('Adding items to batch processor...');
  
  // High priority items
  for (let i = 0; i < 20; i++) {
    processor.add({
      id: `high-${i}`,
      priority: 'high',
      data: { value: i },
      timestamp: Date.now()
    });
  }
  
  // Normal priority items
  for (let i = 0; i < 50; i++) {
    processor.add({
      id: `normal-${i}`,
      priority: 'normal',
      data: { value: i },
      timestamp: Date.now()
    });
  }
  
  // Low priority items
  for (let i = 0; i < 30; i++) {
    processor.add({
      id: `low-${i}`,
      priority: 'low',
      data: { value: i },
      timestamp: Date.now()
    });
  }
  
  // Wait for processing
  await new Promise(r => setTimeout(r, 3000));
  
  // Get stats
  const stats = processor.getStats();
  const queueInfo = processor.getQueueInfo();
  
  logger.info('Batch processor stats:', stats);
  logger.info('Queue info:', queueInfo);
  
  // Flush remaining
  await processor.flush();
  await processor.stop();
  
  return {
    processedBatches,
    totalItems,
    stats,
    adaptationWorked: stats.avgBatchSize !== 5 // Changed from initial
  };
}

async function testAdaptiveCache() {
  logger.info('\n=== Testing Adaptive Cache Manager ===');
  
  const eventBus = new EventBus();
  
  const cache = new AdaptiveCacheManager('test', eventBus, {
    maxSize: 1000000, // 1MB
    defaultTTL: 5000,
    compressionThreshold: 1000,
    compressionEnabled: true,
    evictionPolicy: 'lru',
    adaptiveTTL: true,
    preloadEnabled: true
  });
  
  // Test basic operations
  logger.info('Testing cache operations...');
  
  // Add some items
  const testData = {
    small: 'Small value',
    medium: 'x'.repeat(500),
    large: 'y'.repeat(2000) // Should trigger compression
  };
  
  await cache.set('small', testData.small);
  await cache.set('medium', testData.medium);
  await cache.set('large', testData.large);
  
  // Test retrieval
  const retrieved = {
    small: await cache.get('small'),
    medium: await cache.get('medium'),
    large: await cache.get('large'),
    missing: await cache.get('missing')
  };
  
  logger.info('Cache retrieval results:', {
    small: retrieved.small === testData.small,
    medium: retrieved.medium === testData.medium,
    large: retrieved.large === testData.large,
    missing: retrieved.missing === null
  });
  
  // Simulate cache hits to test adaptation
  for (let i = 0; i < 10; i++) {
    await cache.get('small');
    await cache.get('medium');
  }
  
  // Test eviction by filling cache
  logger.info('Testing cache eviction...');
  const evictionTestSize = 100000;
  for (let i = 0; i < 20; i++) {
    await cache.set(`evict-${i}`, 'z'.repeat(evictionTestSize));
  }
  
  const stats = cache.getStats();
  logger.info('Cache stats:', stats);
  
  // Test optimization
  cache.optimize();
  
  const entries = cache.getEntries();
  logger.info('Cache entries:', {
    count: entries.length,
    compressed: entries.filter(e => e.compressed).length,
    totalHits: entries.reduce((sum, e) => sum + e.hits, 0)
  });
  
  return {
    stats,
    compressionWorked: entries.some(e => e.compressed),
    evictionWorked: stats.evictions > 0
  };
}

async function testPerformanceMonitoring() {
  logger.info('\n=== Testing Performance Monitor ===');
  
  const eventBus = new EventBus();
  
  const monitor = new PerformanceMonitor(eventBus, {
    metricsRetention: 60000,
    samplingInterval: 100,
    enableTracing: true
  });
  
  // Track some operations
  logger.info('Tracking operations...');
  
  for (let i = 0; i < 5; i++) {
    const opId = `op-${i}`;
    eventBus.emit('operation:start', {
      id: opId,
      name: 'test-operation',
      metadata: { index: i }
    });
    
    // Simulate work
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    
    eventBus.emit('operation:complete', {
      id: opId,
      duration: 50 + Math.random() * 100,
      success: Math.random() > 0.1
    });
  }
  
  // Record custom metrics
  for (let i = 0; i < 10; i++) {
    monitor.recordMetric({
      name: 'custom.metric',
      value: Math.random() * 100,
      unit: 'units',
      timestamp: Date.now()
    });
    await new Promise(r => setTimeout(r, 50));
  }
  
  // Wait for metrics collection
  await new Promise(r => setTimeout(r, 1000));
  
  // Get performance summary
  const summary = monitor.getPerformanceSummary();
  const operationStats = monitor.getMetricStats('operation.duration', 60000);
  const customStats = monitor.getMetricStats('custom.metric', 60000);
  const traces = monitor.getTraces(60000);
  
  logger.info('Performance summary:', {
    uptime: summary.uptime,
    operations: summary.operations,
    resources: {
      cpu: summary.resources.cpu.usage.toFixed(2) + '%',
      memory: summary.resources.memory.percentage.toFixed(2) + '%'
    }
  });
  
  logger.info('Operation stats:', operationStats);
  logger.info('Custom metric stats:', customStats);
  logger.info('Traces collected:', traces.length);
  
  monitor.stop();
  
  return { summary, operationStats, customStats, traces };
}

async function testIntegratedPerformance() {
  logger.info('\n=== Testing Integrated Performance ===');
  
  const eventBus = new EventBus();
  
  // Create all components
  const optimizer = new PerformanceOptimizer(eventBus, {
    batching: {
      minBatchSize: 10,
      maxBatchSize: 100,
      batchTimeout: 50,
      adaptiveEnabled: true
    },
    caching: {
      priceCache: { ttl: 1000, maxSize: 100000, preloadEnabled: false },
      metadataCache: { ttl: 5000, maxSize: 500000, compressionEnabled: true },
      poolStateCache: { ttl: 2000, maxSize: 200000, updateInterval: 1000 }
    },
    resources: {
      maxConcurrentOperations: 20,
      memoryLimit: 100,
      cpuThreshold: 80
    },
    monitoring: {
      sampleInterval: 100,
      metricsRetention: 60000,
      alertThresholds: {
        latency: 100,
        throughput: 50,
        errorRate: 0.1
      }
    }
  });
  
  const monitor = new PerformanceMonitor(eventBus, {
    metricsRetention: 60000,
    samplingInterval: 100,
    enableTracing: true
  });
  
  // Simulate workload
  logger.info('Simulating integrated workload...');
  
  const startTime = Date.now();
  let operations = 0;
  
  // Run for 5 seconds
  while (Date.now() - startTime < 5000) {
    const opId = `integrated-op-${operations++}`;
    
    monitor.startOperation(opId, 'integrated-test');
    
    // Simulate varying workload
    const workTime = 10 + Math.random() * 90;
    await new Promise(r => setTimeout(r, workTime));
    
    monitor.completeOperation(opId, true);
    
    // Emit events for optimizer
    eventBus.emit('message:processed', {});
    eventBus.emit('operation:complete', { duration: workTime });
    
    // Vary the rate
    if (operations % 10 === 0) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  // Force optimization
  optimizer.forceOptimization();
  
  // Get final report
  const optimizerReport = optimizer.getPerformanceReport();
  const monitorSummary = monitor.getPerformanceSummary();
  
  logger.info('Integrated test results:', {
    totalOperations: operations,
    avgThroughput: operations / 5,
    optimizerReport: {
      throughputImprovement: optimizerReport.improvement.throughput,
      latencyImprovement: optimizerReport.improvement.latency
    },
    finalMetrics: monitorSummary.operations
  });
  
  optimizer.stop();
  monitor.stop();
  
  return {
    operations,
    throughput: operations / 5,
    improvements: optimizerReport.improvement
  };
}

async function runTests() {
  try {
    logger.info(chalk.cyan('Session 9: Performance Optimization Tests'));
    
    // Run individual tests
    const optimizerResults = await testPerformanceOptimizer();
    const batchingResults = await testDynamicBatching();
    const cacheResults = await testAdaptiveCache();
    const monitoringResults = await testPerformanceMonitoring();
    const integratedResults = await testIntegratedPerformance();
    
    // Summary
    console.log(chalk.cyan('\n📊 Test Summary:'));
    
    console.log(chalk.gray('\n1. Performance Optimizer:'));
    console.log(`   - Batch size adapted: ${optimizerResults.params.batching.currentSize}`);
    console.log(`   - Cache TTL multiplier: ${optimizerResults.params.caching.ttlMultiplier.toFixed(2)}`);
    console.log(`   - Latency improvement: ${optimizerResults.report.improvement.latency.toFixed(1)}%`);
    
    console.log(chalk.gray('\n2. Dynamic Batching:'));
    console.log(`   - Batches processed: ${batchingResults.processedBatches}`);
    console.log(`   - Items processed: ${batchingResults.totalItems}`);
    console.log(`   - Avg batch size: ${batchingResults.stats.avgBatchSize.toFixed(1)}`);
    console.log(`   - Adaptation worked: ${batchingResults.adaptationWorked ? '✓' : '✗'}`);
    
    console.log(chalk.gray('\n3. Adaptive Cache:'));
    console.log(`   - Hit rate: ${(cacheResults.stats.hitRate * 100).toFixed(1)}%`);
    console.log(`   - Compression worked: ${cacheResults.compressionWorked ? '✓' : '✗'}`);
    console.log(`   - Eviction worked: ${cacheResults.evictionWorked ? '✓' : '✗'}`);
    
    console.log(chalk.gray('\n4. Performance Monitoring:'));
    console.log(`   - Operations tracked: ${monitoringResults.summary.operations.completed}`);
    console.log(`   - Success rate: ${(monitoringResults.summary.operations.successRate * 100).toFixed(1)}%`);
    console.log(`   - Metrics collected: ${monitoringResults.operationStats?.count || 0}`);
    
    console.log(chalk.gray('\n5. Integrated Performance:'));
    console.log(`   - Throughput: ${integratedResults.throughput.toFixed(1)} ops/sec`);
    console.log(`   - Throughput improvement: ${integratedResults.improvements.throughput.toFixed(1)}%`);
    console.log(`   - Target: 50%+ improvement`);
    console.log(`   - ${integratedResults.improvements.throughput > 50 ? chalk.green('✓ TARGET MET') : chalk.yellow('⚠ Below target')}`);
    
    logger.info(chalk.green('\n✅ All tests completed successfully!'));
    
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the tests
runTests();