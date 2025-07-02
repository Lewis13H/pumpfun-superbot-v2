# AMM Event Parsing Fix Summary

## Root Cause Identified

The AMM events were not being parsed because of an **IDL compatibility issue** with Anchor v0.29.0:

```
TypeError: Cannot use 'in' operator to search for 'vec' in pubkey
```

The pump AMM IDL uses a format (`"array": ["pubkey", 8]`) that is incompatible with the current Anchor BorshCoder, causing the event parser to fail during initialization.

## Solution Implemented

### 1. Direct Event Decoder
Created `src/utils/amm-event-decoder.ts` that bypasses Anchor and decodes events directly from the Program data logs:
- Extracts the base64-encoded event data from log messages
- Checks discriminators to identify BuyEvent/SellEvent
- Directly parses the binary data into structured events
- Corrected the BuyEvent discriminator from IDL

### 2. Fallback Mechanism
Modified `src/monitors/amm-monitor.ts` to use the direct decoder when Anchor fails:
```typescript
let events = this.pumpAmmEventParser.parseEvent(tx);

// If Anchor event parser fails (returns empty), try direct decoder
if (events.length === 0 && tx.meta?.logMessages) {
  events = extractAmmEventsFromLogs(tx.meta.logMessages);
}
```

### 3. Reserve Extraction Now Working
The events now contain the pool reserves:
- `pool_base_token_reserves` - Token reserves in raw units
- `pool_quote_token_reserves` - SOL reserves in lamports

Example from test:
- Token reserves: 17,005,592,193,375.39 tokens
- SOL reserves: 108.645 SOL

## Testing the Fix

Run the AMM monitors with debug mode:
```bash
DISABLE_BC_MONITORS=true DEBUG_AMM=true npm run start
```

Expected results:
1. Events will be parsed successfully
2. Reserves will be extracted from events
3. Prices will be calculated correctly
4. Trades will show actual USD values instead of $0.00

## Technical Details

### Event Structure (from direct parsing)
```typescript
{
  timestamp: bigint,
  pool_base_token_reserves: bigint,  // Token reserves
  pool_quote_token_reserves: bigint, // SOL reserves
  base_amount_out: bigint,           // For buy events
  quote_amount_in: bigint,           // SOL spent
  // ... other fields
}
```

### Discriminator Correction
- IDL stated: `[103, 244, 82, 31, 44, 245, 119, 119]`
- Actual: `[103, 244, 82, 31, 44, 181, 119, 119]` (byte 5 differs)

## Next Steps

1. Test with live AMM transactions
2. Verify price calculations are accurate
3. Consider updating to a newer Anchor version that supports the IDL format
4. Monitor for any sell events to verify their discriminator

The AMM monitor should now correctly:
- Parse AMM events from transactions
- Extract pool reserves
- Calculate token prices
- Store trades with accurate USD values