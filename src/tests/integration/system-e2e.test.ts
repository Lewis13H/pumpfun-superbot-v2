/**
 * End-to-end integration tests for the complete system
 */

import { createContainer } from '../../core/container-factory';
import { BCMonitor } from '../../monitors/bc-monitor';
import { AMMMonitor } from '../../monitors/amm-monitor';
import { WebSocketServer } from '../../websocket/websocket-server';
import { createServer } from 'http';
import { EventBus, EVENTS } from '../../core/event-bus';
import { Container, TOKENS } from '../../core/container';
import { WebSocket } from 'ws';
import express from 'express';

// Mock blockchain stream
class MockBlockchainStream {
  private subscribers: ((data: any) => void)[] = [];
  private interval: NodeJS.Timeout | null = null;

  subscribe(callback: (data: any) => void) {
    this.subscribers.push(callback);
  }

  start() {
    let slot = 100000;
    this.interval = setInterval(() => {
      const mockData = this.generateMockTransaction(slot++);
      this.subscribers.forEach(cb => cb(mockData));
    }, 100); // 10 tx/second
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private generateMockTransaction(slot: number) {
    const isBc = Math.random() > 0.5;
    
    if (isBc) {
      return {
        transaction: {
          transaction: {
            transaction: {
              message: {
                accountKeys: [
                  Buffer.from('User' + slot),
                  Buffer.from('Token' + Math.floor(slot / 10)),
                  Buffer.from('BondingCurve')
                ]
              }
            },
            meta: {
              innerInstructions: [{
                instructions: [{
                  data: Buffer.alloc(225),
                  accounts: [0, 1, 2]
                }]
              }],
              logMessages: [
                'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
                `Program log: {"mint":"Token${Math.floor(slot / 10)}","solAmount":${1000000000 + slot},"tokenAmount":1000000,"virtualSolReserves":100000000000,"virtualTokenReserves":1000000000}`,
                'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
              ]
            }
          },
          slot
        }
      };
    } else {
      return {
        transaction: {
          transaction: {
            transaction: {
              message: {
                accountKeys: [
                  Buffer.from('User' + slot),
                  Buffer.from('Token' + Math.floor(slot / 20)),
                  Buffer.from('Pool' + Math.floor(slot / 20))
                ]
              }
            },
            meta: {
              innerInstructions: [{
                instructions: [{
                  data: Buffer.from(Math.random() > 0.5 ? 'buy' : 'sell'),
                  accounts: [0, 1, 2]
                }]
              }],
              logMessages: [
                'Program Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB invoke [1]',
                'Program log: Instruction: Swap',
                `Program log: {"mint":"Token${Math.floor(slot / 20)}","solAmount":${2000000000 + slot},"tokenAmount":2000000}`,
                'Program Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB success'
              ]
            }
          },
          slot
        }
      };
    }
  }
}

describe('System End-to-End Tests', () => {
  let container: Container;
  let eventBus: EventBus;
  let bcMonitor: BCMonitor;
  let ammMonitor: AMMMonitor;
  let httpServer: any;
  let wsServer: WebSocketServer;
  let mockStream: MockBlockchainStream;
  let app: express.Application;
  const port = 3457;

  beforeAll(async () => {
    // Mock environment
    process.env.DATABASE_URL = 'postgresql://test@localhost:5432/test';
    process.env.SHYFT_GRPC_ENDPOINT = 'https://test.grpc.endpoint';
    process.env.SHYFT_GRPC_TOKEN = 'test-token';
    process.env.BC_SAVE_THRESHOLD = '1000';
    process.env.AMM_SAVE_THRESHOLD = '500';

    // Create container with real services (mocked DB)
    container = await createContainer();
    eventBus = await container.resolve(TOKENS.EventBus);

    // Mock database repositories
    const mockTokenRepo = {
      findByMintAddress: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({}),
      batchSave: jest.fn().mockResolvedValue([]),
      updatePrice: jest.fn().mockResolvedValue({}),
      markGraduated: jest.fn().mockResolvedValue({}),
      findByFilter: jest.fn().mockResolvedValue([]),
      getStatistics: jest.fn().mockResolvedValue({
        total: 100,
        graduated: 20,
        aboveThreshold: 50
      })
    };

    const mockTradeRepo = {
      save: jest.fn().mockResolvedValue({}),
      batchSave: jest.fn().mockResolvedValue([]),
      getRecentTrades: jest.fn().mockResolvedValue([]),
      getTradesForToken: jest.fn().mockResolvedValue([]),
      getHighValueTrades: jest.fn().mockResolvedValue([]),
      getTopTraders: jest.fn().mockResolvedValue([]),
      getVolumeByPeriod: jest.fn().mockResolvedValue([])
    };

    // Override with mocks
    (container as any).services.set(TOKENS.TokenRepository.toString(), mockTokenRepo);
    (container as any).services.set(TOKENS.TradeRepository.toString(), mockTradeRepo);

    // Create Express app
    app = express();
    app.use(express.json());

    // Add API routes
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date() });
    });

    app.get('/api/tokens', async (_req, res) => {
      const tokenRepo = await container.resolve(TOKENS.TokenRepository);
      const tokens = await tokenRepo.findByFilter({});
      res.json(tokens);
    });

    app.get('/api/stats/overview', async (_req, res) => {
      const tokenRepo = await container.resolve(TOKENS.TokenRepository);
      const stats = await tokenRepo.getStatistics();
      res.json({ tokens: stats });
    });

    // Create HTTP server
    httpServer = createServer(app);

    // Create WebSocket server
    wsServer = new WebSocketServer(httpServer, eventBus, await container.resolve(TOKENS.ConfigService));
    wsServer.startPingInterval();

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(port, () => resolve());
    });

    // Create monitors
    bcMonitor = new BCMonitor(container);
    ammMonitor = new AMMMonitor(container);

    // Create mock blockchain stream
    mockStream = new MockBlockchainStream();

    // Connect monitors to mock stream
    mockStream.subscribe((data) => bcMonitor.processStreamData(data));
    mockStream.subscribe((data) => ammMonitor.processStreamData(data));
  });

  afterAll(async () => {
    // Stop mock stream
    mockStream.stop();

    // Shutdown services
    await wsServer.shutdown();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  describe('Complete System Flow', () => {
    it('should process blockchain data and emit events through WebSocket', async () => {
      const receivedEvents: any[] = [];
      
      // Connect WebSocket client
      const wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });

      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type !== 'connected') {
          receivedEvents.push(message);
        }
      });

      // Start mock blockchain stream
      mockStream.start();

      // Wait for some transactions to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Stop stream
      mockStream.stop();

      // Should have received various events
      const eventTypes = new Set(receivedEvents.map(e => e.type));
      expect(eventTypes.has(EVENTS.BC_TRADE)).toBe(true);
      expect(eventTypes.has(EVENTS.AMM_TRADE)).toBe(true);
      expect(receivedEvents.length).toBeGreaterThan(10);

      // Close client
      wsClient.close();
    });

    it('should expose REST API endpoints', async () => {
      // Test health endpoint
      const healthResponse = await fetch(`http://localhost:${port}/api/health`);
      const health = await healthResponse.json() as { status: string; timestamp: Date };
      expect(health.status).toBe('ok');

      // Test tokens endpoint
      const tokensResponse = await fetch(`http://localhost:${port}/api/tokens`);
      const tokens = await tokensResponse.json() as any[];
      expect(Array.isArray(tokens)).toBe(true);

      // Test stats endpoint
      const statsResponse = await fetch(`http://localhost:${port}/api/stats/overview`);
      const stats = await statsResponse.json() as { tokens: any };
      expect(stats.tokens).toBeDefined();
    });

    it('should handle monitor statistics updates', async () => {
      const statsEvents: any[] = [];
      
      // Subscribe to stats events
      eventBus.on(EVENTS.MONITOR_STATS_UPDATED, (data) => {
        statsEvents.push(data);
      });

      // Force stats update
      bcMonitor.displayStats();
      ammMonitor.displayStats();

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have stats events
      expect(statsEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Token Lifecycle Flow', () => {
    it('should track token from discovery to graduation', async () => {
      const tokenEvents: any[] = [];
      const mintAddress = 'LifecycleToken11111111111111111111111111';

      // Track all events for this token
      const trackTokenEvent = (eventName: string) => (data: any) => {
        if (data?.mintAddress === mintAddress || data?.trade?.mintAddress === mintAddress) {
          tokenEvents.push({ event: eventName, data });
        }
      };
      
      eventBus.on(EVENTS.BC_TRADE, trackTokenEvent(EVENTS.BC_TRADE));
      eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, trackTokenEvent(EVENTS.TOKEN_THRESHOLD_CROSSED));
      eventBus.on(EVENTS.TOKEN_GRADUATED, trackTokenEvent(EVENTS.TOKEN_GRADUATED));
      eventBus.on(EVENTS.AMM_TRADE, trackTokenEvent(EVENTS.AMM_TRADE));

      // 1. Discover token with BC trade
      const bcTrade = {
        transaction: {
          transaction: {
            transaction: {
              message: {
                accountKeys: [
                  Buffer.from('User1'),
                  Buffer.from(mintAddress),
                  Buffer.from('BondingCurve')
                ]
              }
            },
            meta: {
              innerInstructions: [{
                instructions: [{
                  data: Buffer.alloc(225),
                  accounts: [0, 1, 2]
                }]
              }],
              logMessages: [
                'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
                `Program log: {"mint":"${mintAddress}","solAmount":5000000000,"tokenAmount":1000000,"virtualSolReserves":100000000000,"virtualTokenReserves":1000000000}`,
                'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
              ]
            }
          },
          slot: 200000
        }
      };

      await bcMonitor.processStreamData(bcTrade);

      // 2. Token crosses threshold
      eventBus.emit(EVENTS.TOKEN_THRESHOLD_CROSSED, {
        mintAddress,
        threshold: 1000,
        marketCapUsd: 1500
      });

      // 3. Token graduates
      eventBus.emit(EVENTS.TOKEN_GRADUATED, {
        mintAddress,
        graduationSlot: 200100
      });

      // 4. AMM trade for graduated token
      const ammTrade = {
        transaction: {
          transaction: {
            transaction: {
              message: {
                accountKeys: [
                  Buffer.from('User2'),
                  Buffer.from(mintAddress),
                  Buffer.from('Pool1')
                ]
              }
            },
            meta: {
              innerInstructions: [{
                instructions: [{
                  data: Buffer.from('buy'),
                  accounts: [0, 1, 2]
                }]
              }],
              logMessages: [
                'Program Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB invoke [1]',
                'Program log: Instruction: Swap',
                `Program log: {"mint":"${mintAddress}","solAmount":10000000000,"tokenAmount":2000000}`,
                'Program Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB success'
              ]
            }
          },
          slot: 200200
        }
      };

      await ammMonitor.processStreamData(ammTrade);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify lifecycle events
      const eventSequence = tokenEvents.map(e => e.event);
      expect(eventSequence).toContain(EVENTS.BC_TRADE);
      expect(eventSequence).toContain(EVENTS.TOKEN_THRESHOLD_CROSSED);
      expect(eventSequence).toContain(EVENTS.TOKEN_GRADUATED);
      expect(eventSequence).toContain(EVENTS.AMM_TRADE);

      // Verify order
      const bcIndex = eventSequence.indexOf(EVENTS.BC_TRADE);
      const gradIndex = eventSequence.indexOf(EVENTS.TOKEN_GRADUATED);
      const ammIndex = eventSequence.indexOf(EVENTS.AMM_TRADE);
      expect(bcIndex).toBeLessThan(gradIndex);
      expect(gradIndex).toBeLessThan(ammIndex);
    });
  });

  describe('System Resilience', () => {
    it('should handle monitor errors without affecting other monitors', async () => {
      const errorEvents: any[] = [];
      
      eventBus.on(EVENTS.MONITOR_ERROR, (data) => {
        errorEvents.push(data);
      });

      // Send invalid data to BC monitor
      const invalidData = { invalid: true };
      await bcMonitor.processStreamData(invalidData);

      // AMM monitor should still work
      const validAmmData = mockStream['generateMockTransaction'](300000);
      await ammMonitor.processStreamData(validAmmData);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have error from BC monitor
      expect(errorEvents.some(e => e.monitor === 'Bonding Curve Monitor')).toBe(true);
    });

    it('should recover from WebSocket disconnections', async () => {
      const messages: any[] = [];
      
      // Connect client
      let wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });

      wsClient.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      // Disconnect
      wsClient.close();

      // Emit event while disconnected
      eventBus.emit(EVENTS.BC_TRADE, { trade: { signature: 'missed' } });

      // Reconnect
      wsClient = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        wsClient.on('open', () => resolve());
      });

      wsClient.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      // Emit new event
      eventBus.emit(EVENTS.BC_TRADE, { trade: { signature: 'received' } });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should receive new events after reconnection
      const receivedTrades = messages
        .filter(m => m.type === EVENTS.BC_TRADE)
        .map(m => m.payload.trade.signature);
      
      expect(receivedTrades).not.toContain('missed');
      expect(receivedTrades).toContain('received');

      wsClient.close();
    });
  });

  describe('Performance Under Load', () => {
    it('should maintain performance with high transaction volume', async () => {
      const startTime = Date.now();
      const transactionCount = 1000;
      const processedEvents: any[] = [];

      // Track processed events
      eventBus.on(EVENTS.BC_TRADE, () => { processedEvents.push('bc'); });
      eventBus.on(EVENTS.AMM_TRADE, () => { processedEvents.push('amm'); });

      // Generate many transactions rapidly
      const transactions = [];
      for (let i = 0; i < transactionCount; i++) {
        transactions.push(mockStream['generateMockTransaction'](400000 + i));
      }

      // Process all transactions
      await Promise.all([
        ...transactions.map(tx => bcMonitor.processStreamData(tx)),
        ...transactions.map(tx => ammMonitor.processStreamData(tx))
      ]);

      const duration = Date.now() - startTime;
      const txPerSecond = (transactionCount * 2) / (duration / 1000);

      // Should process at least 100 tx/second
      expect(txPerSecond).toBeGreaterThan(100);
      
      // Should have processed most transactions
      expect(processedEvents.length).toBeGreaterThan(transactionCount * 0.8);
    });

    it('should handle concurrent WebSocket connections efficiently', async () => {
      const clientCount = 20;
      const clients: WebSocket[] = [];
      const messageReceived = new Map<number, number>();

      // Connect many clients
      for (let i = 0; i < clientCount; i++) {
        const client = new WebSocket(`ws://localhost:${port}/ws`);
        clients.push(client);
        messageReceived.set(i, 0);

        await new Promise<void>((resolve) => {
          client.on('open', () => resolve());
        });

        client.on('message', () => {
          messageReceived.set(i, (messageReceived.get(i) || 0) + 1);
        });
      }

      // Broadcast many events
      for (let i = 0; i < 100; i++) {
        eventBus.emit(EVENTS.BC_TRADE, {
          trade: { signature: `broadcast${i}` },
          monitor: 'BC Monitor'
        });
      }

      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 1000));

      // All clients should receive messages
      const receivedCounts = Array.from(messageReceived.values());
      expect(receivedCounts.every(count => count > 50)).toBe(true);

      // Clean up
      clients.forEach(c => c.close());
    });
  });
});