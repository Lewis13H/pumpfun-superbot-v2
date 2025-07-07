# AMM BigInt Fix - July 7, 2025

## Problem
AMM trades were being detected by the monitors but not saved to the database. The error was:
```
value "17287889441168440582" is out of range for type bigint
```

## Root Cause
1. AMM virtual reserves can exceed PostgreSQL's BIGINT range (-2^63 to 2^63 - 1)
2. The value `17287889441168440582` (1.73 × 10^19) exceeds the maximum BIGINT value of ~9.22 × 10^18
3. The TypeScript code was trying to convert bigint values to JavaScript Numbers, which also have limitations

## Solution
1. **Database Schema Change**: Changed columns from BIGINT to NUMERIC type
   - `tokens_unified.latest_virtual_sol_reserves`
   - `tokens_unified.latest_virtual_token_reserves`
   - `trades_unified.virtual_sol_reserves`
   - `trades_unified.virtual_token_reserves`
   - `amm_pool_states.virtual_sol_reserves`
   - `amm_pool_states.virtual_token_reserves`

2. **TypeScript Code Updates**:
   - Changed Token interface to use `bigint` instead of `number` for reserves
   - Removed `Number()` conversions in trade-handler.ts
   - Updated token repository to convert bigint to string when saving to database

## Migration Applied
```sql
ALTER TABLE tokens_unified 
  ALTER COLUMN latest_virtual_sol_reserves TYPE NUMERIC,
  ALTER COLUMN latest_virtual_token_reserves TYPE NUMERIC;

ALTER TABLE trades_unified
  ALTER COLUMN virtual_sol_reserves TYPE NUMERIC,
  ALTER COLUMN virtual_token_reserves TYPE NUMERIC;

ALTER TABLE amm_pool_states
  ALTER COLUMN virtual_sol_reserves TYPE NUMERIC,
  ALTER COLUMN virtual_token_reserves TYPE NUMERIC;
```

## Files Modified
- `/src/repositories/token-repository.ts` - Changed reserve types from number to bigint
- `/src/handlers/trade-handler.ts` - Removed Number() conversions for reserves
- `/src/database/migrations/fix-amm-reserves-numeric.sql` - Migration script

## Testing
Created test script that confirmed large AMM reserves can now be saved successfully.

## Impact
AMM trades with large reserves are now being saved correctly to the database.