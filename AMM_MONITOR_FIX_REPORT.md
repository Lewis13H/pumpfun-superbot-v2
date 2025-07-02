# AMM Monitor Fix Report

## Issues Found and Fixed

### 1. ✅ Incorrect Mint Identification
**Issue**: Account monitor was using `quoteMint` (SOL) instead of `baseMint` (token) as the token mint
**Fix**: Changed to use `baseMint` throughout the system
**Files Modified**:
- `src/monitors/amm-account-monitor.ts`
- `src/services/amm-pool-state-service.ts`

### 2. ✅ Missing Pool Address in Swap Events
**Issue**: Swap parser wasn't extracting pool address, causing AMM monitor to show `pool: "unknown"`
**Fix**: Added pool address extraction from swap instruction accounts
**File Modified**: `src/utils/swapTransactionParser.ts`

### 3. ✅ Token Account Subscription Issue
**Issue**: Token account subscriptions were creating new gRPC streams instead of using the shared stream
**Fix**: Modified to track token accounts and process them in main stream handler
**File Modified**: `src/monitors/amm-account-monitor.ts`

### 4. ✅ Reserve Updates Working
**Evidence**: 
```
2025-07-02T03:09:54.275Z INFO  [Monitor:AMM Account Monitor] Pool reserves updated
{
  "mint": "5iooMHkY...",
  "pool": "GjAmkW86...",
  "solReserves": "191261.2989",
  "tokenReserves": "186,472.086"
}
```

### 5. ✅ Price Calculation Working
**Evidence**:
```
2025-07-02T03:10:30.634Z INFO  [Monitor:AMM Pool Monitor] AMM trade
{
  "type": "Buy",
  "mint": "5uAodyuf...",
  "solAmount": "2.6776",
  "tokenAmount": 264251.113631,
  "priceUsd": "0.00150592",
  "volumeUsd": 397.94123633016
}
```

## Remaining Issues

### 1. ❌ Database Reserves Still Zero
While the monitors show reserves being updated, the database still shows zeros. This appears to be a timing/persistence issue with the pool state service's batch save mechanism.

### 2. ⚠️ Pool State Cache Synchronization
Many trades still show "No pool state found" because:
- Pool states are only available after account monitor detects them
- Cache synchronization between monitors may have delays
- Not all pools have their token accounts tracked immediately

## Recommendations

1. **Run Monitors Together**: Always run both monitors to ensure pool states are populated:
   ```bash
   npm run amm-account-monitor  # Run first
   npm run amm-monitor          # Run second
   ```

2. **Allow Warm-up Time**: Give the account monitor 1-2 minutes to populate pool states before expecting accurate prices

3. **Monitor Logs**: Check for "Pool reserves updated" messages to confirm reserves are being tracked

4. **Database Verification**: Periodically check that reserves are persisted:
   ```sql
   SELECT COUNT(*) FROM amm_pool_states WHERE virtual_sol_reserves > 0;
   ```

## Test Results

- ✅ AMM trades are being captured
- ✅ Pool addresses are extracted correctly  
- ✅ Token mints are identified properly (using baseMint)
- ✅ Reserves are being updated in memory
- ✅ Prices are calculated when pool state is available
- ⚠️ Database persistence needs verification
- ⚠️ Not all trades have pool states immediately

## Next Steps

1. Monitor the system for a longer period to verify database persistence
2. Consider implementing a reserve snapshot mechanism
3. Add retry logic for trades without pool states
4. Implement pool state prefetching for known pools