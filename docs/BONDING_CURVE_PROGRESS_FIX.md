# Bonding Curve Progress Calculation Fix

## Problem
Our bonding curve progress calculation shows incorrect values compared to pump.fun. We're using an 85 SOL threshold, but tokens with >100 SOL virtual reserves are still trading on the bonding curve.

## Investigation Results

### Current Implementation Issues:
1. **Wrong threshold**: We use 85 SOL, but tokens don't graduate at this threshold
2. **Wrong metric**: We use virtual SOL reserves, but graduation might be based on:
   - Real SOL reserves (actual SOL in the bonding curve)
   - Market cap reaching $69,420
   - Or another mechanism entirely

### Evidence:
- Token B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump has 105.45 SOL but still trading on BC
- Multiple tokens with >100 SOL showing 100% progress but not graduated
- No tokens in our database have graduated to AMM despite high SOL reserves

## Recommended Solution

### Option 1: Remove Progress Calculation (Immediate Fix)
Since we don't know the actual graduation mechanism, remove the misleading progress bar:

```typescript
// In bc-trade-strategy.ts and bc-trade-idl-strategy.ts
// Remove or comment out:
// const bondingCurveProgress = Math.min((solInCurve / GRADUATION_THRESHOLD) * 100, 100);

// Return null or 0 for bondingCurveProgress
bondingCurveProgress: null // Unknown graduation threshold
```

### Option 2: Monitor Bonding Curve Account (Proper Fix)
1. Parse the `complete` field from bonding curve account updates
2. Track real SOL reserves vs virtual SOL reserves
3. Use the actual `complete` status from the bonding curve

```typescript
// In token-lifecycle-monitor.ts processAccountUpdate()
const bcData = BONDING_CURVE_SCHEMA.decode(accountData.slice(8));
const isComplete = bcData.complete; // This is the actual graduation status
```

### Option 3: Research Actual Mechanism
1. Monitor tokens that actually graduate
2. Track their stats at graduation point
3. Reverse engineer the actual threshold

## Database Changes Needed

Add columns to store real reserves:
```sql
ALTER TABLE trades_unified 
ADD COLUMN real_sol_reserves BIGINT,
ADD COLUMN real_token_reserves BIGINT;
```

## Action Items
1. [ ] Remove/fix the 85 SOL threshold
2. [ ] Store real reserves from trade events
3. [ ] Use bonding curve account `complete` field for graduation status
4. [ ] Update dashboard to show "?" or remove progress bar until fixed
5. [ ] Monitor actual graduations to determine real threshold