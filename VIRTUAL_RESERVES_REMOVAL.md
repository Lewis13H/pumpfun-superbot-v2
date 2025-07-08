# Virtual Reserves Removal Summary

## Changes Made (July 8, 2025)

### Background
Per user request, removed the hardcoded `virtualSolReserves: 0n` and `virtualTokenReserves: 0n` fields from AMM trade parsing, as these values are not available from transaction data and should be fetched from pool account state instead.

### Files Modified

1. **AMM Trade Parsing Strategies** - Removed virtual reserve fields from return objects:
   - `/src/utils/parsers/strategies/amm-trade-inner-ix-strategy.ts`
   - `/src/utils/parsers/strategies/amm-trade-instruction-strategy.ts`
   - `/src/utils/parsers/strategies/amm-trade-idl-strategy.ts`
   - `/src/utils/parsers/strategies/amm-trade-heuristic-strategy.ts`

2. **Type Definition** - Made virtual reserves optional:
   - `/src/utils/parsers/types.ts`
   ```typescript
   virtualSolReserves?: bigint; // Made optional - only available for BC trades
   virtualTokenReserves?: bigint; // Made optional - only available for BC trades
   ```

3. **Trade Handler** - Updated to handle optional reserves:
   - `/src/handlers/trade-handler.ts`
   - Now falls back to calculating price from trade amounts (SOL/token ratio) when reserves are not available

### Price Calculation Fallback
When virtual reserves are not available (AMM trades), the system now:
1. First checks if price/market cap are already provided in the event
2. If reserves are available, uses them for price calculation
3. Otherwise, calculates price from trade amounts: `price = solAmount / tokenAmount`

### Note
As referenced by the user, the Shyft examples show that AMM pool reserves should be fetched from pool account state, not from transaction data. This change aligns with that approach, removing the misleading zero values.

### Future Enhancement
To get accurate reserve values for AMM pools:
1. Subscribe to AMM pool account updates
2. Fetch pool state from the blockchain
3. Parse pool account data to extract current reserves
4. Use these actual reserves for accurate price calculations