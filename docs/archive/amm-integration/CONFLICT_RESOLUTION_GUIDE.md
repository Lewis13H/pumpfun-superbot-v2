# Conflict Resolution Guide: BC Monitor ← AMM Enhancements

## Expected Conflicts and Resolutions

### 1. src/index.ts

**Conflict**: Different SystemStats interfaces and event handlers

**AMM Branch Has**:
```typescript
// Additional stats for AMM features
liquidityDeposits: number;
liquidityWithdrawals: number;
totalLiquidityUsd: number;
feesCollected: number;
totalFeesUsd: number;
lpPositions: number;
lpPositionValueUsd: number;
poolsAnalyzed: number;
highApyPools: number;
```

**BC Branch Has**:
```typescript
// Stale token tracking
staleTokens: number;
tokensRecovered: number;
```

**Resolution**: Combine both sets of stats
```typescript
const stats: SystemStats = {
  startTime: new Date(),
  bcTrades: 0,
  ammTrades: 0,
  totalVolume: 0,
  tokensDiscovered: 0,
  tokensEnriched: 0,
  graduations: 0,
  // From AMM branch
  liquidityDeposits: 0,
  liquidityWithdrawals: 0,
  totalLiquidityUsd: 0,
  feesCollected: 0,
  totalFeesUsd: 0,
  lpPositions: 0,
  lpPositionValueUsd: 0,
  poolsAnalyzed: 0,
  highApyPools: 0,
  // From BC branch
  staleTokens: 0,
  tokensRecovered: 0,
  // Common
  errors: 0,
  lastError: null,
  lastErrorTime: null,
  solPrice: 0,
  activeMonitors: new Set<string>()
};
```

### 2. CLAUDE.md

**Conflict**: Different service lists and documentation

**Resolution Strategy**:
1. Keep the header and overview from BC branch (has latest updates)
2. In the services section, merge both lists:
   - Keep all Phase 3-6 services from BC branch
   - Add AMM-specific services from AMM branch
3. In the commands section:
   - Keep dashboard on port 3001 (BC branch)
   - Remove performance mode commands (removed in BC branch)
4. Architecture updates:
   - Keep Phase 1-6 descriptions from BC branch
   - Add AMM Enhancement Sessions 1-5 from AMM branch

### 3. Database Schema Conflicts

**AMM Branch Schema Files**:
- `database-schemas/amm-fee-events.sql`
- `database-schemas/amm-liquidity-events.sql`
- `database-schemas/lp-positions.sql`
- `database-schemas/pool-analytics.sql`
- `database-schemas/price-impact-schema.sql`

**BC Branch Schema Files**:
- `schema/migrations/add-price-tracking-columns.sql`
- `schema/migrations/add-recovery-progress-table.sql`
- `schema/migrations/add-social-metadata-columns.sql`

**Resolution**: Create a unified migration that applies all changes
```sql
-- 1. Apply BC branch migrations first
\i schema/migrations/add-price-tracking-columns.sql
\i schema/migrations/add-recovery-progress-table.sql
\i schema/migrations/add-social-metadata-columns.sql

-- 2. Apply AMM branch tables
\i database-schemas/amm-liquidity-events.sql
\i database-schemas/amm-fee-events.sql
\i database-schemas/lp-positions.sql
\i database-schemas/pool-analytics.sql
\i database-schemas/price-impact-schema.sql

-- 3. Update price precision (from AMM branch)
ALTER TABLE tokens_unified 
ALTER COLUMN first_price_usd TYPE DECIMAL(20,12),
ALTER COLUMN latest_price_usd TYPE DECIMAL(20,12);

ALTER TABLE trades_unified 
ALTER COLUMN price_usd TYPE DECIMAL(20,12);
```

### 4. API Configuration

**Conflict**: Port numbers

**AMM Branch**: Uses port 3002
**BC Branch**: Uses port 3001

**Resolution**: 
- Keep main API on 3001 (BC branch default)
- AMM analytics endpoints can be part of main API
- If needed, run AMM analytics separately on 3002

### 5. Package.json Scripts

**Potential Conflict**: Different script definitions

**Resolution**: Merge scripts, keeping all unique ones
```json
{
  "scripts": {
    // Keep all existing BC branch scripts
    "start": "...",
    "dev": "...",
    // Add any AMM-specific scripts that don't exist
    "amm-analytics": "..."
  }
}
```

### 6. Service Registration

**Potential Conflict**: DI container service names

**Check for**:
- Duplicate service names
- Different implementations of same service
- Service dependency conflicts

**Resolution**:
1. Ensure unique service names
2. If same service has different implementations, rename one
3. Update dependencies accordingly

### 7. Event Names

**Potential Conflict**: Event bus event names

**Check for**:
- Same event name used for different purposes
- Missing event handlers
- Event payload incompatibilities

**Resolution**:
1. Namespace events if needed (e.g., `AMM:LIQUIDITY_ADDED` vs `BC:LIQUIDITY_ADDED`)
2. Ensure all handlers are registered
3. Verify event payload structures match

## Merge Commands

```bash
# 1. Start merge
git checkout feature/bc-monitor
git merge feature/amm-enhancements

# 2. When conflicts appear, use this guide to resolve
# For each conflicted file:
git status  # See conflicted files
vi <conflicted-file>  # Resolve conflicts
git add <resolved-file>

# 3. Complete merge
git commit -m "feat: Merge AMM enhancements into BC monitor branch

- Added AMM Enhancement Sessions 1-5
- Fixed AMM price calculation
- Added liquidity, fee, and LP tracking
- Integrated price impact analysis
- Maintained all BC monitor Phase 3-6 features
- Updated database schema with AMM tables
- Preserved critical fixes from both branches"

# 4. Verify
npm install
npm run build
npm test
```

## Testing After Merge

1. **Build Test**: `npm run build` - Should have no errors
2. **Unit Tests**: `npm test` - All should pass
3. **Integration Test**: `npm run start` - All 4 monitors should start
4. **Database Test**: Apply migrations and verify schema
5. **API Test**: Check endpoints on port 3001
6. **Dashboard Test**: Verify dashboard loads correctly

## Critical Items to Preserve

From AMM Branch:
- AMM price calculation fix (fallback method)
- All 5 enhancement session implementations
- Database schema updates
- LP token monitor

From BC Branch:
- All Phase 3-6 implementations
- Token enrichment features
- Stale token detection
- WebSocket removal
- Performance optimizations