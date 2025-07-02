# AMM Pool Reserves Extraction Analysis

## Shyft Example Code Analysis

### 1. Event Structure (from IDL)
The pump AMM events contain these reserve fields:
- `pool_base_token_reserves` (u64) - Token reserves after trade
- `pool_quote_token_reserves` (u64) - SOL reserves after trade

### 2. How Shyft Examples Access Reserves

From `stream_pump_swap_amm_token_price/utils/swapTransactionParser.ts`:
```typescript
const parsedEvent = parsedInstruction.instructions.events[0]?.data;
const pool_base_token_reserves = parsedEvent.pool_base_token_reserves;
const pool_quote_token_reserves = parsedEvent.pool_quote_token_reserves;
```

Key points:
- Events are at `parsedInstruction.instructions.events`
- First event (`[0]`) contains the trade data
- Fields use snake_case naming
- Values are already in raw units (lamports/smallest token units)

### 3. Your Current Implementation

Your code structure matches but reserves aren't being found:
```typescript
// Line 208: Events are nested in instructions
const result = { instructions: { pumpAmmIxs, events }, inner_ixs: pump_amm_inner_ixs };

// Line 334-335: Checking correct path
if (parsedTxn?.instructions?.events) {
  for (const event of parsedTxn.instructions.events) {
```

### 4. Potential Issues

1. **Events not being parsed**: The event parser might not be working correctly
2. **BN formatting**: The `bnLayoutFormatter` might be affecting the event data structure
3. **Event filtering**: Only BuyEvent/SellEvent contain reserves

### 5. Debug Steps Added

1. Added logging to see if events are being parsed
2. Added fallback to check first event directly (Shyft pattern)
3. Added optional chaining for safer access

## Next Steps

1. **Verify events are parsed**: Check if `parsedTxn.instructions.events` has any events
2. **Log event structure**: See the actual structure of event.data
3. **Check BN formatter**: Might be converting fields in unexpected ways

## Alternative Approach

If events continue to fail, consider:
1. Query pool accounts directly for current reserves
2. Use the AMM account monitor to maintain pool state
3. Calculate price from trade amounts as fallback