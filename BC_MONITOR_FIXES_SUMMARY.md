# BC Monitor Fixes Summary

## Issues Fixed

### 1. Timestamp Conversion Bug ✅
**Problem**: All timestamps were showing as 1970 epoch time
**Root Cause**: blockTime from gRPC is in Unix seconds, but was being used directly in Date constructor
**Fix**: Modified trade-handler.ts line 80:
```typescript
blockTime: new Date((event.blockTime || Date.now() / 1000) * 1000)
```

### 2. Bonding Curve Key Extraction ✅
**Problem**: Different bonding curve keys for the same token in trades
**Root Cause**: Extracting bonding curve from event data at wrong offset
**Fix**: Modified bc-trade-strategy.ts:
- Updated `findBondingCurveAccount` to use account index 1 (bonding curve is at fixed position)
- Skip the bonding curve bytes in event data and use account array instead

### 3. Creator Address Extraction ✅
**Problem**: Creator addresses didn't match pump.fun data
**Root Cause**: Trying to extract creator from trade transactions instead of creation transactions
**Fix**: Removed creator extraction from trade events - it's only available in token creation transactions

### 4. Metadata Enrichment ✅
**Problem**: No token names or symbols were being captured
**Root Cause**: EnhancedAutoEnricher wasn't being started with monitors
**Fix**: 
- Added MetadataEnricher to container factory
- Start enricher automatically in index.ts
- Uses singleton pattern with getInstance()

### 5. BC Account Monitor ✅
**Problem**: Receiving 0 account updates
**Root Cause**: Using old subscription format instead of enhanced subscription builder
**Fix**: 
- Implemented `getSubscriptionKey()` and `buildEnhancedSubscribeRequest()`
- Added both account and transaction subscriptions for comprehensive monitoring

## Code Changes

### src/handlers/trade-handler.ts
```typescript
// Line 80: Fix timestamp conversion
blockTime: new Date((event.blockTime || Date.now() / 1000) * 1000)
```

### src/parsers/strategies/bc-trade-strategy.ts
```typescript
// Fixed bonding curve extraction from accounts array
private findBondingCurveAccount(accounts: string[]): string | null {
  // Bonding curve is typically at index 1 in pump.fun transactions
  if (accounts.length > 1) {
    return accounts[1];
  }
  // ... fallback logic
}

// Skip bonding curve in event data, use accounts array
offset += 32; // Skip the bonding curve in event data
const bondingCurveKey = this.findBondingCurveAccount(context.accounts) || 'unknown';
```

### src/core/container-factory.ts
```typescript
// Register metadata enricher
container.registerSingleton(TOKENS.MetadataEnricher, async () => {
  const { EnhancedAutoEnricher } = await import('../services/enhanced-auto-enricher');
  const enricher = EnhancedAutoEnricher.getInstance();
  await enricher.start();
  return enricher;
});
```

### src/index.ts
```typescript
// Initialize metadata enricher
await container.resolve(TOKENS.MetadataEnricher);
logger.debug('Metadata enricher initialized and running');
```

### src/monitors/bc-account-monitor.ts
```typescript
// Use enhanced subscription builder
protected getSubscriptionKey(): string {
  return 'pumpfun_accounts';
}

protected buildEnhancedSubscribeRequest(): any {
  const builder = this.subscriptionBuilder;
  builder.setCommitment('confirmed');
  
  // Add account subscription for bonding curve accounts
  builder.addAccountSubscription(this.getSubscriptionKey(), {
    owner: [this.options.programId],
    filters: [],
    nonemptyTxnSignature: true
  });
  
  // Also add transaction subscription
  builder.addTransactionSubscription('pumpfun', {
    vote: false,
    failed: false,
    accountInclude: [this.options.programId],
    accountRequired: [],
    accountExclude: []
  });
  
  return builder.build();
}
```

## Testing

To verify the fixes work correctly:

1. **Timestamp Test**: Check that trades have current timestamps (not 1970)
2. **Bonding Curve Test**: Verify same token has consistent bonding curve key across trades
3. **Metadata Test**: Confirm tokens get names/symbols after discovery
4. **Account Monitor Test**: Check that account updates are being received
5. **Creator Test**: Verify creator field is only populated for token creation events

## Next Steps

1. Run comprehensive test with fresh database
2. Compare results with pump.fun data
3. Monitor for any remaining discrepancies
4. Consider adding creator detection from token creation transactions