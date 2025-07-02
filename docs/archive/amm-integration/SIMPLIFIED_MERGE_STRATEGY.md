# Simplified Merge Strategy: AMM → BC

## Overview
Much simpler approach: Stay in BC worktree and selectively copy AMM improvements.

## Step 1: Prepare AMM Worktree for Analysis
```bash
# Create AMM worktree if not exists
git worktree add ../amm-analysis feature/amm-enhancements
```

## Step 2: Analyze AMM Changes
```bash
# From BC worktree, compare src folders
cd pumpfun-superbot-v2

# List all differences in src folder
diff -rq src/ ../amm-analysis/src/ | grep -v "Only in src/" > amm-differences.txt

# Key files to check:
echo "=== AMM Monitor Files ==="
diff -u src/monitors/amm-monitor.ts ../amm-analysis/src/monitors/amm-monitor.ts > diffs/amm-monitor.diff
diff -u src/monitors/amm-account-monitor.ts ../amm-analysis/src/monitors/amm-account-monitor.ts > diffs/amm-account-monitor.diff

echo "=== AMM Services ==="
# Check for AMM-specific services that don't exist in BC
find ../amm-analysis/src/services -name "*.ts" | while read f; do
  basename=$(basename "$f")
  if [ ! -f "src/services/$basename" ]; then
    echo "NEW SERVICE: $basename"
  fi
done

echo "=== Other Changes ==="
# Check other modified files
diff -rq src/ ../amm-analysis/src/ | grep "differ" | grep -v "amm-monitor"
```

## Step 3: Simple Copy Strategy

### 3.1 Replace AMM Monitors
```bash
# Backup current AMM monitors
cp src/monitors/amm-monitor.ts src/monitors/amm-monitor.ts.bc-backup
cp src/monitors/amm-account-monitor.ts src/monitors/amm-account-monitor.ts.bc-backup

# Copy AMM branch versions
cp ../amm-analysis/src/monitors/amm-monitor.ts src/monitors/
cp ../amm-analysis/src/monitors/amm-account-monitor.ts src/monitors/
```

### 3.2 Identify Required Services
```bash
# Check what services the AMM monitors need
grep -h "import.*from.*services" src/monitors/amm-*.ts | sort -u

# Copy only missing AMM services
# Example:
cp ../amm-analysis/src/services/liquidity-event-tracker.ts src/services/
cp ../amm-analysis/src/services/amm-fee-tracker.ts src/services/
cp ../amm-analysis/src/services/lp-position-tracker.ts src/services/
cp ../amm-analysis/src/services/pool-analytics-service.ts src/services/
cp ../amm-analysis/src/services/price-impact-analyzer.ts src/services/
```

### 3.3 Fix Imports and Dependencies
```typescript
// In copied files, update imports to match BC structure:

// Change any WebSocket imports
// FROM: import { WebSocketService } from '../websocket';
// TO: Remove or comment out

// Update event bus usage
// FROM: this.emit('event', data);
// TO: this.eventBus.emit('event', data);

// Fix API port references
// FROM: const PORT = 3002;
// TO: const PORT = 3001;
```

## Step 4: Database Updates

### 4.1 Check for New Tables
```bash
# Find SQL migrations in AMM branch
find ../amm-analysis -name "*.sql" -type f | grep -E "(liquidity|fee|lp|pool)"

# Copy only AMM-specific migrations
cp ../amm-analysis/src/database/migrations/*amm*.sql src/database/migrations/
```

### 4.2 Apply Migrations
```bash
# Since data can be erased, just apply new tables
psql $DATABASE_URL < src/database/migrations/amm-enhancement-tables.sql
```

## Step 5: Container Registration

### 5.1 Add New Services
```typescript
// src/core/container-factory.ts
// Add only the new AMM services

// Check if service exists before adding
if (!container.has('liquidityEventTracker')) {
  container.register('liquidityEventTracker', () => 
    new LiquidityEventTracker(
      container.get('logger'),
      container.get('db'),
      container.get('eventBus')
    )
  );
}
// ... repeat for other AMM services
```

## Step 6: Quick Testing

### 6.1 Compile Check
```bash
# Quick compile test
npm run build

# If errors, they're likely:
# - Missing imports
# - WebSocket references
# - Service not found
```

### 6.2 Start Monitors
```bash
# Test individually first
npm run amm-monitor
npm run amm-account-monitor

# Then test all together
npm run start
```

## What to Keep/Change

### From AMM Branch (KEEP):
1. **AMM Monitor Price Fix**
   ```typescript
   // Critical fallback calculation
   if (!price && trade.sol_amount && trade.token_amount) {
     price = calculatePriceFromAmounts(trade.sol_amount, trade.token_amount);
   }
   ```

2. **AMM Enhancement Services**
   - liquidity-event-tracker.ts
   - amm-fee-tracker.ts
   - lp-position-tracker.ts
   - pool-analytics-service.ts
   - price-impact-analyzer.ts

3. **AMM Database Tables**
   - liquidity_events
   - amm_fee_events
   - lp_positions
   - amm_pool_metrics_hourly
   - trade_simulations

### From BC Branch (KEEP):
- Everything else!
- BaseMonitor architecture
- Event bus patterns
- No WebSocket
- Port 3001
- All Phase 1-6 features
- Token enrichment

## Simple Checklist

1. **Copy Files**
   - [ ] Copy AMM monitors
   - [ ] Copy AMM services (5 files)
   - [ ] Copy AMM migrations

2. **Fix Issues**
   - [ ] Remove WebSocket imports
   - [ ] Update event bus usage
   - [ ] Fix port to 3001
   - [ ] Register services in container

3. **Test**
   - [ ] npm run build (no errors)
   - [ ] npm run start (all monitors run)
   - [ ] Check dashboard
   - [ ] Verify AMM prices

## Total Time: ~1 hour

Much simpler than the 5-session approach!