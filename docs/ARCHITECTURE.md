# Architecture Guide

## Overview

The pump.fun monitor v2.0 uses a clean architecture approach with dependency injection, event-driven communication, and clear separation of concerns. This guide explains the key architectural decisions and patterns.

## Core Principles

### 1. Dependency Injection (DI)

Instead of singletons and global instances, we use a DI container to manage dependencies:

```typescript
// OLD (problematic)
const dbService = UnifiedDbServiceV2.getInstance();
const solPrice = SolPriceService.getInstance();

// NEW (clean DI)
export class BCMonitorRefactored extends BaseMonitor {
  constructor(container: Container) {
    super(options, container);
    // Services are injected by the container
  }
}
```

**Benefits:**
- Testability - Easy to mock dependencies
- Flexibility - Easy to swap implementations
- No hidden dependencies
- Clear dependency graph

### 2. Event-Driven Architecture

Components communicate through events rather than direct coupling:

```typescript
// Event emission
eventBus.emit(EVENTS.TOKEN_DISCOVERED, {
  mintAddress: token.mintAddress,
  marketCapUsd: token.marketCapUsd
});

// Event subscription
eventBus.on(EVENTS.TOKEN_DISCOVERED, async (data) => {
  await enrichmentService.enrich(data.mintAddress);
});
```

**Event Flow:**
```
Monitor → Parser → Handler → Repository → EventBus
                                              ↓
                    WebSocket ← API ← EnrichmentService
```

### 3. Base Abstractions

Common functionality is extracted to base classes:

```typescript
export abstract class BaseMonitor {
  // Common: gRPC connection, SOL price, stats, shutdown
  protected async startMonitoring(): Promise<void> { }
  
  // Abstract: Monitor-specific implementation
  abstract processStreamData(data: any): Promise<void>;
  abstract displayStats(): void;
}
```

### 4. Repository Pattern

Clean data access layer with clear interfaces:

```typescript
export class TokenRepository extends BaseRepository<Token> {
  async findByMintAddress(mint: string): Promise<Token | null>
  async save(token: Token): Promise<Token>
  async findAboveThreshold(threshold: number): Promise<Token[]>
}
```

### 5. Strategy Pattern

Pluggable parsing strategies for different event types:

```typescript
export class UnifiedEventParser {
  private strategies: ParseStrategy[] = [
    new BCTradeStrategy(),
    new AMMTradeStrategy(),
    new GraduationStrategy()
  ];
  
  parse(context: ParseContext): ParsedEvent | null {
    for (const strategy of this.strategies) {
      if (strategy.canParse(context)) {
        return strategy.parse(context);
      }
    }
    return null;
  }
}
```

## Component Architecture

### Container & Service Registration

```typescript
// core/container-factory.ts
export async function createContainer(): Promise<Container> {
  const container = new Container();
  
  // Register services
  container.registerSingleton(TOKENS.EventBus, () => new EventBus());
  container.registerSingleton(TOKENS.ConfigService, () => new ConfigService());
  
  // Lazy singleton registration
  container.registerSingleton(TOKENS.StreamClient, () => 
    StreamClient.getInstance()
  );
  
  // Transient services (new instance each time)
  container.registerTransient(TOKENS.EventParser, async () => {
    const eventBus = await container.resolve(TOKENS.EventBus);
    return new UnifiedEventParser({ eventBus });
  });
  
  return container;
}
```

### Monitor Lifecycle

```
1. Container Creation
   ↓
2. Service Registration
   ↓
3. Monitor Instantiation
   ↓
4. Service Initialization (initializeServices)
   ↓
5. gRPC Stream Connection
   ↓
6. Event Processing Loop
   ↓
7. Graceful Shutdown
```

### Event Flow

```
gRPC Stream
    ↓
Monitor.processStreamData()
    ↓
EventParser.parse()
    ↓
Strategy.canParse() → Strategy.parse()
    ↓
TradeHandler.processTrade()
    ↓
Repository.save()
    ↓
EventBus.emit()
    ↓
[WebSocket, Enricher, Stats, etc.]
```

### Data Flow

```typescript
// 1. Raw gRPC data arrives
const data = {
  transaction: { /* ... */ },
  slot: 12345678n
};

// 2. Create parse context
const context = UnifiedEventParser.createContext(data);

// 3. Parse into structured event
const event: BCTradeEvent = {
  type: EventType.BC_TRADE,
  signature: 'abc...',
  mintAddress: 'So11...',
  tradeType: TradeType.BUY,
  priceUsd: 0.0001,
  // ...
};

// 4. Process business logic
const token = await tradeHandler.processTrade(event, solPrice);

// 5. Emit domain events
if (token.marketCapUsd >= THRESHOLD) {
  eventBus.emit(EVENTS.TOKEN_THRESHOLD_CROSSED, token);
}
```

## Design Patterns

### Singleton Adapter Pattern

To integrate legacy singleton services with DI:

```typescript
// Adapter for legacy service
container.registerSingleton(TOKENS.SolPriceService, () => ({
  getPrice: async () => {
    const instance = SolPriceService.getInstance();
    return instance.getCurrentPrice();
  }
}));
```

### Builder Pattern for Complex Objects

```typescript
export class SubscribeRequestBuilder {
  private request: SubscribeRequest;
  
  constructor() {
    this.request = {
      commitment: CommitmentLevel.CONFIRMED,
      accounts: {},
      slots: {},
      transactions: {}
    };
  }
  
  withProgram(programId: string): this {
    this.request.accounts.owner = [programId];
    return this;
  }
  
  build(): SubscribeRequest {
    return this.request;
  }
}
```

### Observer Pattern via EventBus

```typescript
export class EventBus {
  private events = new Map<string, Set<EventSubscription>>();
  
  on(event: string, handler: EventHandler): void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add({ handler, once: false });
  }
  
  emit<T>(event: string, data: T): void {
    const subscriptions = this.events.get(event);
    if (!subscriptions) return;
    
    for (const { handler } of subscriptions) {
      handler(data);
    }
  }
}
```

## Best Practices

### 1. Service Design

- Services should be stateless when possible
- Use interfaces for service contracts
- Avoid circular dependencies
- Prefer composition over inheritance

### 2. Error Handling

```typescript
// Centralized error handling
export class BaseMonitor {
  protected async safeProcess(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.stats.errors++;
      if (this.shouldLogError(error)) {
        this.logger.error('Processing error', error as Error);
      }
      this.eventBus.emit(EVENTS.MONITOR_ERROR, { error, monitor: this });
    }
  }
}
```

### 3. Configuration Management

```typescript
// Environment → Config Service → Components
export class ConfigService {
  private config: AppConfig;
  
  constructor() {
    this.config = this.loadFromEnvironment();
    this.validate();
  }
  
  get(path: string): any {
    // Dot notation support: 'monitors.bcSaveThreshold'
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }
}
```

### 4. Testing Strategy

```typescript
// Easy to test with DI
describe('BCMonitor', () => {
  let container: Container;
  let monitor: BCMonitorRefactored;
  
  beforeEach(() => {
    container = new Container();
    // Register mocks
    container.register(TOKENS.DatabaseService, () => mockDb);
    container.register(TOKENS.EventBus, () => new EventBus());
    
    monitor = new BCMonitorRefactored(container);
  });
  
  it('should process trades', async () => {
    await monitor.processStreamData(mockData);
    expect(mockDb.save).toHaveBeenCalled();
  });
});
```

## Performance Considerations

### 1. Batch Processing

```typescript
export class BatchProcessor<T> {
  private queue: T[] = [];
  private timer?: NodeJS.Timeout;
  
  constructor(
    private processor: (items: T[]) => Promise<void>,
    private batchSize = 100,
    private interval = 1000
  ) {}
  
  add(item: T): void {
    this.queue.push(item);
    if (this.queue.length >= this.batchSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.interval);
    }
  }
}
```

### 2. Connection Pooling

```typescript
// Repositories use connection pools
export class BaseRepository<T> {
  constructor(protected pool: Pool) {}
  
  protected async query(text: string, params?: any[]): Promise<any> {
    const client = await this.pool.connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }
}
```

### 3. Caching Strategy

```typescript
export class TokenCache {
  private cache = new Map<string, CachedToken>();
  private readonly TTL = 60000; // 1 minute
  
  get(mintAddress: string): Token | null {
    const cached = this.cache.get(mintAddress);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(mintAddress);
      return null;
    }
    
    return cached.token;
  }
}
```

## Migration Path

### From Singleton to DI

1. Create service interface
2. Wrap singleton in adapter
3. Register in container
4. Inject via constructor
5. Remove getInstance() calls

### From Direct Calls to Events

1. Identify coupling points
2. Define event types
3. Emit events at boundaries
4. Subscribe in dependent components
5. Remove direct dependencies

## Future Enhancements

1. **Plugin System** - Dynamic loading of strategies
2. **Middleware Pipeline** - Request/response interceptors
3. **Service Mesh** - Microservices architecture
4. **CQRS Pattern** - Command/Query separation
5. **Event Sourcing** - Full audit trail