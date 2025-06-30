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
  
  // Register database service
  container.registerSingleton(TOKENS.DatabaseService, () => UnifiedDbServiceV2.getInstance());
  
  // Register price service
  container.registerSingleton(TOKENS.SolPriceService, () => SolPriceService.getInstance());
  
  // Register metadata enricher
  container.registerSingleton(TOKENS.MetadataEnricher, () => GraphQLMetadataEnricher.getInstance());
  
  // Register price recovery services
  container.registerSingleton(TOKENS.PriceRecovery, async () => {
    const config = await container.resolve(TOKENS.ConfigService);
    const eventBus = await container.resolve(TOKENS.EventBus);
    
    // Return appropriate recovery service based on config
    if (config.get('services').recoveryInterval > 0) {
      // For now, return DexScreener recovery as it's the most reliable
      return DexScreenerPriceRecovery.getInstance();
    }
    
    return UnifiedGraphQLPriceRecovery.getInstance();
  });
  
  // Register parsers (will be implemented in next phase)
  container.registerTransient(TOKENS.EventParser, () => {
    throw new Error('EventParser not implemented yet');
  });
  
  // Register calculators (will be implemented in next phase)
  container.registerSingleton(TOKENS.PriceCalculator, () => {
    throw new Error('PriceCalculator not implemented yet');
  });
  
  // Register handlers (will be implemented in next phase)
  container.registerTransient(TOKENS.TradeHandler, () => {
    throw new Error('TradeHandler not implemented yet');
  });
  
  container.registerTransient(TOKENS.GraduationHandler, () => {
    throw new Error('GraduationHandler not implemented yet');
  });
  
  // Register repositories (will be implemented in next phase)
  container.registerSingleton(TOKENS.TokenRepository, async () => {
    const db = await container.resolve(TOKENS.DatabaseService);
    throw new Error('TokenRepository not implemented yet');
  });
  
  container.registerSingleton(TOKENS.TradeRepository, async () => {
    const db = await container.resolve(TOKENS.DatabaseService);
    throw new Error('TradeRepository not implemented yet');
  });
  
  container.registerSingleton(TOKENS.PoolRepository, async () => {
    const db = await container.resolve(TOKENS.DatabaseService);
    throw new Error('PoolRepository not implemented yet');
  });
  
  // Initialize critical services
  const config = await container.resolve(TOKENS.ConfigService);
  const eventBus = await container.resolve(TOKENS.EventBus);
  
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
    getCurrentPrice: async () => 180
  }));
  
  return container;
}