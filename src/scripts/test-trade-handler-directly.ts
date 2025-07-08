import 'reflect-metadata';
import { createContainer } from '../core/container-factory';
import { TradeHandler } from '../handlers/trade-handler';
import { ConfigService } from '../core/config';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { TOKENS } from '../core/container';
import { EventType } from '../utils/parsers/types';

const logger = new Logger({ context: 'TestTradeHandler' });

async function testTradeHandler() {
  logger.info('🔍 Testing trade handler directly...');

  // Create container
  const container = await createContainer();
  
  // Get services
  const tradeHandler = await container.resolve(TOKENS.TradeHandler) as TradeHandler;
  const configService = await container.resolve(TOKENS.ConfigService) as ConfigService;
  const eventBus = await container.resolve(TOKENS.EventBus) as EventBus;
  const solPriceService = await container.resolve(TOKENS.SolPriceService) as any;

  // Get thresholds
  const ammThreshold = configService.get('monitors').ammSaveThreshold;
  const bcThreshold = configService.get('monitors').bcSaveThreshold;
  
  logger.info('📊 Thresholds:', {
    ammSaveThreshold: ammThreshold,
    bcSaveThreshold: bcThreshold
  });

  // Listen for database saves
  eventBus.on(EVENTS.TRADE_SAVED, (data: any) => {
    logger.info('✅ Trade saved to database!', data);
  });

  // Get current SOL price
  const solPrice = await solPriceService.getPrice();
  
  // Test AMM trade that should be saved (high market cap)
  const testAmmTrade = {
    type: EventType.AMM_TRADE,
    signature: 'TESTsig123',
    mintAddress: 'TEST123AMM456HIGH789MARKETCAP',
    userAddress: 'TESTtrader123',
    tradeType: 'buy' as const,
    solAmount: 10_000_000_000n, // 10 SOL in lamports
    tokenAmount: 1000000n,
    virtualSolReserves: 500_000_000_000n, // 500 SOL in lamports
    virtualTokenReserves: 50000000n,
    priceUsd: 0.001,
    marketCapUsd: 50000, // $50,000 (well above $1,000 threshold)
    volumeUsd: 10 * solPrice,
    slot: 123456789n,
    blockTime: Math.floor(Date.now() / 1000)
  };

  logger.info('📤 Emitting test AMM trade with high market cap:', {
    marketCapUsd: testAmmTrade.marketCapUsd,
    threshold: ammThreshold,
    shouldSave: testAmmTrade.marketCapUsd >= ammThreshold
  });

  // Process the test trade through the handler
  const result = await tradeHandler.processTrade(testAmmTrade, solPrice);

  // Wait a bit for processing
  await new Promise(resolve => setTimeout(resolve, 2000));

  logger.info('📦 First trade result:', {
    saved: result.saved,
    tokenCreated: !!result.token,
    mintAddress: result.token?.mintAddress
  });
  
  // Test AMM trade that should NOT be saved (low market cap)
  const testAmmTradeLow = {
    ...testAmmTrade,
    signature: 'TESTsig456',
    mintAddress: 'TEST123AMM456LOW789MARKETCAP',
    virtualSolReserves: 5_000_000_000n, // 5 SOL in lamports
    marketCapUsd: 500 // $500 (below $1,000 threshold)
  };

  logger.info('📤 Emitting test AMM trade with low market cap:', {
    marketCapUsd: testAmmTradeLow.marketCapUsd,
    threshold: ammThreshold,
    shouldSave: testAmmTradeLow.marketCapUsd >= ammThreshold
  });

  const result2 = await tradeHandler.processTrade(testAmmTradeLow, solPrice);
  
  logger.info('📦 Second trade result:', {
    saved: result2.saved,
    tokenCreated: !!result2.token,
    mintAddress: result2.token?.mintAddress
  });

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test BC trade for comparison
  const testBcTrade = {
    type: EventType.BC_TRADE,
    signature: 'TESTsig789',
    mintAddress: 'TEST123BC456HIGH789MARKETCAP',
    userAddress: 'TESTtrader456',
    tradeType: 'buy' as const,
    solAmount: 1_000_000_000n, // 1 SOL in lamports
    tokenAmount: 100000n,
    virtualSolReserves: 100_000_000_000n, // 100 SOL in lamports
    virtualTokenReserves: 10000000n,
    priceUsd: 0.0001,
    marketCapUsd: 10000, // $10,000 (above BC threshold)
    volumeUsd: 1 * solPrice,
    slot: 123456790n,
    blockTime: Math.floor(Date.now() / 1000),
    bondingCurveKey: 'TESTbondingCurve123',
    creator: 'TESTcreator123'
  };

  logger.info('📤 Emitting test BC trade:', {
    marketCapUsd: testBcTrade.marketCapUsd,
    threshold: bcThreshold,
    shouldSave: testBcTrade.marketCapUsd >= bcThreshold
  });

  const result3 = await tradeHandler.processTrade(testBcTrade, solPrice);
  
  logger.info('📦 BC trade result:', {
    saved: result3.saved,
    tokenCreated: !!result3.token,
    mintAddress: result3.token?.mintAddress
  });

  // Wait for final processing
  await new Promise(resolve => setTimeout(resolve, 3000));

  logger.info('✅ Test complete. Check logs above for results.');
  process.exit(0);
}

// Run the test
testTradeHandler().catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});