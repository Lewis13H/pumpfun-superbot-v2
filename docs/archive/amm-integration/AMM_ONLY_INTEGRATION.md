# AMM-Only Integration Guide

## Objective
Extract ONLY the 7 AMM functionality upgrades from AMM worktree:
1. AMM Monitor with price calculation fix
2. AMM Account Monitor improvements  
3. Liquidity Event Tracking (Session 1)
4. Fee Tracking System (Session 2)
5. LP Token & Position Tracking (Session 3)
6. Advanced Pool Analytics (Session 4)
7. Price Impact & Slippage Analysis (Session 5)

## Quick Integration Steps

### Step 1: Copy Core AMM Files
```bash
# From BC worktree root
mkdir -p temp/amm-extract

# 1. Copy AMM monitors (with price fix)
cp ../amm-analysis/src/monitors/amm-monitor.ts temp/amm-extract/
cp ../amm-analysis/src/monitors/amm-account-monitor.ts temp/amm-extract/

# 2-7. Copy AMM Enhancement Services
cp ../amm-analysis/src/services/liquidity-event-tracker.ts temp/amm-extract/
cp ../amm-analysis/src/services/amm-fee-tracker.ts temp/amm-extract/
cp ../amm-analysis/src/services/lp-position-tracker.ts temp/amm-extract/
cp ../amm-analysis/src/services/pool-analytics-service.ts temp/amm-extract/
cp ../amm-analysis/src/services/price-impact-analyzer.ts temp/amm-extract/
```

### Step 2: Quick Compatibility Fixes
```bash
# Fix imports in extracted files
cd temp/amm-extract

# Remove WebSocket references
sed -i '' '/WebSocket/d' *.ts
sed -i '' '/websocket/d' *.ts

# Fix event emitter patterns (if needed)
sed -i '' 's/this\.emit(/this.eventBus.emit(/g' *.ts

# Fix port references
sed -i '' 's/3002/3001/g' *.ts
```

### Step 3: Move Fixed Files
```bash
# Move monitors
mv amm-monitor.ts ../../src/monitors/
mv amm-account-monitor.ts ../../src/monitors/

# Move services
mv liquidity-event-tracker.ts ../../src/services/
mv amm-fee-tracker.ts ../../src/services/
mv lp-position-tracker.ts ../../src/services/
mv pool-analytics-service.ts ../../src/services/
mv price-impact-analyzer.ts ../../src/services/

cd ../..
rm -rf temp/amm-extract
```

### Step 4: Register Services in Container
```typescript
// src/core/container-factory.ts
// Add at the end of setupContainer function:

// AMM Enhancement Services (Sessions 1-5)
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

### Step 5: Add AMM Database Tables
```sql
-- src/database/migrations/add-amm-enhancements.sql
-- Only AMM-specific tables for the 5 enhancement sessions

CREATE TABLE IF NOT EXISTS liquidity_events (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    event_type VARCHAR(20) NOT NULL,
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

CREATE TABLE IF NOT EXISTS trade_simulations (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    trade_type VARCHAR(10) NOT NULL,
    input_amount BIGINT NOT NULL,
    output_amount BIGINT NOT NULL,
    price_impact_percentage DECIMAL(10,6) NOT NULL,
    effective_price DECIMAL(20,12) NOT NULL,
    slippage_percentage DECIMAL(10,6),
    simulation_timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_liquidity_events_pool ON liquidity_events(pool_address, block_time DESC);
CREATE INDEX idx_fee_events_pool ON amm_fee_events(pool_address, block_time DESC);
CREATE INDEX idx_lp_positions_user ON lp_positions(user_address);
CREATE INDEX idx_pool_metrics_time ON amm_pool_metrics_hourly(hour_timestamp DESC);
```

### Step 6: Run Migration
```bash
psql $DATABASE_URL < src/database/migrations/add-amm-enhancements.sql
```

### Step 7: Test
```bash
# Compile
npm run build

# Test AMM monitors
npm run amm-monitor
npm run amm-account-monitor

# Run full system
npm run start
```

## What This Gives You

1. **AMM Price Fix**: Fallback calculation when reserves unavailable
2. **Liquidity Tracking**: Add/remove liquidity events
3. **Fee Analytics**: Track trading fees collected
4. **LP Positions**: Track user LP token holdings
5. **Pool Analytics**: Hourly metrics and statistics
6. **Price Impact**: Calculate slippage for trades

## What This Doesn't Change

- ✅ BC monitor architecture preserved
- ✅ All Phase 1-6 features intact
- ✅ Token enrichment unchanged
- ✅ No WebSocket dependencies
- ✅ Port stays 3001
- ✅ All BC improvements preserved

## Total Time: 30 minutes

Just copy 7 files, fix imports, add tables, done!