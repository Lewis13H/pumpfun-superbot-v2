# AMM Market Cap Calculation Solution

## Problem Summary
Our AMM market cap calculations were off by 27.7x initially, showing $140k instead of the reported $3.9M (now $2.56M) for the IPO token.

## Root Causes Identified

1. **Incorrect Reserve Extraction**: We were extracting post-token balances that included user wallets, resulting in impossible values (16B tokens with 1B supply)

2. **Wrong Circulating Supply Assumption**: We assumed 800M tokens were sold in BC, but pump.fun tokens can have varying amounts sold during bonding curve

3. **Decimal Precision Confusion**: Virtual reserves use standard decimals (9 for SOL, 6 for tokens) but we were applying them incorrectly

## Correct Implementation

### Virtual Reserve Tracking
```typescript
// Correct decimal handling
const solReservesInSol = Number(virtualSolReserves) / 1e9;  // 9 decimals
const tokenReservesInTokens = Number(virtualTokenReserves) / 1e6;  // 6 decimals

// Price calculation
const pricePerToken = solReservesInSol / tokenReservesInTokens;
const priceInUsd = pricePerToken * solPriceUsd;

// Market cap (following Solscan methodology)
const marketCapUsd = priceInUsd * 1_000_000_000;  // Total supply
```

### Key Insights

1. **pump.fun tokens typically have 99%+ in the AMM pool** - Only a small fraction is actually circulating
2. **Market cap = Price × Total Supply** - Not circulating supply (confirmed from Solscan)
3. **Virtual reserves are accounting values** - They track the constant product formula, not actual balances

## Implementation Steps

1. **Update VirtualReserveCalculator**:
   - Track reserves using constant product formula
   - Apply correct decimals (9 for SOL, 6 for tokens)
   - Calculate market cap with total supply

2. **Fix AmmTradeEnricher**:
   - Remove flawed extraction methods
   - Use VirtualReserveCalculator for all reserve tracking
   - Properly update reserves based on trades

3. **Update PriceCalculator**:
   - Use total supply for AMM market cap
   - Apply correct decimal conversions

## Remaining Considerations

If there's still a discrepancy after these fixes:
- **Timing**: Our trade data might be older than real-time prices
- **SOL Price**: Different SOL prices between calculations
- **Trade History**: We need to process trades sequentially to maintain accurate virtual reserves

## Code Changes Required

### 1. Virtual Reserve Calculator
- Already implemented in `/src/services/amm/virtual-reserve-calculator.ts`
- Needs adjustment for market cap to use total supply

### 2. AMM Trade Enricher
- Already updated in `/src/services/amm/amm-trade-enricher.ts`
- Uses VirtualReserveCalculator correctly

### 3. Price Calculator
- Update `/src/services/pricing/price-calculator.ts`
- Change AMM market cap to use total supply (1B)

### 4. Database Updates
- Run scripts to recalculate all AMM market caps
- Ensure consistent decimal handling

## Verification

After implementation:
1. IPO token should show ~$2.56M market cap (matching Solscan)
2. Price should be ~$0.00256 per token
3. Virtual reserves should maintain constant product through trades

## Future Improvements

1. **Real-time Updates**: Subscribe to pool account updates for live reserves
2. **Historical Tracking**: Process all trades sequentially from genesis
3. **Cross-validation**: Compare with multiple sources (DexScreener, Birdeye)
4. **Alerts**: Flag when our calculations diverge significantly from external sources