/**
 * Test Container Helper
 * Creates a dependency injection container with mock services for testing
 */

import { Container } from '../../src/core/container';
import { EventBus } from '../../src/core/event-bus';
import { Logger } from '../../src/core/logger';
import { MockDatabaseService } from './mock-services';
import { TOKENS } from '../../src/core/tokens';

export interface TestContainer extends Container {
  recordedEvents: Array<{ event: string; data: any; timestamp: Date }>;
  mockDb: MockDatabaseService;
}

export function createTestContainer(): TestContainer {
  const container = new Container() as TestContainer;
  
  // Create mock EventBus that records events
  const eventBus = new EventBus();
  const recordedEvents: Array<{ event: string; data: any; timestamp: Date }> = [];
  
  // Override emit to record events
  const originalEmit = eventBus.emit.bind(eventBus);
  eventBus.emit = (event: string, data: any) => {
    recordedEvents.push({ event, data, timestamp: new Date() });
    return originalEmit(event, data);
  };
  
  // Attach recorded events to container for easy access
  container.recordedEvents = recordedEvents;
  
  // Create mock database
  const mockDb = new MockDatabaseService();
  container.mockDb = mockDb;
  
  // Register services
  container.registerSingleton(TOKENS.EventBus, () => Promise.resolve(eventBus));
  container.registerSingleton(TOKENS.DatabaseService, () => Promise.resolve(mockDb));
  container.registerSingleton(TOKENS.Logger, () => Promise.resolve(new Logger({ context: 'Test' })));
  
  // Register mock config
  container.registerSingleton(TOKENS.Config, () => Promise.resolve({
    shyft: {
      grpcEndpoint: 'mock://localhost:9000',
      grpcToken: 'mock-token'
    },
    database: {
      url: 'postgresql://test@localhost:5432/test'
    },
    monitoring: {
      saveThreshold: 1000,
      saveAllTokens: false
    }
  }));
  
  // Register mock services that might be needed
  container.registerSingleton('SolPriceService', () => Promise.resolve({
    getSolPrice: () => Promise.resolve(100),
    startPriceUpdates: () => {},
    stopPriceUpdates: () => {}
  }));
  
  container.registerSingleton('MetadataEnricher', () => Promise.resolve({
    enrichTokensBatch: () => Promise.resolve([]),
    enrichToken: () => Promise.resolve(null)
  }));
  
  return container;
}

export function createIntegrationContainer(): Container {
  const container = new Container();
  
  // Use real services but with test configuration
  const eventBus = new EventBus();
  
  container.registerSingleton(TOKENS.EventBus, () => Promise.resolve(eventBus));
  container.registerSingleton(TOKENS.Logger, () => Promise.resolve(new Logger({ context: 'IntegrationTest' })));
  
  // Use test database URL
  container.registerSingleton(TOKENS.Config, () => Promise.resolve({
    shyft: {
      grpcEndpoint: process.env.TEST_GRPC_ENDPOINT || 'mock://localhost:9000',
      grpcToken: process.env.TEST_GRPC_TOKEN || 'test-token'
    },
    database: {
      url: process.env.TEST_DATABASE_URL || 'postgresql://test@localhost:5432/pump_monitor_test'
    },
    monitoring: {
      saveThreshold: 100, // Lower threshold for testing
      saveAllTokens: true // Save all for testing
    }
  }));
  
  return container;
}

export function clearContainerEvents(container: TestContainer): void {
  container.recordedEvents.length = 0;
}

export function getContainerEvents(container: TestContainer, eventName?: string): any[] {
  if (!eventName) {
    return container.recordedEvents;
  }
  
  return container.recordedEvents
    .filter(e => e.event === eventName)
    .map(e => e.data);
}

export function waitForContainerEvent(
  container: TestContainer,
  eventName: string,
  timeout: number = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkForEvent = () => {
      const event = container.recordedEvents.find(e => e.event === eventName);
      
      if (event) {
        resolve(event.data);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      } else {
        setTimeout(checkForEvent, 10);
      }
    };
    
    checkForEvent();
  });
}