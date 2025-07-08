import 'reflect-metadata';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { ConfigService } from '../core/config';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { Logger } from '../core/logger';
import { TOKENS } from '../core/container';

const logger = new Logger({ context: 'DebugAMMFlow' });

async function debugAMMMonitorFlow() {
  logger.info('🔍 Starting AMM monitor flow debug...');

  // Create container
  const container = await createContainer();
  
  // Get services
  const eventBus = await container.resolve(TOKENS.EventBus) as EventBus;
  const configService = await container.resolve(TOKENS.ConfigService) as ConfigService;
  const streamManager = await container.resolve(TOKENS.StreamManager) as any;

  // Create trading monitor with dependencies
  const parser = await container.resolve(TOKENS.EventParser);
  const tradeHandler = await container.resolve(TOKENS.TradeHandler);
  const solPriceService = await container.resolve(TOKENS.SolPriceService);
  
  const tradingMonitor = new TradingActivityMonitor({
    streamManager,
    eventBus,
    parser,
    tradeHandler,
    solPriceService
  });

  // Log configuration
  const ammThreshold = configService.get('monitors').ammSaveThreshold;
  logger.info('📊 AMM Save Threshold:', ammThreshold);

  // Track event flow
  const eventCounts: Record<string, number> = {};

  // Listen to all relevant events
  const eventHandlers: Array<[string, string]> = [
    [EVENTS.TRADE_PARSED, 'Trade parsed'],
    [EVENTS.AMM_TRADE, 'AMM trade event'],
    [EVENTS.AMM_POOL_TRADE, 'AMM pool trade'],
    [EVENTS.TRADING_ACTIVITY_UPDATE, 'Trading activity update'],
    [EVENTS.TRADE_SAVED, 'Trade saved to DB'],
    [EVENTS.TRADE_ERROR, 'Trade handler error']
  ];

  eventHandlers.forEach(([event, description]) => {
    eventCounts[event] = 0;
    
    eventBus.on(event, (data: any) => {
      eventCounts[event]++;
      
      // Log AMM trades in detail
      if (event === EVENTS.AMM_TRADE) {
        const trade = data.trade || data;
        logger.info(`📍 ${description}:`, {
          mintAddress: trade.mintAddress,
          marketCapUsd: trade.marketCapUsd?.toFixed(2),
          meetsThreshold: trade.marketCapUsd >= ammThreshold,
          threshold: ammThreshold,
          isGraduated: trade.isGraduated || trade.graduatedToAmm,
          source: trade.source || 'unknown'
        });
      } else if (event === EVENTS.TRADE_SAVED) {
        logger.info(`✅ ${description}:`, {
          mintAddress: data.mintAddress,
          marketCapUsd: data.marketCapUsd,
          source: data.source
        });
      } else if (event === EVENTS.TRADE_ERROR) {
        logger.error(`❌ ${description}:`, {
          error: data.error,
          mintAddress: data.mintAddress
        });
      } else {
        logger.debug(`🔸 ${description}`, {
          eventCount: eventCounts[event],
          hasMintAddress: !!data.mintAddress
        });
      }
    });
  });

  // Log statistics periodically
  setInterval(() => {
    logger.info('📊 Event Statistics:', eventCounts);
  }, 30000);

  // Start monitoring
  logger.info('🚀 Starting trading activity monitor...');
  await tradingMonitor.start();

  logger.info('👂 Monitoring AMM trades... Press Ctrl+C to stop');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\n📊 Final Event Statistics:', eventCounts);
    
    logger.info('Stopping monitors...');
    await tradingMonitor.stop();
    await streamManager.close();
    
    process.exit(0);
  });

  // Keep running
  await new Promise(() => {});
}

// Run the debug script
debugAMMMonitorFlow().catch(error => {
  logger.error('Debug script failed:', error);
  process.exit(1);
});