/**
 * Example Integration Test: Graduation Flow
 * Tests the complete flow from BC creation to AMM graduation
 */

import { Container } from '../../../src/core/container';
import { EventBus } from '../../../src/core/event-bus';
import { BCMonitor } from '../../../src/monitors/bc-monitor-refactored';
import { BCAccountMonitor } from '../../../src/monitors/bc-account-monitor-refactored';
import { AMMMonitor } from '../../../src/monitors/amm-monitor-refactored';
import { GraduationHandler } from '../../../src/handlers/graduation-handler';
import { createTestContainer } from '../../helpers/test-container';
import { TestDatabase } from '../../helpers/test-db';
import { generateGraduationScenario } from '../../fixtures/graduation-scenarios';
import { waitForEvent } from '../../helpers/event-utils';

describe('Graduation Flow Integration', () => {
  let container: Container;
  let eventBus: EventBus;
  let bcMonitor: BCMonitor;
  let bcAccountMonitor: BCAccountMonitor;
  let ammMonitor: AMMMonitor;
  let graduationHandler: GraduationHandler;
  let testDb: TestDatabase;

  beforeEach(async () => {
    // Setup test environment
    container = createTestContainer();
    eventBus = container.resolve('EventBus') as EventBus;
    testDb = container.resolve('DatabaseService') as TestDatabase;

    // Initialize services
    bcMonitor = new BCMonitor(container, {
      programId: 'pumpProgramId',
      subscriptionKey: 'test'
    });
    
    bcAccountMonitor = new BCAccountMonitor(container, {
      programId: 'pumpProgramId',
      subscriptionKey: 'test'
    });
    
    ammMonitor = new AMMMonitor(container, {
      programId: 'ammProgramId',
      subscriptionKey: 'test'
    });
    
    graduationHandler = await GraduationHandler.create(eventBus);

    // Start services
    await Promise.all([
      bcMonitor.initialize(),
      bcAccountMonitor.initialize(),
      ammMonitor.initialize()
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      bcMonitor.stop(),
      bcAccountMonitor.stop(),
      ammMonitor.stop()
    ]);
    await testDb.clean();
  });

  describe('Complete Graduation Lifecycle', () => {
    it('should track token from BC creation to AMM graduation', async () => {
      const scenario = generateGraduationScenario('full_lifecycle');
      const { mintAddress, bondingCurveKey, transactions } = scenario;

      // Track events
      const events = {
        tokenCreated: false,
        firstTrade: false,
        thresholdCrossed: false,
        graduationDetected: false,
        poolCreated: false,
        ammTrading: false
      };

      // Setup event listeners
      eventBus.on('TOKEN_CREATED', (data) => {
        if (data.mintAddress === mintAddress) {
          events.tokenCreated = true;
        }
      });

      eventBus.on('TRADE_PROCESSED', (data) => {
        if (data.mintAddress === mintAddress && !events.firstTrade) {
          events.firstTrade = true;
        }
      });

      eventBus.on('THRESHOLD_CROSSED', (data) => {
        if (data.mintAddress === mintAddress) {
          events.thresholdCrossed = true;
        }
      });

      eventBus.on('TOKEN_GRADUATED', (data) => {
        if (data.mintAddress === mintAddress) {
          events.graduationDetected = true;
        }
      });

      eventBus.on('POOL_CREATED', (data) => {
        if (data.mintAddress === mintAddress) {
          events.poolCreated = true;
        }
      });

      eventBus.on('AMM_TRADE', (data) => {
        if (data.mintAddress === mintAddress) {
          events.ammTrading = true;
        }
      });

      // Process transactions in order
      for (const tx of transactions) {
        switch (tx.type) {
          case 'bc_trade':
            await bcMonitor.handleTransaction(tx.data);
            break;
          case 'bc_account':
            await bcAccountMonitor.handleAccountUpdate(tx.data);
            break;
          case 'amm_trade':
            await ammMonitor.handleTransaction(tx.data);
            break;
        }
        
        // Small delay to allow event processing
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Verify all events occurred in order
      expect(events.tokenCreated).toBe(true);
      expect(events.firstTrade).toBe(true);
      expect(events.thresholdCrossed).toBe(true);
      expect(events.graduationDetected).toBe(true);
      expect(events.poolCreated).toBe(true);
      expect(events.ammTrading).toBe(true);

      // Verify database state
      const token = await testDb.query(
        'SELECT * FROM tokens_unified WHERE mint_address = $1',
        [mintAddress]
      );
      
      expect(token.rows[0]).toMatchObject({
        mint_address: mintAddress,
        graduated_to_amm: true,
        bonding_curve_key: bondingCurveKey
      });

      // Verify graduation mapping
      const mapping = await testDb.query(
        'SELECT * FROM bonding_curve_mappings WHERE bonding_curve_key = $1',
        [bondingCurveKey]
      );
      
      expect(mapping.rows[0]).toMatchObject({
        bonding_curve_key: bondingCurveKey,
        mint_address: mintAddress
      });
    });

    it('should handle graduation with high trading volume', async () => {
      const scenario = generateGraduationScenario('high_volume_graduation', {
        tradeCount: 100,
        tradersCount: 50
      });

      let tradeCount = 0;
      eventBus.on('TRADE_PROCESSED', () => {
        tradeCount++;
      });

      // Process all trades
      for (const tx of scenario.transactions) {
        if (tx.type === 'bc_trade') {
          await bcMonitor.handleTransaction(tx.data);
        }
      }

      expect(tradeCount).toBe(100);

      // Process graduation
      const graduationTx = scenario.transactions.find(tx => tx.type === 'graduation');
      await bcAccountMonitor.handleAccountUpdate(graduationTx!.data);

      // Wait for graduation event
      const graduationEvent = await waitForEvent(eventBus, 'TOKEN_GRADUATED', 5000);
      expect(graduationEvent).toBeDefined();
    });

    it('should track bonding curve progress accurately', async () => {
      const scenario = generateGraduationScenario('gradual_progress');
      const progressUpdates: number[] = [];

      eventBus.on('TRADE_PROCESSED', (data) => {
        if (data.bondingCurveProgress) {
          progressUpdates.push(data.bondingCurveProgress);
        }
      });

      // Process trades that gradually increase progress
      for (const tx of scenario.transactions) {
        if (tx.type === 'bc_trade') {
          await bcMonitor.handleTransaction(tx.data);
        }
      }

      // Verify progress increases monotonically
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i]).toBeGreaterThanOrEqual(progressUpdates[i - 1]);
      }

      // Final progress should be near 100
      expect(progressUpdates[progressUpdates.length - 1]).toBeGreaterThan(95);
    });
  });

  describe('Graduation Edge Cases', () => {
    it('should handle failed graduation attempts', async () => {
      const scenario = generateGraduationScenario('failed_graduation');
      
      let errorEmitted = false;
      eventBus.on('GRADUATION_FAILED', () => {
        errorEmitted = true;
      });

      // Process failed graduation
      const failedGraduation = scenario.transactions.find(
        tx => tx.type === 'failed_graduation'
      );
      await bcAccountMonitor.handleAccountUpdate(failedGraduation!.data);

      expect(errorEmitted).toBe(true);

      // Token should not be marked as graduated
      const token = await testDb.query(
        'SELECT graduated_to_amm FROM tokens_unified WHERE mint_address = $1',
        [scenario.mintAddress]
      );
      expect(token.rows[0]?.graduated_to_amm).toBe(false);
    });

    it('should handle tokens that never graduate', async () => {
      const scenario = generateGraduationScenario('abandoned_token', {
        finalProgress: 45 // Only 45% progress
      });

      // Process all trades
      for (const tx of scenario.transactions) {
        if (tx.type === 'bc_trade') {
          await bcMonitor.handleTransaction(tx.data);
        }
      }

      // Check final state
      const lastTrade = await testDb.query(
        'SELECT bonding_curve_progress FROM trades_unified WHERE mint_address = $1 ORDER BY block_time DESC LIMIT 1',
        [scenario.mintAddress]
      );

      expect(lastTrade.rows[0]?.bonding_curve_progress).toBeLessThan(50);
    });

    it('should handle rapid graduation (MEV scenario)', async () => {
      const scenario = generateGraduationScenario('mev_graduation', {
        timeSpan: 10, // 10 seconds from creation to graduation
        tradeCount: 5 // Only 5 large trades
      });

      const timestamps: Date[] = [];
      eventBus.on('TRADE_PROCESSED', (data) => {
        timestamps.push(new Date(data.blockTime));
      });

      // Process rapid trades
      for (const tx of scenario.transactions) {
        await bcMonitor.handleTransaction(tx.data);
      }

      // Calculate time span
      const timeSpan = timestamps[timestamps.length - 1].getTime() - timestamps[0].getTime();
      expect(timeSpan).toBeLessThan(10000); // Less than 10 seconds

      // Should still graduate successfully
      const graduationEvent = await waitForEvent(eventBus, 'TOKEN_GRADUATED', 1000);
      expect(graduationEvent).toBeDefined();
    });
  });

  describe('Cross-Monitor Communication', () => {
    it('should maintain consistency across monitors', async () => {
      const scenario = generateGraduationScenario('standard');
      
      // Track all events from different monitors
      const bcEvents: any[] = [];
      const ammEvents: any[] = [];

      eventBus.on('BC_*', (event, data) => {
        bcEvents.push({ event, data });
      });

      eventBus.on('AMM_*', (event, data) => {
        ammEvents.push({ event, data });
      });

      // Process complete flow
      for (const tx of scenario.transactions) {
        switch (tx.type) {
          case 'bc_trade':
            await bcMonitor.handleTransaction(tx.data);
            break;
          case 'graduation':
            await bcAccountMonitor.handleAccountUpdate(tx.data);
            break;
          case 'amm_trade':
            await ammMonitor.handleTransaction(tx.data);
            break;
        }
      }

      // Verify token appears in both BC and AMM events
      const bcTokenEvents = bcEvents.filter(e => 
        e.data.mintAddress === scenario.mintAddress
      );
      const ammTokenEvents = ammEvents.filter(e => 
        e.data.mintAddress === scenario.mintAddress
      );

      expect(bcTokenEvents.length).toBeGreaterThan(0);
      expect(ammTokenEvents.length).toBeGreaterThan(0);
    });

    it('should handle concurrent updates without conflicts', async () => {
      const scenario = generateGraduationScenario('concurrent_updates');
      
      // Process BC trades and account updates concurrently
      const promises = scenario.transactions.map(async (tx) => {
        switch (tx.type) {
          case 'bc_trade':
            return bcMonitor.handleTransaction(tx.data);
          case 'bc_account':
            return bcAccountMonitor.handleAccountUpdate(tx.data);
          default:
            return Promise.resolve();
        }
      });

      await Promise.all(promises);

      // Verify data consistency
      const trades = await testDb.query(
        'SELECT COUNT(*) as count FROM trades_unified WHERE mint_address = $1',
        [scenario.mintAddress]
      );
      
      expect(trades.rows[0].count).toBe(
        scenario.transactions.filter(tx => tx.type === 'bc_trade').length
      );
    });
  });

  describe('Error Recovery', () => {
    it('should recover from database errors during graduation', async () => {
      const scenario = generateGraduationScenario('standard');
      
      // Simulate database error on first graduation attempt
      let dbErrorCount = 0;
      const originalQuery = testDb.query.bind(testDb);
      jest.spyOn(testDb, 'query').mockImplementation(async (sql, params) => {
        if (sql.includes('UPDATE tokens_unified') && dbErrorCount === 0) {
          dbErrorCount++;
          throw new Error('Database connection lost');
        }
        return originalQuery(sql, params);
      });

      // Process graduation
      const graduationTx = scenario.transactions.find(tx => tx.type === 'graduation');
      await bcAccountMonitor.handleAccountUpdate(graduationTx!.data);

      // Should retry and eventually succeed
      const token = await testDb.query(
        'SELECT graduated_to_amm FROM tokens_unified WHERE mint_address = $1',
        [scenario.mintAddress]
      );
      
      expect(token.rows[0]?.graduated_to_amm).toBe(true);
      expect(dbErrorCount).toBe(1); // Error occurred once
    });

    it('should handle missing bonding curve mapping', async () => {
      const scenario = generateGraduationScenario('missing_mapping');
      
      // Skip BC trades (no mapping created)
      // Process graduation directly
      const graduationTx = scenario.transactions.find(tx => tx.type === 'graduation');
      await bcAccountMonitor.handleAccountUpdate(graduationTx!.data);

      // Should handle gracefully
      const mapping = await testDb.query(
        'SELECT * FROM bonding_curve_mappings WHERE bonding_curve_key = $1',
        [scenario.bondingCurveKey]
      );
      
      expect(mapping.rows.length).toBe(0); // No mapping created
    });
  });
});