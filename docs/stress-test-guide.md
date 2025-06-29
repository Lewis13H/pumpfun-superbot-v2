# 30-Minute Stress Test Guide

## Overview

The stress test suite is designed to thoroughly test all monitors running simultaneously for 30 minutes while:
- Verifying transactions against Solscan in real-time
- Monitoring system resources (CPU, memory, database)
- Tracking errors and performance metrics
- Logging all data for analysis

## Components

### 1. Main Stress Test (`stress-test-all-monitors.ts`)
- Runs all three monitors concurrently
- Collects metrics every 10 seconds
- Samples database performance
- Tracks errors and restarts
- Generates comprehensive report

### 2. Solscan Verifier (`continuous-solscan-verifier.ts`)
- Samples 10 random transactions every 30 seconds
- Verifies signatures exist on Solscan
- Calculates match scores based on:
  - Signature match
  - Block time accuracy
  - Program detection
  - Transaction status
  - Fee payer verification
- Logs verification results

### 3. Resource Monitor (`monitor-system-resources.ts`)
- Tracks CPU and memory usage
- Monitors database connections and query times
- Detects monitor crashes
- Shows real-time graphs
- Alerts on threshold breaches

## Running the Test

### Quick Start
```bash
# Run everything with one command
npm run test-30min
```

### Manual Start (for more control)
```bash
# Terminal 1: Main stress test
npm run stress-test

# Terminal 2: Solscan verification
npm run verify-solscan

# Terminal 3: Resource monitoring
npm run monitor-resources
```

## What to Expect

### Dashboard Views

1. **Stress Test Dashboard**
   - Progress bar and time remaining
   - Monitor status (running/stopped)
   - Database metrics (tokens, trades, pool states)
   - Verification statistics
   - Recent errors

2. **Solscan Verifier**
   - Verification rate percentage
   - Average match score
   - Recent verification results
   - Common issues detected
   - Direct Solscan links

3. **Resource Monitor**
   - CPU and memory usage
   - Database performance
   - Monitor process stats
   - 5-minute trends
   - ASCII usage graphs

### Expected Performance

**Good Performance:**
- CPU: < 60% average
- Memory: < 70% usage
- Database queries: < 100ms
- Verification rate: > 90%
- Match score: > 80%
- Errors/min: < 1

**Acceptable Performance:**
- CPU: 60-80% average
- Memory: 70-85% usage
- Database queries: 100-500ms
- Verification rate: 70-90%
- Match score: 60-80%
- Errors/min: 1-5

**Poor Performance (investigate):**
- CPU: > 80% sustained
- Memory: > 85% usage
- Database queries: > 500ms
- Verification rate: < 70%
- Match score: < 60%
- Errors/min: > 5

## Alert Thresholds

The system will alert when:
- CPU usage > 80%
- Memory usage > 85%
- Database connections > 90
- Query time > 1000ms
- Process memory > 500MB
- Monitor crashes

## Output Files

All logs are saved to `./stress-test-logs/`:

- `stress-test-[timestamp].log` - Main test output
- `errors-[timestamp].log` - All errors encountered
- `metrics-[timestamp].json` - Complete metrics data
- `solscan-verification.log` - Verification results
- `resource-monitor.log` - Resource usage data

## Analyzing Results

### Final Report Includes:
- Total transactions processed
- Trades per second average
- New tokens discovered
- Monitor restart counts
- Error categories and counts
- Verification success rate
- Resource usage summary

### Common Issues to Look For:

1. **High Error Rate**
   - Network connectivity issues
   - API rate limiting
   - Database connection pool exhaustion

2. **Low Verification Rate**
   - Transactions not finalized yet
   - Solscan API issues
   - Data parsing errors

3. **Monitor Crashes**
   - Memory leaks
   - Unhandled exceptions
   - Resource exhaustion

4. **Performance Degradation**
   - Database query optimization needed
   - Memory leak in monitors
   - Too many concurrent operations

## Best Practices

1. **Before Running:**
   - Ensure stable internet connection
   - Check database has enough space
   - Close unnecessary applications
   - Set environment variables

2. **During Test:**
   - Monitor all three dashboards
   - Watch for sustained high resource usage
   - Note any patterns in errors
   - Check verification failures

3. **After Test:**
   - Review the final report
   - Check error logs for patterns
   - Analyze metrics JSON for trends
   - Plan optimizations based on findings

## Troubleshooting

### Monitors Won't Start
```bash
# Check environment variables
echo $DATABASE_URL
echo $SHYFT_GRPC_ENDPOINT

# Check TypeScript compilation
npx tsc --noEmit
```

### High Memory Usage
```bash
# Check for memory leaks
npm run monitor-resources
# Look for steady memory growth
```

### Database Errors
```sql
-- Check connections
SELECT count(*) FROM pg_stat_activity;

-- Check long queries
SELECT pid, now() - query_start as duration, query 
FROM pg_stat_activity 
WHERE state = 'active' 
ORDER BY duration DESC;
```

### Verification Failures
- Check network connectivity to Solscan
- Verify transactions are finalized (not just confirmed)
- Ensure proper rate limiting (1 req/sec)

## Optimization Tips

Based on test results:

1. **If CPU is high:**
   - Reduce parsing complexity
   - Batch operations more efficiently
   - Add caching layers

2. **If memory is high:**
   - Reduce in-memory caches
   - Fix memory leaks
   - Implement object pooling

3. **If database is slow:**
   - Add missing indexes
   - Optimize queries
   - Increase connection pool

4. **If verification is low:**
   - Wait longer before verification
   - Handle rate limits better
   - Improve error handling

## Example Test Session

```bash
# 1. Start the test
npm run test-30min

# 2. Monitor dashboards for 30 minutes
# Watch for:
# - Steady TPS (trades per second)
# - Stable resource usage
# - High verification rate
# - Low error count

# 3. After completion, check logs
cd stress-test-logs
ls -la

# 4. Analyze metrics
cat metrics-*.json | jq '.summary'

# 5. Check for errors
grep -i "critical" errors-*.log

# 6. Review verification
tail -n 100 solscan-verification.log
```

The stress test provides comprehensive insights into system performance and reliability under sustained load, helping identify bottlenecks and optimization opportunities.