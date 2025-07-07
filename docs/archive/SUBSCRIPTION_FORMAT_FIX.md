# Subscription Format Fix - January 2025

## Issue Summary
The domain monitors (TokenLifecycleMonitor, TradingActivityMonitor, LiquidityMonitor) were not receiving any pump.fun transactions despite high blockchain activity. The root cause was a format mismatch in how subscription configurations were being created and processed.

## Root Cause Analysis

### The Problem
1. Domain monitors use `SubscriptionBuilder` from `src/core/subscription-builder.ts` which creates configs like:
```javascript
{
  transactions: {
    'token_lifecycle_txn': {
      vote: false,
      failed: false,
      accountInclude: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
      accountRequired: [],
      accountExclude: []
    }
  },
  accounts: {
    'token_lifecycle_acc': {
      owner: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
      filters: []
    }
  }
}
```

2. However, the Yellowstone gRPC API expects subscription configs with a `filter` property:
```javascript
{
  transactions: {
    'token_lifecycle_txn': {
      filter: {  // <-- This wrapper was missing!
        vote: false,
        failed: false,
        accountInclude: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
        accountRequired: [],
        accountExclude: []
      }
    }
  },
  accounts: {
    'token_lifecycle_acc': {
      filter: {  // <-- This wrapper was missing!
        account: [],
        owner: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
        filters: []
      }
    }
  }
}
```

3. The `StreamManager` was passing the monitor configs directly to the gRPC stream without proper format conversion, resulting in invalid subscriptions that received no data.

## The Fix

Modified `src/core/stream-manager.ts` in the `buildSubscribeRequest()` method to:

1. Check if transaction/account configs already have the `filter` property
2. If not, wrap the config properties inside a `filter` object
3. Ensure all subscription configs match the expected Yellowstone gRPC format

### Code Changes
- Lines 284-325: Added format conversion for account subscriptions
- Lines 304-325: Added format conversion for transaction subscriptions  
- Lines 348-357: Fixed fallback subscription format

## Verification

### Test Scripts Created
1. `src/scripts/test-pump-subscription.ts` - Direct gRPC connection test
2. `src/scripts/diagnose-domain-monitors.ts` - Monitor configuration diagnosis
3. `src/scripts/fix-domain-monitor-subscriptions.ts` - Format fix demonstration
4. `src/scripts/test-fixed-subscriptions.ts` - Integration test with fixed format

### Expected Results
After the fix, domain monitors should:
- Successfully receive pump.fun transactions
- Show message rates of 20-50+ messages/second during active trading
- Process both transaction and account update events
- Track token lifecycle events properly

## Running the Fix

1. The fix has been applied to `src/core/stream-manager.ts`
2. Rebuild the project: `npm run build`
3. Test with: `npx tsx src/scripts/test-fixed-subscriptions.ts`
4. Run the full system: `npm run start`

## Additional Notes

- This issue affected all domain monitors using the enhanced subscription builder
- The fix maintains backward compatibility with monitors that already provide correct format
- Smart streaming architecture continues to work with connection pooling and load balancing
- No changes needed to the domain monitor implementations themselves