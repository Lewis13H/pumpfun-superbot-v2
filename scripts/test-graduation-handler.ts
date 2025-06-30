#!/usr/bin/env tsx
/**
 * Test Graduation Handler Integration
 * Verifies that the graduation handler is properly initialized and working
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { TOKENS } from '../src/core/container';
import { EVENTS } from '../src/core/event-bus';
import { Logger } from '../src/core/logger';
import { Trade } from '../src/repositories/trade-repository';

const logger = new Logger({ context: 'TestGraduationHandler', color: chalk.cyan });

async function testGraduationHandler() {
  try {
    logger.info('Creating container...');
    const container = await createContainer();
    
    // Get services
    const eventBus = await container.resolve(TOKENS.EventBus);
    const graduationHandler = await container.resolve(TOKENS.GraduationHandler);
    
    logger.info('Graduation handler initialized successfully!');
    logger.info('Stats:', graduationHandler.getStats());
    
    // Test event flow
    logger.info('Testing event flow...');
    
    // Listen for graduation processed event
    eventBus.on(EVENTS.GRADUATION_PROCESSED, (data) => {
      logger.warn('🎓 Graduation processed!', data);
    });
    
    // Simulate a BC trade with bonding curve key
    const mockTrade: Trade = {
      signature: 'test-signature-123',
      mintAddress: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
      program: 'bonding_curve',
      tradeType: 'buy' as any,
      userAddress: 'test-user',
      solAmount: 1000000000n, // 1 SOL
      tokenAmount: 1000000000n,
      priceSol: 0.000001,
      priceUsd: 0.00018,
      marketCapUsd: 180000,
      volumeUsd: 180,
      virtualSolReserves: 80000000000n, // 80 SOL
      virtualTokenReserves: 100000000000n,
      bondingCurveKey: 'F8Kseqmboep2JmdrVGmcLDSLjUb8e8m3M4xQeWBBE6Jd',
      bondingCurveProgress: 94.1,
      slot: 123456789n,
      blockTime: new Date()
    };
    
    logger.info('Emitting TRADE_PROCESSED event...');
    eventBus.emit(EVENTS.TRADE_PROCESSED, mockTrade);
    
    // Wait a bit for async processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if mapping was created
    const mintForBC = await graduationHandler.getMintForBondingCurve(mockTrade.bondingCurveKey!);
    logger.info('Mint for bonding curve:', mintForBC);
    
    // Simulate a graduation event
    logger.info('Simulating graduation event...');
    eventBus.emit(EVENTS.TOKEN_GRADUATED, {
      bondingCurveKey: mockTrade.bondingCurveKey,
      virtualSolReserves: '85000000000', // 85 SOL
      virtualTokenReserves: '15000000000',
      complete: true,
      slot: 123456790,
      creator: 'test-creator'
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check stats again
    logger.info('Final stats:', graduationHandler.getStats());
    
    // Process any pending graduations
    await graduationHandler.processPendingGraduations();
    
    logger.info('Test completed successfully! ✅');
    
  } catch (error) {
    logger.error('Test failed:', error as Error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run test
testGraduationHandler();