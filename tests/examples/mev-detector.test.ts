/**
 * Example Unit Test: MEV Detector
 * Tests for sandwich attack and frontrunning detection
 */

import { MEVDetector } from '../../src/services/mev-detector';
import { EventBus } from '../../src/core/event-bus';
import { createTestDatabase, TestDatabase } from '../helpers/test-db';
import { generateMEVScenario } from '../fixtures/mev-scenarios';

describe('MEVDetector', () => {
  let mevDetector: MEVDetector;
  let eventBus: EventBus;
  let testDb: TestDatabase;
  let detectedMEVEvents: any[] = [];

  beforeEach(async () => {
    eventBus = new EventBus();
    testDb = await createTestDatabase();
    mevDetector = await MEVDetector.create(eventBus);

    // Track MEV detection events
    eventBus.on('mev:detected', (event) => {
      detectedMEVEvents.push(event);
    });

    // Clear detection history
    detectedMEVEvents = [];
  });

  afterEach(async () => {
    await testDb.clean();
  });

  describe('Sandwich Attack Detection', () => {
    it('should detect classic sandwich attack pattern', async () => {
      // Generate sandwich attack scenario:
      // 1. Attacker buy (frontrun)
      // 2. Victim buy (target)
      // 3. Attacker sell (backrun)
      const scenario = generateMEVScenario('sandwich', {
        victimAmount: 10_000_000_000, // 10 SOL
        attackerAmount: 50_000_000_000, // 50 SOL
        priceImpact: 0.15 // 15% price impact
      });

      // Process transactions in order
      for (const tx of scenario.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      // Verify sandwich attack was detected
      expect(detectedMEVEvents).toHaveLength(1);
      expect(detectedMEVEvents[0]).toMatchObject({
        type: 'sandwich',
        victimTx: scenario.victimTx,
        attackerAddress: scenario.attackerAddress,
        confidence: 'high',
        profitEstimate: expect.any(Number)
      });

      // Verify profit calculation
      expect(detectedMEVEvents[0].profitEstimate).toBeGreaterThan(0);
    });

    it('should detect sandwich attacks across multiple slots', async () => {
      const scenario = generateMEVScenario('sandwich_multi_slot', {
        slotGap: 2,
        victimAmount: 5_000_000_000
      });

      for (const tx of scenario.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      expect(detectedMEVEvents).toHaveLength(1);
      expect(detectedMEVEvents[0].evidence).toContain('multi-slot sandwich');
    });

    it('should calculate sandwich attack profitability', async () => {
      const scenario = generateMEVScenario('sandwich', {
        victimAmount: 20_000_000_000,
        attackerAmount: 100_000_000_000,
        initialPrice: 0.0001,
        priceImpact: 0.20
      });

      for (const tx of scenario.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      const mevEvent = detectedMEVEvents[0];
      expect(mevEvent.profitEstimate).toBeGreaterThan(0);
      
      // Profit should be reasonable (not more than victim's trade)
      expect(mevEvent.profitEstimate).toBeLessThan(
        scenario.victimAmount * scenario.priceImpact
      );
    });

    it('should not flag legitimate arbitrage as sandwich', async () => {
      const scenario = generateMEVScenario('arbitrage', {
        pools: ['pool1', 'pool2'],
        priceDiscrepancy: 0.02
      });

      for (const tx of scenario.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      // Should detect arbitrage, not sandwich
      expect(detectedMEVEvents).toHaveLength(1);
      expect(detectedMEVEvents[0].type).toBe('arbitrage');
    });

    it('should handle high-frequency sandwich attempts', async () => {
      // Generate multiple sandwich attempts in quick succession
      const scenarios = Array(5).fill(null).map((_, i) => 
        generateMEVScenario('sandwich', {
          victimAmount: (i + 1) * 1_000_000_000,
          slot: BigInt(1000 + i)
        })
      );

      for (const scenario of scenarios) {
        for (const tx of scenario.transactions) {
          await mevDetector.analyzeTransaction(tx);
        }
      }

      // Should detect all sandwich attacks
      expect(detectedMEVEvents).toHaveLength(5);
      
      // Should track repeat attacker
      const attackerStats = await mevDetector.getAttackerStats(
        scenarios[0].attackerAddress
      );
      expect(attackerStats.attackCount).toBe(5);
    });
  });

  describe('Frontrunning Detection', () => {
    it('should detect simple frontrunning', async () => {
      const scenario = generateMEVScenario('frontrun', {
        victimTx: {
          signature: 'victim123',
          gasPrice: 1000,
          slot: 1000n
        },
        frontrunTx: {
          signature: 'frontrun123',
          gasPrice: 2000, // Higher gas price
          slot: 1000n // Same slot
        }
      });

      await mevDetector.analyzeTransaction(scenario.frontrunTx);
      await mevDetector.analyzeTransaction(scenario.victimTx);

      expect(detectedMEVEvents).toHaveLength(1);
      expect(detectedMEVEvents[0]).toMatchObject({
        type: 'frontrun',
        victimTx: 'victim123',
        confidence: expect.stringMatching(/medium|high/)
      });
    });

    it('should analyze gas price patterns for frontrunning', async () => {
      const transactions = generateMEVScenario('gas_price_escalation', {
        baseGasPrice: 1000,
        escalationRate: 1.5,
        transactionCount: 10
      });

      for (const tx of transactions.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      // Should detect gas price war
      const alerts = mevDetector.getGasPriceAlerts();
      expect(alerts).toContainEqual(
        expect.objectContaining({
          type: 'gas_price_escalation',
          severity: 'high'
        })
      );
    });

    it('should differentiate between MEV and normal priority fees', async () => {
      const normalTx = generateMEVScenario('normal_priority', {
        gasPrice: 1500,
        averageGasPrice: 1000
      });

      await mevDetector.analyzeTransaction(normalTx.transaction);

      // Should not flag as MEV
      expect(detectedMEVEvents).toHaveLength(0);
    });
  });

  describe('Pattern Recognition', () => {
    it('should identify known MEV bot addresses', async () => {
      const knownBot = '11111111111111111111111111111111'; // Example
      await mevDetector.addKnownMEVAddress(knownBot, 'sandwich_bot');

      const scenario = generateMEVScenario('sandwich', {
        attackerAddress: knownBot
      });

      await mevDetector.analyzeTransaction(scenario.transactions[0]);

      expect(detectedMEVEvents[0]).toMatchObject({
        attackerAddress: knownBot,
        attackerType: 'sandwich_bot',
        confidence: 'high' // Higher confidence for known bots
      });
    });

    it('should track MEV success rates', async () => {
      const successfulMEV = generateMEVScenario('sandwich', {
        successful: true,
        profit: 1_000_000_000
      });

      const failedMEV = generateMEVScenario('sandwich', {
        successful: false,
        reason: 'slippage'
      });

      for (const tx of [...successfulMEV.transactions, ...failedMEV.transactions]) {
        await mevDetector.analyzeTransaction(tx);
      }

      const stats = await mevDetector.getMEVStats();
      expect(stats).toMatchObject({
        totalAttempts: 2,
        successfulAttempts: 1,
        successRate: 0.5,
        totalProfit: 1_000_000_000
      });
    });

    it('should detect coordinated MEV attacks', async () => {
      const scenario = generateMEVScenario('coordinated_attack', {
        attackerAddresses: ['bot1', 'bot2', 'bot3'],
        targetToken: 'tokenABC'
      });

      for (const tx of scenario.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      expect(detectedMEVEvents[0]).toMatchObject({
        type: 'coordinated_mev',
        participants: expect.arrayContaining(['bot1', 'bot2', 'bot3']),
        confidence: 'high'
      });
    });
  });

  describe('Performance Considerations', () => {
    it('should process high-volume slots efficiently', async () => {
      const largeSlot = generateMEVScenario('high_volume_slot', {
        transactionCount: 1000,
        mevTransactions: 50
      });

      const startTime = Date.now();
      
      for (const tx of largeSlot.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }
      
      const processingTime = Date.now() - startTime;

      // Should process 1000 transactions in under 5 seconds
      expect(processingTime).toBeLessThan(5000);
      
      // Should still detect MEV accurately
      expect(detectedMEVEvents.length).toBeGreaterThanOrEqual(40);
    });

    it('should maintain detection accuracy under load', async () => {
      // Generate mixed legitimate and MEV transactions
      const scenarios = [
        ...Array(50).fill(null).map(() => 
          generateMEVScenario('normal_trade', {})
        ),
        ...Array(10).fill(null).map(() => 
          generateMEVScenario('sandwich', {})
        ),
        ...Array(5).fill(null).map(() => 
          generateMEVScenario('frontrun', {})
        )
      ];

      // Shuffle to simulate real conditions
      const shuffled = scenarios.sort(() => Math.random() - 0.5);

      for (const scenario of shuffled) {
        for (const tx of scenario.transactions) {
          await mevDetector.analyzeTransaction(tx);
        }
      }

      // Should detect correct number of MEV events
      expect(detectedMEVEvents.filter(e => e.type === 'sandwich')).toHaveLength(10);
      expect(detectedMEVEvents.filter(e => e.type === 'frontrun')).toHaveLength(5);
    });
  });

  describe('Database Integration', () => {
    it('should persist MEV events to database', async () => {
      const scenario = generateMEVScenario('sandwich', {});
      
      for (const tx of scenario.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      // Check database for MEV event
      const result = await testDb.query(
        'SELECT * FROM mev_events WHERE victim_tx = $1',
        [scenario.victimTx]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        mev_type: 'sandwich',
        victim_tx: scenario.victimTx,
        confidence: 'high'
      });
    });

    it('should update attacker statistics', async () => {
      const attackerAddress = 'attacker123';
      const scenarios = Array(3).fill(null).map(() =>
        generateMEVScenario('sandwich', { attackerAddress })
      );

      for (const scenario of scenarios) {
        for (const tx of scenario.transactions) {
          await mevDetector.analyzeTransaction(tx);
        }
      }

      const stats = await mevDetector.getAttackerStats(attackerAddress);
      expect(stats).toMatchObject({
        totalAttacks: 3,
        successfulAttacks: 3,
        totalProfit: expect.any(Number),
        averageProfit: expect.any(Number),
        preferredMethod: 'sandwich'
      });
    });
  });

  describe('Alert Generation', () => {
    it('should generate alerts for high-value MEV', async () => {
      let alertEmitted = false;
      eventBus.on('alert:mev_high_value', () => {
        alertEmitted = true;
      });

      const scenario = generateMEVScenario('sandwich', {
        victimAmount: 1000_000_000_000, // 1000 SOL - high value
        profitEstimate: 50_000_000_000 // 50 SOL profit
      });

      for (const tx of scenario.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      expect(alertEmitted).toBe(true);
    });

    it('should alert on new MEV bot detection', async () => {
      let newBotAlert: any = null;
      eventBus.on('alert:new_mev_bot', (alert) => {
        newBotAlert = alert;
      });

      const scenario = generateMEVScenario('sandwich', {
        attackerAddress: 'newBot456'
      });

      // First attack by new bot
      for (const tx of scenario.transactions) {
        await mevDetector.analyzeTransaction(tx);
      }

      expect(newBotAlert).toMatchObject({
        address: 'newBot456',
        firstSeen: expect.any(Date),
        attackType: 'sandwich'
      });
    });
  });
});