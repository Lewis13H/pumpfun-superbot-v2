/**
 * Integration tests for EventBus
 */

import { EventBus, EVENTS } from '../../core/event-bus';

describe('EventBus Integration Tests', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('Event Subscription and Emission', () => {
    it('should handle single event subscription', (done) => {
      const testData = { message: 'Hello World' };

      eventBus.on('test:event', (data) => {
        expect(data).toEqual(testData);
        done();
      });

      eventBus.emit('test:event', testData);
    });

    it('should handle multiple subscribers for same event', () => {
      const results: number[] = [];

      eventBus.on('test:event', () => results.push(1));
      eventBus.on('test:event', () => results.push(2));
      eventBus.on('test:event', () => results.push(3));

      eventBus.emit('test:event', {});

      expect(results).toEqual([1, 2, 3]);
    });

    it('should handle unsubscribe', () => {
      let callCount = 0;
      
      const handler = () => {
        callCount++;
      };

      const unsubscribe = eventBus.on('test:event', handler);
      
      eventBus.emit('test:event', {});
      expect(callCount).toBe(1);

      // Unsubscribe
      unsubscribe();

      // Should not be called again
      eventBus.emit('test:event', {});
      expect(callCount).toBe(1);
    });

    it('should handle wildcard subscriptions', () => {
      const events: string[] = [];

      eventBus.on('*', (data, eventName) => {
        events.push(eventName!);
      });

      eventBus.emit('event1', {});
      eventBus.emit('event2', {});
      eventBus.emit('event3', {});

      expect(events).toEqual(['event1', 'event2', 'event3']);
    });
  });

  describe('Trading Events Integration', () => {
    it('should handle BC trade events', (done) => {
      const tradeData = {
        signature: 'abc123',
        mint: 'So11111111111111111111111111111111111111112',
        type: 'buy' as const,
        userAddress: 'User11111111111111111111111111111111111111',
        solAmount: 1000000000n,
        tokenAmount: 1000000n,
        virtualSolReserves: 100000000000n,
        virtualTokenReserves: 1000000000n,
        slot: 123456789,
        timestamp: new Date()
      };

      eventBus.on(EVENTS.BC_TRADE, (data) => {
        expect(data.trade).toEqual(tradeData);
        expect(data.monitor).toBe('BC Monitor');
        done();
      });

      eventBus.emit(EVENTS.BC_TRADE, {
        trade: tradeData,
        monitor: 'BC Monitor'
      });
    });

    it('should handle AMM trade events', (done) => {
      const tradeData = {
        signature: 'xyz789',
        mint: 'Token1111111111111111111111111111111111111',
        type: 'sell' as const,
        userAddress: 'User22222222222222222222222222222222222222',
        solAmount: 2000000000n,
        tokenAmount: 2000000n,
        poolAddress: 'Pool11111111111111111111111111111111111111',
        slot: 987654321,
        timestamp: new Date()
      };

      eventBus.on(EVENTS.AMM_TRADE, (data) => {
        expect(data.trade).toEqual(tradeData);
        expect(data.monitor).toBe('AMM Monitor');
        done();
      });

      eventBus.emit(EVENTS.AMM_TRADE, {
        trade: tradeData,
        monitor: 'AMM Monitor'
      });
    });
  });

  describe('Token Events Integration', () => {
    it('should handle token discovery chain', () => {
      const events: string[] = [];
      
      eventBus.on(EVENTS.TOKEN_DISCOVERED, () => events.push('discovered'));
      eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, () => events.push('threshold'));
      eventBus.on(EVENTS.TOKEN_GRADUATED, () => events.push('graduated'));

      // Simulate token lifecycle
      eventBus.emit(EVENTS.TOKEN_DISCOVERED, {
        mintAddress: 'NewToken111111111111111111111111111111111',
        firstPriceUsd: 0.001,
        currentMarketCapUsd: 5000
      });

      eventBus.emit(EVENTS.TOKEN_THRESHOLD_CROSSED, {
        mintAddress: 'NewToken111111111111111111111111111111111',
        threshold: 8888,
        marketCapUsd: 10000
      });

      eventBus.emit(EVENTS.TOKEN_GRADUATED, {
        mintAddress: 'NewToken111111111111111111111111111111111',
        graduationSlot: 123456789
      });

      expect(events).toEqual(['discovered', 'threshold', 'graduated']);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in event handlers', () => {
      const console_error = console.error;
      console.error = jest.fn();

      eventBus.on('error:event', () => {
        throw new Error('Handler error');
      });

      // Should not throw, but log error
      expect(() => eventBus.emit('error:event', {})).not.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error in event handler'),
        expect.any(Error)
      );

      console.error = console_error;
    });

    it('should continue calling other handlers after error', () => {
      const results: number[] = [];

      eventBus.on('test:event', () => results.push(1));
      eventBus.on('test:event', () => { throw new Error('Fail'); });
      eventBus.on('test:event', () => results.push(3));

      eventBus.emit('test:event', {});

      expect(results).toEqual([1, 3]);
    });
  });

  describe('Performance', () => {
    it('should handle high-frequency events', () => {
      let eventCount = 0;

      eventBus.on(EVENTS.BC_TRADE, () => {
        eventCount++;
      });

      const startTime = Date.now();
      
      // Emit 10,000 events
      for (let i = 0; i < 10000; i++) {
        eventBus.emit(EVENTS.BC_TRADE, {
          trade: { signature: `sig${i}` },
          monitor: 'BC Monitor'
        });
      }

      const duration = Date.now() - startTime;
      
      expect(eventCount).toBe(10000);
      expect(duration).toBeLessThan(100); // Should process 10k events in < 100ms
    });

    it('should handle many subscribers efficiently', () => {
      let totalCalls = 0;

      // Add 100 subscribers
      for (let i = 0; i < 100; i++) {
        eventBus.on('test:event', () => {
          totalCalls++;
        });
      }

      const startTime = Date.now();
      
      // Emit 100 events
      for (let i = 0; i < 100; i++) {
        eventBus.emit('test:event', { index: i });
      }

      const duration = Date.now() - startTime;
      
      expect(totalCalls).toBe(10000); // 100 subscribers * 100 events
      expect(duration).toBeLessThan(50); // Should be very fast
    });
  });

  describe('Memory Management', () => {
    it('should properly clean up unsubscribed handlers', () => {
      const unsubscribes: (() => void)[] = [];

      // Subscribe 1000 handlers
      for (let i = 0; i < 1000; i++) {
        const unsub = eventBus.on('test:event', () => {});
        unsubscribes.push(unsub);
      }

      // Get initial handler count
      const getHandlerCount = () => {
        let count = 0;
        (eventBus as any).events.forEach((handlers: Set<any>) => {
          count += handlers.size;
        });
        return count;
      };

      expect(getHandlerCount()).toBe(1000);

      // Unsubscribe all
      unsubscribes.forEach(unsub => unsub());

      expect(getHandlerCount()).toBe(0);
    });
  });
});