# AMM Monitor Test Report

Generated: 2025-07-02 17:58:00 SGT

## Test Summary

- **Database Status**: Cleared and started fresh
- **Monitors Running**: AMM Transaction Monitor + AMM Account Monitor only (BC monitors disabled)
- **Test Duration**: ~2 minutes
- **Total Trades Captured**: 1,088+
- **Volume Processed**: $361,268+

## Critical Issues Fixed

### 1. ✅ Decimal Conversion Error Fixed
- **Issue**: Database expected bigint but received decimal values (e.g., "2.274919092")
- **Fix**: Removed decimal conversion in TradeRepository - now stores raw bigint values
- **File**: `src/repositories/trade-repository.ts`
- **Result**: Trades now save successfully to database

### 2. ⚠️ Price Calculation Still Failing
- **Issue**: All prices showing as $0.00 
- **Cause**: Pool reserves not being extracted from AMM events
- **Next Step**: Need to verify exact field names in pump AMM BuyEvent/SellEvent

## Sample Trades Analysis

### Buy Trade 1
- **Signature**: `5GNLms1EQEotXPRKSoYqRboBpg3fwYQm6VDuim8VybE6fbwaKGFxFcJ45JSnwZ3jtNYrnT2E4Kfn3AshExwecs1`
- **Mint**: EuDU2WLtQxPurHq7d7U2M76xLFNJUTsQ4KwSXWQvuP9d
- **SOL Amount**: 82,269,645 lamports = 0.082269645 SOL
- **Token Amount**: 21,352,851,667 raw = 21,352.851667 tokens
- **Price**: $0.00 (reserves not extracted)
- **Solscan**: https://solscan.io/tx/5GNLms1EQEotXPRKSoYqRboBpg3fwYQm6VDuim8VybE6fbwaKGFxFcJ45JSnwZ3jtNYrnT2E4Kfn3AshExwecs1

### Buy Trade 2
- **Signature**: `5td2gJ976jVcHqfqVXZjJJWf8jtvtmPccCVcXn6QEDgw63tY24af7wkvJVbhspGiMgKdd872Hf4pkp582VQtyPEi`
- **Mint**: 9M8DPQF49DxFcBbsnoMk8CqXNVBJxAHJZSGXhtMCJWwW
- **SOL Amount**: 422,196,016 lamports = 0.422196016 SOL
- **Token Amount**: 154,254,252,042 raw = 154,254.252042 tokens
- **Price**: $0.00 (reserves not extracted)
- **Solscan**: https://solscan.io/tx/5td2gJ976jVcHqfqVXZjJJWf8jtvtmPccCVcXn6QEDgw63tY24af7wkvJVbhspGiMgKdd872Hf4pkp582VQtyPEi

### Sell Trade 1
- **Signature**: `3ZFbYXEEciH8CFP7e1aYXEUsnvyrAkXxAPERGS1aHMYbNieHYdoAQpqmrmmTcirWhsd48ibsZqKDhPBYXwDs8jJ8`
- **Mint**: EXgaZEkfdJMGhaK6uMcC7qnsFodEsdaLii8p442ppump
- **SOL Amount**: 508,070,114 lamports = 0.508070114 SOL
- **Token Amount**: 530,621,642,925 raw = 530,621.642925 tokens
- **Price**: $0.00 (reserves not extracted)
- **Solscan**: https://solscan.io/tx/3ZFbYXEEciH8CFP7e1aYXEUsnvyrAkXxAPERGS1aHMYbNieHYdoAQpqmrmmTcirWhsd48ibsZqKDhPBYXwDs8jJ8

### Sell Trade 2
- **Signature**: `28dBzaxGJJQLntgK8BUu5NSj1W7hAo5YCr4QpqiBfyy1FUgRLh4bX7EVArrhpDVhF9jCPDCJZQuBaVkEgehfAggo`
- **Mint**: F7Tyox5rfAzvXkTC75W6iMQiKGsGTZnRZpL2gPAp6BTT
- **SOL Amount**: 62,195,095 lamports = 0.062195095 SOL
- **Token Amount**: 9,844,648,831 raw = 9,844.648831 tokens
- **Price**: $0.00 (reserves not extracted)
- **Solscan**: https://solscan.io/tx/28dBzaxGJJQLntgK8BUu5NSj1W7hAo5YCr4QpqiBfyy1FUgRLh4bX7EVArrhpDVhF9jCPDCJZQuBaVkEgehfAggo

## Token Analysis (10 Random Tokens)

### Most Active Token
- **Mint**: DZwcCm9cS3teTc4s97mg4k4AZvCW1ArFiGuu5s6ZCxBb
- **Total Trades**: 244 (140 buys, 104 sells)
- **Buy/Sell Ratio**: 57.4% buys
- **pump.fun**: https://pump.fun/DZwcCm9cS3teTc4s97mg4k4AZvCW1ArFiGuu5s6ZCxBb

### High Volume Token
- **Mint**: 3ghHhEaEtiWqgvxLpYhE6hoPhJLhTuNMSjk172HPPUMP
- **Total Trades**: 126 (all buys)
- **Buy/Sell Ratio**: 100% buys (unusual - possible bot activity)
- **pump.fun**: https://pump.fun/3ghHhEaEtiWqgvxLpYhE6hoPhJLhTuNMSjk172HPPUMP

### Other Sampled Tokens
1. 2XYgocKz9MvkNVVyj85kdM2VxsUwrJeQUZVD4qmD4dYT - 7 trades
2. 6htHhcDwc6p9H7SzHrBKfdeHqbmSG9RzXfPo3qL6pump - 6 trades
3. 8ztixkSGb1sdq4cBAA44NRAdkUZBuRz9snquq72Gpump - 2 trades
4. 8AkguJ6zeg9Gp2PcLdi4s3NqUANLhp9JXKySMmfypump - 1 trade
5. 8Q8KPBL21FVatn2C1EaxAQSorAkHW2W2jDUXapVPZmhm - 1 trade
6. 38PgzpJYu2HkiYvV8qePFakB8tuobPdGm2FFEn7Dpump - 1 trade
7. 5vdsNXpd7uQLdUMu2e4Ypm9c9swNaLhMQzta4ooMpump - 1 trade

## Data Accuracy Assessment

### ✅ Correct Data Points
1. **Trade Type**: Correctly parsing buy/sell
2. **Token Addresses**: Matching Solscan data
3. **Sol Amounts**: Raw lamports stored correctly
4. **Token Amounts**: Raw token units stored correctly
5. **Signatures**: Properly captured and verifiable on Solscan
6. **AMM Program**: Only capturing pump AMM trades (not BC trades)

### ❌ Issues Still Present
1. **Price Calculation**: All trades showing $0.00 price
2. **Market Cap**: All showing $0.00 (depends on price)
3. **Pool Reserves**: Not being extracted from events
4. **Token Metadata**: Not enriched (no API keys configured)

## Technical Details

### Database Storage
- **Sol amounts**: Stored as bigint in lamports (e.g., 82269645)
- **Token amounts**: Stored as bigint in raw units (e.g., 21352851667)
- **Conversion**: Applied only when displaying (÷ 10^9 for SOL, ÷ 10^6 for tokens)

### AMM Event Structure (Need Investigation)
The pump AMM events should contain pool reserves, but field names need verification:
- Tried: `pool_base_token_reserves`, `pool_quote_token_reserves`
- Tried: `baseTokenReserves`, `quoteTokenReserves`
- Tried: `token_reserves`, `sol_reserves`

## Recommendations

1. **Immediate Fix Needed**: Verify exact field names in pump AMM events
2. **Consider**: Adding debug logging to print full event structure
3. **Alternative**: Query pool accounts directly for reserve data
4. **Enhancement**: Add Helius/Shyft API key for metadata enrichment

## Conclusion

The AMM monitor is successfully:
- ✅ Subscribing to pump AMM transactions only
- ✅ Parsing buy/sell trades correctly
- ✅ Storing trade data with proper amounts
- ✅ Capturing all required transaction details

Still needs fixing:
- ❌ Pool reserve extraction for price calculation
- ❌ Market cap calculation (depends on price)
- ❌ Token metadata enrichment