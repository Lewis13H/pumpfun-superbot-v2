# Token Graduation Detection

## The Challenge

Detecting when a token graduates from bonding curve to AMM is critical but was completely broken initially.

## What Doesn't Work

### ❌ Progress-Based Detection
```typescript
// This is NOT reliable
if (progress >= 100) {
  // Token might not actually be graduated!
}
```
Progress can show 100% but the token might still be on the bonding curve.

### ❌ Looking for AMM Trades
```typescript
// This misses the moment of graduation
const hasAmmTrades = await checkForAmmTrades(mint);
```
By the time you see AMM trades, you've missed the graduation event.

## The Solution: The `complete` Flag

### ✅ Monitor Bonding Curve Account
```typescript
const bondingCurveData = BONDING_CURVE_SCHEMA.decode(accountData);
if (bondingCurveData.complete) {
  // Token has DEFINITELY graduated
}
```

The `complete` boolean in the bonding curve account is the authoritative source.

## Implementation

### 1. Subscribe to Account Updates
```typescript
builder.addAccountSubscription('token_lifecycle_acc', {
  owner: [PUMP_PROGRAM],
  filters: [],
  nonemptyTxnSignature: false // Important: Get all updates
});
```

### 2. Parse Account Data
```typescript
const BONDING_CURVE_SCHEMA = borsh.struct([
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete'), // ← This is what we need
  borsh.publicKey('creator'),
]);
```

### 3. Handle Graduation
```typescript
if (bondingCurveData.complete && !token.graduated_to_amm) {
  await markTokenAsGraduated(mintAddress);
  console.log(`🎓 Token ${mintAddress} has graduated!`);
}
```

## Database Schema

```sql
-- Added columns for tracking
ALTER TABLE tokens_unified ADD COLUMN bonding_curve_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE tokens_unified ADD COLUMN graduation_detected_at TIMESTAMPTZ;
ALTER TABLE tokens_unified ADD COLUMN graduation_method VARCHAR(50);
```

## Edge Cases

1. **Tokens at 100% but not complete**: Keep monitoring, don't assume graduated
2. **Complete flag without 100%**: Trust the flag, it's authoritative
3. **Missing account updates**: Some subscriptions might drop, implement recovery

## Monitoring Scripts

- `monitor-bc-complete-status.ts` - Real-time complete flag monitoring
- `fix-graduated-tokens.ts` - Retroactively fix graduation status
- `test-bc-account-monitoring.ts` - Verify subscriptions working

## Key Learnings

1. **Trust on-chain data**: The `complete` flag is the single source of truth
2. **Account monitoring essential**: Can't detect graduation from transactions alone
3. **Progress is just an estimate**: Use for UI, not for business logic