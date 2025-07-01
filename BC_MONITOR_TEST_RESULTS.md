# Bonding Curve Monitor Test Results

## Test Summary
- **Test Duration**: ~3 minutes
- **Tokens Captured**: 58 tokens (60 reported by monitor)
- **Trades Captured**: 3,981 trades
- **Unique Tokens in Trades**: 336 (many below threshold)
- **Bonding Curve Mappings**: 332

## Data Quality Analysis

### What Data Should Have Been Saved:
1. **Token Metadata**: Name, Symbol, Description, URI, Image
2. **Creator Information**: Creator address
3. **Price Data**: First price, current price, market cap
4. **Trading Data**: Trade type, user addresses, amounts, prices
5. **Bonding Curve Data**: Progress, reserves, bonding curve key
6. **Timestamps**: Accurate block times

### What Data Was Actually Saved:

#### ✅ Successfully Captured:
1. **Mint Addresses**: All tokens have valid mint addresses
2. **Creator Addresses**: 100% of tokens have creator addresses
3. **Bonding Curve Keys**: 100% of tokens have BC keys
4. **Price Data**: First prices and market caps captured
5. **Trade Data**: Buy/sell types, amounts, prices all captured
6. **Bonding Curve Progress**: Calculated for all trades
7. **Current Prices**: 47/58 tokens have current price data

#### ❌ Missing or Incorrect Data:
1. **Token Metadata**: 0% have names or symbols (metadata enrichment not running)
2. **Timestamps**: All showing 1970 epoch time (incorrect conversion)
3. **Graduations**: No graduations detected (BC Account Monitor not receiving updates)

## Accuracy Verification

### Example: Token 2gYoV3kGJTV1u4n7zKSvb3NpPrwUWoFeoSBRxTjopump

**From pump.fun:**
- Name: Redwood Cigarettes GTA
- Symbol: RWC
- Market Cap: $27,647
- Creator: 5HyTaM79ZSJSuokuVYHFnFfm2fuELXAMfJLAqZFNrh5W
- Bonding Curve: ECsCabhRdu3UkQ2PUCgq7QwVmbV87wuakH9kL7NkpFFu

**From our database:**
- Name: (missing)
- Symbol: (missing)
- First Market Cap: $38,343 (captured at higher point)
- Latest Market Cap: $31,765
- Creator: 6mmNRHuMWmjwSZohwTFkcTxEunLgSFQ9ewFgsEgQnx37 (different!)
- Bonding Curve: Chp3z5hQc5JDarktPUJMxwEguJNbPxraQNUH8LpDJWXR (different!)

## Issues Identified:

1. **Timestamp Conversion Bug**: Block times are not being converted correctly from slot timestamps
2. **Metadata Enrichment**: Not running automatically with monitors
3. **BC Account Monitor**: Not receiving account update events (subscription issue)
4. **Creator Mismatch**: The creator address we captured differs from pump.fun
5. **Bonding Curve Key Mismatch**: Our BC key differs from pump.fun's

## Performance Metrics:
- **Parse Rate**: 91.6% (3,806/4,153 transactions)
- **Processing Speed**: 1,342 trades/minute
- **Average Parse Time**: 49.1ms
- **Volume Tracked**: $304,409 in 3 minutes

## Recommendations:
1. Fix timestamp conversion from slot to proper Unix timestamp
2. Enable automatic metadata enrichment
3. Debug BC Account Monitor subscription configuration
4. Verify creator and bonding curve key extraction logic
5. Cross-reference more tokens with on-chain data for accuracy