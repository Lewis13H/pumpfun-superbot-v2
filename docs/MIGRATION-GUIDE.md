# Migration Guide: From Legacy to Refactored Architecture

This guide helps you migrate from the legacy singleton-based system to the new DI-based architecture.

## Overview of Changes

### Before (Legacy)
- Singleton services with `getInstance()`
- Direct service coupling
- Scattered configuration
- Mixed concerns in monitors
- Versioned files (v2, v3, etc.)

### After (Refactored)
- Dependency injection container
- Event-driven communication
- Centralized configuration
- Clean separation of concerns
- Single source of truth

## Migration Steps

### Step 1: Update Imports

Replace singleton imports with DI imports:

```typescript
// OLD
import { UnifiedDbServiceV2 } from './database/unified-db-service-v2';
import { SolPriceService } from './services/sol-price';
const db = UnifiedDbServiceV2.getInstance();
const solPrice = SolPriceService.getInstance();

// NEW
import { createContainer } from './core/container-factory';
import { TOKENS } from './core/container';
const container = await createContainer();
const db = await container.resolve(TOKENS.DatabaseService);
const solPrice = await container.resolve(TOKENS.SolPriceService);
```

### Step 2: Update Monitor Code

Transform existing monitors to extend BaseMonitor:

```typescript
// OLD
export class BCMonitor {
  private db = UnifiedDbServiceV2.getInstance();
  private solPrice = SolPriceService.getInstance();
  
  async start() {
    // Manual setup code
  }
}

// NEW
export class BCMonitorRefactored extends BaseMonitor {
  constructor(container: Container) {
    super({
      programId: PUMP_PROGRAM,
      monitorName: 'Bonding Curve Monitor',
      color: chalk.yellow
    }, container);
  }
  
  async processStreamData(data: any): Promise<void> {
    // Process logic here
  }
  
  displayStats(): void {
    // Statistics display
  }
}
```

### Step 3: Replace Direct Service Calls

Convert direct service calls to event emissions:

```typescript
// OLD
class TradeProcessor {
  async processTrade(trade: Trade) {
    const token = await db.saveToken(trade);
    await enrichmentService.enrichToken(token);
    websocketServer.broadcast('new-token', token);
  }
}

// NEW
class TradeHandler {
  async processTrade(event: TradeEvent, solPrice: number) {
    const token = await this.tokenRepo.save(mapToToken(event));
    
    // Emit events instead of direct calls
    this.eventBus.emit(EVENTS.TOKEN_DISCOVERED, token);
    
    if (token.marketCapUsd >= threshold) {
      this.eventBus.emit(EVENTS.TOKEN_THRESHOLD_CROSSED, token);
    }
  }
}
```

### Step 4: Update Configuration

Move from environment variables to centralized config:

```typescript
// OLD
const threshold = process.env.BC_SAVE_THRESHOLD || '8888';
const saveAll = process.env.SAVE_ALL_TOKENS === 'true';

// NEW
export class ConfigService {
  get(path: string): any {
    // 'monitors.bcSaveThreshold' → 8888
    // 'monitors.saveAllTokens' → false
  }
}

// Usage
const threshold = this.config.get('monitors.bcSaveThreshold');
const saveAll = this.config.get('monitors.saveAllTokens');
```

### Step 5: Update Database Access

Replace direct DB calls with repositories:

```typescript
// OLD
const result = await db.pool.query(
  'SELECT * FROM tokens_unified WHERE market_cap > $1',
  [threshold]
);

// NEW
export class TokenRepository extends BaseRepository<Token> {
  async findAboveThreshold(threshold: number): Promise<Token[]> {
    return this.query(
      'SELECT * FROM tokens_unified WHERE market_cap > $1',
      [threshold]
    );
  }
}

// Usage
const tokens = await tokenRepo.findAboveThreshold(8888);
```

### Step 6: Update Event Handling

Replace callback patterns with EventBus:

```typescript
// OLD
websocketServer.on('trade', (data) => {
  processNewTrade(data);
  updateStatistics(data);
  checkGraduation(data);
});

// NEW
eventBus.on(EVENTS.BC_TRADE, async (trade) => {
  // Handle trade
});

eventBus.on(EVENTS.BC_TRADE, async (trade) => {
  // Update statistics separately
});

eventBus.on(EVENTS.BC_TRADE, async (trade) => {
  // Check graduation separately
});
```

## Running Both Systems

During migration, you can run both systems side-by-side:

```bash
# Terminal 1: Legacy system
npm run bc-monitor
npm run amm-monitor

# Terminal 2: Refactored system
npm run start-refactored
```

### Database Compatibility

Both systems use the same database schema, so they can coexist:

```sql
-- Shared tables
tokens_unified
trades_unified
amm_pool_states
```

### WebSocket Compatibility

Different WebSocket paths to avoid conflicts:

- Legacy: `ws://localhost:3001/ws`
- Refactored: `ws://localhost:3001/ws-unified`

## Common Migration Issues

### Issue 1: Circular Dependencies

**Problem**: Services depend on each other in a circle

**Solution**: Use events to break the cycle
```typescript
// Instead of: A → B → C → A
// Use: A → EventBus ← B, C
```

### Issue 2: Missing Service Registration

**Error**: `No factory registered for token: SomeService`

**Solution**: Register the service in container-factory.ts
```typescript
container.registerSingleton(TOKENS.SomeService, () => new SomeService());
```

### Issue 3: Async Initialization

**Problem**: Service needs async setup

**Solution**: Use factory function
```typescript
container.registerSingleton(TOKENS.Service, async () => {
  const service = new Service();
  await service.initialize();
  return service;
});
```

### Issue 4: Event Handler Errors

**Problem**: Unhandled errors in event handlers

**Solution**: Wrap handlers in try-catch
```typescript
eventBus.on(EVENTS.SOME_EVENT, async (data) => {
  try {
    await processData(data);
  } catch (error) {
    logger.error('Handler error', error);
  }
});
```

## Testing During Migration

### 1. Unit Tests

Test individual components with mocked dependencies:

```typescript
describe('TokenRepository', () => {
  let repo: TokenRepository;
  let mockPool: Pool;
  
  beforeEach(() => {
    mockPool = createMockPool();
    repo = new TokenRepository(mockPool, new EventBus());
  });
  
  it('should save tokens', async () => {
    const token = await repo.save(mockToken);
    expect(token.mintAddress).toBe(mockToken.mintAddress);
  });
});
```

### 2. Integration Tests

Test component interactions:

```typescript
describe('Trade Processing', () => {
  let container: Container;
  
  beforeEach(async () => {
    container = await createTestContainer();
  });
  
  it('should emit events on trade', async () => {
    const events = [];
    const eventBus = await container.resolve(TOKENS.EventBus);
    
    eventBus.on(EVENTS.TOKEN_DISCOVERED, (e) => events.push(e));
    
    // Process trade...
    
    expect(events).toHaveLength(1);
  });
});
```

### 3. End-to-End Tests

Validate the full system:

```bash
# Run validation suite
tsx src/tests/validate-refactoring.ts

# Expected output:
# ✓ Core Services
# ✓ Monitor Implementation
# ✓ Dependency Injection
# ✓ Event-Driven Architecture
# ...
```

## Rollback Plan

If issues arise, you can quickly rollback:

1. **Stop refactored services**
   ```bash
   pm2 stop pump-monitor-refactored
   ```

2. **Start legacy services**
   ```bash
   pm2 start pump-monitor-legacy
   ```

3. **No database changes needed** - Same schema

4. **Update nginx/proxy** - Point to legacy ports

## Performance Comparison

### Metrics to Monitor

- **Parse Rate**: Should remain >95%
- **Save Rate**: Should match or exceed legacy
- **Memory Usage**: Should be similar or lower
- **CPU Usage**: Should be similar or lower
- **Response Time**: API should be <100ms

### Benchmarking

```bash
# Legacy system
curl http://localhost:3001/api/stats > legacy-stats.json

# Refactored system  
curl http://localhost:3001/api/stats > refactored-stats.json

# Compare
diff legacy-stats.json refactored-stats.json
```

## Deprecation Timeline

1. **Week 1-2**: Run both systems in parallel
2. **Week 3-4**: Route 50% traffic to refactored
3. **Week 5-6**: Route 100% traffic to refactored
4. **Week 7-8**: Decommission legacy system

## Getting Help

- Check [ARCHITECTURE.md](./ARCHITECTURE.md) for design details
- Review [README-REFACTORED.md](../README-REFACTORED.md) for usage
- Run tests: `npm test`
- Check logs: `pm2 logs pump-monitor`

## Checklist

- [ ] Update all imports from singletons to DI
- [ ] Convert monitors to extend BaseMonitor
- [ ] Replace direct calls with events
- [ ] Update configuration access
- [ ] Migrate database queries to repositories
- [ ] Update WebSocket connections
- [ ] Run validation suite
- [ ] Test in staging environment
- [ ] Monitor performance metrics
- [ ] Plan rollback strategy