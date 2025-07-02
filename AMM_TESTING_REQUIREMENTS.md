# AMM Integration Testing Requirements

## Status: Integration Complete - Extensive Testing Required

### Date: January 2, 2025

## Overview
The AMM enhancement features have been integrated from `feature/amm-enhancements` into `feature/bc-monitor`. While the integration was successful and builds without errors, extensive testing and debugging is required to ensure full functionality.

## Known Issues

### 1. AMM Monitor Not Receiving Trades
- **Symptom**: AMM monitor shows 0 trades while BC monitor processes thousands
- **Expected**: AMM should process hundreds of trades per second
- **Potential Causes**:
  - Subscription key configuration issue with StreamManager
  - gRPC stream not properly subscribing to AMM program
  - Transaction filtering preventing AMM trades from being processed

### 2. Subscription Configuration
The AMM monitor is configured with:
- Program ID: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- Subscription Key: `pumpswap_amm`
- All configuration appears correct but trades aren't flowing

## Required Testing

### 1. Subscription Debugging
- [ ] Verify StreamManager receives AMM subscription config
- [ ] Check gRPC stream logs for `pumpswap_amm` subscription
- [ ] Confirm transaction keys include both `pumpfun` and `pumpswap_amm`
- [ ] Test AMM monitor in isolation with `npm run amm-monitor`

### 2. Integration Testing
- [ ] BC → AMM graduation flow
- [ ] Price calculation with fallback logic
- [ ] Liquidity event tracking
- [ ] Fee collection monitoring
- [ ] LP position updates
- [ ] Pool state synchronization

### 3. Database Verification
- [ ] All AMM tables created successfully
- [ ] Data flows into liquidity_events table
- [ ] Fee events properly recorded
- [ ] LP positions tracked
- [ ] Pool metrics aggregated hourly

### 4. Performance Testing
- [ ] Monitor CPU/memory usage with AMM active
- [ ] Verify parse rates remain >95%
- [ ] Check for memory leaks in long runs
- [ ] Database query performance

## Debug Steps

### Step 1: Verify Subscription
```bash
# Start monitors and look for subscription logs
npm run start 2>&1 | grep -E "subscription|pumpswap_amm|transactionKeys"
```

### Step 2: Test AMM in Isolation
```bash
# Run only AMM monitor to isolate issues
npm run amm-monitor
```

### Step 3: Check Stream Data
Add temporary logging to see all programs in stream:
```typescript
// In StreamManager or BaseMonitor
this.eventBus.on(EVENTS.STREAM_DATA, (data) => {
  if (data?.transaction?.transaction?.transaction?.message?.accountKeys) {
    const programs = extractProgramIds(data);
    console.log('Programs in tx:', programs);
  }
});
```

### Step 4: Verify AMM Program Transactions
```bash
# Check if AMM transactions exist in recent data
psql $DATABASE_URL -c "
  SELECT COUNT(*), program 
  FROM trades_unified 
  WHERE block_time > NOW() - INTERVAL '1 hour' 
  GROUP BY program
"
```

## Integration Changes Made

### Files Added (8)
- `amm-monitor.ts` - Enhanced with price fallback
- `amm-account-monitor.ts` - Pool state tracking
- `enhanced-amm-price-calculator.ts` - Price calculations
- `enhanced-trade-handler.ts` - Trade processing with impact
- `amm-pool-decoder.ts` - Pool data decoding
- `amm-price-calculator.ts` - AMM price utilities
- `amm-endpoints.ts` - API endpoints
- `pool-state-types.ts` - TypeScript types

### Database Tables Added (6)
- `liquidity_events`
- `amm_fee_events`
- `lp_positions`
- `amm_pool_metrics_hourly`
- `trade_simulations`
- `amm_pool_state` (enhanced)

### Key Features
- ✅ Price calculation fallback when reserves unavailable
- ✅ Liquidity tracking (add/remove)
- ✅ Fee analytics
- ✅ LP position management
- ✅ Price impact analysis

## Next Steps

1. **Debug Subscription Issue**
   - Add detailed logging to StreamManager
   - Verify gRPC subscription format
   - Check if AMM trades are being filtered out

2. **Test with Known AMM Transaction**
   - Find a recent AMM trade on Solscan
   - Verify our system would process it
   - Check parsing logic

3. **Compare with Working Branch**
   - The AMM monitors work in `feature/amm-enhancements`
   - Compare subscription setup between branches
   - Check for missing initialization steps

## Notes

- BC monitor continues to work perfectly (>1000 trades processed)
- All TypeScript builds without errors
- Database schema is complete
- The issue appears to be in the stream subscription, not the processing logic

## Contact

If issues persist, compare implementation with the working version at:
https://github.com/Lewis13H/pumpfun-superbot-v2/tree/feature/amm-enhancements