/**
 * Example Unit Test: Unified Event Parser
 * Demonstrates comprehensive testing approach for the parser
 */

import { UnifiedEventParser } from '../../src/parsers/unified-event-parser';
import { EventBus } from '../../src/core/event-bus';
import { Container } from '../../src/core/container';
import { createTestContainer } from '../helpers/test-container';
import { mockTransactions } from '../fixtures/mock-transactions';
import { Logger } from '../../src/core/logger';

// Mock logger to suppress output in tests
jest.mock('../../src/core/logger');

describe('UnifiedEventParser', () => {
  let parser: UnifiedEventParser;
  let container: Container;
  let eventBus: EventBus;
  let emittedEvents: Array<{event: string; data: any}>;

  beforeEach(() => {
    // Setup test container with mocks
    container = createTestContainer();
    eventBus = container.resolve('EventBus') as EventBus;
    
    // Track emitted events
    emittedEvents = [];
    eventBus.on('*', (event: string, data: any) => {
      emittedEvents.push({ event, data });
    });

    // Create parser instance
    parser = new UnifiedEventParser(container);
  });

  afterEach(() => {
    emittedEvents = [];
    jest.clearAllMocks();
  });

  describe('BC Trade Parsing', () => {
    describe('Buy Transactions', () => {
      it('should parse a valid BC buy transaction', async () => {
        const tx = mockTransactions.bcBuy;
        const result = await parser.parseTransaction(tx);

        expect(result).toMatchObject({
          signature: tx.signature,
          program: 'pump.fun',
          tradeType: 'buy',
          mintAddress: expect.any(String),
          userAddress: expect.any(String),
          solAmount: expect.any(BigInt),
          tokenAmount: expect.any(BigInt),
          virtualSolReserves: expect.any(BigInt),
          virtualTokenReserves: expect.any(BigInt),
          price: expect.any(Number),
          slot: expect.any(BigInt)
        });

        // Verify price calculation
        expect(result.price).toBeGreaterThan(0);
        expect(result.price).toBeLessThan(1); // Reasonable price range
      });

      it('should extract bonding curve key from buy transaction', async () => {
        const tx = mockTransactions.bcBuyWithCurveKey;
        const result = await parser.parseTransaction(tx);

        expect(result.bondingCurveKey).toBeDefined();
        expect(result.bondingCurveKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      });

      it('should calculate bonding curve progress', async () => {
        const tx = mockTransactions.bcBuyNearGraduation;
        const result = await parser.parseTransaction(tx);

        expect(result.bondingCurveProgress).toBeDefined();
        expect(result.bondingCurveProgress).toBeGreaterThan(0);
        expect(result.bondingCurveProgress).toBeLessThanOrEqual(100);
      });

      it('should handle missing virtual reserves gracefully', async () => {
        const tx = mockTransactions.bcBuyNoReserves;
        const result = await parser.parseTransaction(tx);

        expect(result).toBeDefined();
        expect(result.virtualSolReserves).toBeUndefined();
        expect(result.virtualTokenReserves).toBeUndefined();
        // Should still calculate price from amounts
        expect(result.price).toBeGreaterThan(0);
      });
    });

    describe('Sell Transactions', () => {
      it('should parse a valid BC sell transaction', async () => {
        const tx = mockTransactions.bcSell;
        const result = await parser.parseTransaction(tx);

        expect(result).toMatchObject({
          tradeType: 'sell',
          solAmount: expect.any(BigInt),
          tokenAmount: expect.any(BigInt)
        });

        // Sell should have negative token amount in some representations
        expect(result.tokenAmount).toBeGreaterThan(0n);
      });

      it('should detect slippage in sell transactions', async () => {
        const tx = mockTransactions.bcSellHighSlippage;
        const result = await parser.parseTransaction(tx);

        expect(result).toBeDefined();
        // Additional slippage data could be extracted
      });
    });

    describe('Edge Cases', () => {
      it('should handle transactions with no logs', async () => {
        const tx = mockTransactions.noLogs;
        const result = await parser.parseTransaction(tx);

        expect(result).toBeNull();
      });

      it('should handle malformed log messages', async () => {
        const tx = mockTransactions.malformedLogs;
        const result = await parser.parseTransaction(tx);

        expect(result).toBeNull();
      });

      it('should parse transaction with multiple instructions', async () => {
        const tx = mockTransactions.multipleInstructions;
        const result = await parser.parseTransaction(tx);

        expect(result).toBeDefined();
        // Should parse the relevant pump instruction
      });
    });
  });

  describe('AMM Trade Parsing', () => {
    describe('Swap Transactions', () => {
      it('should parse a valid AMM swap transaction', async () => {
        const tx = mockTransactions.ammSwap;
        const result = await parser.parseTransaction(tx);

        expect(result).toMatchObject({
          signature: tx.signature,
          program: 'pump.swap',
          tradeType: expect.stringMatching(/buy|sell/),
          mintAddress: expect.any(String),
          userAddress: expect.any(String),
          solAmount: expect.any(BigInt),
          tokenAmount: expect.any(BigInt),
          price: expect.any(Number)
        });
      });

      it('should determine trade direction correctly', async () => {
        const buyTx = mockTransactions.ammBuySwap;
        const buyResult = await parser.parseTransaction(buyTx);
        expect(buyResult.tradeType).toBe('buy');

        const sellTx = mockTransactions.ammSellSwap;
        const sellResult = await parser.parseTransaction(sellTx);
        expect(sellResult.tradeType).toBe('sell');
      });

      it('should extract pool state from swap', async () => {
        const tx = mockTransactions.ammSwapWithPoolState;
        const result = await parser.parseTransaction(tx);

        expect(result.poolState).toBeDefined();
        expect(result.poolState).toMatchObject({
          baseReserves: expect.any(BigInt),
          quoteReserves: expect.any(BigInt)
        });
      });
    });

    describe('Pool Events', () => {
      it('should detect pool creation events', async () => {
        const tx = mockTransactions.poolCreation;
        const result = await parser.parseTransaction(tx);

        expect(emittedEvents).toContainEqual({
          event: 'POOL_CREATED',
          data: expect.objectContaining({
            poolAddress: expect.any(String),
            mintAddress: expect.any(String)
          })
        });
      });
    });
  });

  describe('Event Emission', () => {
    it('should emit TRADE_PARSED event for successful parses', async () => {
      const tx = mockTransactions.bcBuy;
      await parser.parseTransaction(tx);

      expect(emittedEvents).toContainEqual({
        event: 'TRADE_PARSED',
        data: expect.objectContaining({
          signature: tx.signature
        })
      });
    });

    it('should emit PARSE_ERROR event for failures', async () => {
      const tx = mockTransactions.invalidTransaction;
      await parser.parseTransaction(tx);

      expect(emittedEvents).toContainEqual({
        event: 'PARSE_ERROR',
        data: expect.objectContaining({
          error: expect.any(String)
        })
      });
    });

    it('should emit TOKEN_GRADUATED event when detected', async () => {
      const tx = mockTransactions.graduationTransaction;
      await parser.parseTransaction(tx);

      expect(emittedEvents).toContainEqual({
        event: 'TOKEN_GRADUATED',
        data: expect.objectContaining({
          mintAddress: expect.any(String),
          bondingCurveKey: expect.any(String)
        })
      });
    });
  });

  describe('Performance', () => {
    it('should parse 100 transactions in under 1 second', async () => {
      const transactions = Array(100).fill(mockTransactions.bcBuy);
      
      const startTime = Date.now();
      await Promise.all(transactions.map(tx => parser.parseTransaction(tx)));
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle concurrent parsing without errors', async () => {
      const transactions = [
        mockTransactions.bcBuy,
        mockTransactions.bcSell,
        mockTransactions.ammSwap,
        mockTransactions.bcBuy,
        mockTransactions.ammSwap
      ];

      const results = await Promise.all(
        transactions.map(tx => parser.parseTransaction(tx))
      );

      expect(results.filter(r => r !== null)).toHaveLength(5);
    });
  });

  describe('Error Handling', () => {
    it('should handle null transaction gracefully', async () => {
      const result = await parser.parseTransaction(null as any);
      expect(result).toBeNull();
    });

    it('should handle transaction with missing meta', async () => {
      const tx = { ...mockTransactions.bcBuy, meta: undefined };
      const result = await parser.parseTransaction(tx);
      expect(result).toBeNull();
    });

    it('should suppress known error types', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const tx = mockTransactions.computeBudgetTransaction;
      await parser.parseTransaction(tx);

      // Should not log ComputeBudget errors
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('ComputeBudget')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('IDL Parsing Integration', () => {
    it('should use IDL parser when available', async () => {
      const tx = mockTransactions.bcBuyWithFullData;
      const result = await parser.parseTransaction(tx);

      // IDL parsing provides more detailed data
      expect(result.instructionName).toBeDefined();
      expect(result.accounts).toBeDefined();
      expect(result.accounts).toHaveProperty('user');
      expect(result.accounts).toHaveProperty('bondingCurve');
    });

    it('should fallback to simple parsing when IDL fails', async () => {
      const tx = mockTransactions.bcBuyNonStandardFormat;
      const result = await parser.parseTransaction(tx);

      // Should still get basic trade data
      expect(result).toBeDefined();
      expect(result.tradeType).toBeDefined();
      expect(result.price).toBeGreaterThan(0);
    });
  });
});

describe('UnifiedEventParser - State Management', () => {
  let parser: UnifiedEventParser;
  let container: Container;

  beforeEach(() => {
    container = createTestContainer();
    parser = new UnifiedEventParser(container);
  });

  it('should maintain parsing statistics', () => {
    const stats = parser.getStatistics();
    
    expect(stats).toMatchObject({
      totalParsed: expect.any(Number),
      successfulParses: expect.any(Number),
      failedParses: expect.any(Number),
      parseRatePercent: expect.any(Number),
      averageParseTime: expect.any(Number)
    });
  });

  it('should reset statistics on demand', () => {
    parser.resetStatistics();
    const stats = parser.getStatistics();
    
    expect(stats.totalParsed).toBe(0);
    expect(stats.successfulParses).toBe(0);
    expect(stats.failedParses).toBe(0);
  });
});