# Job Queue System

## Overview
The holder analysis job queue system provides asynchronous, priority-based processing of holder analysis tasks with worker pools, scheduling, and monitoring capabilities.

## Architecture

### Core Components

1. **Job Queue** (`holder-analysis-job-queue.ts`)
   - In-memory priority queue
   - Automatic retry logic
   - Event-driven notifications
   - Configurable concurrency

2. **Job Processor** (`holder-analysis-job-processor.ts`)
   - Worker pool management
   - Multiple job type support
   - Progress reporting
   - Graceful shutdown

3. **Job Scheduler** (`holder-analysis-job-scheduler.ts`)
   - Recurring job management
   - Interval-based scheduling
   - Dynamic data fetching
   - Predefined schedules

4. **Job Monitor** (`holder-analysis-job-monitor.ts`)
   - Real-time metrics
   - Performance tracking
   - Alert system
   - Health scoring

## Job Types

### Single Analysis
Analyzes one token with full holder analysis:
```typescript
{
  type: 'single_analysis',
  mintAddress: 'token123',
  options: {
    forceRefresh: true,
    maxHolders: 1000,
    enableTrends: true
  }
}
```

### Batch Analysis
Efficiently processes multiple tokens:
```typescript
{
  type: 'batch_analysis',
  mintAddresses: ['token1', 'token2', 'token3'],
  options: {
    maxHolders: 500,
    enableTrends: false
  }
}
```

### Recurring Analysis
Updates existing analysis on schedule:
```typescript
{
  type: 'recurring_analysis',
  mintAddress: 'token123',
  options: {
    forceRefresh: true,
    saveSnapshot: true
  }
}
```

### Trend Update
Lightweight trend calculation only:
```typescript
{
  type: 'trend_update',
  mintAddress: 'token123'
}
```

## Priority System

Jobs are processed based on priority weights:
- **Critical**: 1000 (immediate processing)
- **High**: 100 (important tasks)
- **Normal**: 10 (standard processing)
- **Low**: 1 (background tasks)

Priority affects:
- Queue position
- Worker assignment
- Resource allocation

## Worker Pool

### Configuration
```typescript
const processor = new HolderAnalysisJobProcessor(pool, {
  maxWorkers: 3,              // Concurrent workers
  workerIdleTimeout: 300000,  // 5 minute idle timeout
  batchSize: 10,              // Items per batch
  heliusApiKey: 'key',
  shyftApiKey: 'key'
});
```

### Worker Management
- Dynamic worker creation up to maxWorkers
- Idle timeout detection
- Error tracking per worker
- Performance statistics

### Load Distribution
- Round-robin assignment
- Automatic failover
- Worker health monitoring
- Graceful shutdown

## Scheduling System

### Predefined Schedules

1. **Top Tokens Analysis**
   - Default: Every 6 hours
   - Analyzes top 100 tokens by market cap
   - High priority processing

2. **Trending Tokens Analysis**
   - Default: Every 2 hours
   - Focuses on high-volume tokens
   - Critical priority

3. **Poor Score Reanalysis**
   - Default: Every 12 hours
   - Re-evaluates low-scoring tokens
   - Normal priority

### Custom Schedules
```typescript
scheduler.scheduleRecurringAnalysis({
  id: 'custom-job',
  name: 'Custom Analysis',
  schedule: '30m',  // Every 30 minutes
  data: {
    type: 'batch_analysis',
    mintAddresses: customList
  },
  enabled: true
});
```

### Schedule Formats
- Interval: `30s`, `5m`, `2h`, `1d`
- Simple numeric: `60` (minutes)
- Cron-like (future): `0 */6 * * *`

## Monitoring & Alerts

### Metrics Collected
- Queue depth and wait times
- Processing throughput
- Success/error rates
- Worker utilization
- Average processing time

### Alert Thresholds
```typescript
{
  queueDepth: 100,         // Max pending jobs
  processingTime: 300000,  // 5 min max time
  errorRate: 10,           // 10% max errors
  workerIdleTime: 600000   // 10 min max idle
}
```

### Health Score Calculation
0-100 score based on:
- Queue congestion (-20 points)
- Error rate (-30 points)
- Processing speed (-20 points)
- Alert count (-5 per alert)
- Throughput bonus (+10 points)

## Performance Optimization

### API Rate Limiting
- Built-in delays between API calls
- Batch processing for efficiency
- Automatic backoff on errors
- Provider fallback support

### Memory Management
- In-memory queue limitations
- Event history capping (1000 events)
- Metrics retention (24 hours)
- Automatic cleanup

### Concurrency Control
- Worker pool limits
- API request throttling
- Database connection pooling
- Resource monitoring

## Error Handling

### Retry Logic
```typescript
{
  retries: 3,              // Max attempts
  retryDelay: 60000,       // 1 minute between
  timeout: 300000,         // 5 minute timeout
  removeOnFail: false      // Keep failed jobs
}
```

### Failure Scenarios
1. **API Failures**: Automatic retry with backoff
2. **Timeout**: Job marked failed after timeout
3. **Worker Crash**: Job reassigned to healthy worker
4. **Queue Full**: New jobs rejected with error

## Best Practices

### Job Design
- Keep jobs focused and atomic
- Use appropriate priorities
- Set realistic timeouts
- Enable progress reporting

### Batch Optimization
- 10-50 tokens for detailed analysis
- 100-500 tokens for quick scans
- Balance API limits vs throughput
- Monitor rate limit errors

### Monitoring
- Watch queue depth trends
- Track error rates by job type
- Monitor worker utilization
- Set up critical alerts

### Scaling Considerations
- Current limit: ~10,000 in-memory jobs
- Consider Redis for larger scale
- Database job persistence
- Distributed worker pools

## Common Patterns

### Priority Analysis
```typescript
// High-value token gets priority
await queue.add({
  type: 'single_analysis',
  mintAddress: highValueToken,
  options: { forceRefresh: true }
}, { priority: 'critical' });
```

### Scheduled Batch
```typescript
// Nightly analysis of all tokens
scheduler.scheduleRecurringAnalysis({
  id: 'nightly-batch',
  schedule: '1d',
  data: {
    type: 'batch_analysis',
    mintAddresses: allTokens
  }
});
```

### Event-Driven Analysis
```typescript
// Analyze on significant event
eventBus.on('large_trade', async (data) => {
  await queue.add({
    type: 'single_analysis',
    mintAddress: data.token
  }, { priority: 'high' });
});
```

## Troubleshooting

### High Queue Depth
- Increase worker count
- Reduce job complexity
- Check for API throttling
- Consider job priorities

### Slow Processing
- Profile individual job types
- Check API response times
- Reduce batch sizes
- Enable caching

### Memory Issues
- Implement job cleanup
- Reduce history retention
- Use external queue
- Monitor memory usage