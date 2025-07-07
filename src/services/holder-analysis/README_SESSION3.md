# Holder Analysis Session 3: Core Analysis Service

## Overview
Session 3 implements the core holder analysis service with the 0-300 point scoring algorithm, distribution metrics calculation, and comprehensive analysis orchestration.

## What Was Created

### 1. Holder Score Calculator
- **File**: `holder-score-calculator.ts`
- **Features**:
  - 0-300 point scoring algorithm
  - Base score: 150 points
  - Positive adjustments (up to +150):
    - Distribution score: +50 max (holder count)
    - Decentralization: +50 max (ownership spread)
    - Organic growth: +30 max (low bot ratio)
    - Developer ethics: +20 max (reasonable team holdings)
  - Negative adjustments (up to -150):
    - Sniper penalty: -50 max
    - Bot penalty: -30 max
    - Bundler penalty: -20 max
    - Concentration penalty: -70 max
  - Score ratings and recommendations

### 2. Distribution Metrics Calculator
- **File**: `distribution-metrics-calculator.ts`
- **Features**:
  - Top N percentage calculations (10, 25, 100)
  - Gini coefficient (wealth inequality measure)
  - Herfindahl-Hirschman Index (market concentration)
  - Holding duration statistics
  - Distribution health analysis
  - Decentralization score (0-100)

### 3. Holder Analysis Service
- **File**: `holder-analysis-service.ts`
- **Features**:
  - Main orchestrator for analysis workflow
  - Coordinates all sub-services
  - Event-driven progress tracking
  - Snapshot caching and history
  - Trend calculation
  - Analysis metadata tracking
  - Comprehensive error handling

## Scoring Algorithm Details

### Base Score: 150 points

### Positive Factors (Max +150)

#### Distribution Score (+50 max)
```
≥1000 holders: +50
≥500 holders:  +35
≥100 holders:  +20
≥50 holders:   +10
<50 holders:   +5
```

#### Decentralization Score (+50 max)
Based on top 10 holder percentage:
```
<20%: +50 (Excellent)
<30%: +35 (Good)
<40%: +20 (Fair)
<50%: +10 (Poor)
≥50%: +0  (Critical)
```

#### Organic Growth Score (+30 max)
Based on bot percentage:
```
<5%:  +30 (Excellent)
<15%: +15 (Good)
≥15%: +0  (Poor)
```

#### Developer Ethics (+20 max)
Based on developer holdings:
```
<5%:  +20 (Excellent)
<10%: +10 (Good)
<15%: +5  (Fair)
≥15%: +0  (Poor)
```

### Negative Factors (Max -150)

#### Concentration Penalties
Top 10 holders:
```
>70%: -50 (Extreme)
>60%: -35 (Very high)
>50%: -25 (High)
>40%: -15 (Moderate)
>35%: -10 (Slight)
```

Top 25 holders (additional):
```
>85%: -20
>75%: -15
>65%: -10
>55%: -5
```

#### Activity Penalties
- Sniper holdings: -15 to -50
- Bot holdings: -10 to -30
- Bundler count: -5 to -20

## Distribution Metrics

### Gini Coefficient
- Measures wealth inequality (0 = perfect equality, 1 = perfect inequality)
- Good: < 0.5
- Fair: 0.5 - 0.8
- Poor: > 0.8

### Herfindahl Index
- Measures market concentration (0 = perfect competition, 1 = monopoly)
- Good: < 0.1
- Fair: 0.1 - 0.25
- Poor: > 0.25

## Usage Example

```typescript
const analysisService = new HolderAnalysisService(pool, heliusKey, shyftKey);

// Analyze a token
const result = await analysisService.analyzeToken(mintAddress, {
  forceRefresh: false,      // Use cache if available
  maxHolders: 1000,         // Analyze top 1000 holders
  enableTrends: true,       // Calculate trends
  classifyWallets: true,    // Classify wallet types
  saveSnapshot: true        // Save to database
});

if (result.success) {
  console.log(`Score: ${result.analysis.holderScore}/300`);
  console.log(`Rating: ${getScoreRating(result.analysis.holderScore).rating}`);
}
```

## Score Interpretation

| Score Range | Rating | Emoji | Description |
|------------|--------|-------|-------------|
| 250-300 | Excellent | 🟢 | Outstanding holder distribution and health |
| 200-249 | Good | 🟢 | Strong holder base with minor concerns |
| 150-199 | Fair | 🟡 | Average holder health with room for improvement |
| 100-149 | Poor | 🟠 | Significant holder concentration or bot activity |
| 0-99 | Critical | 🔴 | Severe holder issues requiring immediate attention |

## Testing

Run the test script:
```bash
npx tsx src/scripts/test-holder-analysis-session3.ts
```

This will:
1. Test the scoring calculator with various scenarios
2. Calculate distribution metrics for test data
3. Run a full analysis workflow (mock or real)
4. Compare scores across different distribution patterns

## Event System

The analysis service emits events for progress tracking:
- `analysis_start` - Analysis begins
- `analysis_progress` - Step updates (fetching, calculating, etc.)
- `analysis_complete` - Analysis finished with score
- `analysis_error` - Error occurred
- `data_fetched` - Holder data retrieved
- `wallet_classified` - Wallet classification complete

## Next Steps (Session 4)
- Implement job queue for scheduled analysis
- Add priority-based processing
- Create background workers
- Set up recurring analysis jobs