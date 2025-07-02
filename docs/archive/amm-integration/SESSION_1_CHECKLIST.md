# Session 1: Preparation & Analysis Checklist

## Pre-Session Setup
- [ ] Ensure clean working directory: `git status`
- [ ] Update both branches: `git fetch origin`
- [ ] Create backup bundle: `git bundle create pre-merge-backup.bundle --all`
- [ ] Backup database: `pg_dump $DATABASE_URL > pre-merge-db-backup.sql`

## BC Branch Documentation

### 1. Feature Inventory
```bash
# Document Phase implementations
echo "=== BC Monitor Phases ===" > BC_STATE_BASELINE.md
echo "Generated: $(date)" >> BC_STATE_BASELINE.md
echo "" >> BC_STATE_BASELINE.md

# Find Phase 1-6 features
echo "## Phase Implementations" >> BC_STATE_BASELINE.md
grep -r "Phase [1-6]" src/ --include="*.ts" -n >> BC_STATE_BASELINE.md

# Find Token Enrichment Sessions
echo -e "\n## Token Enrichment Sessions" >> BC_STATE_BASELINE.md
grep -r "Session [1-4]" src/ --include="*.ts" -n >> BC_STATE_BASELINE.md

# List all services
echo -e "\n## BC Services" >> BC_STATE_BASELINE.md
find src/services -name "*.ts" -type f | sort >> BC_STATE_BASELINE.md

# Document removed features
echo -e "\n## Removed Features" >> BC_STATE_BASELINE.md
echo "WebSocket functionality removed in BC branch" >> BC_STATE_BASELINE.md
```

### 2. Current Configuration
- [ ] Document environment variables
- [ ] Note API port (should be 3001)
- [ ] List active monitors
- [ ] Database schema version

## AMM Branch Analysis

### 1. Create AMM Worktree
```bash
# Create separate worktree for analysis
git worktree add ../amm-analysis feature/amm-enhancements
cd ../amm-analysis
```

### 2. AMM Feature Extraction
```bash
# Document AMM features
echo "=== AMM Features to Integrate ===" > ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md
echo "Generated: $(date)" >> ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md

# List AMM Enhancement Sessions
echo -e "\n## AMM Enhancement Sessions" >> ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md
grep -r "Session [1-5]" src/ --include="*.ts" -A 2 -B 2 >> ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md

# Find AMM-specific services
echo -e "\n## AMM Services" >> ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md
find src/services -name "amm-*.ts" -o -name "*liquidity*.ts" -o -name "*fee*.ts" -o -name "*lp*.ts" | sort >> ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md

# Critical fixes
echo -e "\n## Critical Fixes" >> ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md
grep -r "calculatePriceFromAmounts\|fallback.*price" src/ --include="*.ts" >> ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md
```

### 3. Identify Differences
```bash
# Compare key files
echo -e "\n## File Differences" >> ../pumpfun-superbot-v2/AMM_FEATURES_TO_INTEGRATE.md

# AMM monitors
diff -u ../pumpfun-superbot-v2/src/monitors/amm-monitor.ts src/monitors/amm-monitor.ts > amm-monitor.diff
diff -u ../pumpfun-superbot-v2/src/monitors/amm-account-monitor.ts src/monitors/amm-account-monitor.ts > amm-account-monitor.diff

# Key services
diff -u ../pumpfun-superbot-v2/src/services/amm-pool-state-service.ts src/services/amm-pool-state-service.ts > amm-pool-state.diff

# Database schemas
diff -u ../pumpfun-superbot-v2/src/database/migrations/ src/database/migrations/ > db-migrations.diff
```

## Decision Matrix

### BC Branch (Keep Everything)
| Component | Status | Notes |
|-----------|---------|--------|
| Phase 1-6 | ✅ Keep | Core enhancements |
| Token Enrichment | ✅ Keep | Sessions 1-4 |
| WebSocket Removal | ✅ Keep | Performance improvement |
| Performance Monitor | ✅ Keep | Phase 6 feature |
| Stale Detection | ✅ Keep | Critical feature |
| Base Architecture | ✅ Keep | DI, EventBus, etc |

### AMM Branch (Selective Integration)
| Component | Decision | Notes |
|-----------|----------|--------|
| AMM Monitors | ✅ Integrate | Core functionality |
| Price Calc Fix | ✅ Integrate | Critical fix |
| Liquidity Tracking | ✅ Integrate | Session 1 |
| Fee Tracking | ✅ Integrate | Session 2 |
| LP Positions | ✅ Integrate | Session 3 |
| Pool Analytics | ✅ Integrate | Session 4 |
| Price Impact | ✅ Integrate | Session 5 |
| WebSocket Code | ❌ Reject | If present |
| Port 3002 | ❌ Reject | Use 3001 |
| Base Services | ❌ Reject | Use BC versions |

## Validation Steps

### 1. BC Branch Health Check
```bash
cd ../pumpfun-superbot-v2
npm run build
npm test
npm run bc-monitor # Quick test
```

### 2. Document Current Metrics
- [ ] Current parse rate: _____
- [ ] Token save rate: _____
- [ ] Memory usage: _____
- [ ] Database size: _____

### 3. Create Integration Branch
```bash
git checkout feature/bc-monitor
git pull origin feature/bc-monitor
git checkout -b feature/unified-monitoring-final
git log --oneline -10 # Document starting point
```

## Session 1 Deliverables

1. **BC_STATE_BASELINE.md**
   - Complete feature inventory
   - Service list
   - Configuration snapshot

2. **AMM_FEATURES_TO_INTEGRATE.md**
   - AMM sessions to integrate
   - Critical fixes needed
   - Services to add

3. **INTEGRATION_DECISIONS.md**
   - What to keep/reject
   - Conflict resolution strategy
   - Risk assessment

4. **Backups**
   - Git bundle created
   - Database backup complete
   - Configuration documented

## Next Session Preparation

- [ ] Review diff files
- [ ] Identify high-risk integrations
- [ ] Plan conflict resolution
- [ ] Schedule Session 2

## Notes Section
_Record any discoveries, concerns, or decisions made during analysis:_

---

**Session 1 Complete When:**
- All documentation generated
- Backups created and verified
- Integration strategy clear
- No uncommitted changes
- Ready for Session 2