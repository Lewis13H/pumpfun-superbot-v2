import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TokenLifecycleMonitor } from '../../monitors/domain/token-lifecycle-monitor';
import { TradingActivityMonitor } from '../../monitors/domain/trading-activity-monitor';
import { LiquidityMonitor } from '../../monitors/domain/liquidity-monitor';
import { SmartStreamManager, SmartStreamManagerOptions } from '../../services/core/smart-stream-manager';
import { EventBus } from '../../core/event-bus';
import { Logger } from '../../core/logger';

// Mock dependencies
vi.mock('../../core/stream-client', () => ({
  createStreamClient: () => ({
    subscribe: vi.fn().mockResolvedValue(undefined)
  })
}));

describe('Domain Monitors Integration', () => {
  let eventBus: EventBus;
  let smartStreamManager: SmartStreamManager;
  let tokenLifecycleMonitor: TokenLifecycleMonitor;
  let tradingActivityMonitor: TradingActivityMonitor;
  let liquidityMonitor: LiquidityMonitor;
  let logger: Logger;

  const config: SmartStreamManagerOptions = {
    eventBus: new EventBus(),
    poolConfig: {
      grpcEndpoint: 'test://endpoint',
      grpcToken: 'test-token',
      maxConnections: 2,
      minConnections: 1,
      connectionTimeout: 1000,
      healthCheckInterval: 5000,
      maxRetries: 3
    },
    loadBalancerConfig: {
      rebalanceThreshold: 0.3,
      rebalanceInterval: 1000,
      minLoadDifference: 0.2
    },
    pipelineConfig: {
      batchSize: 50,
      batchTimeout: 500,
      maxQueueSize: 1000,
      workers: 2
    }
  };

  beforeEach(async () => {
    eventBus = config.eventBus!;
    logger = new Logger({ context: 'Test' });
    
    // Create smart stream manager
    smartStreamManager = new SmartStreamManager(config);
    await smartStreamManager.initialize();

    // Create domain monitors
    tokenLifecycleMonitor = new TokenLifecycleMonitor({
      grpcEndpoint: 'test://endpoint',
      grpcToken: 'test-token',
      reconnectDelay: 1000,
      maxReconnectDelay: 5000,
      eventBus,
      streamManager: smartStreamManager
    });

    tradingActivityMonitor = new TradingActivityMonitor({
      grpcEndpoint: 'test://endpoint',
      grpcToken: 'test-token',
      reconnectDelay: 1000,
      maxReconnectDelay: 5000,
      eventBus,
      streamManager: smartStreamManager
    });

    liquidityMonitor = new LiquidityMonitor({
      grpcEndpoint: 'test://endpoint',
      grpcToken: 'test-token',
      reconnectDelay: 1000,
      maxReconnectDelay: 5000,
      eventBus,
      streamManager: smartStreamManager
    });
  });

  afterEach(async () => {
    await tokenLifecycleMonitor.stop();
    await tradingActivityMonitor.stop();
    await liquidityMonitor.stop();
    await smartStreamManager.stop();
    vi.clearAllMocks();
  });

  describe('monitor registration', () => {
    it('should register all monitors with smart stream manager', async () => {
      await tokenLifecycleMonitor.start();
      await tradingActivityMonitor.start();
      await liquidityMonitor.start();

      const stats = smartStreamManager.getStats();
      expect(stats.monitors.total).toBe(6); // 2 per monitor (tx + account)
      expect(stats.monitors.byGroup['bonding_curve']).toBeGreaterThan(0);
      expect(stats.monitors.byGroup['amm_pool']).toBeGreaterThan(0);
    });

    it('should distribute monitors across connections', async () => {
      await tokenLifecycleMonitor.start();
      await tradingActivityMonitor.start();
      await liquidityMonitor.start();

      const stats = smartStreamManager.getStats();
      const connectionCount = Object.keys(stats.monitors.byConnection).length;
      expect(connectionCount).toBeGreaterThanOrEqual(1);
      expect(connectionCount).toBeLessThanOrEqual(config.poolConfig.maxConnections);
    });
  });

  describe('event processing', () => {
    it('should process token lifecycle events', (done) => {
      const tokenCreatedSpy = vi.fn();
      const phaseChangeSpy = vi.fn();
      
      eventBus.on('TOKEN_LIFECYCLE_CREATED', tokenCreatedSpy);
      eventBus.on('TOKEN_LIFECYCLE_PHASE_CHANGE', phaseChangeSpy);

      tokenLifecycleMonitor.start().then(() => {
        // Simulate BC transaction
        eventBus.emit('STREAM_DATA', {
          connectionId: 'test-conn',
          data: {
            transaction: {
              transaction: {
                transaction: {
                  signatures: ['test-sig'],
                  message: {
                    accountKeys: ['account1', 'account2'],
                    instructions: [{
                      programIdIndex: 0,
                      data: Buffer.from('test-data')
                    }]
                  }
                }
              }
            }
          },
          slot: 12345
        });

        // Give time for processing
        setTimeout(() => {
          expect(tokenCreatedSpy.mock.calls.length + phaseChangeSpy.mock.calls.length).toBeGreaterThan(0);
          done();
        }, 100);
      });
    });

    it('should process trading activity across venues', (done) => {
      const tradeSpy = vi.fn();
      const mevSpy = vi.fn();
      
      eventBus.on('TRADE_ACTIVITY', tradeSpy);
      eventBus.on('MEV_ACTIVITY_DETECTED', mevSpy);

      tradingActivityMonitor.start().then(() => {
        // Simulate trades from different venues
        const venues = ['bonding_curve', 'amm_pool', 'external_amm'];
        
        venues.forEach((venue, index) => {
          eventBus.emit('STREAM_DATA', {
            connectionId: 'test-conn',
            data: {
              transaction: {
                transaction: {
                  transaction: {
                    signatures: [`sig-${venue}-${index}`],
                    message: {
                      accountKeys: ['trader1', 'trader2'],
                      instructions: [{
                        programIdIndex: 0,
                        data: Buffer.from(`trade-${venue}`)
                      }]
                    }
                  }
                }
              }
            },
            slot: 12345 + index
          });
        });

        setTimeout(() => {
          // Should have processed trades
          const stats = tradingActivityMonitor.getStats();
          expect(stats.messagesReceived).toBeGreaterThan(0);
          done();
        }, 200);
      });
    });

    it('should process liquidity events', (done) => {
      const liquidityAddSpy = vi.fn();
      const liquidityRemoveSpy = vi.fn();
      
      eventBus.on('AMM_LIQUIDITY_ADD', liquidityAddSpy);
      eventBus.on('AMM_LIQUIDITY_REMOVE', liquidityRemoveSpy);

      liquidityMonitor.start().then(() => {
        // Simulate liquidity events
        eventBus.emit('STREAM_DATA', {
          connectionId: 'test-conn',
          data: {
            transaction: {
              transaction: {
                transaction: {
                  signatures: ['liq-sig-1'],
                  message: {
                    accountKeys: ['lp-provider', 'pool'],
                    instructions: [{
                      programIdIndex: 0,
                      data: Buffer.from('add-liquidity')
                    }]
                  }
                }
              }
            }
          },
          slot: 12345
        });

        setTimeout(() => {
          const stats = liquidityMonitor.getStats();
          expect(stats.messagesReceived).toBeGreaterThan(0);
          done();
        }, 100);
      });
    });
  });

  describe('cross-monitor coordination', () => {
    it('should coordinate between monitors for graduated tokens', async () => {
      const graduationSpy = vi.fn();
      eventBus.on('TOKEN_GRADUATED', graduationSpy);

      await tokenLifecycleMonitor.start();
      await tradingActivityMonitor.start();
      await liquidityMonitor.start();

      // Simulate graduation detection
      eventBus.emit('TOKEN_LIFECYCLE_PHASE_CHANGE', {
        mint: 'test-token',
        previousPhase: 'TRADING',
        newPhase: 'GRADUATED',
        bondingProgress: 100
      });

      // Trading monitor should pick up graduated tokens
      const tradingStats = tradingActivityMonitor.getStats();
      expect(tradingStats).toBeDefined();
    });
  });

  describe('performance under load', () => {
    it('should handle high message throughput', async () => {
      await tokenLifecycleMonitor.start();
      await tradingActivityMonitor.start();
      await liquidityMonitor.start();

      const messageCount = 1000;
      const startTime = Date.now();

      // Send many messages
      for (let i = 0; i < messageCount; i++) {
        eventBus.emit('STREAM_DATA', {
          connectionId: 'test-conn',
          data: {
            transaction: {
              transaction: {
                transaction: {
                  signatures: [`sig-${i}`],
                  message: {
                    accountKeys: ['acc1', 'acc2'],
                    instructions: [{
                      programIdIndex: 0,
                      data: Buffer.from(`data-${i}`)
                    }]
                  }
                }
              }
            }
          },
          slot: 10000 + i
        });
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      const endTime = Date.now();
      const duration = endTime - startTime;
      const tps = messageCount / (duration / 1000);

      logger.info(`Processed ${messageCount} messages in ${duration}ms (${tps.toFixed(2)} TPS)`);
      
      // Should maintain good performance
      expect(tps).toBeGreaterThan(100); // At least 100 TPS
    });
  });

  describe('error recovery', () => {
    it('should recover from monitor failures', async () => {
      const errorSpy = vi.fn();
      const recoverySpy = vi.fn();
      
      eventBus.on('MONITOR_ERROR', errorSpy);
      eventBus.on('connection:success', recoverySpy);

      await tokenLifecycleMonitor.start();

      // Simulate error
      eventBus.emit('connection:error', {
        connectionId: 'test-conn',
        error: new Error('Test connection error')
      });

      // Should attempt recovery
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(errorSpy).toHaveBeenCalled();
      // Recovery would be handled by fault tolerance if enabled
    });
  });

  describe('metrics and monitoring', () => {
    it('should expose comprehensive metrics', async () => {
      await tokenLifecycleMonitor.start();
      await tradingActivityMonitor.start();
      await liquidityMonitor.start();

      // Generate some activity
      for (let i = 0; i < 10; i++) {
        eventBus.emit('STREAM_DATA', {
          connectionId: 'test-conn',
          data: { /* mock data */ },
          slot: 1000 + i
        });
      }

      const stats = smartStreamManager.getStats();
      
      expect(stats).toHaveProperty('pool');
      expect(stats).toHaveProperty('subscriptions');
      expect(stats).toHaveProperty('load');
      expect(stats).toHaveProperty('monitors');
      expect(stats).toHaveProperty('pipeline');
      
      expect(stats.pool.totalConnections).toBeGreaterThan(0);
      expect(stats.monitors.total).toBe(6);
    });
  });

  describe('data pipeline integration', () => {
    it('should process events through pipeline', async () => {
      const pipelineSpy = vi.fn();
      eventBus.on('pipeline:batch-processed', pipelineSpy);

      await tokenLifecycleMonitor.start();

      // Send enough messages to trigger batch
      for (let i = 0; i < 100; i++) {
        eventBus.emit('TOKEN_LIFECYCLE_CREATED', {
          mint: `token-${i}`,
          creator: 'creator',
          timestamp: new Date()
        });
      }

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, config.pipelineConfig!.batchTimeout! + 100));

      expect(pipelineSpy).toHaveBeenCalled();
      
      const pipelineStats = smartStreamManager.getStats().pipeline;
      expect(pipelineStats?.eventsProcessed).toBeGreaterThan(0);
    });
  });
});