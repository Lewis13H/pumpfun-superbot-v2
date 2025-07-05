import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionPool, ConnectionPoolConfig } from '../../services/core/connection-pool';
import { SmartStreamManager, SmartStreamManagerOptions } from '../../services/core/smart-stream-manager';
import { EventBus } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import { performance } from 'perf_hooks';

// Mock the stream client with realistic behavior
const createMockStreamClient = (delay: number = 0) => ({
  subscribe: async () => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return undefined;
  }
});

describe('Connection Pool Load Tests', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ context: 'LoadTest' });
  });

  describe('connection creation stress test', () => {
    it('should handle rapid connection creation', async () => {
      const config: ConnectionPoolConfig = {
        grpcEndpoint: 'test://endpoint',
        grpcToken: 'test-token',
        maxConnections: 10,
        minConnections: 2,
        connectionTimeout: 5000,
        healthCheckInterval: 30000,
        maxRetries: 3
      };

      const pool = new ConnectionPool(config);
      await pool.initialize();

      const startTime = performance.now();
      const acquisitionPromises: Promise<any>[] = [];

      // Rapidly acquire connections
      for (let i = 0; i < 50; i++) {
        acquisitionPromises.push(
          pool.acquireConnection('test').catch(err => ({ error: err }))
        );
      }

      const results = await Promise.all(acquisitionPromises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      const successful = results.filter(r => !r.error).length;
      const failed = results.filter(r => r.error).length;

      logger.info(`Connection acquisition stress test:`, {
        total: results.length,
        successful,
        failed,
        duration: `${duration.toFixed(2)}ms`,
        avgTime: `${(duration / results.length).toFixed(2)}ms`
      });

      // Should handle all requests without crashes
      expect(successful).toBeGreaterThan(0);
      expect(pool.getConnectionStats().totalConnections).toBeLessThanOrEqual(config.maxConnections);

      await pool.shutdown();
    });

    it('should maintain performance under sustained load', async () => {
      const config: ConnectionPoolConfig = {
        grpcEndpoint: 'test://endpoint',
        grpcToken: 'test-token',
        maxConnections: 5,
        minConnections: 3,
        connectionTimeout: 2000,
        healthCheckInterval: 30000,
        maxRetries: 3
      };

      const pool = new ConnectionPool(config);
      await pool.initialize();

      const testDuration = 5000; // 5 seconds
      const startTime = performance.now();
      let requestCount = 0;
      let successCount = 0;
      let errorCount = 0;
      const latencies: number[] = [];

      // Sustained load for duration
      while (performance.now() - startTime < testDuration) {
        const reqStart = performance.now();
        
        try {
          const conn = await pool.acquireConnection('test');
          successCount++;
          
          // Simulate some work
          await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
          
          pool.releaseConnection(conn.id);
        } catch (error) {
          errorCount++;
        }
        
        const reqEnd = performance.now();
        latencies.push(reqEnd - reqStart);
        requestCount++;
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
      const p99Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)];

      logger.info(`Sustained load test results:`, {
        duration: `${testDuration}ms`,
        requests: requestCount,
        successful: successCount,
        errors: errorCount,
        errorRate: `${((errorCount / requestCount) * 100).toFixed(2)}%`,
        avgLatency: `${avgLatency.toFixed(2)}ms`,
        p95Latency: `${p95Latency.toFixed(2)}ms`,
        p99Latency: `${p99Latency.toFixed(2)}ms`,
        rps: (requestCount / (testDuration / 1000)).toFixed(2)
      });

      expect(successCount).toBeGreaterThan(requestCount * 0.95); // >95% success rate
      expect(avgLatency).toBeLessThan(100); // <100ms average latency

      await pool.shutdown();
    });
  });

  describe('smart stream manager load test', () => {
    it('should handle multiple monitors with high throughput', async () => {
      const eventBus = new EventBus();
      const config: SmartStreamManagerOptions = {
        eventBus,
        poolConfig: {
          grpcEndpoint: 'test://endpoint',
          grpcToken: 'test-token',
          maxConnections: 3,
          minConnections: 2,
          connectionTimeout: 2000,
          healthCheckInterval: 30000,
          maxRetries: 3
        },
        loadBalancerConfig: {
          rebalanceThreshold: 0.3,
          rebalanceInterval: 5000,
          minLoadDifference: 0.2
        },
        pipelineConfig: {
          batchSize: 100,
          batchTimeout: 250,
          maxQueueSize: 10000,
          workers: 4
        }
      };

      const manager = new SmartStreamManager(config);
      await manager.initialize();

      // Register multiple monitors
      const monitorCount = 10;
      const registrations = [];

      for (let i = 0; i < monitorCount; i++) {
        const group = i % 3 === 0 ? 'bonding_curve' : i % 3 === 1 ? 'amm_pool' : 'external_amm';
        registrations.push(
          manager.registerMonitor({
            monitorId: `monitor-${i}`,
            monitorType: 'test',
            group,
            programId: `program-${i}`,
            subscriptionConfig: {}
          })
        );
      }

      await Promise.all(registrations);

      // Simulate high message throughput
      const messageCount = 10000;
      const startTime = performance.now();
      let processedCount = 0;

      eventBus.on('message:processed', () => processedCount++);

      // Send messages
      for (let i = 0; i < messageCount; i++) {
        eventBus.emit('STREAM_DATA', {
          connectionId: `conn-${i % 3}`,
          data: { test: `message-${i}` },
          slot: 1000 + i
        });
        
        // Simulate realistic message arrival rate
        if (i % 100 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000; // seconds
      const throughput = messageCount / duration;

      const stats = manager.getStats();
      const loadMetrics = manager.getLoadMetrics();

      logger.info(`Smart streaming load test results:`, {
        duration: `${duration.toFixed(2)}s`,
        messages: messageCount,
        throughput: `${throughput.toFixed(2)} msg/s`,
        monitors: stats.monitors.total,
        connections: stats.pool.activeConnections,
        loadBalance: loadMetrics.summary,
        pipeline: stats.pipeline
      });

      expect(throughput).toBeGreaterThan(1000); // >1000 msg/s
      expect(stats.pool.healthyConnections).toBe(stats.pool.activeConnections);

      await manager.stop();
    });
  });

  describe('failover load test', () => {
    it('should maintain throughput during connection failures', async () => {
      const eventBus = new EventBus();
      const config: SmartStreamManagerOptions = {
        eventBus,
        poolConfig: {
          grpcEndpoint: 'test://endpoint',
          grpcToken: 'test-token',
          maxConnections: 4,
          minConnections: 3,
          connectionTimeout: 1000,
          healthCheckInterval: 1000,
          maxRetries: 2
        },
        faultToleranceConfig: {
          enabled: true,
          circuitBreaker: {
            failureThreshold: 3,
            recoveryTimeout: 2000,
            halfOpenRequests: 2,
            monitoringWindow: 5000
          },
          checkpointInterval: 5000,
          maxRecoveryAttempts: 3,
          recoveryBackoff: 1000
        }
      };

      const manager = new SmartStreamManager(config);
      await manager.initialize();

      // Register monitors
      for (let i = 0; i < 6; i++) {
        await manager.registerMonitor({
          monitorId: `monitor-${i}`,
          monitorType: 'test',
          group: 'bonding_curve',
          programId: `program-${i}`,
          subscriptionConfig: {}
        });
      }

      let processedCount = 0;
      let errorCount = 0;
      const startTime = performance.now();

      eventBus.on('message:processed', () => processedCount++);
      eventBus.on('MONITOR_ERROR', () => errorCount++);

      // Start sending messages
      const sendMessages = async () => {
        for (let i = 0; i < 5000; i++) {
          eventBus.emit('STREAM_DATA', {
            connectionId: `conn-${i % 3}`,
            data: { test: `message-${i}` },
            slot: 1000 + i
          });
          
          if (i % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
      };

      const messagePromise = sendMessages();

      // Simulate connection failure after 1 second
      setTimeout(() => {
        logger.info('Simulating connection failure');
        eventBus.emit('connection:error', {
          connectionId: 'conn-0',
          error: new Error('Simulated connection failure')
        });
      }, 1000);

      await messagePromise;
      await new Promise(resolve => setTimeout(resolve, 2000));

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;
      const throughput = processedCount / duration;

      const stats = manager.getStats();
      const healthSummary = stats.faultTolerance.enabled ? 
        stats.faultTolerance.health : 
        { healthy: 0, degraded: 0, failed: 0 };

      logger.info(`Failover load test results:`, {
        duration: `${duration.toFixed(2)}s`,
        processed: processedCount,
        errors: errorCount,
        errorRate: `${((errorCount / (processedCount + errorCount)) * 100).toFixed(2)}%`,
        throughput: `${throughput.toFixed(2)} msg/s`,
        health: healthSummary
      });

      // Should maintain reasonable throughput despite failure
      expect(throughput).toBeGreaterThan(500); // >500 msg/s even with failures
      expect(errorCount).toBeLessThan(processedCount * 0.1); // <10% error rate

      await manager.stop();
    });
  });

  describe('memory usage under load', () => {
    it('should not leak memory under sustained load', async function() {
      // Skip in CI environments or if memory tracking not available
      if (!global.gc) {
        logger.warn('Skipping memory test - GC not available');
        this.skip();
        return;
      }

      const eventBus = new EventBus();
      const config: SmartStreamManagerOptions = {
        eventBus,
        poolConfig: {
          grpcEndpoint: 'test://endpoint',
          grpcToken: 'test-token',
          maxConnections: 2,
          minConnections: 2,
          connectionTimeout: 1000,
          healthCheckInterval: 10000,
          maxRetries: 3
        },
        pipelineConfig: {
          batchSize: 100,
          batchTimeout: 100,
          maxQueueSize: 1000,
          workers: 2
        }
      };

      const manager = new SmartStreamManager(config);
      await manager.initialize();

      // Force GC and get baseline memory
      global.gc();
      const baselineMemory = process.memoryUsage().heapUsed;

      // Run sustained load
      const iterations = 10;
      const messagesPerIteration = 1000;

      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < messagesPerIteration; i++) {
          eventBus.emit('STREAM_DATA', {
            connectionId: 'conn-0',
            data: { 
              test: `message-${i}`,
              payload: Buffer.alloc(1024) // 1KB payload
            },
            slot: 1000 + i
          });
        }
        
        // Allow processing
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Force GC every iteration
        if (iter % 2 === 0) {
          global.gc();
        }
      }

      // Final GC and memory check
      await new Promise(resolve => setTimeout(resolve, 500));
      global.gc();
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - baselineMemory;
      const memoryGrowthMB = memoryGrowth / 1024 / 1024;

      logger.info(`Memory usage test results:`, {
        baseline: `${(baselineMemory / 1024 / 1024).toFixed(2)}MB`,
        final: `${(finalMemory / 1024 / 1024).toFixed(2)}MB`,
        growth: `${memoryGrowthMB.toFixed(2)}MB`,
        messagesProcessed: iterations * messagesPerIteration
      });

      // Memory growth should be reasonable
      expect(memoryGrowthMB).toBeLessThan(50); // Less than 50MB growth

      await manager.stop();
    });
  });
});