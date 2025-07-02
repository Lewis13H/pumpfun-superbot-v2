# Pre-Merge Validation Checklist

## Current State Documentation

### Branch: feature/bc-monitor
**Latest Commit**: 1c5d583 - "docs: Update Token Enrichment Plan with completion status"

**Key Features**:
- [x] Phase 1-6 of Bonding Curve Enhancement Plan completed
- [x] Token Enrichment Sessions 1-4 completed
- [x] WebSocket removed for reliability
- [x] Enhanced stale token detection
- [x] Historical data recovery
- [x] Performance monitoring

**Critical Files to Backup**:
```bash
# Create backup of critical files
cp src/index.ts src/index.ts.bc-backup
cp CLAUDE.md CLAUDE.md.bc-backup
cp package.json package.json.bc-backup
```

### Branch: feature/amm-enhancements
**Latest Commit**: 770b96a - "Pre-merge commit: AMM enhancements completed and ready for integration"

**Key Features**:
- [x] AMM price calculation fixed (critical)
- [x] All 5 AMM Enhancement Sessions completed
- [x] LP token monitoring
- [x] Fee tracking system
- [x] Price impact analysis
- [x] API port changed to 3002

## Pre-Merge Tests

### 1. BC Monitor Branch Tests
```bash
# Switch to BC monitor branch
git checkout feature/bc-monitor

# Run build
npm run build
# Expected: No errors

# Run tests
npm test
# Expected: All tests pass

# Test monitors individually
npm run bc-monitor
# Expected: Connects and processes BC trades

npm run amm-monitor
# Expected: Connects and processes AMM trades
```

### 2. Database State
```sql
-- Check current schema
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Document row counts
SELECT 
  'tokens_unified' as table_name, COUNT(*) as row_count FROM tokens_unified
UNION ALL
SELECT 
  'trades_unified', COUNT(*) FROM trades_unified
UNION ALL
SELECT 
  'bonding_curve_mappings', COUNT(*) FROM bonding_curve_mappings;
```

### 3. Running Services
```bash
# Check if any services are running
ps aux | grep -E "bc-monitor|amm-monitor|dashboard"

# Stop all services before merge
pkill -f "bc-monitor"
pkill -f "amm-monitor"
pkill -f "dashboard"
```

## Backup Commands

```bash
# 1. Create branch backup
git branch backup-bc-monitor-$(date +%Y%m%d-%H%M%S)

# 2. Create working directory backup
cd ..
cp -r pumpfun-superbot-v2 pumpfun-superbot-v2-backup-$(date +%Y%m%d)

# 3. Database backup (if needed)
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
```

## Environment Check

```bash
# 1. Check Node version
node --version
# Expected: v18.x or higher

# 2. Check npm version
npm --version
# Expected: v9.x or higher

# 3. Check PostgreSQL connection
psql $DATABASE_URL -c "SELECT version();"
# Expected: PostgreSQL 13.x or higher

# 4. Check environment variables
env | grep -E "SHYFT|DATABASE|API_PORT|HELIUS"
```

## Git Status Check

```bash
# 1. Check for uncommitted changes
git status
# Expected: nothing to commit, working tree clean

# 2. Check for stashed changes
git stash list
# Expected: empty or note any stashes

# 3. Verify remote is up to date
git fetch origin
git status
# Expected: Your branch is up to date
```

## Dependency Check

```bash
# 1. Check for outdated packages
npm outdated

# 2. Check for security vulnerabilities
npm audit

# 3. Clean install to ensure lock file is correct
rm -rf node_modules
npm install
```

## Configuration Documentation

### Current BC Monitor Config:
- API Port: 3001
- BC Save Threshold: $8,888
- AMM Save Threshold: $1,000
- Stale Token Detection: Enabled
- WebSocket: Removed

### AMM Enhancement Config:
- API Port: 3002 (in AMM branch)
- Price Precision: DECIMAL(20,12)
- LP Tracking: Enabled
- Fee Analytics: Enabled

## Final Pre-Merge Checklist

- [ ] All tests pass on BC monitor branch
- [ ] No uncommitted changes
- [ ] Backup created
- [ ] Database backed up
- [ ] Services stopped
- [ ] Dependencies up to date
- [ ] Environment variables documented
- [ ] Current configuration documented
- [ ] Team notified of merge

## Ready to Merge?

If all items above are checked:
1. Proceed with merge plan in MERGE_PLAN_BC_AMM.md
2. Use CONFLICT_RESOLUTION_GUIDE.md for conflicts
3. Run post-merge validation

## Emergency Rollback

If something goes wrong:
```bash
# Option 1: Reset to backup branch
git reset --hard backup-bc-monitor-[timestamp]

# Option 2: Restore from directory backup
cd ..
rm -rf pumpfun-superbot-v2
mv pumpfun-superbot-v2-backup-[date] pumpfun-superbot-v2
cd pumpfun-superbot-v2

# Option 3: Restore database (if needed)
psql $DATABASE_URL < backup-[timestamp].sql
```