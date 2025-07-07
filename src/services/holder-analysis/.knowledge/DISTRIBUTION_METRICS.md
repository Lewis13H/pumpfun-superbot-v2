# Distribution Metrics Explained

## Overview
Distribution metrics provide quantitative measures of how tokens are distributed among holders. These metrics help identify concentration risks, inequality levels, and overall health of token distribution.

## Core Metrics

### 1. Top N Percentage
**What it measures**: Percentage of total supply held by the top N holders.

**Common Measurements**:
- **Top 10**: Most critical metric, shows extreme concentration
- **Top 25**: Broader concentration view
- **Top 100**: Overall distribution health

**Interpretation**:
```
Top 10 Percentage:
- <20%: Excellent distribution
- 20-30%: Good distribution
- 30-50%: Fair distribution
- 50-70%: Poor distribution
- >70%: Critical concentration

Top 25 Percentage:
- <40%: Excellent
- 40-55%: Good
- 55-70%: Fair
- 70-85%: Poor
- >85%: Critical
```

**Why it matters**: High concentration means few wallets can manipulate price.

### 2. Gini Coefficient
**What it measures**: Income inequality measure adapted for token holdings (0 = perfect equality, 1 = perfect inequality).

**Calculation**:
```
G = (2 * Σ(i * balance[i])) / (n * totalBalance) - (n + 1) / n
```
Where balances are sorted in ascending order.

**Interpretation**:
- **0.0-0.3**: Very equal distribution (rare in crypto)
- **0.3-0.5**: Good distribution
- **0.5-0.7**: Moderate inequality
- **0.7-0.9**: High inequality (common in crypto)
- **0.9-1.0**: Extreme inequality

**Real-world context**:
- Bitcoin Gini: ~0.88
- Ethereum Gini: ~0.92
- Most tokens: 0.7-0.95

### 3. Herfindahl-Hirschman Index (HHI)
**What it measures**: Market concentration using sum of squared market shares.

**Calculation**:
```
HHI = Σ(marketShare[i]²)
```

**Interpretation**:
- **0-0.01**: Highly competitive (many small holders)
- **0.01-0.15**: Unconcentrated
- **0.15-0.25**: Moderately concentrated
- **0.25-1.0**: Highly concentrated

**Traditional finance context**:
- Used by regulators for merger analysis
- HHI > 0.25 often blocks mergers
- Crypto typically shows higher concentration

### 4. Holding Duration Metrics
**What it measures**: How long holders keep their tokens.

**Metrics**:
- **Average Holding Duration**: Mean time tokens are held
- **Median Holding Duration**: Middle value (less affected by outliers)

**Interpretation**:
- **<24 hours**: High speculation/bot activity
- **1-7 days**: Short-term trading
- **1-4 weeks**: Medium-term holders
- **>1 month**: Long-term believers

**Calculation challenges**:
- Requires transaction history
- Must track wallet entries/exits
- Approximate from on-chain data

## Advanced Metrics

### 1. Nakamoto Coefficient
**What it measures**: Minimum number of entities needed to control 51% of supply.

**Interpretation**:
- Higher = More decentralized
- Bitcoin: ~4-5 mining pools
- Most tokens: 5-20 holders

### 2. Shannon Entropy
**What it measures**: Information-theoretic measure of distribution randomness.

**Formula**:
```
H = -Σ(p[i] * log2(p[i]))
```
Where p[i] is the proportion held by wallet i.

**Use case**: Comparing distribution "surprise" across tokens.

### 3. Concentration Ratio (CR-n)
**What it measures**: Cumulative percentage held by top n holders.

Common measurements:
- CR-4: Top 4 holders (from antitrust analysis)
- CR-10: Top 10 holders
- CR-50: Top 50 holders

## Practical Applications

### 1. Risk Assessment
```typescript
function assessDistributionRisk(metrics: DistributionMetrics): RiskLevel {
  let riskScore = 0;
  
  // Top 10 concentration risk
  if (metrics.top10Percentage > 70) riskScore += 3;
  else if (metrics.top10Percentage > 50) riskScore += 2;
  else if (metrics.top10Percentage > 30) riskScore += 1;
  
  // Gini coefficient risk
  if (metrics.giniCoefficient > 0.9) riskScore += 2;
  else if (metrics.giniCoefficient > 0.8) riskScore += 1;
  
  // Determine risk level
  if (riskScore >= 4) return 'CRITICAL';
  if (riskScore >= 3) return 'HIGH';
  if (riskScore >= 2) return 'MEDIUM';
  return 'LOW';
}
```

### 2. Distribution Health Score
```typescript
function calculateDistributionHealth(metrics: DistributionMetrics): number {
  // 0-100 score based on multiple factors
  const giniScore = (1 - metrics.giniCoefficient) * 40;
  const top10Score = Math.max(0, (100 - metrics.top10Percentage) * 0.3);
  const top25Score = Math.max(0, (100 - metrics.top25Percentage) * 0.2);
  const hhiScore = (1 - metrics.herfindahlIndex) * 10;
  
  return giniScore + top10Score + top25Score + hhiScore;
}
```

### 3. Comparative Analysis
Use metrics to compare tokens:
- Within same category (memes, DeFi, etc.)
- At similar market caps
- At similar ages since launch

## Common Patterns

### Healthy Distribution Evolution
1. **Launch**: High concentration (team, early investors)
2. **Growth**: Concentration decreases as community grows
3. **Maturity**: Stabilizes with moderate concentration

### Unhealthy Patterns
1. **Increasing Concentration**: Whales accumulating
2. **Stable High Concentration**: No new holders joining
3. **Rapid Distribution**: Possible dump incoming

## Limitations & Considerations

### 1. Exchange Wallets
- Can appear as massive whales
- Actually represent many users
- Need to identify and handle separately

### 2. Smart Contract Holdings
- Liquidity pools
- Staking contracts
- Bridge contracts
- May need exclusion from metrics

### 3. Multiple Wallets
- Single entity using multiple addresses
- Sybil attacks on distribution metrics
- Difficult to detect perfectly

### 4. Time Sensitivity
- Metrics change constantly
- Snapshots may miss important changes
- Need regular monitoring

## Best Practices

### 1. Regular Monitoring
- Calculate metrics at regular intervals
- Track trends over time
- Set up alerts for significant changes

### 2. Multiple Metrics
- Don't rely on single metric
- Use combination for full picture
- Weight based on token type

### 3. Context Awareness
- New tokens naturally concentrated
- Different standards by category
- Consider token utility

### 4. Actionable Insights
Turn metrics into actions:
- High concentration → Incentivize distribution
- Low holder count → Marketing campaign
- High Gini → Airdrop to small holders

## Implementation Notes

### Performance Optimization
```typescript
// Efficient top N calculation
function calculateTopNPercentage(holders: Holder[], n: number): number {
  // Pre-sort by balance descending
  const sorted = [...holders].sort((a, b) => b.balance - a.balance);
  
  // Use BigInt for precision
  const totalSupply = holders.reduce((sum, h) => sum + BigInt(h.balance), 0n);
  const topNSum = sorted.slice(0, n).reduce((sum, h) => sum + BigInt(h.balance), 0n);
  
  return Number((topNSum * 10000n) / totalSupply) / 100;
}
```

### Caching Strategy
- Cache calculated metrics for 5-15 minutes
- Invalidate on significant holder changes
- Background refresh for active tokens

## Future Enhancements

1. **Dynamic Thresholds**
   - Adjust based on token age
   - Market cap considerations
   - Category-specific standards

2. **Predictive Analytics**
   - Forecast distribution changes
   - Identify accumulation patterns
   - Early warning system

3. **Network Analysis**
   - Wallet clustering
   - Transaction flow analysis
   - True entity detection