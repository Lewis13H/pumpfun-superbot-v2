/**
 * Integration tests for Dependency Injection Container
 */

import { Container, ServiceToken, TOKENS } from '../../core/container';
import { EventBus } from '../../core/event-bus';
import { ConfigService } from '../../core/config';
import { Logger } from '../../core/logger';

describe('Container Integration Tests', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('Service Registration and Resolution', () => {
    it('should register and resolve services', async () => {
      // Register a simple service
      const testService = { name: 'test' };
      const testToken = 'TestService' as ServiceToken<typeof testService>;
      container.register({
        token: testToken,
        factory: async () => testService,
        singleton: true
      });

      // Resolve the service
      const resolved = await container.resolve(testToken);
      expect(resolved).toBe(testService);
    });

    it('should create singleton instances', async () => {
      let constructorCalls = 0;
      
      class TestService {
        constructor() {
          constructorCalls++;
        }
      }

      const testToken = 'TestService' as ServiceToken<TestService>;
      container.register({
        token: testToken,
        factory: async () => new TestService(),
        singleton: true
      });

      // Resolve multiple times
      const instance1 = await container.resolve(testToken);
      const instance2 = await container.resolve(testToken);

      expect(constructorCalls).toBe(1);
      expect(instance1).toBe(instance2);
    });

    it('should resolve services with dependencies', async () => {
      // Register EventBus
      container.register({
        token: TOKENS.EventBus,
        factory: async () => new EventBus(),
        singleton: true
      });

      // Register a service that depends on EventBus
      class TestService {
        constructor(public eventBus: EventBus) {}
      }

      const testToken = 'TestService' as ServiceToken<TestService>;
      container.register({
        token: testToken,
        factory: async () => {
          const eventBus = await container.resolve(TOKENS.EventBus);
          return new TestService(eventBus);
        },
        singleton: true
      });

      // Resolve the service
      const testService = await container.resolve(testToken) as TestService;
      expect(testService.eventBus).toBeInstanceOf(EventBus);
    });

    it('should detect circular dependencies', async () => {
      // Create circular dependency: A -> B -> A
      const tokenA = 'ServiceA' as ServiceToken<{name: string}>;
      const tokenB = 'ServiceB' as ServiceToken<{name: string}>;

      container.register({
        token: tokenA,
        factory: async () => {
          await container.resolve(tokenB);
          return { name: 'A' };
        },
        singleton: true
      });

      container.register({
        token: tokenB,
        factory: async () => {
          await container.resolve(tokenA);
          return { name: 'B' };
        },
        singleton: true
      });

      // Should throw error when resolving
      await expect(container.resolve(tokenA)).rejects.toThrow('Circular dependency detected');
    });
  });

  describe('Container Factory Integration', () => {
    it('should create a fully configured container', async () => {
      // Import factory (mocked for testing)
      const createContainer = async () => {
        const container = new Container();
        
        // Register core services
        container.register({
          token: TOKENS.EventBus,
          factory: async () => new EventBus(),
          singleton: true
        });
        container.register({
          token: TOKENS.ConfigService,
          factory: async () => new ConfigService(),
          singleton: true
        });
        container.register({
          token: TOKENS.Logger,
          factory: async () => new Logger({ context: 'Test' }),
          singleton: true
        });
        
        return container;
      };

      const factoryContainer = await createContainer();

      // Should be able to resolve all core services
      const eventBus = await factoryContainer.resolve(TOKENS.EventBus);
      const config = await factoryContainer.resolve(TOKENS.ConfigService);
      const logger = await factoryContainer.resolve(TOKENS.Logger);

      expect(eventBus).toBeInstanceOf(EventBus);
      expect(config).toBeInstanceOf(ConfigService);
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unregistered services', async () => {
      const unknownToken = 'UnknownService' as ServiceToken<any>;
      await expect(container.resolve(unknownToken)).rejects.toThrow('Service not registered: UnknownService');
    });

    it('should handle factory errors gracefully', async () => {
      const errorToken = 'ErrorService' as ServiceToken<any>;
      container.register({
        token: errorToken,
        factory: async () => {
          throw new Error('Factory error');
        },
        singleton: true
      });

      await expect(container.resolve(errorToken))
        .rejects.toThrow('Factory error');
    });
  });

  describe('Multi-Instance Services', () => {
    it('should support transient services', async () => {
      let instanceCount = 0;
      
      class TransientService {
        id: number;
        constructor() {
          this.id = ++instanceCount;
        }
      }

      // Register as transient
      const token = 'TransientService' as ServiceToken<TransientService>;
      container.registerTransient(token, async () => new TransientService());

      // Each resolution should create a new instance
      const instance1 = await container.resolve(token);
      const instance2 = await container.resolve(token);

      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
      expect(instance1).not.toBe(instance2);
    });
  });
});