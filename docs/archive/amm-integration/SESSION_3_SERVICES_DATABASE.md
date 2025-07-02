# Session 3: AMM Services & Database Integration

## Pre-Session Validation
- [ ] Session 2 complete - AMM monitors integrated
- [ ] Price calculation improvements verified
- [ ] No uncommitted changes
- [ ] Database backup available

## Overview
Integrate AMM Enhancement Sessions 1-5 services while preserving BC architecture.

## Step 1: AMM Service Inventory

### 1.1 Identify Services to Integrate
```bash
# From AMM worktree, list AMM enhancement services
cd ../amm-analysis
find src/services -name "*.ts" | grep -E "(liquidity|fee|lp|pool-analytics|price-impact)" | sort

# Expected services:
# - liquidity-event-tracker.ts (Session 1)
# - amm-fee-tracker.ts (Session 2)
# - lp-position-tracker.ts (Session 3)
# - pool-analytics-service.ts (Session 4)
# - price-impact-analyzer.ts (Session 5)
```

### 1.2 Dependency Analysis
```bash
# Check service dependencies
for service in liquidity-event-tracker amm-fee-tracker lp-position-tracker pool-analytics-service price-impact-analyzer; do
  echo "=== $service dependencies ==="
  grep -E "import.*from|constructor\(" src/services/$service.ts
done
```

## Step 2: Service Integration

### 2.1 Copy AMM Services
```bash
# Return to main project
cd ../pumpfun-superbot-v2

# Copy only AMM enhancement services
cp ../amm-analysis/src/services/liquidity-event-tracker.ts src/services/
cp ../amm-analysis/src/services/amm-fee-tracker.ts src/services/
cp ../amm-analysis/src/services/lp-position-tracker.ts src/services/
cp ../amm-analysis/src/services/pool-analytics-service.ts src/services/
cp ../amm-analysis/src/services/price-impact-analyzer.ts src/services/
```

### 2.2 Update Service Imports
```typescript
// Fix imports to use BC's architecture
// In each service file:

// Change WebSocket imports (if any)
// FROM: import { WebSocketService } from '../websocket';
// TO: Remove WebSocket dependencies

// Update database imports
// FROM: import { db } from '../db';
// TO: import { db } from '../database';

// Use BC's event bus
// FROM: import EventEmitter from 'events';
// TO: import { EventBus } from '../core/event-bus';
```

### 2.3 Container Registration
```typescript
// src/core/container-factory.ts
// Add AMM services to container

// AMM Enhancement Services
container.register('liquidityEventTracker', () => 
  new LiquidityEventTracker(
    container.get('logger'),
    container.get('db'),
    container.get('eventBus')
  )
);

container.register('ammFeeTracker', () =>
  new AmmFeeTracker(
    container.get('logger'),
    container.get('db'),
    container.get('eventBus')
  )
);

container.register('lpPositionTracker', () =>
  new LpPositionTracker(
    container.get('logger'),
    container.get('db'),
    container.get('ammPoolStateService')
  )
);

container.register('poolAnalyticsService', () =>
  new PoolAnalyticsService(
    container.get('logger'),
    container.get('db')
  )
);

container.register('priceImpactAnalyzer', () =>
  new PriceImpactAnalyzer(
    container.get('logger'),
    container.get('db'),
    container.get('ammPoolStateService')
  )
);
```

## Step 3: Database Schema Integration

### 3.1 Extract AMM Tables
```bash
# Find AMM-specific migrations
cd ../amm-analysis
find src/database/migrations -name "*.sql" | grep -E "(liquidity|fee|lp|pool|simulation)"

# Copy relevant migrations
cp src/database/migrations/*liquidity*.sql ../pumpfun-superbot-v2/src/database/migrations/
cp src/database/migrations/*fee*.sql ../pumpfun-superbot-v2/src/database/migrations/
cp src/database/migrations/*lp*.sql ../pumpfun-superbot-v2/src/database/migrations/
cp src/database/migrations/*pool*.sql ../pumpfun-superbot-v2/src/database/migrations/
cp src/database/migrations/*simulation*.sql ../pumpfun-superbot-v2/src/database/migrations/
```

### 3.2 Create Unified Migration
```sql
-- src/database/migrations/add-amm-enhancement-tables.sql
-- AMM Enhancement Sessions 1-5 Tables

-- Session 1: Liquidity Events
CREATE TABLE IF NOT EXISTS liquidity_events (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    event_type VARCHAR(20) NOT NULL, -- 'add' or 'remove'
    user_address VARCHAR(64) NOT NULL,
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    lp_tokens_minted BIGINT,
    lp_tokens_burned BIGINT,
    pool_sol_balance BIGINT NOT NULL,
    pool_token_balance BIGINT NOT NULL,
    slot BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL UNIQUE,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session 2: Fee Events
CREATE TABLE IF NOT EXISTS amm_fee_events (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    trade_signature VARCHAR(88) NOT NULL,
    fee_sol_amount BIGINT NOT NULL,
    fee_token_amount BIGINT NOT NULL,
    fee_percentage DECIMAL(5,4) NOT NULL,
    cumulative_fees_sol BIGINT,
    cumulative_fees_token BIGINT,
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session 3: LP Positions
CREATE TABLE IF NOT EXISTS lp_positions (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    lp_token_balance BIGINT NOT NULL,
    pool_share_percentage DECIMAL(5,2),
    estimated_sol_value BIGINT,
    estimated_token_value BIGINT,
    last_updated_slot BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_address, user_address)
);

-- Session 4: Pool Analytics
CREATE TABLE IF NOT EXISTS amm_pool_metrics_hourly (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    hour_timestamp TIMESTAMPTZ NOT NULL,
    volume_sol BIGINT NOT NULL DEFAULT 0,
    volume_usd DECIMAL(20,4),
    trade_count INTEGER NOT NULL DEFAULT 0,
    unique_traders INTEGER NOT NULL DEFAULT 0,
    liquidity_sol BIGINT NOT NULL,
    liquidity_usd DECIMAL(20,4),
    fees_collected_sol BIGINT DEFAULT 0,
    fees_collected_usd DECIMAL(20,4),
    price_high DECIMAL(20,12),
    price_low DECIMAL(20,12),
    price_open DECIMAL(20,12),
    price_close DECIMAL(20,12),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pool_address, hour_timestamp)
);

-- Session 5: Trade Simulations
CREATE TABLE IF NOT EXISTS trade_simulations (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    trade_type VARCHAR(10) NOT NULL, -- 'buy' or 'sell'
    input_amount BIGINT NOT NULL,
    output_amount BIGINT NOT NULL,
    price_impact_percentage DECIMAL(10,6) NOT NULL,
    effective_price DECIMAL(20,12) NOT NULL,
    slippage_percentage DECIMAL(10,6),
    simulation_timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_liquidity_events_pool_time ON liquidity_events(pool_address, block_time DESC);
CREATE INDEX idx_fee_events_pool ON amm_fee_events(pool_address, block_time DESC);
CREATE INDEX idx_lp_positions_user ON lp_positions(user_address);
CREATE INDEX idx_pool_metrics_time ON amm_pool_metrics_hourly(hour_timestamp DESC);
CREATE INDEX idx_simulations_pool ON trade_simulations(pool_address, simulation_timestamp DESC);
```

### 3.3 Run Migration
```bash
# Test migration first
psql $DATABASE_URL -c "BEGIN; \i src/database/migrations/add-amm-enhancement-tables.sql; ROLLBACK;"

# If successful, run actual migration
psql $DATABASE_URL < src/database/migrations/add-amm-enhancement-tables.sql
```

## Step 4: Service Initialization

### 4.1 Update Monitor Initialization
```typescript
// src/monitors/amm-monitor.ts
// Add service dependencies

constructor(container: DIContainer) {
  super(container, config);
  
  // Get AMM enhancement services
  this.liquidityTracker = container.get('liquidityEventTracker');
  this.feeTracker = container.get('ammFeeTracker');
  this.priceImpactAnalyzer = container.get('priceImpactAnalyzer');
}

// Hook services into trade processing
protected async handleTrade(trade: AMMTrade): Promise<void> {
  // Existing trade handling...
  
  // Track liquidity events
  if (trade.instructionType === 'addLiquidity' || trade.instructionType === 'removeLiquidity') {
    await this.liquidityTracker.trackEvent(trade);
  }
  
  // Track fees
  if (trade.feeAmount) {
    await this.feeTracker.trackFee(trade);
  }
  
  // Analyze price impact for large trades
  if (trade.sol_amount > LARGE_TRADE_THRESHOLD) {
    await this.priceImpactAnalyzer.analyze(trade);
  }
}
```

### 4.2 Event Bus Integration
```typescript
// Connect services to event bus
// In each service's constructor:

this.eventBus.on('AMM_TRADE', async (data) => {
  if (this.shouldProcess(data.trade)) {
    await this.processTrade(data.trade);
  }
});

this.eventBus.on('POOL_STATE_UPDATED', async (data) => {
  await this.updateMetrics(data.pool);
});
```

## Step 5: API Integration

### 5.1 Add AMM Endpoints
```bash
# Copy AMM-specific endpoints
cp ../amm-analysis/src/api/liquidity-endpoints.ts src/api/
cp ../amm-analysis/src/api/fee-analytics-endpoints.ts src/api/
cp ../amm-analysis/src/api/pool-analytics-endpoints.ts src/api/
```

### 5.2 Update API Server
```typescript
// src/api/server-unified.ts
// Add AMM enhancement routes

import { setupLiquidityEndpoints } from './liquidity-endpoints';
import { setupFeeAnalyticsEndpoints } from './fee-analytics-endpoints';
import { setupPoolAnalyticsEndpoints } from './pool-analytics-endpoints';

// In server setup
setupLiquidityEndpoints(app, container);
setupFeeAnalyticsEndpoints(app, container);
setupPoolAnalyticsEndpoints(app, container);

// Keep port 3001 (not 3002)
const PORT = process.env.API_PORT || 3001;
```

## Step 6: Testing

### 6.1 Service Unit Tests
```typescript
// Create test file: test-amm-services.ts
import { LiquidityEventTracker } from '../src/services/liquidity-event-tracker';
import { AmmFeeTracker } from '../src/services/amm-fee-tracker';

describe('AMM Enhancement Services', () => {
  test('Liquidity tracker processes events', async () => {
    // Test liquidity add/remove
  });
  
  test('Fee tracker calculates correctly', async () => {
    // Test fee calculations
  });
  
  test('Price impact analyzer', async () => {
    // Test price impact calculations
  });
});
```

### 6.2 Integration Test
```bash
# Start full system
npm run start

# In another terminal, check:
# 1. Services initialized
# 2. Database tables created
# 3. API endpoints available

# Test endpoints
curl http://localhost:3001/api/v1/liquidity/events?pool=xxx
curl http://localhost:3001/api/v1/fees/summary
curl http://localhost:3001/api/v1/pools/analytics
```

## Validation Checklist

### Services
- [ ] All 5 AMM services compile
- [ ] Services registered in container
- [ ] No WebSocket dependencies
- [ ] Event bus integration working

### Database
- [ ] All tables created successfully
- [ ] Indexes applied
- [ ] No conflicts with existing tables
- [ ] Foreign keys valid

### API
- [ ] Endpoints accessible
- [ ] Using port 3001
- [ ] Responses valid JSON
- [ ] No 404 errors

### Integration
- [ ] Services start with monitors
- [ ] Events flow correctly
- [ ] Data saved to database
- [ ] No memory leaks

## Troubleshooting

### Service Registration Errors
```typescript
// Check container-factory.ts
// Ensure all dependencies available
console.log('Available services:', container.list());
```

### Database Errors
```sql
-- Check table existence
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%amm%' OR table_name LIKE '%liquidity%';
```

### Event Bus Issues
```typescript
// Add debug logging
this.eventBus.on('*', (event, data) => {
  console.log(`Event: ${event}`, data);
});
```

## Session 3 Deliverables

1. **Integrated Services**
   - 5 AMM enhancement services
   - Container registration complete
   - Event bus connections

2. **Database Updates**
   - All AMM tables created
   - Migration successful
   - Indexes applied

3. **API Enhancements**
   - AMM endpoints added
   - Port 3001 maintained
   - Documentation updated

## Commit Strategy
```bash
git add src/services/liquidity-event-tracker.ts src/services/amm-fee-tracker.ts
git commit -m "feat: Add AMM liquidity and fee tracking services (Sessions 1-2)"

git add src/services/lp-position-tracker.ts src/services/pool-analytics-service.ts src/services/price-impact-analyzer.ts
git commit -m "feat: Add LP, analytics, and price impact services (Sessions 3-5)"

git add src/database/migrations/add-amm-enhancement-tables.sql
git commit -m "feat: Add database schema for AMM enhancements"

git add src/api/*endpoints.ts
git commit -m "feat: Add API endpoints for AMM analytics"
```

---

**Session 3 Complete When:**
- All services integrated and initialized
- Database migrations successful
- API endpoints functional
- No runtime errors
- Ready for Session 4 testing