# Session 8: Historical Tracking & Analytics

## Overview
Session 8 adds comprehensive historical tracking and analytics capabilities to the holder analysis system. This enables trend analysis, peer comparisons, alerts, and detailed reporting.

## Components Implemented

### 1. Historical Services (`historical/`)
- **HolderHistoryService**: Manages historical snapshots and retrieval
- **HolderTrendAnalyzer**: Analyzes trends over various time periods
- **HolderComparisonService**: Compares tokens with peer groups

### 2. Reporting Services (`reports/`)
- **HolderReportGenerator**: Generates comprehensive analysis reports
- **HolderAlertService**: Monitors changes and generates alerts

### 3. Database Tables
- `holder_snapshots` - Already existed, enhanced with historical tracking
- `holder_trends` - Stores calculated trend data
- `holder_alerts` - New table for alert tracking (migration 004)

## Features

### Historical Tracking
- Automatic snapshot storage during analysis
- Configurable time periods (1h, 6h, 24h, 7d, 30d)
- Change detection to avoid duplicate snapshots
- Efficient storage with data hashing

### Trend Analysis
- Holder growth tracking (absolute, percentage, daily rate)
- Score movement analysis
- Concentration changes
- Wallet churn rates
- Health trajectory assessment
- Growth acceleration detection

### Comparison & Benchmarking
- Peer group identification based on market cap
- Percentile ranking across metrics
- Best-in-class comparisons
- Actionable insights generation

### Alert System
- Automatic alert generation based on rules:
  - Score drops (20+ points or 10+ if below 150)
  - Concentration increases (10% or 5% if already >50%)
  - Rapid holder growth (>10 holders/hour)
  - High churn rates (>25%)
- Alert severity levels (low, medium, high, critical)
- Alert acknowledgment tracking

### Reporting
- Comprehensive JSON reports
- Markdown report generation
- Includes all metrics, trends, comparisons
- Actionable recommendations

## API Endpoints

### Historical Data
- `GET /api/v1/holder-analysis/:mintAddress/history` - Get historical snapshots
- `GET /api/v1/holder-analysis/:mintAddress/trends` - Get trend analysis

### Comparison
- `GET /api/v1/holder-analysis/:mintAddress/comparison` - Compare with peers
- `GET /api/v1/holder-analysis/leaderboard` - Top tokens by score

### Reports
- `GET /api/v1/holder-analysis/:mintAddress/report` - Generate report (JSON/Markdown)

### Alerts
- `GET /api/v1/holder-analysis/alerts` - Get active alerts
- `POST /api/v1/holder-analysis/alerts/:alertId/acknowledge` - Acknowledge alert
- `GET /api/v1/holder-analysis/:mintAddress/alerts/history` - Alert history

## Usage Example

```typescript
// Get historical data
const history = await holderAnalysisService.getHolderHistory(
  mintAddress,
  '7d' // period
);

// Analyze trends
const trends = await holderAnalysisService.analyzeTrends(
  mintAddress,
  '24h'
);

// Check alerts
const alerts = await holderAnalysisService.getActiveAlerts(mintAddress);

// Generate report
const report = await fetch(`/api/v1/holder-analysis/${mintAddress}/report?format=markdown`);
```

## Testing
Run the test script to verify all components:
```bash
npx tsx src/scripts/test-session-8-historical.ts
```

## Integration Notes
- Historical tracking is automatically integrated into the main analysis flow
- Snapshots are saved after each successful analysis
- Alerts are checked after each snapshot save
- All services use the existing database pool
- Event-driven architecture for loose coupling

## Next Steps (Sessions 9-10)
- Session 9: Performance optimization with caching
- Session 10: Comprehensive testing and deployment