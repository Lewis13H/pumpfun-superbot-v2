# Comprehensive Monitoring Database Schema

This schema is designed to handle high-throughput monitoring of both pump.fun bonding curves and pump.swap AMM pools, processing 100,000+ tokens per week while only storing data for tokens that reach $8,888 market cap.

## Key Design Principles

### 1. **Efficient Filtering**
- Market cap threshold ($8,888) enforced at multiple levels
- Check constraints on state tables prevent low-value data storage
- Service layer pre-filters before queuing

### 2. **High Performance**
- Batch processing with queue system
- Comprehensive indexing strategy
- Partitioning ready for large-scale data
- In-memory caching for frequently accessed data

### 3. **Data Completeness**
- Captures all events from both programs
- Tracks token journey from bonding curve to AMM
- Stores both transaction and state data
- Maintains hourly aggregates for fast queries

## Schema Structure

### Core Tables

#### `tokens_comprehensive`
- Master registry of tokens that crossed $8,888 threshold
- Tracks which program first detected the token
- Records graduation from bonding curve to AMM

#### `bonding_curve_states` & `bonding_curve_trades`
- Complete bonding curve activity
- Virtual and real reserves tracked
- Progress percentage calculated

#### `amm_pools`, `amm_pool_states` & `amm_swaps`
- AMM pool configurations and activity
- Note: Pool accounts don't store reserves directly
- Reserves must be queried from separate token accounts

#### `token_stats_hourly`
- Pre-aggregated statistics for fast queries
- OHLCV data per token per hour
- Volume breakdown by program

### Support Tables

#### `processing_queue`
- Handles high-throughput data ingestion
- Batches writes for efficiency
- Provides resilience against failures

#### `monitoring_metrics`
- System performance tracking
- Processing statistics
- Error rates and latencies

## Usage

### 1. Run Migration
```bash
# Make migration script executable
chmod +x schema/migrate-comprehensive.ts

# Run migration
npx ts-node schema/migrate-comprehensive.ts
```

### 2. Use Database Service
```typescript
import { ComprehensiveDbService } from './database/comprehensive-db-service';

const dbService = new ComprehensiveDbService();

// Save token when it crosses threshold
const tokenId = await dbService.saveToken({
  mintAddress: '...',
  symbol: 'TEST',
  firstProgram: 'bonding_curve',
  firstSeenSlot: BigInt(12345),
  firstMarketCapUsd: 8900,
  thresholdPriceSol: 0.00001,
  thresholdMarketCapUsd: 8900
});

// Queue high-frequency data
await dbService.queueBondingCurveTrade({
  tokenId,
  signature: '...',
  tradeType: 'buy',
  // ... other fields
});
```

### 3. Query Examples

```sql
-- Top tokens by 24h volume
SELECT 
  t.symbol,
  t.name,
  SUM(s.volume_usd) as volume_24h,
  AVG(s.close_price_usd) as avg_price
FROM tokens_comprehensive t
JOIN token_stats_hourly s ON t.id = s.token_id
WHERE s.hour >= NOW() - INTERVAL '24 hours'
GROUP BY t.id, t.symbol, t.name
ORDER BY volume_24h DESC
LIMIT 100;

-- Graduation rate
SELECT 
  COUNT(*) FILTER (WHERE graduated_to_amm = true) * 100.0 / COUNT(*) as graduation_rate
FROM tokens_comprehensive
WHERE created_at >= NOW() - INTERVAL '7 days';

-- Recent high-value trades
SELECT 
  t.symbol,
  bt.trade_type,
  bt.sol_amount / 1e9 as sol_amount,
  bt.price_usd,
  bt.market_cap_usd
FROM bonding_curve_trades bt
JOIN tokens_comprehensive t ON bt.token_id = t.id
WHERE bt.market_cap_usd > 50000
ORDER BY bt.block_time DESC
LIMIT 20;
```

## Performance Considerations

1. **Indexing Strategy**
   - Primary indexes on foreign keys and timestamps
   - Composite indexes for common query patterns
   - Partial indexes for graduated tokens

2. **Batch Processing**
   - Default batch size: 100 records
   - Batch interval: 1 second
   - Automatic retry on failures

3. **Caching**
   - Token mint → ID mapping cached in memory
   - Pool address → ID mapping cached
   - Reduces database lookups significantly

4. **Maintenance**
   - Old queue items cleaned up hourly
   - Metrics archived after 7 days
   - Consider partitioning trades tables by month

## Monitoring

Track system health with:
```sql
-- Processing lag
SELECT 
  AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_lag_seconds
FROM processing_queue
WHERE processed = true
AND processed_at > NOW() - INTERVAL '1 hour';

-- Error rate
SELECT 
  metric_value as error_rate
FROM monitoring_metrics
WHERE metric_name = 'processing_errors'
ORDER BY recorded_at DESC
LIMIT 1;
```