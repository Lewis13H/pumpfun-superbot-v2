# AMM Pool Mapping Fix Summary

## Issues Fixed

1. **Incorrect SOL Mint Storage** ✅
   - Problem: 1,028 entries in `amm_pool_states` had SOL mint instead of token mint
   - Cause: Previous bug storing `baseMint` (SOL) instead of `quoteMint` (token)
   - Fix: Deleted all SOL mint entries using `fix-amm-pool-mint-mapping.ts`
   - Result: Database now clean with 169 unique pools/tokens

2. **Correct Mint Mapping** ✅
   - The AMM account monitor correctly uses `quoteMint` as the token mint
   - The pool state service correctly stores token mint addresses
   - Mapping between pool addresses and token mints is working

## Remaining Issues

1. **No Reserve Data** ❌
   - All `virtual_sol_reserves` and `virtual_token_reserves` are 0
   - The AMM account monitor only decodes pool structure, not token balances
   - The AMM trade monitor expects reserves from swap events, but parser doesn't extract them

2. **Price Recovery Cannot Work Without Reserves** ❌
   - `AmmPoolPriceRecovery` service needs reserves to calculate prices
   - Without reserves, graduated tokens remain stale
   - 63 graduated tokens have no working price update mechanism

## Solutions

### Option 1: Enhance AMM Account Monitor (Recommended)
Modify the AMM account monitor to also subscribe to token accounts:
```typescript
// Subscribe to both pool accounts AND their token vault accounts
// When pool account is decoded, also subscribe to its vault accounts
// When vault account updates, update reserves in pool state
```

### Option 2: Extract Reserves from Trade Events
Modify the swap parser to extract post-trade reserves:
```typescript
// Parse pool reserve updates from transaction logs or account deltas
// Update pool state service with new reserves after each trade
```

### Option 3: Use External APIs
For immediate relief, use Jupiter or other APIs:
```typescript
// Query Jupiter Price API for graduated tokens
// Fall back to on-chain queries only when API fails
```

## Scripts Created

1. **check-amm-pool-states.ts** - Checks for SOL mint contamination
2. **fix-amm-pool-mint-mapping.ts** - Removes incorrect SOL mint entries
3. **test-amm-pool-price-recovery.ts** - Tests price recovery for graduated tokens
4. **verify-pool-states.ts** - Verifies pool states and reserve data
5. **check-pool-reserves.ts** - Quick check of reserve values

## Next Steps

1. Implement token account subscription in AMM account monitor
2. Add reserve extraction to swap event parser
3. Consider external API integration for immediate price updates
4. Add monitoring to ensure reserves are being populated

## Database Status

- `amm_pool_states` table is clean (no SOL mints)
- Pool-to-token mapping is correct
- Reserve data needs to be populated for price calculations to work