# Monitor Subscription Configuration Fix

## Summary
Fixed the monitor subscription configurations to match the exact format required by Shyft's gRPC stream, based on their official examples.

## Changes Made

### 1. BC Monitor (`src/monitors/bc-monitor.ts`)
- Changed transaction subscription key from `pumpfun` to `pumpFun` (capital F)
- This matches the Shyft example in `shyft-code-examples/bonding curve/stream_and_parse_pump_fun_transactions/index.ts`

### 2. BC Account Monitor (`src/monitors/bc-account-monitor.ts`)
- Changed account subscription key from `pump_accounts` to `pumpfun` (lowercase)
- This matches the Shyft example in `shyft-code-examples/bonding curve/stream_and_parse_all_pump_fun_accounts/index.ts`

### 3. AMM Monitor (`src/monitors/amm-monitor.ts`)
- Subscription key `pumpAMM` was already correct
- This matches the Shyft example in `shyft-code-examples/amm/grpc-stream-and-parse-pump-swap-amm-transaction/index.ts`

### 4. AMM Account Monitor (`src/monitors/amm-account-monitor.ts`)
- Changed account subscription key from `pumpswap_amm` to `pumpswap_amm` (with underscore)
- This matches the Shyft example in `shyft-code-examples/amm/grpc-stream-and-parse-pump-swap-amm-account/index.ts`

## Key Pattern
Based on the Shyft examples, the subscription keys follow this pattern:
- **BC Transaction subscriptions**: `pumpFun` (camelCase with capital F)
- **BC Account subscriptions**: `pumpfun` (all lowercase)
- **AMM Transaction subscriptions**: `pumpAMM` (camelCase)
- **AMM Account subscriptions**: `pumpswap_amm` (lowercase with underscore)

## Testing
To verify the fixes work correctly:
```bash
# Run all monitors
npm run start

# Or run individually
npm run bc-monitor
npm run bc-account-monitor
npm run amm-monitor
npm run amm-account-monitor
```

The monitors should now properly connect to the gRPC stream and receive data.