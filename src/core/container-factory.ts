/**
 * Container Factory - Creates and configures the DI container
 */

import { Container, TOKENS } from './container';
import { EventBus } from './event-bus';
import { ConfigService } from './config';
import { StreamClient } from '../stream/client';
import { SolPriceService } from '../services/sol-price';
import { UnifiedDbServiceV2 } from '../database/unified-db-service';
import { GraphQLMetadataEnricher } from '../services/graphql-metadata-enricher';
import { UnifiedGraphQLPriceRecovery } from '../services/unified-graphql-price-recovery';
import { DexScreenerPriceRecovery } from '../services/dexscreener-price-recovery';

/**
 * Create and configure the dependency injection container
 */
export async function createContainer(): Promise<Container> {
  const container = new Container();
  
  // Register core services
  container.registerSingleton(TOKENS.EventBus, () => new EventBus());
  container.registerSingleton(TOKENS.ConfigService, () => new ConfigService());
  
  // Register stream client
  container.registerSingleton(TOKENS.StreamClient, () => StreamClient.getInstance());
  
  // Register StreamManager (shared stream for all monitors)
  container.registerSingleton(TOKENS.StreamManager, async () => {
    const { StreamManager } = await import('./stream-manager');
    const streamClientService = await container.resolve(TOKENS.StreamClient);
    const eventBus = await container.resolve(TOKENS.EventBus);
    const config = await container.resolve(TOKENS.ConfigService);
    
    const manager = new StreamManager({
      streamClient: streamClientService.getClient(), // Pass the yellowstone-grpc Client
      eventBus,
      reconnectDelay: config.get('grpc').reconnectDelay,
      maxReconnectDelay: config.get('grpc').maxReconnectDelay
    });
    
    // Don't start here - let it start when first monitor subscribes
    
    return manager;
  });
  
  // Register database service
  container.registerSingleton(TOKENS.DatabaseService, () => UnifiedDbServiceV2.getInstance());
  
  // Register price service
  container.registerSingleton(TOKENS.SolPriceService, () => SolPriceService.getInstance());
  
  // Register metadata enricher
  container.registerSingleton(TOKENS.MetadataEnricher, () => GraphQLMetadataEnricher.getInstance());
  
  // Register price recovery services
  container.registerSingleton(TOKENS.PriceRecovery, async () => {
    const config = await container.resolve(TOKENS.ConfigService);
    
    // Return appropriate recovery service based on config
    if (config.get('services').recoveryInterval > 0) {
      // For now, return DexScreener recovery as it's the most reliable
      return DexScreenerPriceRecovery.getInstance();
    }
    
    return UnifiedGraphQLPriceRecovery.getInstance();
  });
  
  // Register parsers
  container.registerTransient(TOKENS.EventParser, async () => {
    const { UnifiedEventParser } = await import('../parsers/unified-event-parser');
    const eventBus = await container.resolve(TOKENS.EventBus);
    const config = await container.resolve(TOKENS.ConfigService);
    
    return new UnifiedEventParser({
      eventBus,
      logErrors: config.get('monitors').debugParseErrors
    });
  });
  
  // Register AMM Enhancement Services
  container.registerSingleton(TOKENS.LiquidityEventHandler, async () => {
    const { LiquidityEventHandler } = await import('../handlers/liquidity-event-handler');
    const eventBus = await container.resolve(TOKENS.EventBus);
    const dbService = await container.resolve(TOKENS.DatabaseService);
    const poolStateService = await container.resolve(TOKENS.PoolStateService);
    
    return new LiquidityEventHandler(eventBus, dbService, poolStateService);
  });
  
  container.registerSingleton(TOKENS.AmmFeeService, async () => {
    const { AmmFeeService } = await import('../services/amm-fee-service');
    return AmmFeeService.getInstance();
  });
  
  container.registerSingleton(TOKENS.LpPositionCalculator, async () => {
    const { LpPositionCalculator } = await import('../services/lp-position-calculator');
    return LpPositionCalculator.getInstance();
  });
  
  container.registerSingleton(TOKENS.AmmPoolAnalytics, async () => {
    const { AmmPoolAnalytics } = await import('../services/amm-pool-analytics');
    return AmmPoolAnalytics.getInstance();
  });
  
  // Register calculators
  container.registerSingleton(TOKENS.PriceCalculator, async () => {
    const { PriceCalculator } = await import('../services/price-calculator');
    return new PriceCalculator();
  });
  
  // Register repositories
  container.registerSingleton(TOKENS.TokenRepository, async () => {
    const { TokenRepository } = await import('../repositories/token-repository');
    const { Pool } = await import('pg');
    const eventBus = await container.resolve(TOKENS.EventBus);
    const config = await container.resolve(TOKENS.ConfigService);
    
    const pool = new Pool({
      connectionString: config.get('database').url,
      max: config.get('database').poolSize,
      idleTimeoutMillis: config.get('database').idleTimeout
    });
    
    return new TokenRepository(pool, eventBus);
  });
  
  container.registerSingleton(TOKENS.TradeRepository, async () => {
    const { TradeRepository } = await import('../repositories/trade-repository');
    const { Pool } = await import('pg');
    const config = await container.resolve(TOKENS.ConfigService);
    
    const pool = new Pool({
      connectionString: config.get('database').url,
      max: config.get('database').poolSize,
      idleTimeoutMillis: config.get('database').idleTimeout
    });
    
    return new TradeRepository(pool);
  });
  
  // Register handlers
  container.registerTransient(TOKENS.TradeHandler, async () => {
    const { TradeHandler } = await import('../handlers/trade-handler');
    const tokenRepo = await container.resolve(TOKENS.TokenRepository);
    const tradeRepo = await container.resolve(TOKENS.TradeRepository);
    const priceCalculator = await container.resolve(TOKENS.PriceCalculator);
    const eventBus = await container.resolve(TOKENS.EventBus);
    const config = await container.resolve(TOKENS.ConfigService);
    
    return new TradeHandler({
      tokenRepo,
      tradeRepo,
      priceCalculator,
      eventBus,
      config
    });
  });
  
  container.registerSingleton(TOKENS.GraduationHandler, async () => {
    const { GraduationHandler } = await import('../handlers/graduation-handler');
    const eventBus = await container.resolve(TOKENS.EventBus);
    const tokenRepo = await container.resolve(TOKENS.TokenRepository);
    const dbService = await container.resolve(TOKENS.DatabaseService);
    
    const handler = new GraduationHandler(eventBus, tokenRepo, dbService);
    await handler.initialize();
    
    return handler;
  });
  
  container.registerTransient(TOKENS.EnhancedTradeHandler, async () => {
    const { EnhancedTradeHandler } = await import('../handlers/enhanced-trade-handler');
    const tokenRepo = await container.resolve(TOKENS.TokenRepository);
    const tradeRepo = await container.resolve(TOKENS.TradeRepository);
    const priceCalculator = await container.resolve(TOKENS.PriceCalculator);
    const eventBus = await container.resolve(TOKENS.EventBus);
    const config = await container.resolve(TOKENS.ConfigService);
    const solPriceService = await container.resolve(TOKENS.SolPriceService);
    
    return new EnhancedTradeHandler({
      tokenRepo,
      tradeRepo,
      priceCalculator,
      eventBus,
      config,
      solPriceService,
      container
    });
  });
  
  container.registerSingleton(TOKENS.PoolRepository, async () => {
    // TODO: Implement pool repository
    throw new Error('PoolRepository not implemented yet');
  });
  
  // Register pool state service
  container.registerSingleton(TOKENS.PoolStateService, async () => {
    const { AmmPoolStateService } = await import('../services/amm-pool-state-service');
    return AmmPoolStateService.getInstance();
  });
  
  // Register metadata enricher
  container.registerSingleton(TOKENS.MetadataEnricher, async () => {
    const { EnhancedAutoEnricher } = await import('../services/enhanced-auto-enricher');
    const enricher = EnhancedAutoEnricher.getInstance();
    await enricher.start();
    return enricher;
  });
  
  // Initialize critical services
  const config = await container.resolve(TOKENS.ConfigService);
  
  // Log configuration in development
  if (config.isDevelopment()) {
    config.logConfig();
  }
  
  return container;
}

/**
 * Create a test container with mock services
 */
export async function createTestContainer(): Promise<Container> {
  const container = new Container();
  
  // Register mock services for testing
  container.registerSingleton(TOKENS.EventBus, () => new EventBus());
  container.registerSingleton(TOKENS.ConfigService, () => ({
    get: (key: string) => {
      // Return test configuration
      switch (key) {
        case 'monitors':
          return {
            bcSaveThreshold: 1000,
            ammSaveThreshold: 100,
            saveAllTokens: true,
            displayInterval: 1000,
            debugParseErrors: true
          };
        case 'services':
          return {
            solPriceUpdateInterval: 5000,
            enrichmentBatchSize: 10,
            enrichmentInterval: 5000,
            recoveryInterval: 0
          };
        case 'grpc':
          return {
            endpoint: 'https://test.grpc.endpoint',
            token: 'test-token',
            reconnectDelay: 1000,
            maxReconnectDelay: 5000
          };
        default:
          return {};
      }
    },
    isDevelopment: () => true,
    isProduction: () => false,
    isEnabled: () => true,
    logConfig: () => console.log('Test configuration')
  }));
  
  // Mock stream client
  container.registerSingleton(TOKENS.StreamClient, () => ({
    subscribe: async () => {
      // Return async iterator that yields test data
      return {
        async *[Symbol.asyncIterator]() {
          yield { test: 'data' };
        }
      };
    }
  }));
  
  // Mock database service
  container.registerSingleton(TOKENS.DatabaseService, () => ({
    getInstance: () => ({
      saveToken: async () => true,
      processTrade: async () => true
    })
  }));
  
  // Mock SOL price service
  container.registerSingleton(TOKENS.SolPriceService, () => ({
    initialize: async () => {},
    getPrice: async () => 180
  }));
  
  return container;
}