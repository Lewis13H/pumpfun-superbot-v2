/**
 * Integration tests for monitor system
 */

import { BCMonitor } from '../../monitors/bc-monitor';
import { AMMMonitor } from '../../monitors/amm-monitor';
import { EventBus, EVENTS } from '../../core/event-bus';
import { Container, TOKENS } from '../../core/container';
import { UnifiedEventParser } from '../../parsers/unified-event-parser';
import { TradeHandler } from '../../handlers/trade-handler';
import { TokenRepository } from '../../repositories/token-repository';
import { TradeRepository } from '../../repositories/trade-repository';
import { ConfigService } from '../../core/config';

// Mock stream data for testing
const mockBCTradeData = {
  transaction: {
    transaction: {
      transaction: {
        message: {
          accountKeys: [
            Buffer.from('User11111111111111111111111111111111111111', 'base64'),
            Buffer.from('Token1111111111111111111111111111111111111', 'base64'),
            Buffer.from('BondingCurve111111111111111111111111111111', 'base64')
          ]
        }
      },
      meta: {
        innerInstructions: [{
          instructions: [{
            data: Buffer.alloc(225), // BC trade event
            accounts: [0, 1, 2]
          }]
        }],
        logMessages: [
          'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
          'Program log: {"mint":"Token1111111111111111111111111111111111111","solAmount":1000000000,"tokenAmount":1000000,"virtualSolReserves":100000000000,"virtualTokenReserves":1000000000}',
          'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
        ]
      }
    },
    slot: 123456789
  }
};

const mockAMMTradeData = {
  transaction: {
    transaction: {
      transaction: {
        message: {
          accountKeys: [
            Buffer.from('User22222222222222222222222222222222222222', 'base64'),
            Buffer.from('Token2222222222222222222222222222222222222', 'base64'),
            Buffer.from('Pool222222222222222222222222222222222222222', 'base64')
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
          'Program log: {"mint":"Token2222222222222222222222222222222222222","solAmount":2000000000,"tokenAmount":2000000}',
          'Program Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB success'
        ]
      }
    },
    slot: 987654321
  }
};

describe('Monitor System Integration', () => {
  let container: Container;
  let eventBus: EventBus;
  let bcMonitor: BCMonitor;
  let ammMonitor: AMMMonitor;
  let tradeHandler: TradeHandler;
  let tokenRepo: TokenRepository;
  let tradeRepo: TradeRepository;

  beforeEach(async () => {
    // Mock environment variables
    process.env.DATABASE_URL = 'postgresql://test@localhost:5432/test';
    process.env.SHYFT_GRPC_ENDPOINT = 'https://test.grpc.endpoint';
    process.env.SHYFT_GRPC_TOKEN = 'test-token';

    // Create container with mocked services
    container = new Container();
    
    // Register core services
    eventBus = new EventBus();
    container.registerSingleton(TOKENS.EventBus, async () => eventBus);
    container.registerSingleton(TOKENS.ConfigService, async () => new ConfigService());
    
    // Mock repositories
    tokenRepo = {
      findByMintAddress: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({}),
      batchSave: jest.fn().mockResolvedValue([]),
      updatePrice: jest.fn().mockResolvedValue({}),
      markGraduated: jest.fn().mockResolvedValue({})
    } as any;
    
    tradeRepo = {
      save: jest.fn().mockResolvedValue({}),
      batchSave: jest.fn().mockResolvedValue([]),
      getRecentTrades: jest.fn().mockResolvedValue([])
    } as any;
    
    container.registerSingleton(TOKENS.TokenRepository, async () => tokenRepo);
    container.registerSingleton(TOKENS.TradeRepository, async () => tradeRepo);
    
    // Register services
    container.registerSingleton(TOKENS.EventParser, async () => new UnifiedEventParser({}));
    container.registerSingleton(TOKENS.SolPriceService, async () => ({
      getPrice: jest.fn().mockResolvedValue(180)
    }));
    
    // Create trade handler with mocked services
    tradeHandler = new TradeHandler({
      tokenRepo,
      tradeRepo,
      priceCalculator: { getCurrentSolPrice: () => 180 } as any,
      eventBus,
      config: new ConfigService()
    });
    container.registerSingleton(TOKENS.TradeHandler, async () => tradeHandler);
    
    // Create monitors
    bcMonitor = new BCMonitor(container);
    ammMonitor = new AMMMonitor(container);
  });

  describe('BC Monitor Integration', () => {
    it('should process BC trade and emit events', async () => {
      const events: any[] = [];
      
      // Subscribe to events
      eventBus.on(EVENTS.BC_TRADE, (data) => { events.push({ type: 'bc_trade', data }); });
      eventBus.on(EVENTS.TOKEN_DISCOVERED, (data) => { events.push({ type: 'token_discovered', data }); });
      eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, (data) => { events.push({ type: 'threshold', data }); });
      
      // Process mock trade
      await bcMonitor.processStreamData(mockBCTradeData);
      
      // Should emit BC trade event
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('bc_trade');
      expect(events[0].data.monitor).toBe('Bonding Curve Monitor');
    });

    it('should track statistics correctly', async () => {
      // Process multiple trades
      for (let i = 0; i < 5; i++) {
        await bcMonitor.processStreamData(mockBCTradeData);
      }
      
      // Get stats through display (would need getter method in real implementation)
      const stats = (bcMonitor as any).bcStats;
      expect(stats.trades).toBe(5);
      expect(stats.uniqueTokens.size).toBe(1);
      expect(stats.uniqueUsers.size).toBe(1);
    });
  });

  describe('AMM Monitor Integration', () => {
    it('should process AMM trade and emit events', async () => {
      const events: any[] = [];
      
      // Subscribe to events
      eventBus.on(EVENTS.AMM_TRADE, (data) => { events.push({ type: 'amm_trade', data }); });
      eventBus.on(EVENTS.TOKEN_DISCOVERED, (data) => { events.push({ type: 'token_discovered', data }); });
      
      // Process mock trade
      await ammMonitor.processStreamData(mockAMMTradeData);
      
      // Should emit AMM trade event
      expect(events.length).toBeGreaterThan(0);
      const ammEvent = events.find(e => e.type === 'amm_trade');
      expect(ammEvent).toBeDefined();
      expect(ammEvent?.data.monitor).toBe('AMM Pool Monitor');
    });

    it('should detect large swaps', async () => {
      const warnSpy = jest.spyOn((ammMonitor as any).logger, 'warn');
      
      // Create large swap data
      const largeSwapData = {
        ...mockAMMTradeData,
        transaction: {
          ...mockAMMTradeData.transaction,
          transaction: {
            ...mockAMMTradeData.transaction.transaction,
            meta: {
              ...mockAMMTradeData.transaction.transaction.meta,
              logMessages: [
                ...mockAMMTradeData.transaction.transaction.meta.logMessages.slice(0, -2),
                'Program log: {"mint":"Token2222222222222222222222222222222222222","solAmount":100000000000,"tokenAmount":100000000}',
                mockAMMTradeData.transaction.transaction.meta.logMessages[3]
              ]
            }
          }
        }
      };
      
      await ammMonitor.processStreamData(largeSwapData);
      
      // Should log large swap warning
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Large AMM swap detected'),
        expect.any(Object)
      );
    });
  });

  describe('Cross-Monitor Integration', () => {
    it('should handle token graduation flow', async () => {
      const events: any[] = [];
      
      // Subscribe to all events
      const trackEvent = (eventName: string) => (data: any) => {
        events.push({ event: eventName, data });
      };
      
      eventBus.on(EVENTS.BC_TRADE, trackEvent(EVENTS.BC_TRADE));
      eventBus.on(EVENTS.TOKEN_GRADUATED, trackEvent(EVENTS.TOKEN_GRADUATED));
      eventBus.on(EVENTS.AMM_TRADE, trackEvent(EVENTS.AMM_TRADE));
      
      // 1. First discover token in BC
      await bcMonitor.processStreamData(mockBCTradeData);
      
      // 2. Emit graduation event (would come from BC Account Monitor)
      eventBus.emit(EVENTS.TOKEN_GRADUATED, {
        mintAddress: 'Token1111111111111111111111111111111111111',
        graduationSlot: 123456790
      });
      
      // 3. Process AMM trade for same token
      const ammTradeForGraduated = {
        ...mockAMMTradeData,
        transaction: {
          ...mockAMMTradeData.transaction,
          transaction: {
            ...mockAMMTradeData.transaction.transaction,
            meta: {
              ...mockAMMTradeData.transaction.transaction.meta,
              logMessages: [
                ...mockAMMTradeData.transaction.transaction.meta.logMessages.slice(0, -2),
                'Program log: {"mint":"Token1111111111111111111111111111111111111","solAmount":2000000000,"tokenAmount":2000000}',
                mockAMMTradeData.transaction.transaction.meta.logMessages[3]
              ]
            }
          }
        }
      };
      
      await ammMonitor.processStreamData(ammTradeForGraduated);
      
      // Should have BC trade, graduation, and AMM trade events
      const eventTypes = events.map(e => e.event);
      expect(eventTypes).toContain(EVENTS.BC_TRADE);
      expect(eventTypes).toContain(EVENTS.TOKEN_GRADUATED);
      expect(eventTypes).toContain(EVENTS.AMM_TRADE);
    });
  });

  describe('Error Recovery', () => {
    it('should handle parser errors gracefully', async () => {
      const invalidData = {
        transaction: {
          transaction: {
            transaction: {
              message: { accountKeys: [] }
            },
            meta: { innerInstructions: [], logMessages: [] }
          },
          slot: 123
        }
      };
      
      // Should not throw
      await expect(bcMonitor.processStreamData(invalidData)).resolves.not.toThrow();
      
      // Should increment error counter
      const stats = (bcMonitor as any).bcStats;
      expect(stats.parseErrors).toBeGreaterThan(0);
    });

    it('should handle database errors gracefully', async () => {
      // Make save throw error
      tokenRepo.save = jest.fn().mockRejectedValue(new Error('DB Error'));
      
      // Should not throw
      await expect(bcMonitor.processStreamData(mockBCTradeData)).resolves.not.toThrow();
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle high transaction volume', async () => {
      const startTime = Date.now();
      const iterations = 1000;
      
      // Process many transactions
      const promises = [];
      for (let i = 0; i < iterations; i++) {
        promises.push(bcMonitor.processStreamData(mockBCTradeData));
      }
      
      await Promise.all(promises);
      
      const duration = Date.now() - startTime;
      const txPerSecond = (iterations / duration) * 1000;
      
      // Should process at least 100 tx/second
      expect(txPerSecond).toBeGreaterThan(100);
    });

    it('should batch database operations efficiently', async () => {
      // Reset mock
      tokenRepo.batchSave = jest.fn().mockResolvedValue([]);
      
      // Process multiple trades quickly
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(bcMonitor.processStreamData(mockBCTradeData));
      }
      
      await Promise.all(promises);
      
      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should use batch operations
      expect(tokenRepo.batchSave).toHaveBeenCalled();
    });
  });

  describe('Configuration Integration', () => {
    it('should respect threshold configuration', async () => {
      // Set custom threshold
      process.env.BC_SAVE_THRESHOLD = '1000';
      
      // Create new monitor with updated config
      const customMonitor = new BCMonitor(container);
      
      // Process trade
      await customMonitor.processStreamData(mockBCTradeData);
      
      // Should check against custom threshold
      // (Implementation would need to expose config for testing)
    });

    it('should handle SAVE_ALL_TOKENS mode', async () => {
      process.env.SAVE_ALL_TOKENS = 'true';
      
      const customMonitor = new BCMonitor(container);
      await customMonitor.processStreamData(mockBCTradeData);
      
      // Should save token regardless of threshold
      expect(tokenRepo.save).toHaveBeenCalled();
    });
  });
});