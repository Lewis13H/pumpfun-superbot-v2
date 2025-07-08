import 'reflect-metadata';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { ConfigService } from '../core/config';
import { Logger } from '../core/logger';
import { TOKENS } from '../core/container';

const logger = new Logger({ context: 'DebugAMMEvents' });

async function debugAMMEventFlow() {
  logger.info('🔍 Starting AMM event flow debug...');

  // Create container
  const container = await createContainer();
  
  // Get services
  const eventBus = await container.resolve(TOKENS.EventBus) as EventBus;
  const configService = await container.resolve(TOKENS.ConfigService) as ConfigService;

  // Get thresholds
  const ammThreshold = configService.get('monitors').ammSaveThreshold;
  const bcThreshold = configService.get('monitors').bcSaveThreshold;
  
  logger.info('📊 Configuration:', {
    ammSaveThreshold: ammThreshold,
    bcSaveThreshold: bcThreshold,
    saveAllTokens: configService.get('monitors').saveAllTokens
  });

  // Track event flow
  let ammTradeCount = 0;
  let tokenDiscoveredCount = 0;
  let tradeProcessedCount = 0;
  let thresholdCrossedCount = 0;

  // Listen to AMM trade events
  eventBus.on(EVENTS.AMM_TRADE, (data: any) => {
    ammTradeCount++;
    const trade = data.trade || data;
    const token = data.token;
    
    logger.info('💱 AMM_TRADE event:', {
      count: ammTradeCount,
      mintAddress: trade.mintAddress,
      marketCapUsd: trade.marketCapUsd?.toFixed(2),
      meetsThreshold: trade.marketCapUsd >= ammThreshold,
      hasToken: !!token,
      tokenSaved: token ? !!token.id : false
    });
  });

  // Listen to token discovered events
  eventBus.on(EVENTS.TOKEN_DISCOVERED, (data: any) => {
    tokenDiscoveredCount++;
    logger.info('🆕 TOKEN_DISCOVERED event:', {
      count: tokenDiscoveredCount,
      mintAddress: data.mintAddress,
      marketCapUsd: data.marketCapUsd
    });
  });

  // Listen to trade processed events
  eventBus.on(EVENTS.TRADE_PROCESSED, (data: any) => {
    tradeProcessedCount++;
    logger.debug('✅ TRADE_PROCESSED event:', {
      count: tradeProcessedCount,
      mintAddress: data.mintAddress
    });
  });

  // Listen to threshold crossed events
  eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, (data: any) => {
    thresholdCrossedCount++;
    logger.info('🎯 TOKEN_THRESHOLD_CROSSED event:', {
      count: thresholdCrossedCount,
      mintAddress: data.mintAddress,
      marketCapUsd: data.marketCapUsd,
      threshold: data.threshold
    });
  });

  // Start the trading activity monitor
  logger.info('🚀 Starting monitors...');
  
  // Import and start monitors
  const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
  const { TokenLifecycleMonitor } = await import('../monitors/domain/token-lifecycle-monitor');
  
  const streamManager = await container.resolve(TOKENS.StreamManager) as any;
  const parser = await container.resolve(TOKENS.EventParser);
  const tradeHandler = await container.resolve(TOKENS.TradeHandler);
  const solPriceService = await container.resolve(TOKENS.SolPriceService);
  const dbService = await container.resolve(TOKENS.DatabaseService);
  
  const tradingMonitor = new TradingActivityMonitor({
    streamManager,
    eventBus,
    parser,
    tradeHandler,
    solPriceService
  });
  
  const tokenMonitor = new TokenLifecycleMonitor({
    streamManager,
    eventBus,
    parser,
    tradeHandler,
    solPriceService,
    dbService
  });

  await tradingMonitor.start();
  await tokenMonitor.start();

  // Log statistics periodically
  setInterval(() => {
    logger.info('📊 Event Statistics:', {
      ammTradeCount,
      tokenDiscoveredCount,
      tradeProcessedCount,
      thresholdCrossedCount,
      ammThreshold
    });
  }, 30000);

  logger.info('👂 Monitoring events... Press Ctrl+C to stop');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\n📊 Final Statistics:', {
      ammTradeCount,
      tokenDiscoveredCount,
      tradeProcessedCount,
      thresholdCrossedCount
    });
    
    logger.info('Stopping monitors...');
    await tradingMonitor.stop();
    await tokenMonitor.stop();
    await streamManager.close();
    
    process.exit(0);
  });

  // Keep running
  await new Promise(() => {});
}

// Run the debug script
debugAMMEventFlow().catch(error => {
  logger.error('Debug script failed:', error);
  process.exit(1);
});