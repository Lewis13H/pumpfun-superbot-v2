# Holder Analysis Session 4: Job Queue Implementation

## Overview
Session 4 implements a comprehensive job queue system for holder analysis with priority processing, worker pools, scheduling, and monitoring.

## What Was Created

### 1. Job Queue Service
- **File**: `holder-analysis-job-queue.ts`
- **Features**:
  - In-memory job queue with priority processing
  - Job status tracking (pending, running, completed, failed)
  - Retry logic with configurable attempts
  - Event-driven architecture
  - Priority levels: critical > high > normal > low
  - Delayed job support
  - Queue statistics and metrics

### 2. Job Processor
- **File**: `holder-analysis-job-processor.ts`
- **Features**:
  - Worker pool with configurable concurrency
  - Supports multiple job types:
    - `single_analysis`: Analyze one token
    - `batch_analysis`: Analyze multiple tokens
    - `recurring_analysis`: Update existing analysis
    - `trend_update`: Light trend calculation
  - Worker statistics tracking
  - Graceful shutdown support
  - Progress reporting

### 3. Job Scheduler
- **File**: `holder-analysis-job-scheduler.ts`
- **Features**:
  - Recurring job scheduling with intervals
  - Predefined schedules:
    - Top tokens analysis (every 6 hours)
    - Trending tokens analysis (every 2 hours)
    - Poor score reanalysis (every 12 hours)
  - Dynamic job data fetching
  - Start/stop control
  - Custom interval parsing (30s, 5m, 2h, 1d)

### 4. Job Monitor
- **File**: `holder-analysis-job-monitor.ts`
- **Features**:
  - Real-time metrics collection
  - Performance tracking:
    - Throughput (jobs/minute)
    - Average wait time
    - Success/error rates
    - Worker utilization
  - Alert system with thresholds
  - Health score calculation (0-100)
  - Dashboard data aggregation
  - Historical metrics storage

### 5. Job Types
- **File**: `holder-analysis-job.types.ts`
- **Interfaces**:
  - `Job<T>`: Core job structure
  - `JobQueue<T>`: Queue interface
  - `JobProcessor<T>`: Processor function type
  - `RecurringJobConfig`: Scheduled job configuration
  - `QueueStats`: Queue statistics
  - `WorkerStats`: Worker metrics

## Architecture

### Job Flow
```
Add Job → Queue (Priority Sort) → Worker Assignment → Processing → Complete/Retry
                                        ↓
                                   Progress Events
```

### Priority System
- **Critical**: 1000 weight (processes first)
- **High**: 100 weight
- **Normal**: 10 weight
- **Low**: 1 weight

### Worker Pool
- Configurable number of workers (default: 3)
- Each worker processes one job at a time
- Automatic work distribution
- Idle timeout detection

## Usage Examples

### Basic Usage
```typescript
// Create components
const queue = new HolderAnalysisJobQueue();
const processor = new HolderAnalysisJobProcessor(pool);
const scheduler = new HolderAnalysisJobScheduler(queue);
const monitor = new HolderAnalysisJobMonitor(queue, processor, scheduler);

// Start processing
queue.process(3, processor.createProcessor()); // 3 concurrent workers
monitor.start();

// Add a job
const job = await queue.add({
  type: 'single_analysis',
  mintAddress: 'token123',
  options: {
    forceRefresh: true,
    maxHolders: 1000
  }
}, {
  priority: 'high',
  retries: 3
});
```

### Batch Analysis
```typescript
await queue.add({
  type: 'batch_analysis',
  mintAddresses: ['token1', 'token2', 'token3'],
  options: {
    maxHolders: 500,
    enableTrends: true
  }
}, {
  priority: 'normal',
  timeout: 1800000 // 30 minutes
});
```

### Scheduled Jobs
```typescript
// Schedule top tokens analysis
await scheduler.scheduleTopTokensAnalysis(100, 360); // Top 100, every 6 hours

// Schedule custom recurring job
scheduler.scheduleRecurringAnalysis({
  id: 'vip-tokens',
  name: 'VIP Token Analysis',
  schedule: '1h', // Every hour
  data: {
    type: 'batch_analysis',
    mintAddresses: vipTokens,
    options: { forceRefresh: true }
  },
  enabled: true
});

// Start scheduler
scheduler.start();
```

### Monitoring
```typescript
// Get dashboard data
const dashboard = await monitor.getDashboardData();
console.log(`Health Score: ${dashboard.summary.healthScore}/100`);
console.log(`Throughput: ${dashboard.current.performance.throughput} jobs/min`);

// Listen for alerts
monitor.on('alert', (alert) => {
  if (alert.severity === 'critical') {
    // Send notification
  }
});
```

## Alert Types

### Queue Depth Alert
Triggered when pending jobs exceed threshold (default: 100)

### Slow Processing Alert
Triggered when average processing time exceeds threshold (default: 5 minutes)

### High Error Rate Alert
Triggered when error rate exceeds threshold (default: 10%)

### Worker Idle Alert
Triggered when worker is idle for too long (default: 10 minutes)

## Performance Considerations

### Queue Size
- In-memory queue, limited by available RAM
- Consider external queue (Redis, RabbitMQ) for production
- Current implementation good for <10,000 jobs

### Worker Count
- Balance between throughput and API rate limits
- Recommended: 2-5 workers for API-heavy tasks
- Monitor rate limit errors

### Batch Sizes
- Smaller batches (10-50) for detailed analysis
- Larger batches (100-500) for quick scans
- Adjust based on API quotas

## Testing

Run the test script:
```bash
npx tsx src/scripts/test-holder-analysis-session4.ts
```

This will:
1. Test single token analysis
2. Test batch analysis
3. Test job priorities
4. Test scheduled jobs
5. Test job cancellation
6. Display comprehensive metrics

## Next Steps (Session 5)
- Implement dashboard UI for job monitoring
- Add WebSocket support for real-time updates
- Create REST API endpoints for job management
- Add job persistence to database