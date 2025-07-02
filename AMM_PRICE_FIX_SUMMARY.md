# AMM Price Calculation Fix Summary

## Issue
All AMM trades were showing `price_usd = 0` and `market_cap_usd = 0`, preventing tokens from being saved to the database (threshold is $1,000).

## Root Causes
1. **Swap Transaction Parser** (`swapTransactionParser.ts`) doesn't extract pool reserves
2. **AMM Monitor** was expecting `pool_base_token_reserves` and `pool_quote_token_reserves` fields that don't exist in swap events
3. **AMM Account Monitor** wasn't updating pool reserves when token account balances changed
4. **Pool State Service** had all reserves stored as 0 in the database

## Solution

### 1. Fixed AMM Monitor (`src/monitors/amm-monitor.ts`)
- Changed from trying to extract non-existent reserve fields from swap events
- Now fetches reserves from the pool state service cache
- Falls back gracefully when pool state not found

```typescript
// OLD - Looking for fields that don't exist
const poolBaseReserves = Number(swapEvent.pool_base_token_reserves || 0);
const poolQuoteReserves = Number(swapEvent.pool_quote_token_reserves || 0);

// NEW - Get from pool state service
let poolState = this.poolStateService.getPoolState(swapEvent.mint);
if (!poolState && swapEvent.pool) {
  poolState = this.poolStateService.getPoolStateByAddress(swapEvent.pool);
}

let virtualSolReserves = poolState?.reserves.virtualSolReserves || 0;
let virtualTokenReserves = poolState?.reserves.virtualTokenReserves || 0;
```

### 2. Fixed AMM Account Monitor (`src/monitors/amm-account-monitor.ts`)
- Added logic to update pool reserves when token account balances change
- Properly converts between lamports/SOL and token amounts
- Emits pool state update events for other components

```typescript
// NEW - Update reserves when token accounts change
if (poolInfo.isBase) {
  // SOL vault update
  solReserves = Number(tokenAccount.amount) / 1e9;
} else {
  // Token vault update  
  tokenReserves = Number(tokenAccount.amount) / 1e6;
}

await this.poolStateService.updatePoolReserves(
  poolInfo.mintAddress,
  solReserves,
  tokenReserves,
  data.slot || 0
);
```

### 3. Data Flow After Fix
1. **AMM Account Monitor** subscribes to pool accounts and their token vaults
2. When token account balances change, it updates the pool state service with new reserves
3. **AMM Monitor** processes swap transactions and gets current reserves from pool state service
4. **Price Calculator** uses the reserves to calculate accurate prices
5. **Trade Handler** saves tokens that meet the $1,000 threshold

## Testing
Created test script that verified:
- Price calculator correctly calculates prices from reserves
- Zero reserves return zero prices (as expected)
- Real-world reserve values produce correct market caps

## Expected Results
- AMM trades will now have accurate `price_usd` and `market_cap_usd` values
- Tokens with market cap > $1,000 will be saved to database
- Price impact calculations (Session 5) will work correctly
- All downstream analytics will function properly

## Next Steps
1. Run both AMM monitors together to populate pool reserves
2. Verify trades are being saved with correct prices
3. Check that price impact calculations are working
4. Monitor for any edge cases or missed scenarios