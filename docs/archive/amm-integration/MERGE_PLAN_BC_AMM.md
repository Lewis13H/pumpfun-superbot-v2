# Comprehensive Merge Plan: feature/bc-monitor ← feature/amm-enhancements

## Executive Summary

This document outlines the detailed plan for merging AMM enhancements into the BC monitor branch. Both branches have diverged significantly since commit `70de30c` (Phase 1 & 2 enhancements), with BC monitor implementing Phases 3-6 and Token Enrichment, while AMM branch focused on AMM-specific enhancements.

## Branch Analysis

### Divergence Point
- **Common Ancestor**: `70de30c` - "docs: Update CLAUDE.md directory structure with Phase 1 & 2 enhancements"
- **Divergence Date**: Approximately when Phase 3 work began

### feature/bc-monitor Progress
1. **Phase 3-6 Implementations**:
   - Phase 3: Token Lifecycle Tracking
   - Phase 4: Failed Transaction & MEV Analysis
   - Phase 5: Advanced State Tracking & Analytics
   - Phase 6: Performance Optimization (WebSocket removed)

2. **Token Enrichment Plan**:
   - Session 1-4 completed
   - Enhanced stale token detection
   - Shyft DAS integration
   - Historical data recovery

3. **Critical Fixes**:
   - Fixed bonding curve extraction (correct account index)
   - Fixed gRPC subscription format
   - Removed WebSocket for reliability

### feature/amm-enhancements Progress
1. **AMM-Specific Features**:
   - Fixed AMM price calculation (critical fix)
   - All 5 AMM Enhancement Sessions completed
   - Database schema updates for AMM tracking
   - API port changed to 3002

2. **Key Improvements**:
   - Liquidity event tracking
   - Fee tracking system
   - LP token & position tracking
   - Price impact & slippage analysis

## Conflict Analysis

### High Probability Conflicts

1. **CLAUDE.md**
   - BC: Added Phase 3-6 documentation, Token Enrichment
   - AMM: Added AMM enhancement documentation
   - **Resolution**: Merge both sets of additions

2. **src/index.ts**
   - BC: Integration with new Phase services
   - AMM: AMM-specific monitor configurations
   - **Resolution**: Combine all service initializations

3. **API Configuration**
   - BC: Uses port 3001
   - AMM: Changed to port 3002
   - **Resolution**: Keep 3001 for main API, add separate AMM analytics on 3002

4. **Database Schema**
   - BC: Added stale token tracking, social metadata
   - AMM: Added AMM-specific tables, increased price precision
   - **Resolution**: Apply all schema changes

### Medium Probability Conflicts

1. **Dashboard Files**
   - BC: Added streaming metrics dashboard
   - AMM: Added AMM-specific dashboard
   - **Resolution**: Keep both dashboards

2. **Service Files**
   - Potential namespace conflicts in DI container
   - **Resolution**: Ensure unique service names

## Pre-Merge Checklist

- [ ] Backup current state: `git branch backup-bc-monitor`
- [ ] Ensure clean working directory: `git status`
- [ ] Update dependencies: `npm install`
- [ ] Run tests on BC branch: `npm test`
- [ ] Document current API endpoints
- [ ] Export current database schema

## Merge Execution Plan

### Step 1: Prepare Environment
```bash
# Ensure we're on the correct branch
git checkout feature/bc-monitor

# Create backup
git branch backup-bc-monitor-$(date +%Y%m%d)

# Fetch latest
git fetch origin

# Verify clean state
git status
```

### Step 2: Start Merge
```bash
# Begin merge
git merge feature/amm-enhancements

# This will likely result in conflicts
```

### Step 3: Resolve Conflicts

#### CLAUDE.md Resolution
```markdown
# Merge strategy:
1. Keep Phase 3-6 documentation from BC branch
2. Add AMM Enhancement Sessions documentation
3. Update architecture section with both sets of services
4. Combine command lists
```

#### src/index.ts Resolution
```typescript
// Combine service initializations:
// 1. Keep all Phase 3-6 services from BC
// 2. Add AMM-specific services
// 3. Ensure proper initialization order
// 4. Register all event handlers
```

#### Database Schema Resolution
```sql
-- Apply in order:
1. BC branch schema changes (stale tracking, social metadata)
2. AMM branch schema changes (liquidity events, fee tracking)
3. Update price precision to DECIMAL(20,12) everywhere
```

### Step 4: Post-Merge Tasks

#### 4.1 Database Migration Script
```sql
-- Create unified migration script
-- 1. Add all BC branch columns
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS last_trade_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS should_remove BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS social_links JSONB,
ADD COLUMN IF NOT EXISTS metadata_completeness_score INTEGER;

-- 2. Add all AMM branch tables
CREATE TABLE IF NOT EXISTS liquidity_events (...);
CREATE TABLE IF NOT EXISTS amm_fee_events (...);
CREATE TABLE IF NOT EXISTS lp_positions (...);
CREATE TABLE IF NOT EXISTS amm_pool_metrics_hourly (...);
CREATE TABLE IF NOT EXISTS trade_simulations (...);

-- 3. Update price precision
ALTER TABLE tokens_unified 
ALTER COLUMN first_price_usd TYPE DECIMAL(20,12),
ALTER COLUMN latest_price_usd TYPE DECIMAL(20,12);

ALTER TABLE trades_unified 
ALTER COLUMN price_usd TYPE DECIMAL(20,12);
```

#### 4.2 Configuration Updates
```typescript
// Update environment configuration
// 1. Main API stays on 3001
// 2. AMM analytics API on 3002
// 3. Ensure all service keys are registered
```

### Step 5: Testing Plan

#### 5.1 Unit Tests
```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testPathPattern="bc-monitor"
npm test -- --testPathPattern="amm"
```

#### 5.2 Integration Tests
1. **Monitor Startup**
   ```bash
   npm run start
   # Verify all 4 monitors start
   # Check logs for errors
   ```

2. **Graduation Flow**
   - Monitor BC trades
   - Detect graduation
   - Verify AMM pool creation
   - Check token status update

3. **Price Calculations**
   - Verify BC prices are accurate
   - Verify AMM prices use fallback calculation
   - Check threshold detection

4. **Event Bus**
   - Ensure all events are emitted
   - Verify handlers receive events
   - Check cross-service communication

#### 5.3 Dashboard Tests
1. Open main dashboard (port 3001)
2. Open AMM dashboard (port 3002)
3. Verify data flow
4. Check WebSocket removal didn't break UI

### Step 6: Validation

#### 6.1 Data Validation
```sql
-- Check for data integrity
SELECT COUNT(*) FROM tokens_unified WHERE price_source IS NULL;
SELECT COUNT(*) FROM trades_unified WHERE program = 'amm' AND price_usd = 0;
```

#### 6.2 Performance Validation
- Monitor CPU/memory usage
- Check parse rates
- Verify no memory leaks
- Ensure <1s processing latency

## Rollback Plan

If critical issues arise:

```bash
# Option 1: Reset to backup
git reset --hard backup-bc-monitor-20250102

# Option 2: Revert merge commit
git revert -m 1 HEAD

# Option 3: Cherry-pick critical fixes only
git cherry-pick <amm-price-fix-commit>
```

## Post-Merge Documentation

### Update These Files:
1. **README.md**
   - Unified feature list
   - Updated installation steps
   - Complete command reference

2. **ARCHITECTURE.md**
   - Updated system diagram
   - Service dependency graph
   - Event flow documentation

3. **API Documentation**
   - Endpoint consolidation
   - New AMM analytics endpoints
   - Breaking changes (if any)

## Risk Assessment

### High Risk Items
1. **Database Schema Conflicts**: Multiple migration files may conflict
   - **Mitigation**: Create unified migration script

2. **Service Registration**: DI container conflicts
   - **Mitigation**: Verify unique service names

3. **Event Bus Overwrites**: Event name conflicts
   - **Mitigation**: Namespace events properly

### Medium Risk Items
1. **Configuration Conflicts**: Port and threshold settings
   - **Mitigation**: Document all config changes

2. **Dashboard Integration**: Multiple dashboards may confuse users
   - **Mitigation**: Create unified navigation

## Success Criteria

The merge is successful when:
- [ ] All 4 monitors start without errors
- [ ] BC trades are detected and saved
- [ ] Graduations flow BC → AMM correctly
- [ ] AMM prices calculate correctly (not zero)
- [ ] All tests pass
- [ ] Dashboards display data
- [ ] No TypeScript build errors
- [ ] Performance metrics remain stable
- [ ] Documentation is updated

## Timeline

Estimated time: 4-6 hours
1. Preparation: 30 minutes
2. Merge & conflict resolution: 2-3 hours
3. Testing: 1-2 hours
4. Documentation: 30 minutes

## Notes

1. The AMM price calculation fix is **critical** - ensure it's preserved
2. WebSocket has been removed in BC branch - don't reintroduce it
3. Both branches have valuable features - we want to keep everything
4. Test the graduation flow thoroughly - it's the key integration point