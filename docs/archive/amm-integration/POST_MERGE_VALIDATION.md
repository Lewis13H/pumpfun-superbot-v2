# Post-Merge Validation Guide

## Immediate Validation (First 30 minutes)

### 1. Build Validation
```bash
# Clean build
rm -rf dist
npm run build

# Expected: No TypeScript errors
# Critical: Watch for any type mismatches between services
```

### 2. Dependency Check
```bash
# Install dependencies
npm install

# Check for conflicts
npm ls --depth=0

# Expected: No peer dependency warnings
```

### 3. Test Suite
```bash
# Run all tests
npm test

# Run specific test suites
npm test -- bc-monitor
npm test -- amm
npm test -- integration

# Expected: All tests pass
```

## Service Startup Validation (Next 1 hour)

### 4. Individual Monitor Tests
```bash
# Test BC Monitor
npm run bc-monitor
# Watch for:
# - Successful gRPC connection
# - Trade events being processed
# - Correct bonding curve key extraction

# Test BC Account Monitor
npm run bc-account-monitor
# Watch for:
# - Account updates received
# - Graduation events detected

# Test AMM Monitor
npm run amm-monitor
# Watch for:
# - AMM trades detected
# - Prices calculated (not zero!)
# - Tokens saved at $1,000 threshold

# Test AMM Account Monitor
npm run amm-account-monitor
# Watch for:
# - Pool state updates
# - Reserve changes tracked
```

### 5. Unified System Test
```bash
# Start all monitors
npm run start

# Expected output:
# - All 4 monitors initialize
# - EventBus connections established
# - Shared services start (SOL price, enricher)
# - No duplicate service errors
```

## Data Flow Validation (Next 2 hours)

### 6. BC to AMM Graduation Flow
```
Monitor for:
1. BC trade detected → bonding_curve_key extracted
2. Trade saved with bonding curve mapping
3. BC account monitor detects graduation
4. Token status updated to graduated
5. AMM pool creation detected
6. AMM trades start flowing
```

### 7. Database Integrity
```sql
-- Check AMM tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_name IN (
  'liquidity_events',
  'amm_fee_events', 
  'lp_positions',
  'amm_pool_metrics_hourly',
  'trade_simulations'
);

-- Check price precision
SELECT 
  column_name,
  data_type,
  numeric_precision,
  numeric_scale
FROM information_schema.columns
WHERE table_name = 'trades_unified'
AND column_name LIKE '%price%';
-- Expected: DECIMAL(20,12)

-- Verify no zero prices for AMM trades
SELECT COUNT(*) 
FROM trades_unified 
WHERE program = 'amm' 
AND price_usd = 0
AND created_at > NOW() - INTERVAL '1 hour';
-- Expected: 0
```

### 8. API Validation
```bash
# Test main API
curl http://localhost:3001/api/v1/tokens
# Expected: JSON response with tokens

# Test AMM endpoints
curl http://localhost:3001/api/v1/amm/pools
curl http://localhost:3001/api/v1/amm/liquidity-events
curl http://localhost:3001/api/v1/amm/fees

# Test enhanced endpoints
curl http://localhost:3001/api/v1/lifecycle/stats
curl http://localhost:3001/api/v1/stale/summary
```

### 9. Dashboard Validation
```
1. Open http://localhost:3001
2. Check:
   - Tokens display with prices
   - AMM tokens show at $1,000+ market cap
   - BC tokens show at $8,888+ market cap
   - Stale token indicators work
   - Metadata enrichment status shown
```

## Performance Validation (Next 4 hours)

### 10. Memory & CPU Monitoring
```bash
# Monitor resource usage
htop
# or
top

# Expected:
# - Stable memory usage (no leaks)
# - CPU usage <50% average
# - No growing memory trend
```

### 11. Parse Rate Monitoring
```
Check logs for:
- BC Monitor parse rate: >95%
- AMM Monitor parse rate: >80%
- No increasing error rates
```

### 12. Event Bus Health
```
Monitor for:
- All events being emitted
- Handlers receiving events
- No event queue buildup
- Cross-service communication working
```

## Long-term Validation (24 hours)

### 13. Data Quality Checks
```sql
-- Check for stale tokens being marked
SELECT COUNT(*) 
FROM tokens_unified 
WHERE is_stale = true 
AND last_trade_at < NOW() - INTERVAL '30 minutes';

-- Check metadata enrichment
SELECT 
  COUNT(*) as total,
  COUNT(name) as has_name,
  COUNT(symbol) as has_symbol,
  COUNT(image_uri) as has_image
FROM tokens_unified
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Check graduation tracking
SELECT COUNT(*)
FROM tokens_unified
WHERE graduated_to_amm = true
AND graduation_at > NOW() - INTERVAL '24 hours';
```

### 14. Error Analysis
```bash
# Check error logs
grep -i error logs/*.log | tail -100

# Common issues to watch for:
# - Rate limit errors (should be handled)
# - Database connection errors (should retry)
# - gRPC disconnections (should reconnect)
```

## Success Metrics

The merge is successful when:

### Immediate (30 min)
- [x] Builds without errors
- [x] All tests pass
- [x] All monitors start

### Short-term (4 hours)
- [x] BC trades flowing
- [x] AMM trades flowing with correct prices
- [x] Graduations detected
- [x] No memory leaks
- [x] API endpoints working

### Long-term (24 hours)
- [x] Parse rates remain high
- [x] No data quality issues
- [x] Stale token detection working
- [x] Metadata enrichment functioning
- [x] System stable under load

## Issue Resolution

### If AMM prices are zero:
1. Check AMM monitor logs for calculation errors
2. Verify fallback price calculation is working
3. Check trade handler receives pre-calculated prices

### If monitors won't start:
1. Check for port conflicts
2. Verify gRPC endpoint is accessible
3. Check service registration in DI container

### If graduation flow breaks:
1. Verify bonding_curve_key extraction
2. Check graduation handler is registered
3. Verify event bus connections

### If database errors occur:
1. Run pending migrations
2. Check column data types
3. Verify connection pool settings

## Rollback Procedures

If critical issues arise:

### Quick Rollback (< 5 minutes)
```bash
git reset --hard backup-bc-monitor-[timestamp]
npm install
npm run build
```

### Full Rollback (< 30 minutes)
```bash
# Restore code
cd ..
rm -rf pumpfun-superbot-v2
cp -r pumpfun-superbot-v2-backup-[date] pumpfun-superbot-v2
cd pumpfun-superbot-v2

# Restore database if needed
psql $DATABASE_URL < backup-[timestamp].sql

# Restart services
npm run start
```

## Sign-off Checklist

- [ ] All monitors running stable for 24 hours
- [ ] No critical errors in logs
- [ ] Data quality metrics acceptable
- [ ] Performance metrics within bounds
- [ ] Team approval received
- [ ] Documentation updated
- [ ] Backup plan tested