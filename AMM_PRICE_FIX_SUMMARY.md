# AMM Price Calculation Fix Summary

## Issue
The AMM monitor was returning zero prices and market caps for all trades because it wasn't extracting pool reserves from pump.fun AMM events.

## Root Cause
1. The AMM monitor was trying to get reserves from the pool state service (cache) instead of from the transaction events
2. The pump.fun AMM events (`BuyEvent` and `SellEvent`) contain pool reserves as:
   - `pool_base_token_reserves` (token reserves)
   - `pool_quote_token_reserves` (SOL reserves)
3. These reserves were not being extracted and passed to the price calculator

## Solution Implemented

### 1. Extract Reserves from Events
Modified `src/monitors/amm-monitor.ts` to:
- Parse pump.fun AMM events using the event parser service
- Extract `pool_base_token_reserves` and `pool_quote_token_reserves` from BuyEvent/SellEvent
- Convert reserves to BigInt (they come as strings in the events)

### 2. Use Price Calculator Service
- Added PriceCalculator import and dependency injection
- Use `priceCalculator.calculatePrice()` with the extracted reserves
- This properly calculates price and market cap based on the constant product formula

### 3. Maintain Compatibility
- Keep pool state service as fallback if events don't contain reserves
- Handle both BigInt and number formats for reserves
- Log warnings when reserves are not found

## Code Changes

### Before (lines 349-399)
```typescript
// Get pool reserves from pool state service
let poolState = this.poolStateService.getPoolState(swapEvent.mint);
// ... fallback logic
const priceInSol = tokenAmount > 0 ? solAmount / tokenAmount : 0;
const priceUsd = priceInSol * this.currentSolPrice;
const marketCapUsd = priceUsd * 1e9;
```

### After
```typescript
// Extract reserves from pump AMM events
const parsedEvents = eventParserService.parseTransaction(txn);
for (const event of parsedEvents) {
  if (event.name === 'BuyEvent' || event.name === 'SellEvent') {
    virtualTokenReserves = BigInt(eventData.pool_base_token_reserves || '0');
    virtualSolReserves = BigInt(eventData.pool_quote_token_reserves || '0');
    // ...
  }
}

// Use price calculator with reserves
priceInfo = this.priceCalculator.calculatePrice(
  {
    solReserves: virtualSolReserves,
    tokenReserves: virtualTokenReserves,
    isVirtual: false
  },
  this.currentSolPrice
);
```

## Expected Results
- AMM trades should now have proper price calculations
- Market cap calculations based on 1B token supply
- Tokens above $1,000 market cap will be saved to database
- Session 5 price impact features will work correctly

## Testing
Created test script at `src/scripts/test-amm-price-fix.ts` to verify:
- Trades are being processed
- Prices are non-zero
- Market caps are calculated correctly

## Next Steps
1. Run the AMM monitor to verify the fix
2. Monitor for trades with proper prices
3. Check database for newly saved AMM tokens
4. Verify price impact calculations are working