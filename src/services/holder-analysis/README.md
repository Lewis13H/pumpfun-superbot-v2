# Holder Analysis System

## Overview
The Holder Analysis System provides comprehensive token holder analysis for Solana tokens, with a focus on pump.fun tokens. It analyzes holder distribution, classifies wallet types, calculates health scores, and provides actionable insights.

## System Architecture

### Core Components

1. **API Integration Layer** (Session 2)
   - Helius API client for wallet analysis
   - Shyft DAS API client for holder data
   - Automatic fallback mechanism
   - Rate limiting and caching

2. **Analysis Engine** (Session 3)
   - 0-300 point scoring algorithm
   - Distribution metrics (Gini, HHI, concentration)
   - Wallet classification (sniper, bot, whale, etc.)
   - Trend analysis and historical tracking

3. **Job Queue System** (Session 4)
   - Priority-based job processing
   - Worker pool management
   - Scheduled analysis jobs
   - Real-time monitoring and alerts

4. **Database Layer** (Session 1)
   - PostgreSQL schema for holder data
   - Snapshot history tracking
   - Wallet classifications storage
   - Analysis metadata and trends

## Key Features

### Holder Health Scoring (0-300 points)
- **Base Score**: 150 points
- **Positive Factors** (up to +150):
  - Distribution score (holder count)
  - Decentralization (ownership spread)
  - Organic growth (low bot ratio)
  - Developer ethics (reasonable holdings)
- **Negative Factors** (up to -150):
  - Concentration penalties
  - Sniper activity
  - Bot holdings
  - MEV bundler presence

### Wallet Classification
- **Snipers**: Early buyers within minutes of launch
- **Bots**: Automated trading patterns
- **Bundlers**: MEV transaction bundling
- **Developers**: Team and creator wallets
- **Whales**: Large holders (>1% of supply)
- **Normal**: Regular retail investors

### Distribution Metrics
- **Top N Percentage**: Concentration in top holders
- **Gini Coefficient**: Wealth inequality measure
- **Herfindahl Index**: Market concentration
- **Holding Duration**: Average time tokens held

## Quick Start

### Installation
```bash
# No additional packages needed - uses built-in Node.js features
```

### Basic Usage
```typescript
import { Pool } from 'pg';
import { HolderAnalysisService } from './holder-analysis-service';

const pool = new Pool(/* config */);
const service = new HolderAnalysisService(
  pool,
  process.env.HELIUS_API_KEY,
  process.env.SHYFT_API_KEY
);

// Analyze a token
const result = await service.analyzeToken('mintAddress123');
if (result.success) {
  console.log(`Score: ${result.analysis.holderScore}/300`);
  console.log(`Rating: ${result.analysis.scoreRating}`);
}
```

### Job Queue Usage
```typescript
import { HolderAnalysisJobQueue } from './holder-analysis-job-queue';
import { HolderAnalysisJobProcessor } from './holder-analysis-job-processor';

const queue = new HolderAnalysisJobQueue();
const processor = new HolderAnalysisJobProcessor(pool);

// Start processing
queue.process(3, processor.createProcessor());

// Add analysis job
await queue.add({
  type: 'single_analysis',
  mintAddress: 'token123',
  options: { forceRefresh: true }
});
```

## API Integration

### Supported Providers
1. **Helius** (Primary for wallet analysis)
   - Transaction history
   - Wallet patterns
   - MEV detection

2. **Shyft** (Primary for holder data)
   - Token holders list
   - Holder percentages
   - Digital Asset Standard compliance

### Rate Limits
- Helius: 100 req/min (free tier)
- Shyft: 200 req/min (standard)
- Built-in delays and retry logic

## Score Interpretation

| Score | Rating | Description |
|-------|--------|-------------|
| 250-300 | Excellent 🟢 | Outstanding distribution |
| 200-249 | Good 🟢 | Strong holder base |
| 150-199 | Fair 🟡 | Average health |
| 100-149 | Poor 🟠 | Significant issues |
| 0-99 | Critical 🔴 | Severe problems |

## Job Types

### Single Analysis
Analyze one token with full details

### Batch Analysis
Analyze multiple tokens efficiently

### Recurring Analysis
Update existing analysis periodically

### Trend Update
Light-weight trend calculation

## Monitoring & Alerts

### Metrics Tracked
- Queue depth and throughput
- Worker utilization
- Success/error rates
- Processing times

### Alert Types
- Queue depth exceeded
- High error rate
- Slow processing
- Worker idle timeout

## Testing

### Run All Tests
```bash
# Session 2: API Integration
npx tsx src/scripts/test-holder-analysis-session2-mock.ts

# Session 3: Analysis Engine
npx tsx src/scripts/test-holder-analysis-session3.ts

# Session 4: Job Queue
npx tsx src/scripts/test-holder-analysis-session4.ts
```

## Best Practices

1. **API Keys**: Always use environment variables
2. **Rate Limiting**: Respect API limits with built-in delays
3. **Caching**: Use cache for repeated queries
4. **Batch Processing**: Group tokens for efficiency
5. **Monitoring**: Watch queue depth and error rates

## Common Issues

### High Bot Percentage
- Normal for new tokens
- Check launch time vs first trades
- Review wallet classification confidence

### API Errors
- Check rate limits
- Verify API keys
- Use fallback providers

### Slow Processing
- Reduce batch sizes
- Increase worker count
- Check API response times

## Future Enhancements

- Machine learning for wallet classification
- Cross-chain holder analysis
- Real-time WebSocket updates
- Advanced MEV detection
- Social sentiment integration

## Support

For issues or questions:
1. Check `.knowledge/` files for deep insights
2. Review test scripts for examples
3. Monitor logs for detailed errors