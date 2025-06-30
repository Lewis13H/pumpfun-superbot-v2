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
      container.register(ServiceToken.for('TestService'), async () => testService);

      // Resolve the service
      const resolved = await container.resolve(ServiceToken.for('TestService'));
      expect(resolved).toBe(testService);
    });

    it('should create singleton instances', async () => {
      let constructorCalls = 0;
      
      class TestService {
        constructor() {
          constructorCalls++;
        }
      }

      container.register(ServiceToken.for('TestService'), async () => new TestService());

      // Resolve multiple times
      const instance1 = await container.resolve(ServiceToken.for('TestService'));
      const instance2 = await container.resolve(ServiceToken.for('TestService'));

      expect(constructorCalls).toBe(1);
      expect(instance1).toBe(instance2);
    });

    it('should resolve services with dependencies', async () => {
      // Register EventBus
      container.register(TOKENS.EventBus, async () => new EventBus());

      // Register a service that depends on EventBus
      class TestService {
        constructor(public eventBus: EventBus) {}
      }

      container.register(ServiceToken.for('TestService'), async () => {
        const eventBus = await container.resolve(TOKENS.EventBus);
        return new TestService(eventBus);
      });

      // Resolve the service
      const testService = await container.resolve(ServiceToken.for('TestService')) as TestService;
      expect(testService.eventBus).toBeInstanceOf(EventBus);
    });

    it('should detect circular dependencies', async () => {
      // Create circular dependency: A -> B -> A
      const tokenA = ServiceToken.for('ServiceA');
      const tokenB = ServiceToken.for('ServiceB');

      container.register(tokenA, async () => {
        await container.resolve(tokenB);
        return { name: 'A' };
      });

      container.register(tokenB, async () => {
        await container.resolve(tokenA);
        return { name: 'B' };
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
        container.register(TOKENS.EventBus, async () => new EventBus());
        container.register(TOKENS.ConfigService, async () => new ConfigService());
        container.register(TOKENS.Logger, async () => new Logger({ context: 'Test' }));
        
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
      const unknownToken = ServiceToken.for('UnknownService');
      await expect(container.resolve(unknownToken)).rejects.toThrow('Service UnknownService not registered');
    });

    it('should handle factory errors gracefully', async () => {
      container.register(ServiceToken.for('ErrorService'), async () => {
        throw new Error('Factory error');
      });

      await expect(container.resolve(ServiceToken.for('ErrorService')))
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
      const token = ServiceToken.for('TransientService');
      container.registerTransient(token, async () => new TransientService());

      // Each resolution should create a new instance
      const instance1 = await container.resolve(token) as TransientService;
      const instance2 = await container.resolve(token) as TransientService;

      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
      expect(instance1).not.toBe(instance2);
    });
  });
});