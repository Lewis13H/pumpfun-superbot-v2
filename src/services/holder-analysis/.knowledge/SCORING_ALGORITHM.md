# Holder Scoring Algorithm Deep Dive

## Overview
The holder scoring algorithm evaluates token health on a 0-300 point scale, with 150 as the base score. This document explains the rationale behind each scoring component and how to interpret results.

## Scoring Philosophy

### Base Score: 150 Points
- Represents a neutral starting point
- Assumes neither particularly good nor bad distribution
- Allows for equal positive and negative adjustments

### Score Range Interpretation
- **250-300**: Excellent - Outstanding holder distribution and health
- **200-249**: Good - Strong holder base with minor concerns
- **150-199**: Fair - Average holder health with room for improvement
- **100-149**: Poor - Significant concentration or bot activity
- **0-99**: Critical - Severe holder issues requiring immediate attention

## Positive Factors (Max +150 points)

### 1. Distribution Score (+50 max)
**Purpose**: Rewards tokens with many holders, indicating broad interest and adoption.

**Thresholds**:
- ≥1000 holders: +50 points (excellent distribution)
- ≥500 holders: +35 points (good distribution)
- ≥100 holders: +20 points (fair distribution)
- ≥50 holders: +10 points (minimal viable distribution)
- <50 holders: +5 points (very limited distribution)

**Rationale**: More holders generally indicate:
- Greater decentralization
- Wider community support
- Reduced manipulation risk
- Better liquidity distribution

### 2. Decentralization Score (+50 max)
**Purpose**: Rewards tokens where ownership is spread across many holders rather than concentrated.

**Based on Top 10 Holder Percentage**:
- <20%: +50 points (excellent decentralization)
- <30%: +35 points (good decentralization)
- <40%: +20 points (fair decentralization)
- <50%: +10 points (poor decentralization)
- ≥50%: +0 points (critical concentration)

**Why Top 10?**: The top 10 holders often represent the most influential group. Their collective holdings indicate whether a token can be easily manipulated.

### 3. Organic Growth Score (+30 max)
**Purpose**: Rewards tokens with genuine human holders rather than automated bots.

**Based on Bot Percentage**:
- <5%: +30 points (highly organic)
- <15%: +15 points (mostly organic)
- ≥15%: +0 points (significant bot presence)

**Bot Detection Indicators**:
- High-frequency trading patterns
- Consistent time intervals between trades
- Multiple tokens traded simultaneously
- Known bot wallet addresses

### 4. Developer Ethics Score (+20 max)
**Purpose**: Rewards teams that don't hold excessive amounts of their own token.

**Based on Developer Holdings**:
- <5%: +20 points (excellent - team shows confidence without greed)
- <10%: +10 points (good - reasonable team allocation)
- <15%: +5 points (fair - borderline acceptable)
- ≥15%: +0 points (concerning - potential dump risk)

## Negative Factors (Max -150 points)

### 1. Concentration Penalty (-70 max)
**Purpose**: Penalizes tokens with extreme wealth concentration.

**Top 10 Concentration**:
- >70%: -50 points (extreme risk)
- >60%: -35 points (very high risk)
- >50%: -25 points (high risk)
- >40%: -15 points (moderate risk)
- >35%: -10 points (slight risk)

**Top 25 Concentration** (additional):
- >85%: -20 points
- >75%: -15 points
- >65%: -10 points
- >55%: -5 points

**Why Double Penalty?**: Both top 10 and top 25 are evaluated because:
- Top 10 shows extreme concentration
- Top 25 reveals broader distribution issues
- Together they paint a complete picture

### 2. Sniper Penalty (-50 max)
**Purpose**: Penalizes tokens dominated by early buyers who bought within minutes of launch.

**Thresholds**:
- >30% sniper holdings: -50 points (extreme sniping)
- >20% sniper holdings: -30 points (high sniping)
- >10% sniper holdings: -15 points (moderate sniping)

**Impact**: Snipers often:
- Create artificial price pumps
- Dump on retail investors
- Discourage organic growth

### 3. Bot Penalty (-30 max)
**Purpose**: Penalizes tokens with significant bot-controlled supply.

**Thresholds**:
- >25% bot holdings: -30 points
- >15% bot holdings: -20 points
- >5% bot holdings: -10 points

**Different from Organic Score**: While organic growth score rewards low bot counts, this penalty specifically targets bot-held supply percentage.

### 4. Bundler Penalty (-20 max)
**Purpose**: Penalizes presence of MEV bundlers which indicate sophisticated extraction.

**Thresholds**:
- >10 bundlers: -20 points
- >5 bundlers: -10 points
- >2 bundlers: -5 points

## Score Calculation Example

### Scenario: Average Token
```
Base Score: 150

Positive Factors:
- 250 holders: +20 (fair distribution)
- Top 10 hold 45%: +10 (poor decentralization)
- 12% bots: +15 (mostly organic)
- 8% dev holdings: +10 (good ethics)
Subtotal: +55

Negative Factors:
- Top 10 at 45%: -15 (moderate concentration)
- Top 25 at 68%: -10 (high concentration)
- 18% sniper holdings: -15 (moderate sniping)
- 12% bot holdings: -10 (moderate bots)
- 3 bundlers: -5 (low bundler activity)
Subtotal: -55

Final Score: 150 + 55 - 55 = 150/300 (Fair)
```

## Customizing the Algorithm

The scoring algorithm can be customized via weights and thresholds:

```typescript
const calculator = new HolderScoreCalculator({
  // Adjust importance of each positive factor
  weights: {
    distribution: 1.2,      // Increase by 20%
    decentralization: 0.8,  // Decrease by 20%
    organicGrowth: 1.0,     // Keep standard
    developerEthics: 1.1    // Increase by 10%
  },
  // Adjust thresholds
  thresholds: {
    excellentHolderCount: 2000, // Require more holders
    whaleMinPercentage: 0.5,    // Stricter whale definition
    // ... other thresholds
  }
});
```

## Best Practices

1. **Regular Monitoring**: Scores change as holder distribution evolves
2. **Trend Analysis**: Look at score changes over time, not just absolute values
3. **Context Matters**: New tokens naturally score lower; compare within peer groups
4. **Action Items**: Use recommendations to improve score
5. **Multiple Metrics**: Don't rely solely on score; review all metrics

## Common Patterns

### High-Scoring Tokens (250+)
- Community-driven projects with fair launches
- Established tokens with proven distribution
- Projects with anti-sniper mechanisms

### Low-Scoring Tokens (<100)
- Fresh launches dominated by snipers
- Abandoned projects with concentrated holdings
- Bot-manipulated tokens
- Projects with excessive team allocations

## Future Enhancements

1. **Time-Weighted Scores**: Give more weight to recent holder behavior
2. **Velocity Metrics**: Include trading velocity and holder turnover
3. **Social Metrics**: Incorporate community engagement data
4. **Cross-Chain Analysis**: Compare with holders on other chains
5. **ML-Based Classification**: Improve wallet classification accuracy