# Comprehensive Testing Suite Design for Bonding Curve Monitor System

## Overview
This document outlines a complete testing strategy for the enhanced bonding curve monitoring system, covering unit tests, integration tests, performance tests, and end-to-end testing scenarios.

## Testing Architecture

### 1. Test Categories

#### Unit Tests (70% coverage target)
- Individual service functionality
- Parser accuracy
- Utility functions
- Event handling
- State management

#### Integration Tests (20% coverage)
- Service interactions
- Database operations
- Event bus communication
- External API integrations

#### End-to-End Tests (5% coverage)
- Complete transaction flow
- Multi-service scenarios
- Real blockchain data
- System recovery

#### Performance Tests (5% coverage)
- Load testing
- Latency benchmarks
- Memory usage
- Throughput testing

## Test Structure

```
tests/
├── unit/
│   ├── core/
│   │   ├── base-monitor.test.ts
│   │   ├── container.test.ts
│   │   ├── event-bus.test.ts
│   │   ├── subscription-builder.test.ts
│   │   └── filter-factory.test.ts
│   ├── services/
│   │   ├── idl-parser-service.test.ts
│   │   ├── event-parser-service.test.ts
│   │   ├── state-history-service.test.ts
│   │   ├── fork-detector.test.ts
│   │   ├── mev-detector.test.ts
│   │   ├── liquidity-depth-tracker.test.ts
│   │   ├── performance-monitor.test.ts
│   │   └── alert-manager.test.ts
│   ├── parsers/
│   │   ├── unified-event-parser.test.ts
│   │   ├── bc-trade-strategy.test.ts
│   │   └── amm-trade-strategy.test.ts
│   └── utils/
│       ├── price-calculator.test.ts
│       └── amm-pool-decoder.test.ts
├── integration/
│   ├── monitor-integration.test.ts
│   ├── database-integration.test.ts
│   ├── event-flow.test.ts
│   ├── graduation-flow.test.ts
│   └── recovery-flow.test.ts
├── e2e/
│   ├── bc-monitor-e2e.test.ts
│   ├── amm-monitor-e2e.test.ts
│   ├── full-lifecycle-e2e.test.ts
│   └── failure-recovery-e2e.test.ts
├── performance/
│   ├── parser-performance.test.ts
│   ├── database-performance.test.ts
│   └── stream-processing.test.ts
├── fixtures/
│   ├── transactions/
│   ├── accounts/
│   └── mock-data/
└── helpers/
    ├── test-container.ts
    ├── mock-services.ts
    └── test-utils.ts
```

## Detailed Test Specifications

### 1. Core Components Testing

#### BaseMonitor Tests
```typescript
describe('BaseMonitor', () => {
  describe('initialization', () => {
    it('should initialize with correct options');
    it('should setup event listeners');
    it('should connect to stream');
    it('should handle connection errors');
  });
  
  describe('subscription management', () => {
    it('should build correct subscription request');
    it('should handle subscription updates');
    it('should apply filters correctly');
    it('should manage slot tracking');
  });
  
  describe('error handling', () => {
    it('should retry on connection failure');
    it('should emit error events');
    it('should gracefully shutdown');
  });
});
```

#### EventBus Tests
```typescript
describe('EventBus', () => {
  describe('event handling', () => {
    it('should emit and receive events');
    it('should handle multiple listeners');
    it('should remove listeners');
    it('should handle wildcard events');
    it('should maintain event order');
  });
  
  describe('error propagation', () => {
    it('should not stop on listener error');
    it('should emit error events');
  });
});
```

### 2. Service Testing

#### IDL Parser Service Tests
```typescript
describe('IDLParserService', () => {
  describe('instruction parsing', () => {
    it('should parse BC trade instructions');
    it('should parse AMM swap instructions');
    it('should extract correct accounts');
    it('should handle unknown instructions');
    it('should parse inner instructions');
  });
  
  describe('event extraction', () => {
    it('should extract trade events from logs');
    it('should extract graduation events');
    it('should handle malformed events');
  });
});
```

#### MEV Detector Tests
```typescript
describe('MEVDetector', () => {
  describe('sandwich attack detection', () => {
    it('should identify sandwich patterns');
    it('should calculate MEV profit');
    it('should track attacker addresses');
    it('should handle false positives');
  });
  
  describe('frontrunning detection', () => {
    it('should detect frontrun transactions');
    it('should analyze gas price patterns');
    it('should identify victim transactions');
  });
});
```

#### State History Service Tests
```typescript
describe('StateHistoryService', () => {
  describe('state tracking', () => {
    it('should track account updates');
    it('should maintain write version consistency');
    it('should handle concurrent updates');
    it('should detect missing states');
  });
  
  describe('historical reconstruction', () => {
    it('should reconstruct state at slot');
    it('should handle missing data');
    it('should validate reconstructed state');
  });
});
```

### 3. Parser Testing

#### Unified Event Parser Tests
```typescript
describe('UnifiedEventParser', () => {
  describe('BC trade parsing', () => {
    it('should parse buy transactions');
    it('should parse sell transactions');
    it('should extract virtual reserves');
    it('should calculate prices correctly');
    it('should handle edge cases');
  });
  
  describe('AMM trade parsing', () => {
    it('should parse swap transactions');
    it('should handle different AMM versions');
    it('should extract pool states');
    it('should identify token directions');
  });
  
  describe('error handling', () => {
    it('should fallback to simple parsing');
    it('should suppress known errors');
    it('should report unknown errors');
  });
});
```

### 4. Integration Tests

#### Monitor Integration Tests
```typescript
describe('Monitor Integration', () => {
  describe('BC to AMM graduation flow', () => {
    it('should track token from BC creation to AMM');
    it('should detect graduation event');
    it('should update token status');
    it('should emit correct events');
  });
  
  describe('multi-monitor coordination', () => {
    it('should share stream connection');
    it('should not duplicate events');
    it('should handle monitor failures');
  });
});
```

#### Database Integration Tests
```typescript
describe('Database Integration', () => {
  describe('batch operations', () => {
    it('should batch insert trades');
    it('should handle conflicts');
    it('should maintain consistency');
    it('should recover from errors');
  });
  
  describe('threshold detection', () => {
    it('should detect threshold crossing');
    it('should be atomic');
    it('should handle race conditions');
  });
});
```

### 5. End-to-End Tests

#### Full Lifecycle E2E Test
```typescript
describe('Token Lifecycle E2E', () => {
  it('should track complete token lifecycle', async () => {
    // 1. Create new token on BC
    // 2. Monitor initial trades
    // 3. Track price increases
    // 4. Detect threshold crossing
    // 5. Enrich metadata
    // 6. Monitor graduation
    // 7. Track AMM trading
    // 8. Verify all data consistency
  });
});
```

#### Failure Recovery E2E Test
```typescript
describe('Failure Recovery E2E', () => {
  it('should recover from stream disconnection', async () => {
    // 1. Start monitoring
    // 2. Simulate disconnection
    // 3. Verify automatic reconnection
    // 4. Check no data loss
    // 5. Verify slot recovery
  });
  
  it('should handle region failover', async () => {
    // 1. Start with primary region
    // 2. Simulate region failure
    // 3. Verify failover to secondary
    // 4. Check data continuity
  });
});
```

### 6. Performance Tests

#### Parser Performance Tests
```typescript
describe('Parser Performance', () => {
  it('should parse 1000 transactions in <1 second');
  it('should handle 100 concurrent parses');
  it('should maintain <50ms p95 latency');
  it('should use <100MB memory for batch');
});
```

#### Stream Processing Tests
```typescript
describe('Stream Processing Performance', () => {
  it('should handle 1000 TPS');
  it('should maintain <100ms lag');
  it('should queue without dropping');
  it('should scale with load');
});
```

## Test Data Management

### 1. Fixture Creation
```typescript
// fixtures/transactions/bc-trades.json
{
  "buy_transaction": { /* Real BC buy transaction */ },
  "sell_transaction": { /* Real BC sell transaction */ },
  "graduation_transaction": { /* Real graduation transaction */ }
}

// fixtures/mock-data/generator.ts
export function generateMockTrade(options: TradeOptions): Transaction {
  // Generate realistic trade data
}
```

### 2. Mock Services
```typescript
// helpers/mock-services.ts
export class MockDatabaseService {
  async query(sql: string, params: any[]): Promise<any> {
    // Mock database responses
  }
}

export class MockEventBus extends EventBus {
  recordedEvents: Array<{event: string, data: any}> = [];
  
  emit(event: string, data: any): void {
    this.recordedEvents.push({event, data});
    super.emit(event, data);
  }
}
```

### 3. Test Container
```typescript
// helpers/test-container.ts
export function createTestContainer(): Container {
  const container = new Container();
  
  // Register mock services
  container.register('DatabaseService', MockDatabaseService);
  container.register('EventBus', new MockEventBus());
  
  return container;
}
```

## Testing Scenarios

### 1. Happy Path Scenarios
- New token creation and trading
- Price increase to threshold
- Successful graduation
- AMM pool creation
- Continuous trading

### 2. Edge Cases
- Tokens that never graduate
- Failed graduations
- Price crashes
- Zero liquidity
- Malformed transactions

### 3. Error Scenarios
- Network disconnections
- Database failures
- API rate limits
- Invalid transaction data
- Concurrent modifications

### 4. Performance Scenarios
- High transaction volume
- Large batch processing
- Memory pressure
- Network congestion
- Database bottlenecks

## Test Execution Strategy

### 1. Local Development
```bash
# Run all tests
npm test

# Run specific category
npm run test:unit
npm run test:integration
npm run test:e2e

# Run with coverage
npm run test:coverage

# Run specific file
npm test -- --testPathPattern=mev-detector

# Debug mode
npm test -- --runInBand --detectOpenHandles
```

### 2. CI/CD Pipeline
```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:unit
      
  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:integration
      
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:e2e
```

### 3. Test Reports
- Coverage reports with Istanbul
- Performance benchmarks with results tracking
- Test execution time monitoring
- Flaky test detection

## Mock Data Strategy

### 1. Transaction Mocking
```typescript
export const mockTransactions = {
  bcBuy: createMockTransaction({
    program: PUMP_PROGRAM,
    type: 'buy',
    amount: 1000000000, // 1 SOL
    tokenAmount: 1000000000000
  }),
  
  bcSell: createMockTransaction({
    program: PUMP_PROGRAM,
    type: 'sell',
    amount: 500000000, // 0.5 SOL
    tokenAmount: 500000000000
  }),
  
  ammSwap: createMockTransaction({
    program: PUMP_SWAP_PROGRAM,
    type: 'swap',
    poolState: mockPoolState
  })
};
```

### 2. Event Mocking
```typescript
export class EventRecorder {
  private events: Array<{name: string, data: any, timestamp: Date}> = [];
  
  record(eventName: string, data: any): void {
    this.events.push({
      name: eventName,
      data,
      timestamp: new Date()
    });
  }
  
  getEvents(eventName?: string): any[] {
    return eventName 
      ? this.events.filter(e => e.name === eventName)
      : this.events;
  }
  
  clear(): void {
    this.events = [];
  }
}
```

## Assertion Helpers

### 1. Custom Matchers
```typescript
// helpers/custom-matchers.ts
expect.extend({
  toBeValidPrice(received: number) {
    const pass = received > 0 && received < Number.MAX_SAFE_INTEGER;
    return {
      pass,
      message: () => `Expected ${received} to be a valid price`
    };
  },
  
  toBeValidSolanaAddress(received: string) {
    const pass = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(received);
    return {
      pass,
      message: () => `Expected ${received} to be a valid Solana address`
    };
  }
});
```

### 2. Assertion Utilities
```typescript
export function assertTradeEvent(event: any): void {
  expect(event).toHaveProperty('signature');
  expect(event).toHaveProperty('mintAddress');
  expect(event).toHaveProperty('tradeType');
  expect(event.price).toBeValidPrice();
  expect(event.user).toBeValidSolanaAddress();
}

export function assertTokenState(token: any): void {
  expect(token).toHaveProperty('mintAddress');
  expect(token).toHaveProperty('symbol');
  expect(token).toHaveProperty('marketCap');
  expect(token.marketCap).toBeGreaterThan(0);
}
```

## Test Database Setup

### 1. Test Database Configuration
```typescript
// helpers/test-db.ts
export async function setupTestDatabase(): Promise<TestDatabase> {
  const db = new TestDatabase({
    connectionString: process.env.TEST_DATABASE_URL || 
      'postgresql://test@localhost:5432/pump_monitor_test'
  });
  
  await db.migrate();
  await db.seed();
  
  return db;
}

export class TestDatabase {
  async clean(): Promise<void> {
    await this.query('TRUNCATE TABLE tokens_unified CASCADE');
    await this.query('TRUNCATE TABLE trades_unified CASCADE');
  }
  
  async seed(): Promise<void> {
    // Insert test data
  }
}
```

### 2. Database Assertions
```typescript
export async function assertTokenSaved(
  db: TestDatabase, 
  mintAddress: string
): Promise<void> {
  const result = await db.query(
    'SELECT * FROM tokens_unified WHERE mint_address = $1',
    [mintAddress]
  );
  
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    mint_address: mintAddress,
    threshold_crossed_at: expect.any(Date)
  });
}
```

## Performance Testing Tools

### 1. Load Generator
```typescript
export class LoadGenerator {
  async generateLoad(options: {
    tps: number;
    duration: number;
    transactionType: 'bc' | 'amm' | 'mixed';
  }): Promise<LoadTestResult> {
    const results = {
      totalTransactions: 0,
      successfulParses: 0,
      failedParses: 0,
      avgLatency: 0,
      p95Latency: 0,
      p99Latency: 0
    };
    
    // Generate and process transactions
    return results;
  }
}
```

### 2. Memory Profiler
```typescript
export class MemoryProfiler {
  private baseline: NodeJS.MemoryUsage;
  
  start(): void {
    this.baseline = process.memoryUsage();
  }
  
  snapshot(): MemorySnapshot {
    const current = process.memoryUsage();
    return {
      heapUsed: current.heapUsed - this.baseline.heapUsed,
      heapTotal: current.heapTotal,
      external: current.external,
      arrayBuffers: current.arrayBuffers
    };
  }
}
```

## Continuous Testing

### 1. Smoke Tests
Run after every deployment:
- Basic connectivity
- Core functionality
- Critical paths
- Health checks

### 2. Regression Tests
Run nightly:
- Full test suite
- Performance benchmarks
- Integration scenarios
- Load testing

### 3. Chaos Testing
Run weekly:
- Random failures
- Network partitions
- Resource exhaustion
- Data corruption

## Success Criteria

### 1. Coverage Targets
- Unit tests: 70% line coverage
- Integration tests: 80% of service interactions
- E2E tests: All critical user journeys
- No untested error paths

### 2. Performance Targets
- All unit tests < 5ms
- Integration tests < 100ms
- E2E tests < 5 seconds
- Full suite < 5 minutes

### 3. Quality Gates
- No failing tests in main branch
- No flaky tests (>95% success rate)
- Performance regression < 10%
- Memory leaks detected = 0

## Implementation Priority

1. **Phase 1**: Core unit tests (1 week)
   - Parsers and services
   - Event handling
   - Price calculations

2. **Phase 2**: Integration tests (1 week)
   - Service interactions
   - Database operations
   - Event flows

3. **Phase 3**: E2E tests (3 days)
   - Critical paths
   - Failure scenarios
   - Recovery testing

4. **Phase 4**: Performance tests (2 days)
   - Load testing
   - Benchmarking
   - Optimization validation