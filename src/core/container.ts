/**
 * Dependency Injection Container
 * Manages service creation and lifecycle
 */

export type Factory<T> = () => T | Promise<T>;
export type ServiceToken<T> = string & { __type?: T };

export interface ServiceDescriptor<T> {
  token: ServiceToken<T>;
  factory: Factory<T>;
  singleton?: boolean;
}

export class Container {
  private services = new Map<string, any>();
  private factories = new Map<string, ServiceDescriptor<any>>();
  private resolving = new Set<string>();

  /**
   * Register a service factory
   */
  register<T>(descriptor: ServiceDescriptor<T>): void {
    this.factories.set(descriptor.token, descriptor);
  }

  /**
   * Register a singleton service
   */
  registerSingleton<T>(token: ServiceToken<T>, factory: Factory<T>): void {
    this.register({
      token,
      factory,
      singleton: true
    });
  }

  /**
   * Register a transient service (new instance each time)
   */
  registerTransient<T>(token: ServiceToken<T>, factory: Factory<T>): void {
    this.register({
      token,
      factory,
      singleton: false
    });
  }

  /**
   * Register a value directly
   */
  registerValue<T>(token: ServiceToken<T>, value: T): void {
    this.services.set(token, value);
  }

  /**
   * Resolve a service
   */
  async resolve<T>(token: ServiceToken<T>): Promise<T> {
    // Check if we already have an instance
    if (this.services.has(token)) {
      return this.services.get(token);
    }

    // Check for circular dependencies
    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency detected: ${token}`);
    }

    // Get the factory
    const descriptor = this.factories.get(token);
    if (!descriptor) {
      throw new Error(`Service not registered: ${token}`);
    }

    try {
      this.resolving.add(token);
      
      // Create the instance
      const instance = await descriptor.factory();
      
      // Store if singleton
      if (descriptor.singleton) {
        this.services.set(token, instance);
      }
      
      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  /**
   * Resolve multiple services
   */
  async resolveAll<T>(...tokens: ServiceToken<T>[]): Promise<T[]> {
    return Promise.all(tokens.map(token => this.resolve(token)));
  }

  /**
   * Check if a service is registered
   */
  has(token: string): boolean {
    return this.services.has(token) || this.factories.has(token);
  }

  /**
   * Clear all services (useful for testing)
   */
  clear(): void {
    this.services.clear();
    this.factories.clear();
    this.resolving.clear();
  }
}

// Service tokens with type information
export const TOKENS = {
  // Core services
  StreamClient: 'StreamClient' as ServiceToken<any>,
  StreamManager: 'StreamManager' as ServiceToken<any>,
  DatabaseService: 'DatabaseService' as ServiceToken<any>,
  SolPriceService: 'SolPriceService' as ServiceToken<any>,
  EventBus: 'EventBus' as ServiceToken<any>,
  ConfigService: 'ConfigService' as ServiceToken<any>,
  Logger: 'Logger' as ServiceToken<any>,
  
  // Parsers
  EventParser: 'EventParser' as ServiceToken<any>,
  
  // Calculators
  PriceCalculator: 'PriceCalculator' as ServiceToken<any>,
  
  // Handlers
  TradeHandler: 'TradeHandler' as ServiceToken<any>,
  EnhancedTradeHandler: 'EnhancedTradeHandler' as ServiceToken<any>,
  GraduationHandler: 'GraduationHandler' as ServiceToken<any>,
  LiquidityEventHandler: 'LiquidityEventHandler' as ServiceToken<any>,
  FeeEventHandler: 'FeeEventHandler' as ServiceToken<any>,
  LpPositionHandler: 'LpPositionHandler' as ServiceToken<any>,
  PoolAnalyticsHandler: 'PoolAnalyticsHandler' as ServiceToken<any>,
  
  // Repositories
  TokenRepository: 'TokenRepository' as ServiceToken<any>,
  TradeRepository: 'TradeRepository' as ServiceToken<any>,
  PoolRepository: 'PoolRepository' as ServiceToken<any>,
  
  // Pool State Service
  PoolStateService: 'PoolStateService' as ServiceToken<any>,
  
  // WebSocket
  WebSocketServer: 'WebSocketServer' as ServiceToken<any>,
  
  // Enrichment
  MetadataEnricher: 'MetadataEnricher' as ServiceToken<any>,
  PriceRecovery: 'PriceRecovery' as ServiceToken<any>,
} as const;

// Global container instance (can be replaced for testing)
let globalContainer: Container | null = null;

export function getGlobalContainer(): Container {
  if (!globalContainer) {
    globalContainer = new Container();
  }
  return globalContainer;
}

export function setGlobalContainer(container: Container): void {
  globalContainer = container;
}

export function resetGlobalContainer(): void {
  globalContainer = null;
}