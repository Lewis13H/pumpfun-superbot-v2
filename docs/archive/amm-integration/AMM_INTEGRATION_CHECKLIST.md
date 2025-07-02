# AMM Integration Verification Checklist

## Pre-Integration Status
- [ ] Currently on BC worktree (`feature/bc-monitor`)
- [ ] AMM worktree available at `../amm-analysis`
- [ ] Database backed up or data erasable

## File Integration (7 files)
- [ ] `amm-monitor.ts` copied and updated
- [ ] `amm-account-monitor.ts` copied and updated
- [ ] `liquidity-event-tracker.ts` copied
- [ ] `amm-fee-tracker.ts` copied
- [ ] `lp-position-tracker.ts` copied
- [ ] `pool-analytics-service.ts` copied
- [ ] `price-impact-analyzer.ts` copied

## Code Fixes Applied
- [ ] WebSocket imports removed
- [ ] Event bus pattern updated
- [ ] Port changed to 3001 (if needed)
- [ ] Import paths corrected

## Container Registration
- [ ] All 5 AMM services registered
- [ ] No duplicate registrations
- [ ] Dependencies available

## Database
- [ ] AMM enhancement tables created
- [ ] Indexes applied
- [ ] No conflicts with existing schema

## Build & Test
- [ ] `npm run build` - no errors
- [ ] `npm run amm-monitor` - starts successfully
- [ ] `npm run amm-account-monitor` - starts successfully
- [ ] `npm run start` - all 4 monitors running

## Functionality Verification

### AMM Price Calculation
```bash
# Check logs for price calculations
tail -f logs/amm-monitor.log | grep -i "price"

# Should see fallback calculations when reserves missing
```

### Liquidity Events
```bash
# After liquidity add/remove
psql $DATABASE_URL -c "SELECT COUNT(*) FROM liquidity_events;"
```

### Fee Tracking
```bash
# After some trades
psql $DATABASE_URL -c "SELECT COUNT(*) FROM amm_fee_events;"
```

### API Endpoints (Optional)
If AMM endpoints were added:
```bash
curl http://localhost:3001/api/v1/liquidity/events
curl http://localhost:3001/api/v1/fees/summary
curl http://localhost:3001/api/v1/pools/analytics
```

## Success Criteria
- [ ] AMM monitors process trades
- [ ] Price calculations include fallback
- [ ] Enhancement services collecting data
- [ ] No errors in logs
- [ ] BC features still working

## Rollback if Needed
```bash
# Restore original files
git checkout -- src/monitors/amm-monitor.ts
git checkout -- src/monitors/amm-account-monitor.ts
git clean -fd src/services/

# Remove tables if needed
psql $DATABASE_URL -c "DROP TABLE IF EXISTS liquidity_events, amm_fee_events, lp_positions, amm_pool_metrics_hourly, trade_simulations CASCADE;"
```

## Final Steps
- [ ] Commit changes
- [ ] Update CLAUDE.md
- [ ] Push to repository
- [ ] Create PR to main branch

---

**Integration Complete When:**
- All 7 AMM features integrated
- System running without errors
- AMM price fix verified working
- Ready to merge to main