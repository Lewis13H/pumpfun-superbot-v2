/**
 * Example End-to-End Test: Full System Test
 * Tests the complete system with real-like data and all components
 */

import { Container } from '../../../src/core/container-factory';
import { startRefactoredMonitors } from '../../../src/start-refactored-monitors';
import { WebSocketServer } from '../../../src/websocket/websocket-server';
import { createTestClient, TestClient } from '../../helpers/test-client';
import { MockStreamClient } from '../../helpers/mock-stream-client';
import { TestDatabase } from '../../helpers/test-db';
import { generateE2EScenario } from '../../fixtures/e2e-scenarios';
import { MetricsCollector } from '../../helpers/metrics-collector';

describe('Full System E2E Tests', () => {
  let container: Container;
  let wsServer: WebSocketServer;
  let testClient: TestClient;
  let mockStream: MockStreamClient;
  let testDb: TestDatabase;
  let metrics: MetricsCollector;
  let systemProcess: any;

  beforeAll(async () => {
    // Setup test environment with mock stream
    process.env.NODE_ENV = 'test';
    process.env.USE_MOCK_STREAM = 'true';
    process.env.DATABASE_URL = 'postgresql://test@localhost:5432/pump_monitor_e2e_test';
    
    // Initialize test database
    testDb = new TestDatabase();
    await testDb.setup();

    // Create mock stream client
    mockStream = new MockStreamClient();
    await mockStream.start();

    // Start the system
    systemProcess = await startRefactoredMonitors();
    container = systemProcess.container;

    // Start WebSocket server
    wsServer = new WebSocketServer(3002);
    await wsServer.start();

    // Create test client
    testClient = await createTestClient('ws://localhost:3002');

    // Initialize metrics collector
    metrics = new MetricsCollector(container);
  }, 30000); // 30 second timeout for system startup

  afterAll(async () => {
    await testClient.disconnect();
    await wsServer.stop();
    await systemProcess.stop();
    await mockStream.stop();
    await testDb.teardown();
  });

  describe('System Startup and Health', () => {
    it('should start all monitors successfully', async () => {
      const health = await testClient.getHealth();
      
      expect(health).toMatchObject({
        status: 'healthy',
        monitors: {
          bc: 'running',
          bc_account: 'running',
          amm: 'running',
          amm_account: 'running'
        },
        services: {
          database: 'connected',
          stream: 'connected',
          websocket: 'running'
        }
      });
    });

    it('should handle initial connection and subscriptions', async () => {
      const subscriptions = await mockStream.getActiveSubscriptions();
      
      expect(subscriptions).toContainEqual(
        expect.objectContaining({
          type: 'transaction',
          program: expect.stringContaining('pump')
        })
      );
      
      expect(subscriptions).toContainEqual(
        expect.objectContaining({
          type: 'account',
          program: expect.stringContaining('pump')
        })
      );
    });
  });

  describe('Real-Time Token Monitoring', () => {
    it('should monitor complete token lifecycle in real-time', async () => {
      const scenario = generateE2EScenario('token_lifecycle');
      const { mintAddress, transactions } = scenario;

      // Subscribe to WebSocket updates
      const updates: any[] = [];
      await testClient.subscribe('token_updates', (data) => {
        if (data.mintAddress === mintAddress) {
          updates.push(data);
        }
      });

      // Feed transactions to mock stream
      for (const tx of transactions) {
        await mockStream.sendTransaction(tx);
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate real-time delay
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify we received all expected updates
      expect(updates.length).toBeGreaterThan(0);
      
      // Verify token progression
      const tokenStates = updates.filter(u => u.type === 'token_state');
      const lastState = tokenStates[tokenStates.length - 1];
      
      expect(lastState).toMatchObject({
        mintAddress,
        graduated: true,
        marketCap: expect.any(Number)
      });

      // Verify database state
      const dbToken = await testDb.query(
        'SELECT * FROM tokens_unified WHERE mint_address = $1',
        [mintAddress]
      );
      
      expect(dbToken.rows[0]).toMatchObject({
        mint_address: mintAddress,
        graduated_to_amm: true,
        threshold_crossed_at: expect.any(Date)
      });
    });

    it('should handle high-frequency trading accurately', async () => {
      const scenario = generateE2EScenario('high_frequency_trading', {
        tradingPairs: 5,
        tradesPerPair: 100,
        timeWindow: 10000 // 10 seconds
      });

      const startTime = Date.now();
      let processedTrades = 0;

      // Monitor trade processing
      await testClient.subscribe('trades', (trade) => {
        processedTrades++;
      });

      // Send all trades concurrently
      const promises = scenario.transactions.map(tx => 
        mockStream.sendTransaction(tx)
      );
      await Promise.all(promises);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 5000));

      const processingTime = Date.now() - startTime;
      const tps = processedTrades / (processingTime / 1000);

      // System should handle at least 100 TPS
      expect(tps).toBeGreaterThan(100);
      
      // Verify accuracy
      const dbTrades = await testDb.query(
        'SELECT COUNT(*) as count FROM trades_unified WHERE block_time > NOW() - INTERVAL \'1 minute\''
      );
      
      expect(dbTrades.rows[0].count).toBe(scenario.transactions.length);
    });
  });

  describe('Failure Scenarios and Recovery', () => {
    it('should recover from stream disconnection', async () => {
      const scenario = generateE2EScenario('simple_trades');
      
      // Send some trades
      for (let i = 0; i < 5; i++) {
        await mockStream.sendTransaction(scenario.transactions[i]);
      }

      // Disconnect stream
      await mockStream.disconnect();
      
      // Wait for reconnection
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify system detected disconnection
      const health = await testClient.getHealth();
      expect(health.services.stream).toBe('reconnecting');

      // Reconnect stream
      await mockStream.reconnect();
      
      // Send more trades
      for (let i = 5; i < 10; i++) {
        await mockStream.sendTransaction(scenario.transactions[i]);
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify all trades were processed
      const trades = await testDb.query(
        'SELECT COUNT(*) as count FROM trades_unified WHERE signature = ANY($1)',
        [scenario.transactions.map(tx => tx.signature)]
      );
      
      expect(trades.rows[0].count).toBe(10);
    });

    it('should handle database connection issues', async () => {
      const scenario = generateE2EScenario('simple_trades');
      
      // Temporarily break database connection
      await testDb.simulateConnectionError(5000); // 5 second outage

      // Send trades during outage
      for (const tx of scenario.transactions.slice(0, 5)) {
        await mockStream.sendTransaction(tx);
      }

      // Wait for database recovery
      await new Promise(resolve => setTimeout(resolve, 6000));

      // Send more trades after recovery
      for (const tx of scenario.transactions.slice(5, 10)) {
        await mockStream.sendTransaction(tx);
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify system recovered and processed all trades
      const trades = await testDb.query(
        'SELECT COUNT(*) as count FROM trades_unified WHERE signature = ANY($1)',
        [scenario.transactions.map(tx => tx.signature)]
      );
      
      // Should have processed trades after recovery
      expect(trades.rows[0].count).toBeGreaterThanOrEqual(5);
    });

    it('should detect and handle MEV attacks', async () => {
      const scenario = generateE2EScenario('mev_attack', {
        attackType: 'sandwich',
        victimTrade: '10_sol'
      });

      let mevDetected = false;
      await testClient.subscribe('mev_alerts', () => {
        mevDetected = true;
      });

      // Send MEV attack sequence
      for (const tx of scenario.transactions) {
        await mockStream.sendTransaction(tx);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Wait for detection
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(mevDetected).toBe(true);

      // Verify MEV event in database
      const mevEvents = await testDb.query(
        'SELECT * FROM mev_events WHERE victim_tx = $1',
        [scenario.victimTx]
      );
      
      expect(mevEvents.rows.length).toBe(1);
      expect(mevEvents.rows[0]).toMatchObject({
        mev_type: 'sandwich',
        confidence: expect.stringMatching(/high|medium/)
      });
    });
  });

  describe('Performance and Resource Usage', () => {
    it('should maintain acceptable resource usage under load', async () => {
      const initialMetrics = await metrics.snapshot();
      
      // Generate load
      const scenario = generateE2EScenario('load_test', {
        duration: 30000, // 30 seconds
        targetTps: 200
      });

      const loadStartTime = Date.now();
      let sentCount = 0;

      // Send transactions at target TPS
      const interval = setInterval(async () => {
        if (sentCount < scenario.transactions.length) {
          await mockStream.sendTransaction(scenario.transactions[sentCount]);
          sentCount++;
        }
      }, 1000 / 200); // 200 TPS

      // Run for 30 seconds
      await new Promise(resolve => setTimeout(resolve, 30000));
      clearInterval(interval);

      const finalMetrics = await metrics.snapshot();

      // Verify performance constraints
      expect(finalMetrics.memory.heapUsed - initialMetrics.memory.heapUsed)
        .toBeLessThan(500 * 1024 * 1024); // Less than 500MB increase

      expect(finalMetrics.cpu.usage).toBeLessThan(80); // Less than 80% CPU

      expect(finalMetrics.eventLoop.lag).toBeLessThan(100); // Less than 100ms lag

      // Verify processing accuracy
      const processedCount = await testDb.query(
        'SELECT COUNT(*) as count FROM trades_unified WHERE block_time > $1',
        [new Date(loadStartTime)]
      );
      
      const accuracy = processedCount.rows[0].count / sentCount;
      expect(accuracy).toBeGreaterThan(0.98); // 98% accuracy
    });

    it('should handle memory pressure gracefully', async () => {
      // Generate scenario with large metadata
      const scenario = generateE2EScenario('memory_pressure', {
        tokenCount: 1000,
        metadataSize: 'large'
      });

      // Monitor memory usage
      const memorySnapshots: number[] = [];
      const memoryMonitor = setInterval(async () => {
        const usage = process.memoryUsage();
        memorySnapshots.push(usage.heapUsed);
      }, 1000);

      // Process all tokens
      for (const tx of scenario.transactions) {
        await mockStream.sendTransaction(tx);
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10000));
      clearInterval(memoryMonitor);

      // Verify no memory leak
      const avgMemory = memorySnapshots.reduce((a, b) => a + b) / memorySnapshots.length;
      const maxMemory = Math.max(...memorySnapshots);
      
      expect(maxMemory / avgMemory).toBeLessThan(1.5); // Max is less than 150% of average
    });
  });

  describe('API and WebSocket Integration', () => {
    it('should provide real-time updates via WebSocket', async () => {
      const updates: any[] = [];
      let subscriptionId: string;

      // Subscribe to all updates
      subscriptionId = await testClient.subscribe('all', (data) => {
        updates.push(data);
      });

      // Generate activity
      const scenario = generateE2EScenario('mixed_activity');
      for (const tx of scenario.transactions.slice(0, 10)) {
        await mockStream.sendTransaction(tx);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for updates
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify updates received
      expect(updates.length).toBeGreaterThan(0);
      
      // Verify update types
      const updateTypes = new Set(updates.map(u => u.type));
      expect(updateTypes).toContain('trade');
      expect(updateTypes).toContain('token_update');

      // Unsubscribe
      await testClient.unsubscribe(subscriptionId);
    });

    it('should handle concurrent API requests', async () => {
      // Make multiple concurrent API requests
      const requests = Array(50).fill(null).map((_, i) => 
        fetch(`http://localhost:3001/api/v1/tokens?page=${i}`)
          .then(res => res.json())
      );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;

      // All requests should succeed
      expect(responses.every(r => r.success)).toBe(true);
      
      // Should complete within reasonable time
      expect(duration).toBeLessThan(5000); // 5 seconds for 50 requests
    });
  });

  describe('System Metrics and Monitoring', () => {
    it('should track comprehensive system metrics', async () => {
      const metricsResponse = await fetch('http://localhost:3001/api/v1/metrics/current');
      const metrics = await metricsResponse.json();

      expect(metrics.data).toMatchObject({
        metrics: {
          parseLatency: expect.any(Array),
          streamLag: expect.any(Number),
          missedTransactions: expect.any(Number),
          memoryUsage: expect.objectContaining({
            heapUsed: expect.any(Number),
            heapTotal: expect.any(Number)
          }),
          cpuUsage: expect.any(Number)
        },
        healthScore: expect.any(Number)
      });

      expect(metrics.data.healthScore).toBeGreaterThan(70); // Healthy system
    });

    it('should generate performance alerts when thresholds exceeded', async () => {
      let alertReceived = false;
      
      await testClient.subscribe('alerts', (alert) => {
        if (alert.type === 'performance') {
          alertReceived = true;
        }
      });

      // Generate high load to trigger alert
      const scenario = generateE2EScenario('burst_load', {
        burstSize: 1000,
        burstDuration: 1000 // 1 second
      });

      // Send burst
      await Promise.all(
        scenario.transactions.map(tx => mockStream.sendTransaction(tx))
      );

      // Wait for alert
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Should have received performance alert
      expect(alertReceived).toBe(true);
    });
  });
});