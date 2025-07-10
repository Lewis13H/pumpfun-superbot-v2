# Virtual Reserves Discrepancy Analysis

## Problem Statement
Our calculated market cap for the IPO token (2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump) is $140k, but DexScreener/pump.fun shows $3.9M - a 27.7x difference.

## Investigation Results

### 1. Current State
- **Our calculation**: $140,680 market cap
- **Reported**: $3,900,000 market cap
- **Difference**: 27.7x

### 2. Reserve Analysis
From our latest AMM trade:
- SOL reserves: 14.66 SOL (decreased from initial 42 SOL)
- Token reserves: 16,041,467,500 tokens (increased from initial 1B)
- This indicates people have been buying tokens (SOL down, tokens up)

### 3. Key Issues Identified

#### Issue 1: Reserve Extraction Method
Our current method extracts reserves from post-token balances, but we might be getting the wrong accounts:
- We filter for "high balance accounts" (>1M tokens)
- This might be capturing user wallets, not the pool reserves
- The 16B tokens in "reserves" is impossible if total supply is only 1B

#### Issue 2: Virtual vs Actual Reserves
pump.fun uses **virtual reserves** for pricing, not actual token balances:
- Virtual reserves are accounting numbers, not real balances
- Initial virtual: 42 SOL and 1B tokens
- These change with trades but don't represent actual pool balances

#### Issue 3: Market Cap Calculation
We're using: `price × total_supply = market_cap`
But pump.fun might use: `price × circulating_supply = market_cap`

Where circulating supply = tokens sold in BC + tokens traded in AMM

## Root Cause

The 16B token reserves we're seeing are likely **cumulative trading volume** or incorrectly extracted balances, not actual reserves. This is why our calculation is off by 27.7x.

## Solution

### Phase 1: Fix Reserve Extraction (Immediate)
1. **Identify correct pool accounts**:
   - Look for pump.swap pool program accounts specifically
   - Use account owner validation
   - Cross-reference with known pool patterns

2. **Validate reserve constraints**:
   - Token reserves cannot exceed total supply (1B)
   - Implement sanity checks

3. **Use transaction logs**:
   - Parse pool state from logs if available
   - Look for "pool_state" or similar events

### Phase 2: Implement Proper Virtual Reserve Tracking
1. **Track virtual reserves separately**:
   - Start with initial values (42 SOL, 1B tokens)
   - Update based on trade amounts using constant product formula
   - Store in separate columns

2. **Calculate market cap correctly**:
   - Use virtual reserves for price calculation
   - Apply proper circulating supply logic
   - Account for BC tokens (800M) + AMM trading

### Phase 3: Cross-Validation
1. **Fetch real-time data**:
   - Use Helius/Shyft to get current pool state
   - Compare with our calculations
   - Implement alerts for large discrepancies

2. **Monitor accuracy**:
   - Track our calculations vs DexScreener
   - Log discrepancies for analysis
   - Adjust algorithm based on patterns

## Implementation Priority

1. **Critical**: Fix reserve extraction to ensure token reserves ≤ total supply
2. **High**: Implement virtual reserve tracking
3. **Medium**: Add cross-validation with external sources
4. **Low**: Build monitoring dashboard for accuracy metrics

## Next Steps

1. Create script to properly extract pool reserves
2. Implement virtual reserve calculation
3. Update price calculator to handle pump.fun specifics
4. Backfill historical data with correct calculations