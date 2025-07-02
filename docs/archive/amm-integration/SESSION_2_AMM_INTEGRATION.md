# Session 2: AMM Monitor Core Integration Guide

## Pre-Session Validation
- [ ] Session 1 complete with all deliverables
- [ ] Working on `feature/unified-monitoring-final` branch
- [ ] AMM worktree available at `../amm-analysis`
- [ ] No uncommitted changes: `git status`

## Integration Strategy

### Core Principle
BC branch code is authoritative. We only extract AMM-specific improvements that enhance AMM monitoring functionality.

## Step 1: AMM Monitor Analysis

### 1.1 Extract AMM Monitor Logic
```bash
# Create temporary directory for AMM code
mkdir -p temp/amm-extraction

# Copy AMM monitors for analysis
cp ../amm-analysis/src/monitors/amm-monitor.ts temp/amm-extraction/
cp ../amm-analysis/src/monitors/amm-account-monitor.ts temp/amm-extraction/

# Extract price calculation improvements
grep -A 10 -B 10 "calculatePriceFromAmounts\|fallback" temp/amm-extraction/*.ts > price-fixes.txt
```

### 1.2 Identify Key Improvements
Look for:
- [ ] Price calculation fallback logic
- [ ] Enhanced error handling
- [ ] Improved parsing strategies
- [ ] Better liquidity calculations
- [ ] AMM-specific event handling

## Step 2: Manual Integration Process

### 2.1 AMM Monitor Integration
```typescript
// src/monitors/amm-monitor.ts
// Keep BC's BaseMonitor extension
// Add AMM price calculation improvements

// CRITICAL FIX TO ADD:
private calculatePrice(trade: any): number | null {
  // Original calculation
  let price = this.calculatePriceFromReserves(
    trade.virtualSolReserves,
    trade.virtualTokenReserves
  );
  
  // AMM ENHANCEMENT: Fallback calculation
  if (!price && trade.sol_amount && trade.token_amount) {
    // Calculate price from trade amounts when reserves unavailable
    const solAmount = new BN(trade.sol_amount);
    const tokenAmount = new BN(trade.token_amount);
    
    if (tokenAmount.gt(new BN(0))) {
      // Price = SOL per token
      price = solAmount.toNumber() / tokenAmount.toNumber();
    }
  }
  
  return price;
}
```

### 2.2 Preserve BC Architecture
```typescript
// DO NOT CHANGE:
export class AMMMonitor extends BaseMonitor {
  // Keep all BC's dependency injection
  constructor(container: DIContainer) {
    super(container, {
      programId: PUMP_SWAP_PROGRAM_ID,
      subscriptionKey: 'pumpswap_amm',
      monitorName: 'AMM Monitor'
    });
  }
  
  // Keep BC's event emission patterns
  private emitTradeEvent(trade: AMMTrade): void {
    this.eventBus.emit('AMM_TRADE', { trade });
    this.eventBus.emit('TRADE_PROCESSED', {
      trade,
      source: 'amm'
    });
  }
}
```

### 2.3 Integration Checklist
- [ ] Price fallback logic added
- [ ] BaseMonitor extension preserved
- [ ] Event bus patterns maintained
- [ ] No WebSocket references added
- [ ] DI container usage intact

## Step 3: AMM Account Monitor Integration

### 3.1 Key Improvements to Extract
```typescript
// From AMM branch - pool state calculations
private calculatePoolMetrics(accountData: Buffer): PoolMetrics {
  // Enhanced calculations from AMM branch
  const metrics = {
    totalLiquidity: this.calculateTotalLiquidity(reserves),
    priceImpact: this.estimatePriceImpact(reserves, tradeSize),
    depth: this.calculateDepth(reserves)
  };
  return metrics;
}
```

### 3.2 Preserve BC Features
- [ ] Keep subscription builder usage
- [ ] Maintain event emission standards
- [ ] Preserve error handling patterns
- [ ] Keep performance monitoring hooks

## Step 4: Service Dependencies

### 4.1 Check AMM Service Requirements
```bash
# Identify required services
grep -r "import.*from.*services" temp/amm-extraction/*.ts | grep -E "amm|pool|liquidity"
```

### 4.2 Add Only Essential Services
```typescript
// In container setup - only add if not present
if (!container.has('ammPoolStateService')) {
  container.register('ammPoolStateService', AMMPoolStateService);
}
```

## Step 5: Testing & Validation

### 5.1 Compilation Test
```bash
# Test compilation
npm run build

# If errors, check:
# - Missing imports
# - Type mismatches
# - Service dependencies
```

### 5.2 Individual Monitor Tests
```bash
# Test AMM monitor in isolation
AMM_ONLY=true npm run amm-monitor

# Test AMM account monitor
AMM_ONLY=true npm run amm-account-monitor

# Check logs for:
# - Successful startup
# - Price calculations working
# - No WebSocket errors
```

### 5.3 Price Calculation Validation
```typescript
// Create test script: test-amm-price-calc.ts
import { AMMMonitor } from './src/monitors/amm-monitor';

// Test cases:
// 1. Normal reserves available
// 2. Fallback to trade amounts
// 3. Zero token amounts
// 4. Very small amounts (dust)
```

## Step 6: Commit Strategy

### 6.1 Staged Commits
```bash
# Commit 1: AMM monitor core
git add src/monitors/amm-monitor.ts
git commit -m "feat: Integrate AMM price calculation improvements

- Add fallback price calculation from trade amounts
- Preserve BC monitor architecture
- Fix price calculation for missing reserves"

# Commit 2: AMM account monitor
git add src/monitors/amm-account-monitor.ts
git commit -m "feat: Enhance AMM account monitor

- Improve pool state calculations
- Add enhanced metrics
- Maintain BC event patterns"
```

## Common Issues & Solutions

### Issue 1: Import Conflicts
```typescript
// Wrong (from AMM branch):
import { WebSocketManager } from '../websocket';

// Correct (BC approach):
// Remove WebSocket imports entirely
```

### Issue 2: Service Not Found
```typescript
// Add to container setup
container.register('missingService', MissingService);
```

### Issue 3: Event Name Conflicts
```typescript
// Ensure consistent event names
// BC standard: 'AMM_TRADE', 'TRADE_PROCESSED'
// Not: 'amm-trade', 'trade-processed'
```

## Validation Checklist

### Core Functionality
- [ ] AMM monitors start successfully
- [ ] Price calculations accurate
- [ ] Fallback logic working
- [ ] No runtime errors

### Architecture Preservation
- [ ] BaseMonitor pattern intact
- [ ] DI container working
- [ ] Event bus functional
- [ ] No WebSocket dependencies

### Performance
- [ ] Parse rate maintained/improved
- [ ] Memory usage stable
- [ ] No performance regression

## Session 2 Deliverables

1. **Integrated AMM Monitors**
   - amm-monitor.ts with price fixes
   - amm-account-monitor.ts enhanced

2. **Test Results**
   - Compilation successful
   - Individual monitor tests pass
   - Price calculations verified

3. **Documentation**
   - List of changes made
   - Any deviations from plan
   - Issues encountered

## Next Session Preparation

- [ ] Document integrated features
- [ ] List remaining AMM services
- [ ] Identify database changes needed
- [ ] Plan Session 3 schedule

## Rollback Plan

If critical issues:
```bash
# Revert to BC baseline
git reset --hard HEAD~2
git clean -fd

# Or restore specific file
git checkout feature/bc-monitor -- src/monitors/amm-monitor.ts
```

## Notes Section
_Record integration decisions, issues, and solutions:_

---

**Session 2 Complete When:**
- AMM monitors integrated and tested
- Price calculation improvements verified
- No compilation errors
- Ready for Session 3 (services)