# Session 4: Testing & Integration Validation

## Pre-Session Setup
- [ ] Sessions 1-3 complete
- [ ] All services integrated
- [ ] Database schema updated
- [ ] Clean database (data can be erased)

## Database Reset Strategy

### 4.1 Complete Database Reset
```bash
# Since data isn't important, we can do a clean reset
# This eliminates any schema conflicts

# Option 1: Drop and recreate all tables
psql $DATABASE_URL << EOF
-- Drop all existing tables
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
EOF

# Option 2: Drop specific tables and recreate
psql $DATABASE_URL << EOF
-- List all tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Drop each table
DROP TABLE IF EXISTS tokens_unified CASCADE;
DROP TABLE IF EXISTS trades_unified CASCADE;
DROP TABLE IF EXISTS bonding_curve_mappings CASCADE;
DROP TABLE IF EXISTS liquidity_events CASCADE;
DROP TABLE IF EXISTS amm_fee_events CASCADE;
DROP TABLE IF EXISTS lp_positions CASCADE;
DROP TABLE IF EXISTS amm_pool_metrics_hourly CASCADE;
DROP TABLE IF EXISTS trade_simulations CASCADE;
-- ... drop all other tables
EOF
```

### 4.2 Apply All Migrations
```bash
# Create master migration script
cat > src/database/migrations/complete-schema.sql << 'EOF'
-- Complete schema for unified BC + AMM system

-- Core tables from BC branch
CREATE TYPE program_type AS ENUM ('bonding_curve', 'amm_pool');
CREATE TYPE trade_type AS ENUM ('buy', 'sell');

-- Main token table
CREATE TABLE tokens_unified (
    mint_address VARCHAR(64) PRIMARY KEY,
    symbol VARCHAR(50),
    name VARCHAR(255),
    first_price_sol DECIMAL(20, 12),
    first_price_usd DECIMAL(20, 12),
    first_market_cap_usd DECIMAL(20, 4),
    threshold_crossed_at TIMESTAMP,
    graduated_to_amm BOOLEAN DEFAULT FALSE,
    graduation_at TIMESTAMP,
    graduation_slot BIGINT,
    price_source TEXT DEFAULT 'unknown',
    last_graphql_update TIMESTAMP,
    last_rpc_update TIMESTAMP,
    last_dexscreener_update TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Pump.fun specific
    creator VARCHAR(64),
    total_supply BIGINT,
    bonding_curve_key VARCHAR(64),
    -- Metadata columns
    description TEXT,
    image_uri TEXT,
    uri TEXT,
    metadata_source VARCHAR(20),
    metadata_updated_at TIMESTAMP,
    -- Price tracking (Token Enrichment)
    latest_price_sol DECIMAL(20,12),
    latest_price_usd DECIMAL(20,4),
    latest_market_cap_usd DECIMAL(20,4),
    latest_bonding_curve_progress DECIMAL(5,2),
    last_trade_at TIMESTAMP,
    is_stale BOOLEAN DEFAULT FALSE,
    should_remove BOOLEAN DEFAULT FALSE,
    volume_24h_usd DECIMAL(20,4),
    holder_count INTEGER,
    liquidity_usd DECIMAL(20,4),
    -- Social metadata (Shyft DAS)
    twitter VARCHAR(255),
    telegram VARCHAR(255),
    discord VARCHAR(255),
    website VARCHAR(255),
    metadata_score INTEGER,
    update_authority VARCHAR(64),
    freeze_authority VARCHAR(64),
    mint_authority VARCHAR(64)
);

-- Trades table
CREATE TABLE trades_unified (
    signature VARCHAR(88) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    program program_type NOT NULL,
    trade_type trade_type,
    user_address VARCHAR(64) NOT NULL,
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    price_sol DECIMAL(20, 12) NOT NULL,
    price_usd DECIMAL(20, 12) NOT NULL,
    market_cap_usd DECIMAL(20, 4) NOT NULL,
    volume_usd DECIMAL(20, 4),
    virtual_sol_reserves BIGINT,
    virtual_token_reserves BIGINT,
    bonding_curve_key VARCHAR(64),
    bonding_curve_progress DECIMAL(5, 2),
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BC to AMM mappings
CREATE TABLE bonding_curve_mappings (
    bonding_curve_key VARCHAR(64) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(mint_address)
);

-- All Phase and Enhancement tables...
-- [Include all tables from both branches]
EOF

# Run complete migration
psql $DATABASE_URL < src/database/migrations/complete-schema.sql
```

## Step 1: System Startup Test

### 1.1 Clean Start
```bash
# Ensure clean environment
pkill -f "node.*monitor" || true
rm -f logs/*.log

# Start with debug logging
DEBUG=* npm run start 2>&1 | tee startup.log
```

### 1.2 Monitor Startup Validation
Check for:
- [ ] All 4 monitors start successfully
- [ ] No WebSocket connection attempts
- [ ] gRPC stream established
- [ ] Services initialized
- [ ] Event bus active

Expected output:
```
[BC Monitor] Started successfully
[BC Account Monitor] Monitoring account updates
[AMM Monitor] Started with price fix
[AMM Account Monitor] Monitoring pool states
[StreamManager] Single gRPC connection established
```

## Step 2: BC → AMM Flow Test

### 2.1 Create Test Trade
```typescript
// test-graduation-flow.ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// Simulate BC trade that triggers graduation
async function testGraduationFlow() {
  // 1. Create BC trade near graduation threshold
  console.log('Creating BC trade...');
  
  // 2. Wait for BC monitor to process
  await sleep(5000);
  
  // 3. Check if graduation detected
  const graduationDetected = await checkDatabase(`
    SELECT * FROM tokens_unified 
    WHERE graduated_to_amm = true 
    AND graduation_at > NOW() - INTERVAL '1 minute'
  `);
  
  // 4. Verify AMM pool creation
  const poolCreated = await checkDatabase(`
    SELECT * FROM amm_pool_state 
    WHERE created_at > NOW() - INTERVAL '1 minute'
  `);
  
  return { graduationDetected, poolCreated };
}
```

### 2.2 Event Flow Validation
```bash
# Monitor event flow
tail -f logs/*.log | grep -E "TRADE_PROCESSED|TOKEN_GRADUATED|POOL_CREATED"
```

## Step 3: AMM Enhancement Testing

### 3.1 Liquidity Event Test
```bash
# Test liquidity tracking
curl -X GET http://localhost:3001/api/v1/liquidity/events

# Expected: Empty array initially
# After liquidity events, should show data
```

### 3.2 Fee Tracking Test
```bash
# Test fee analytics
curl -X GET http://localhost:3001/api/v1/fees/summary

# Verify fee calculation working
```

### 3.3 Price Impact Test
```bash
# Simulate large trade
curl -X POST http://localhost:3001/api/v1/simulate/trade \
  -H "Content-Type: application/json" \
  -d '{
    "pool": "poolAddress",
    "type": "buy",
    "amount": "1000000000"
  }'
```

## Step 4: BC Enhancement Testing

### 4.1 Stale Token Detection
```bash
# Check stale token service
curl http://localhost:3001/api/v1/stale/stats

# Should show tier-based detection active
```

### 4.2 Token Enrichment
```bash
# Verify Shyft DAS integration
curl http://localhost:3001/api/v1/tokens?enriched=true

# Check metadata scores
```

### 4.3 Performance Monitoring
```bash
# Check Phase 6 performance features
curl http://localhost:3001/api/v1/performance/metrics

# Verify metrics collection
```

## Step 5: Integration Test Suite

### 5.1 Create Full Test Script
```typescript
// test-unified-system.ts
import { runTest, assertExists, assertMetrics } from './test-utils';

describe('Unified BC + AMM System', () => {
  test('All monitors operational', async () => {
    const status = await getSystemStatus();
    expect(status.monitors).toHaveLength(4);
    expect(status.monitors.every(m => m.running)).toBe(true);
  });
  
  test('BC features intact', async () => {
    // Test each Phase 1-6 feature
    assertExists('Phase 1: IDL parsing');
    assertExists('Phase 2: Advanced subscriptions');
    assertExists('Phase 3: Token lifecycle');
    assertExists('Phase 4: Failed tx analysis');
    assertExists('Phase 5: State tracking');
    assertExists('Phase 6: Performance optimization');
  });
  
  test('AMM enhancements working', async () => {
    // Test each Session 1-5 enhancement
    assertExists('Session 1: Liquidity tracking');
    assertExists('Session 2: Fee tracking');
    assertExists('Session 3: LP positions');
    assertExists('Session 4: Pool analytics');
    assertExists('Session 5: Price impact');
  });
  
  test('Token enrichment active', async () => {
    // Test Sessions 1-4 of Token Enrichment
    assertMetrics('Stale detection', { active: true });
    assertMetrics('Shyft DAS', { integrated: true });
    assertMetrics('Historical recovery', { available: true });
  });
  
  test('No WebSocket dependencies', async () => {
    const logs = await readLogs();
    expect(logs).not.toContain('WebSocket');
    expect(logs).not.toContain('ws://');
  });
});
```

### 5.2 Run Test Suite
```bash
# Run all tests
npm test

# Run integration tests only
npm run test:integration

# Generate coverage report
npm run test:coverage
```

## Step 6: Performance Validation

### 6.1 Baseline Metrics
```bash
# Record performance metrics
curl http://localhost:3001/api/v1/performance/metrics > baseline-metrics.json

# Key metrics to track:
# - Parse rate (should be >95%)
# - Save rate (should be >95%)
# - Memory usage (should be stable)
# - Event processing time
```

### 6.2 Load Test
```typescript
// load-test.ts
async function loadTest() {
  const results = {
    bcTrades: 0,
    ammTrades: 0,
    graduations: 0,
    errors: 0
  };
  
  // Simulate 1 hour of activity
  const duration = 60 * 60 * 1000; // 1 hour
  const startTime = Date.now();
  
  while (Date.now() - startTime < duration) {
    // Monitor metrics
    const metrics = await getMetrics();
    console.log(`Parse rate: ${metrics.parseRate}%`);
    console.log(`Memory: ${metrics.memory.heapUsed / 1024 / 1024}MB`);
    
    await sleep(60000); // Check every minute
  }
  
  return results;
}
```

## Step 7: Dashboard Validation

### 7.1 Check Dashboard
```bash
# Open dashboard
open http://localhost:3001

# Verify:
# - Tokens display correctly
# - Real-time updates working (polling)
# - BC and AMM tokens shown
# - Stale tokens marked/removed
# - Enriched metadata visible
```

### 7.2 API Health Check
```bash
# Test all major endpoints
./scripts/test-all-endpoints.sh

# Or manually:
endpoints=(
  "/api/v1/tokens"
  "/api/v1/trades/recent"
  "/api/v1/lifecycle/stats"
  "/api/v1/failures/summary"
  "/api/v1/performance/health"
  "/api/v1/stale/stats"
  "/api/v1/liquidity/events"
  "/api/v1/fees/summary"
)

for endpoint in "${endpoints[@]}"; do
  echo "Testing $endpoint..."
  curl -s http://localhost:3001$endpoint | jq . > /dev/null && echo "✅ OK" || echo "❌ Failed"
done
```

## Validation Summary

### Core Functionality ✓
- [ ] All 4 monitors running
- [ ] BC trades processed
- [ ] AMM trades processed
- [ ] Graduation flow working
- [ ] Price calculations accurate

### BC Features ✓
- [ ] Phases 1-6 operational
- [ ] Token enrichment active
- [ ] Stale detection working
- [ ] Performance monitoring enabled

### AMM Features ✓
- [ ] Price fallback working
- [ ] Liquidity tracking active
- [ ] Fee collection monitored
- [ ] LP positions tracked
- [ ] Price impact calculated

### System Health ✓
- [ ] No WebSocket errors
- [ ] Memory usage stable
- [ ] Parse rate >95%
- [ ] API responsive
- [ ] Dashboard functional

## Issue Resolution

### Common Issues

1. **Monitor won't start**
   ```bash
   # Check for port conflicts
   lsof -i :3001
   
   # Check environment variables
   env | grep -E "SHYFT|DATABASE|API"
   ```

2. **Database errors**
   ```sql
   -- Check schema
   \dt
   
   -- Verify permissions
   \dp
   ```

3. **Missing data**
   ```bash
   # Check if monitors receiving data
   tail -f logs/*.log | grep "Processing"
   ```

## Session 4 Deliverables

1. **Test Results**
   - All tests passing
   - Performance metrics documented
   - No critical issues

2. **System Documentation**
   - Feature inventory complete
   - API documentation updated
   - Known issues documented

3. **Ready for Session 5**
   - System stable
   - All features integrated
   - Documentation prepared

---

**Session 4 Complete When:**
- Full system operational
- All tests passing
- Performance acceptable
- No critical bugs
- Ready for final documentation