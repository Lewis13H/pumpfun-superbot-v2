# Merge Strategy: AMM Enhancements → BC Monitor

## Overview
Merging the completed AMM enhancement features from `feature/amm-enhancements` into `feature/bc-monitor` to create a unified monitoring system.

## Current State

### AMM Enhancements Branch (`feature/amm-enhancements`)
**Completed Features:**
1. ✅ AMM Price Calculation Fixed
   - Fallback price calculation from trade amounts
   - Accurate prices ($0.00001 - $0.18 range)
   - Tokens saving with $1,000 threshold

2. ✅ Database Schema Updates
   - Fixed column mismatches (image → image_uri)
   - Added missing columns (price_source, last_price_update)
   - Increased price precision to 12 decimal places

3. ✅ All 5 AMM Enhancement Sessions
   - Session 1: Liquidity Event Tracking
   - Session 2: Fee Tracking System  
   - Session 3: LP Token & Position Tracking
   - Session 4: Advanced Pool Analytics
   - Session 5: Price Impact & Slippage Analysis

4. ✅ Infrastructure Improvements
   - Enhanced AMM monitor with full precision logging
   - API port changed to 3002
   - Fixed all sol_prices column references

### BC Monitor Branch (`feature/bc-monitor`)
**Expected Features:**
- Bonding curve trade monitoring
- BC account monitoring (graduation detection)
- Phase 1 & 2 enhancements from BONDING-CURVE-ENHANCEMENT-PLAN.md
- Integration with the refactored DI architecture

## Merge Strategy

### Step 1: Prepare for Merge
```bash
# In the BC monitor worktree
cd /path/to/bc-monitor-worktree
git fetch origin
git pull origin feature/bc-monitor
```

### Step 2: Create Integration Branch
```bash
# Create a new branch for the integration
git checkout -b feature/unified-monitoring
```

### Step 3: Merge AMM Enhancements
```bash
# Merge the AMM enhancements
git merge origin/feature/amm-enhancements
```

### Step 4: Resolve Conflicts
Expected conflict areas:
1. **CLAUDE.md** - Both branches have updates
2. **Database schema** - Ensure all tables are included
3. **src/index.ts** - Main entry point modifications
4. **Configuration files** - Port settings, thresholds

### Step 5: Integration Testing
1. **Test all 4 monitors together**:
   ```bash
   npm run start  # Should run BC + AMM monitors
   ```

2. **Verify graduation flow**:
   - BC trades → Graduation detection → AMM pool creation
   - Bonding curve mappings preserved
   - Token status updates correctly

3. **Test enhanced features**:
   - AMM price calculations
   - Liquidity event tracking
   - Fee collection monitoring
   - LP position tracking
   - Price impact analysis

### Step 6: Database Migration
```sql
-- Ensure all tables exist
-- From AMM enhancements:
CREATE TABLE IF NOT EXISTS liquidity_events (...);
CREATE TABLE IF NOT EXISTS amm_fee_events (...);
CREATE TABLE IF NOT EXISTS lp_positions (...);
CREATE TABLE IF NOT EXISTS amm_pool_metrics_hourly (...);
CREATE TABLE IF NOT EXISTS trade_simulations (...);

-- Update price columns precision
ALTER TABLE tokens_unified 
ALTER COLUMN first_price_usd TYPE DECIMAL(20,12);

ALTER TABLE trades_unified 
ALTER COLUMN price_usd TYPE DECIMAL(20,12);
```

### Step 7: Update Documentation
1. **Merge CLAUDE.md sections**:
   - BC monitor improvements
   - AMM enhancement completions
   - Updated architecture diagram

2. **Update README.md**:
   - Unified monitoring instructions
   - Complete feature list

## Testing Checklist

### Pre-Merge Tests
- [ ] AMM monitors run independently
- [ ] BC monitors run independently  
- [ ] Database migrations applied
- [ ] TypeScript builds without errors

### Post-Merge Tests
- [ ] All 4 monitors start correctly
- [ ] BC trades detected and saved
- [ ] Graduations detected and processed
- [ ] AMM trades calculated with correct prices
- [ ] Tokens saved when meeting thresholds
- [ ] Dashboard displays unified data
- [ ] WebSocket broadcasts working
- [ ] Price recovery services functional

### Integration Tests
- [ ] BC → AMM graduation flow
- [ ] Token metadata enrichment
- [ ] SOL price updates
- [ ] Event bus communication
- [ ] DI container initialization

## Rollback Plan
If issues arise:
```bash
# Return to BC monitor state
git reset --hard origin/feature/bc-monitor

# Or return to AMM state
git reset --hard origin/feature/amm-enhancements
```

## Final Steps
1. **Create PR**: `feature/unified-monitoring` → `main`
2. **Deploy to staging** for full system test
3. **Monitor for 24 hours** before production
4. **Document any new issues** discovered

## Notes
- The AMM price calculation fix is critical for the unified system
- Ensure environment variables are updated (API_PORT=3002)
- Check that all event handlers are registered with EventBus
- Verify shared services (SOL price, metadata) work for both BC and AMM