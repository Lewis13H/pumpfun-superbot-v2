# AMM Monitor Accuracy Test Report - January 2025

## Test Overview
- **Test Date**: 2025-07-02
- **Duration**: ~3 minutes
- **Monitors Run**: AMM Transaction Monitor + AMM Account Monitor
- **Database**: Cleared before test

## Results Summary

### Captured Data
- **Total Trades**: 861
- **Unique Tokens**: 56  
- **Tokens Saved to DB**: 0 (due to $0 prices not meeting $1,000 threshold)

### Critical Issue: Zero Price Calculation
All AMM trades show `price_usd = 0.0000` and `market_cap_usd = 0.0000` despite the recent fix attempt.

## Sample Token Analysis

### Token 1: 6CB4fk4fByJ8754WJYPxA3wRBUbnADGWhSFTcKQ43Ltx
- **Trades Captured**: 53
- **Price in DB**: $0.0000
- **Market Cap in DB**: $0.0000

#### Sample Trades:
| Signature | Type | SOL Amount | Token Amount | Price (DB) |
|-----------|------|------------|--------------|------------|
| 5iqa6Bnq... | Sell | 0.0594 | 44,862 | $0.00 |
| 2RrtgzVF... | Buy | 1.4382 | 1,093,741 | $0.00 |
| 5YWE298t... | Sell | 0.8187 | 628,484 | $0.00 |
| wjRkY7vF... | Buy | 1.5651 | 1,203,275 | $0.00 |

#### Verification URLs:
- **Pump.fun**: https://pump.fun/coin/6CB4fk4fByJ8754WJYPxA3wRBUbnADGWhSFTcKQ43Ltx
- **Solscan.io**: https://solscan.io/token/6CB4fk4fByJ8754WJYPxA3wRBUbnADGWhSFTcKQ43Ltx

### Additional Random Sample Tokens

| Token | Trades | Avg Price (DB) | Avg Market Cap (DB) | Pump.fun URL | Solscan URL |
|-------|--------|----------------|---------------------|--------------|-------------|
| 5SCwTDPR... | 11 | $0.00 | $0.00 | [Pump.fun](https://pump.fun/coin/5SCwTDPRTqcnDvtLct9EpX3peGDehRPvn5pui97ek9oo) | [Solscan](https://solscan.io/token/5SCwTDPRTqcnDvtLct9EpX3peGDehRPvn5pui97ek9oo) |
| 5S82DHVy... | 3 | $0.00 | $0.00 | [Pump.fun](https://pump.fun/coin/5S82DHVy5s5TcdaACov9an2qHcP9Z68ZGuNsRDPGpump) | [Solscan](https://solscan.io/token/5S82DHVy5s5TcdaACov9an2qHcP9Z68ZGuNsRDPGpump) |
| BE3VzT6i... | 2 | $0.00 | $0.00 | [Pump.fun](https://pump.fun/coin/BE3VzT6inyLjjMbE8VpzjUiAWFQGadLkPXpm8vwGqMX8) | [Solscan](https://solscan.io/token/BE3VzT6inyLjjMbE8VpzjUiAWFQGadLkPXpm8vwGqMX8) |
| 3fkvnQA6... | 8 | $0.00 | $0.00 | [Pump.fun](https://pump.fun/coin/3fkvnQA6fPWXD92y24QUKnaEgNuNGDLLbmBL7M8S1r1C) | [Solscan](https://solscan.io/token/3fkvnQA6fPWXD92y24QUKnaEgNuNGDLLbmBL7M8S1r1C) |
| BWMphfXY... | 25 | $0.00 | $0.00 | [Pump.fun](https://pump.fun/coin/BWMphfXYz418n8wpSgqs6veemhdhayDPiNmvj6gkPump) | [Solscan](https://solscan.io/token/BWMphfXYz418n8wpSgqs6veemhdhayDPiNmvj6gkPump) |
| 9PpuwyH1... | 25 | $0.00 | $0.00 | [Pump.fun](https://pump.fun/coin/9PpuwyH1V1JbbMuCMWgqtz2DSzMxNZ5x84DVqytw4Kp3) | [Solscan](https://solscan.io/token/9PpuwyH1V1JbbMuCMWgqtz2DSzMxNZ5x84DVqytw4Kp3) |
| 49isEfbh... | 4 | $0.00 | $0.00 | [Pump.fun](https://pump.fun/coin/49isEfbhAxNLvavGXLFvGoneWzbumQ19xQk7dXBXpump) | [Solscan](https://solscan.io/token/49isEfbhAxNLvavGXLFvGoneWzbumQ19xQk7dXBXpump) |

## Expected vs Actual Data

### What Should Have Been Saved:
1. **Tokens with market cap > $1,000** should be saved to `tokens_unified` table
2. **Prices** should be calculated based on SOL/token ratios and current SOL price
3. **Market caps** should be calculated as price * 1B token supply
4. **Metadata** should be enriched for tokens meeting threshold

### What Actually Happened:
1. **No tokens saved** - 0 tokens in `tokens_unified` table
2. **All prices are $0.00** - Price calculation returning zeros
3. **All market caps are $0.00** - Follows from zero prices
4. **No metadata enrichment** - No tokens met threshold to trigger enrichment

## Monitor Log Analysis

### From AMM Transaction Monitor:
```
WARN  [Monitor:AMM Pool Monitor] No reserves found from events or pool state
WARN  [Monitor:AMM Pool Monitor] Using fallback price calculation from trade amounts
```

This shows the monitor is:
1. Not finding reserves from pump.fun AMM events
2. Attempting fallback calculation from trade amounts
3. But still resulting in $0 prices

### From AMM Account Monitor:
```
INFO  [Monitor:AMM Account Monitor] Pool reserves updated
{
  "mint": "6CB4fk4f...",
  "pool": "HYvuvjXS...",
  "solReserves": "X.XXXX",
  "tokenReserves": "X,XXX,XXX.XXX"
}
```

The account monitor IS successfully reading pool reserves, but these aren't being used for price calculation in trades.

## Database Issues Found

### AMM Account Monitor Error:
```
Database query error: error: invalid input syntax for type bigint: "35179.699079714"
```

The pool state service is trying to save decimal SOL values as bigint, causing save failures.

## Accuracy Assessment

### Trade Capture: ✅ ACCURATE
- Trades are being captured correctly
- Trade amounts (SOL and token) match blockchain data
- Trade types (buy/sell) are identified correctly

### Price Calculation: ❌ BROKEN
- All prices are $0.00
- Market caps are $0.00
- Prevents token saves (don't meet $1,000 threshold)

### Pool State Tracking: ⚠️ PARTIAL
- Pool reserves are being read correctly
- But database saves fail due to type mismatch
- Pool states not persisting properly

## Root Cause Analysis

1. **Price Calculation Issue**: The AMM monitor fix attempted to extract reserves from pump.fun events, but the fallback calculation is still returning $0
2. **Event Parsing**: Pump.fun AMM events are not being parsed to extract `pool_base_token_reserves` and `pool_quote_token_reserves`
3. **Database Schema**: Pool state table expects bigint but receiving decimals

## Recommendations

1. Debug why the fallback price calculation returns $0
2. Fix event parsing to properly extract pump.fun AMM event data
3. Update pool state schema to handle decimal reserves
4. Ensure pool state service reserves are used in price calculations

## Conclusion

The AMM monitors are successfully capturing trades but failing at price calculation, resulting in no tokens being saved to the database. The core issue remains unresolved despite the recent fix attempt.