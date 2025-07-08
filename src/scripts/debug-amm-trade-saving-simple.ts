import 'reflect-metadata';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { ConfigService } from '../core/config';
import { Logger } from '../core/logger';
import { EVENTS } from '../core/event-bus';

const logger = new Logger({ context: 'DebugAMM' });

interface AMMTradeEventData {
  mintAddress: string;
  solAmount: number;
  tokenAmount: number;
  pricePerToken: number;
  marketCapSol: number;
  marketCapUsd: number;
  trader: string;
  isBuy: boolean;
  isGraduated?: boolean;
  poolAddress?: string;
}

async function debugAMMTradeSaving() {
  logger.info('🔍 Starting AMM trade saving debug script...');

  // Create container for proper DI setup
  const container = await createContainer();
  
  // Get services
  const eventBus = await container.resolve('EventBus') as EventBus;
  const configService = await container.resolve('ConfigService') as ConfigService;

  // Get configuration values
  const ammThreshold = configService.get('monitors').ammSaveThreshold;
  const bcThreshold = configService.get('monitors').bcSaveThreshold;
  
  logger.info('📊 Configuration:', {
    ammSaveThreshold: ammThreshold,
    bcSaveThreshold: bcThreshold,
    env: {
      AMM_SAVE_THRESHOLD: process.env.AMM_SAVE_THRESHOLD || 'not set',
      BC_SAVE_THRESHOLD: process.env.BC_SAVE_THRESHOLD || 'not set'
    }
  });

  // Track statistics
  let totalTrades = 0;
  let tradesAboveThreshold = 0;
  let tradesBelowThreshold = 0;
  let graduatedTrades = 0;
  let nonGraduatedTrades = 0;

  // Subscribe to AMM trade events
  eventBus.on(EVENTS.AMM_TRADE, (data: { trade: AMMTradeEventData }) => {
    // Events from trade handler wrap the trade in a 'trade' property
    const trade = data.trade || data;
    totalTrades++;
    
    const meetsThreshold = trade.marketCapUsd >= ammThreshold;
    
    if (meetsThreshold) {
      tradesAboveThreshold++;
    } else {
      tradesBelowThreshold++;
    }

    if (trade.isGraduated) {
      graduatedTrades++;
    } else {
      nonGraduatedTrades++;
    }

    // Log trade details
    logger.info('💱 AMM Trade Event:', {
      mintAddress: trade.mintAddress,
      marketCapUsd: trade.marketCapUsd?.toFixed(2) || 'unknown',
      marketCapSol: trade.marketCapSol?.toFixed(4) || 'unknown',
      pricePerToken: trade.pricePerToken?.toFixed(9) || 'unknown',
      meetsThreshold,
      threshold: ammThreshold,
      isGraduated: trade.isGraduated,
      isBuy: trade.isBuy,
      trader: trade.trader || trade.userAddress,
      poolAddress: trade.poolAddress || 'unknown'
    });

    // Log running statistics every 10 trades
    if (totalTrades % 10 === 0) {
      logger.info('📈 Statistics Update:', {
        totalTrades,
        tradesAboveThreshold,
        tradesBelowThreshold,
        percentageAboveThreshold: ((tradesAboveThreshold / totalTrades) * 100).toFixed(2) + '%',
        graduatedTrades,
        nonGraduatedTrades,
        averageThresholdDifference: (tradesAboveThreshold > 0 ? 
          (tradesAboveThreshold / totalTrades * ammThreshold).toFixed(2) : '0')
      });
    }
  });

  // Also listen for database save events to confirm saves
  eventBus.on(EVENTS.TRADE_SAVED, (data: any) => {
    logger.info('✅ Trade saved to database:', {
      mintAddress: data.mintAddress,
      marketCapUsd: data.marketCapUsd,
      source: data.source || 'unknown'
    });
  });

  // Listen for trade handler errors
  eventBus.on(EVENTS.TRADE_ERROR, (data: any) => {
    logger.error('❌ Trade handler error:', {
      error: data.error,
      mintAddress: data.mintAddress,
      marketCapUsd: data.marketCapUsd
    });
  });

  logger.info('👂 Listening for AMM trade events...');
  logger.info('Press Ctrl+C to stop and see final statistics');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('\n📊 Final Statistics:', {
      totalTrades,
      tradesAboveThreshold,
      tradesBelowThreshold,
      percentageAboveThreshold: totalTrades > 0 ? 
        ((tradesAboveThreshold / totalTrades) * 100).toFixed(2) + '%' : '0%',
      graduatedTrades,
      nonGraduatedTrades,
      threshold: ammThreshold
    });
    
    process.exit(0);
  });

  // Keep the script running
  await new Promise(() => {});
}

// Run the debug script
debugAMMTradeSaving().catch(error => {
  logger.error('Debug script failed:', error);
  process.exit(1);
});