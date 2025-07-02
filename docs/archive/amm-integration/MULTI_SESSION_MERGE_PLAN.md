# Multi-Session Merge Implementation Plan
## BC Monitor (Authoritative) + AMM Enhancements

### Core Principle
The BC branch (`feature/bc-monitor`) is authoritative for all code except AMM-specific monitor functionality. We will selectively integrate AMM improvements without disrupting BC enhancements.

## Overview
- **Base Branch**: `feature/bc-monitor` (authoritative)
- **Integration Branch**: `feature/amm-enhancements` (selective features)
- **Target Branch**: `feature/unified-monitoring-final`
- **Estimated Duration**: 5 sessions over 2-3 days

## Session 1: Preparation & Analysis (2 hours)

### Objectives
- Document current state of both branches
- Identify AMM-specific files and changes
- Create backup and recovery plan

### Tasks
1. **Create Working Branch**
   ```bash
   git checkout feature/bc-monitor
   git pull origin feature/bc-monitor
   git checkout -b feature/unified-monitoring-final
   ```

2. **Document BC Branch State**
   ```bash
   # List all Phase implementations
   grep -r "Phase [1-6]" src/ --include="*.ts" > bc-phases.txt
   
   # List Token Enrichment features
   grep -r "Session [1-4]" src/ --include="*.ts" > bc-enrichment.txt
   
   # Document removed features
   find . -name "*websocket*" -o -name "*ws*" > removed-features.txt
   ```

3. **Analyze AMM Branch Differences**
   ```bash
   # Checkout AMM branch in separate worktree
   git worktree add ../amm-branch feature/amm-enhancements
   
   # Compare AMM-specific files
   diff -r src/monitors/amm-monitor.ts ../amm-branch/src/monitors/amm-monitor.ts
   diff -r src/services/amm-*.ts ../amm-branch/src/services/amm-*.ts
   ```

4. **Create AMM Feature Inventory**
   - List all AMM Enhancement Sessions (1-5)
   - Identify critical AMM fixes (price calculation)
   - Document AMM-specific services
   - Note AMM database changes

### Deliverables
- `BC_STATE_BASELINE.md` - Current BC branch features
- `AMM_FEATURES_TO_INTEGRATE.md` - AMM-specific improvements
- Database backup
- Git bundle backup

## Session 2: AMM Monitor Core Integration (3 hours)

### Objectives
- Integrate AMM monitor improvements
- Preserve BC monitor architecture
- Apply critical AMM price fixes

### Tasks
1. **Extract AMM Monitor Changes**
   ```bash
   # Cherry-pick AMM monitor improvements
   git checkout ../amm-branch/src/monitors/amm-monitor.ts -- .
   git checkout ../amm-branch/src/monitors/amm-account-monitor.ts -- .
   
   # Review changes
   git diff --cached
   ```

2. **Manual Integration**
   - Keep BC's BaseMonitor architecture
   - Integrate AMM price calculation fix
   - Preserve BC's event-driven patterns
   - Remove any WebSocket references

3. **AMM Price Calculator Integration**
   ```typescript
   // Critical fix from AMM branch
   // Fallback price calculation from trade amounts
   if (!price && trade.sol_amount && trade.token_amount) {
     price = calculatePriceFromAmounts(trade.sol_amount, trade.token_amount);
   }
   ```

4. **Test Monitor Startup**
   ```bash
   # Test individual monitors
   npm run amm-monitor
   npm run amm-account-monitor
   
   # Verify no WebSocket errors
   # Verify price calculations
   ```

### Validation
- [ ] AMM monitors start without errors
- [ ] Price calculations work correctly
- [ ] No WebSocket dependencies
- [ ] Event bus integration intact

## Session 3: AMM Services & Database Integration (3 hours)

### Objectives
- Integrate AMM Enhancement Session features
- Update database with AMM-specific tables
- Preserve BC's service architecture

### Tasks
1. **AMM Service Integration**
   ```bash
   # Selectively copy AMM services
   cp ../amm-branch/src/services/liquidity-event-tracker.ts src/services/
   cp ../amm-branch/src/services/amm-fee-tracker.ts src/services/
   cp ../amm-branch/src/services/lp-position-tracker.ts src/services/
   cp ../amm-branch/src/services/pool-analytics-service.ts src/services/
   cp ../amm-branch/src/services/price-impact-analyzer.ts src/services/
   ```

2. **Service Registration**
   ```typescript
   // In DI container - add AMM services
   // Preserve BC's container structure
   container.register('liquidityEventTracker', LiquidityEventTracker);
   container.register('ammFeeTracker', AmmFeeTracker);
   // ... etc
   ```

3. **Database Schema Integration**
   ```sql
   -- Only add AMM-specific tables
   -- Don't modify existing BC tables
   CREATE TABLE IF NOT EXISTS liquidity_events (...);
   CREATE TABLE IF NOT EXISTS amm_fee_events (...);
   CREATE TABLE IF NOT EXISTS lp_positions (...);
   CREATE TABLE IF NOT EXISTS amm_pool_metrics_hourly (...);
   CREATE TABLE IF NOT EXISTS trade_simulations (...);
   ```

4. **API Endpoint Integration**
   - Copy AMM-specific endpoints only
   - Keep BC's port 3001 (not 3002)
   - Integrate into BC's API structure

### Validation
- [ ] All AMM services compile
- [ ] Database migrations apply cleanly
- [ ] No conflicts with BC services
- [ ] API endpoints accessible

## Session 4: Testing & Integration Validation (2 hours)

### Objectives
- Full system integration testing
- Validate BC→AMM graduation flow
- Performance testing

### Tasks
1. **Full System Startup**
   ```bash
   # Start all monitors
   npm run start
   
   # Verify all 4 monitors running
   # Check logs for errors
   ```

2. **Integration Flow Tests**
   - Create BC trade
   - Trigger graduation
   - Verify AMM pool creation
   - Test liquidity events
   - Validate fee tracking

3. **BC Feature Validation**
   - Stale token detection working
   - Token enrichment active
   - Historical recovery functional
   - Performance monitoring operational

4. **AMM Feature Validation**
   - Liquidity tracking
   - Fee collection monitoring
   - LP position updates
   - Price impact calculations

### Test Scenarios
```typescript
// Test 1: BC Trade → Graduation → AMM Pool
// Test 2: AMM Liquidity Add/Remove
// Test 3: Fee Collection Events
// Test 4: Price Impact on Large Trades
// Test 5: Stale Token Detection (BC + AMM)
```

## Session 5: Documentation & Deployment (2 hours)

### Objectives
- Update all documentation
- Create deployment guide
- Final validation

### Tasks
1. **Update CLAUDE.md**
   ```markdown
   ## Unified System Features
   
   ### From BC Branch (Authoritative)
   - Phases 1-6 Implementation
   - Token Enrichment Sessions 1-4
   - WebSocket Removal
   - Performance Monitoring
   
   ### From AMM Branch (Integrated)
   - AMM Enhancement Sessions 1-5
   - Critical Price Calculation Fix
   - Liquidity & Fee Tracking
   - LP Position Management
   ```

2. **Create Migration Guide**
   - Database migration order
   - Configuration changes
   - Breaking changes
   - Rollback procedures

3. **Performance Benchmarks**
   ```bash
   # Run performance tests
   npm run performance:metrics
   
   # Document baseline metrics
   # - Parse rates
   # - Save rates
   # - Memory usage
   # - CPU usage
   ```

4. **Final Checklist**
   - [ ] All tests passing
   - [ ] Documentation updated
   - [ ] No TypeScript errors
   - [ ] Performance acceptable
   - [ ] Rollback plan ready

### Deployment Steps
1. Backup production database
2. Deploy to staging
3. Run integration tests
4. Monitor for 24 hours
5. Deploy to production

## Critical Decision Points

### What to Keep from BC Branch
- All Phase 1-6 implementations
- Token Enrichment Sessions 1-4
- WebSocket removal
- Performance monitoring
- Stale token detection
- Historical recovery
- Base architecture patterns

### What to Take from AMM Branch
- AMM monitor improvements
- Price calculation fixes
- 5 AMM Enhancement Sessions:
  - Liquidity event tracking
  - Fee tracking
  - LP position management
  - Pool analytics
  - Price impact analysis
- AMM-specific API endpoints
- AMM database tables

### What to Reject from AMM Branch
- WebSocket code (if any)
- Port 3002 configuration
- Outdated base services
- Non-AMM code changes
- Conflicting architecture patterns

## Risk Mitigation

### Backup Strategy
```bash
# Before each session
git bundle create bc-backup-session-X.bundle --all
pg_dump $DATABASE_URL > db-backup-session-X.sql
```

### Rollback Plan
```bash
# If issues arise
git reset --hard origin/feature/bc-monitor
psql $DATABASE_URL < db-backup-session-X.sql
```

### Validation Gates
- Must pass before proceeding to next session
- TypeScript compilation
- All tests passing
- Manual smoke tests
- No performance degradation

## Success Criteria

1. **Functional Success**
   - All 4 monitors operational
   - BC→AMM graduation working
   - All Phase features intact
   - AMM enhancements integrated

2. **Technical Success**
   - No TypeScript errors
   - All tests passing
   - Performance metrics maintained
   - Clean architecture preserved

3. **Operational Success**
   - Smooth deployment
   - No production issues
   - Documentation complete
   - Team knowledge transfer

## Timeline

- **Day 1**: Sessions 1-2 (Analysis + Core Integration)
- **Day 2**: Sessions 3-4 (Services + Testing)
- **Day 3**: Session 5 (Documentation + Deployment)

## Notes

- BC branch remains authoritative for all non-AMM code
- AMM improvements are additive, not replacements
- Preserve BC's architectural decisions
- Test thoroughly at each session
- Document all decisions made during merge