# Bonding Curve Monitor - 1 Hour Test Plan

## Test Overview
**Purpose**: Thoroughly test bc-monitor reliability, accuracy, and database persistence over 1 hour  
**Duration**: 60 minutes continuous operation  
**Date**: To be executed  

## Pre-Test Setup

### 1. Database Baseline
```bash
# Record initial database state
psql $DATABASE_URL -c "SELECT COUNT(*) as total_tokens FROM tokens_unified"
psql $DATABASE_URL -c "SELECT COUNT(*) as tokens_above_threshold FROM tokens_unified WHERE threshold_crossed_at IS NOT NULL"
psql $DATABASE_URL -c "SELECT COUNT(*) as total_trades FROM trades_unified"
psql $DATABASE_URL -c "SELECT COUNT(*) as graduated_tokens FROM tokens_unified WHERE graduated_to_amm = TRUE"
```

### 2. Clear Test Logs
```bash
# Create test output directory
mkdir -p logs/bc-monitor-test
rm -f logs/bc-monitor-test/*
```

### 3. System Resources Baseline
```bash
# Record system state
echo "CPU Usage:" && top -l 1 | grep "CPU usage"
echo "Memory:" && vm_stat | grep "Pages free"
```

## Test Execution

### Run Command
```bash
# Start monitor with timestamped output
npm run bc-monitor 2>&1 | tee logs/bc-monitor-test/output_$(date +%Y%m%d_%H%M%S).log
```

### Monitoring Checkpoints (Every 10 minutes)

#### 10-Minute Checkpoint
- [ ] Monitor still running
- [ ] No database errors in logs
- [ ] Statistics increasing monotonically
- [ ] Memory usage stable
- [ ] Record key metrics

#### 20-Minute Checkpoint
- [ ] Check for any disconnections
- [ ] Verify graduation detections
- [ ] Sample token price accuracy
- [ ] Database batch queue healthy

#### 30-Minute Checkpoint
- [ ] Mid-test database validation
- [ ] Progress tracking accuracy
- [ ] Error rate acceptable (<5%)
- [ ] Trade detection rate >95%

#### 40-Minute Checkpoint
- [ ] Check for memory leaks
- [ ] Verify cache efficiency
- [ ] Database connection pool status
- [ ] Parse error patterns

#### 50-Minute Checkpoint
- [ ] Final statistics recording
- [ ] Graduation candidates tracking
- [ ] System resource check
- [ ] Prepare for shutdown

#### 60-Minute Mark
- [ ] Graceful shutdown (Ctrl+C)
- [ ] Final statistics captured
- [ ] Database flush completed

## Metrics to Track

### Extended Statistics Display
```typescript
📊 Monitor Statistics (Enhanced):
──────────────────────────────────────────────────
Connection:
  Status: CONNECTED
  Uptime: 1h 0m 0s
  Last data: 0s ago
  Stream health: 100%

Transactions:
  Received: ~7,200 (expected: ~2/sec)
  Trades detected: ~7,500
  Parse errors: <500
  Error rate: <7%

Trade Analysis:
  Buys: ~5,250 (70%)
  Sells: ~2,250 (30%)
  Unique tokens: ~800-1,000
  Detection rate: >95%
  Avg trades/tx: ~1.04

Price & Market Cap:
  SOL Price: $XXX.XX
  Total Volume: >$250,000
  Highest MC: >$50K
  Above $8,888: ~3,000-4,000 events
  Unique above threshold: ~150-200 tokens

Database Performance:
  Discovered tokens: ~150-200
  Tokens saved: ~150-200
  Trades saved: ~3,000-4,000
  Batch queue: <100 (healthy)
  Batch processing time: <50ms avg
  Cache hit rate: >80%

Progress Tracking:
  Tracked tokens: ~800-1,000
  Near graduation: 10-20
  Graduations detected: 5-15
  Progress updates: ~7,500

System Health:
  Reconnections: 0 (ideal)
  Total errors: <100
  Memory usage: <500MB
  CPU usage: <10%
  Network latency: <100ms

Advanced Metrics:
  Unique users: ~2,000-3,000
  Avg token lifespan: varies
  Token velocity: trades/min/token
  Bonding curve distribution:
    0-25%: ~40% of tokens
    25-50%: ~30% of tokens  
    50-75%: ~20% of tokens
    75-90%: ~8% of tokens
    90-100%: ~2% of tokens
```

## Post-Test Validation

### 1. Database Integrity Check
```bash
# Count final state
echo "=== Final Database State ==="
psql $DATABASE_URL << EOF
SELECT 
  COUNT(DISTINCT mint_address) as unique_tokens,
  COUNT(*) FILTER (WHERE threshold_crossed_at IS NOT NULL) as above_threshold,
  COUNT(*) FILTER (WHERE graduated_to_amm = TRUE) as graduated,
  MIN(created_at) as oldest_token,
  MAX(created_at) as newest_token
FROM tokens_unified
WHERE created_at > NOW() - INTERVAL '1 hour';
EOF

# Trade statistics
psql $DATABASE_URL << EOF
SELECT 
  COUNT(*) as total_trades,
  COUNT(DISTINCT mint_address) as tokens_with_trades,
  COUNT(*) FILTER (WHERE trade_type = 'buy') as buys,
  COUNT(*) FILTER (WHERE trade_type = 'sell') as sells,
  AVG(market_cap_usd) as avg_market_cap,
  MAX(market_cap_usd) as max_market_cap
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour';
EOF
```

### 2. Log Analysis
```bash
# Extract key metrics from logs
echo "=== Log Analysis ==="
grep -c "GRADUATION DETECTED" logs/bc-monitor-test/*.log
grep -c "New token discovered" logs/bc-monitor-test/*.log
grep -c "Database error" logs/bc-monitor-test/*.log
grep -c "Connection error" logs/bc-monitor-test/*.log
grep -c "Parse error" logs/bc-monitor-test/*.log
```

### 3. Performance Analysis
```bash
# Memory usage over time
grep "Memory usage" logs/bc-monitor-test/*.log | tail -10

# Processing rates
grep "Detection rate" logs/bc-monitor-test/*.log | tail -10

# Cache performance
grep "Cache hit rate" logs/bc-monitor-test/*.log | tail -10
```

### 4. Data Quality Validation
```sql
-- Check for data anomalies
SELECT 
  'Duplicate trades' as check_name,
  COUNT(*) as count
FROM (
  SELECT signature, COUNT(*) as cnt
  FROM trades_unified
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY signature
  HAVING COUNT(*) > 1
) dups

UNION ALL

SELECT 
  'Tokens without trades' as check_name,
  COUNT(*) as count
FROM tokens_unified t
LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
WHERE t.created_at > NOW() - INTERVAL '1 hour'
  AND tr.mint_address IS NULL

UNION ALL

SELECT 
  'Invalid market caps' as check_name,
  COUNT(*) as count
FROM trades_unified
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND (market_cap_usd < 0 OR market_cap_usd > 1000000);
```

## Success Criteria

### ✅ MUST PASS
1. **Uptime**: 60 minutes without crash
2. **Data Loss**: 0% (all trades above threshold saved)
3. **Reconnections**: ≤ 1 (network resilience)
4. **Memory Leaks**: None (stable memory usage)
5. **Database Errors**: 0 duplicate constraints

### ✅ SHOULD PASS
1. **Parse Success Rate**: > 93%
2. **Trade Detection Rate**: > 95%
3. **Cache Hit Rate**: > 80%
4. **Batch Processing**: < 100ms average
5. **Graduation Detection**: 100% accuracy

### ✅ PERFORMANCE TARGETS
1. **Transactions/Hour**: > 7,000
2. **Unique Tokens**: > 800
3. **Trades Saved**: > 3,000
4. **Memory Usage**: < 500MB
5. **CPU Usage**: < 10%

## Test Report Template

```markdown
# BC Monitor 1-Hour Test Report

**Date**: [DATE]
**Start Time**: [TIME]
**End Time**: [TIME]
**Duration**: 60 minutes

## Executive Summary
- Overall Result: PASS/FAIL
- Uptime: 100%
- Transactions Processed: X,XXX
- Tokens Discovered: XXX
- Graduations Detected: XX

## Detailed Results

### Connection Stability
- Disconnections: 0
- Reconnections: 0
- Average Latency: XXms
- Stream Health: 100%

### Data Processing
- Parse Success Rate: XX.X%
- Trade Detection Rate: XX.X%
- Error Rate: X.X%
- Batch Processing Avg: XXms

### Database Performance
- Tokens Saved: XXX
- Trades Saved: X,XXX
- Cache Hit Rate: XX%
- Query Performance: XXms avg

### System Resources
- Peak Memory: XXXMB
- Average CPU: X.X%
- Network Bandwidth: XX KB/s
- Disk I/O: Minimal

### Notable Events
- Graduations: [List mint addresses]
- Highest Market Cap: $XX,XXX
- Errors: [List any errors]

## Recommendations
1. [Performance optimizations if needed]
2. [Error handling improvements]
3. [Scaling considerations]
```

## Automated Test Script

Create `test-bc-monitor.sh`:
```bash
#!/bin/bash

# BC Monitor 1-Hour Test Script
TEST_DIR="logs/bc-monitor-test"
START_TIME=$(date +"%Y-%m-%d %H:%M:%S")
LOG_FILE="$TEST_DIR/test_$(date +%Y%m%d_%H%M%S).log"

echo "Starting BC Monitor 1-Hour Test at $START_TIME"
echo "Log file: $LOG_FILE"

# Create test directory
mkdir -p $TEST_DIR

# Record initial state
echo "=== Initial Database State ===" >> $LOG_FILE
psql $DATABASE_URL -c "SELECT COUNT(*) as tokens FROM tokens_unified" >> $LOG_FILE 2>&1

# Start monitor with timeout
timeout 3600 npm run bc-monitor 2>&1 | tee -a $LOG_FILE &
MONITOR_PID=$!

# Monitor checkpoints
for i in {1..6}; do
  sleep 600  # 10 minutes
  echo -e "\n=== ${i}0-Minute Checkpoint ===" >> $LOG_FILE
  ps -p $MONITOR_PID > /dev/null && echo "Monitor still running" >> $LOG_FILE || echo "Monitor stopped!" >> $LOG_FILE
  
  # Log system stats
  echo "Memory: $(ps -o rss= -p $MONITOR_PID 2>/dev/null || echo 'N/A') KB" >> $LOG_FILE
done

# Wait for completion
wait $MONITOR_PID

# Final analysis
echo -e "\n=== Test Complete ===" >> $LOG_FILE
echo "End time: $(date +"%Y-%m-%d %H:%M:%S")" >> $LOG_FILE

# Generate summary
./analyze-test-results.sh $LOG_FILE
```

## Quick Test (5 minutes)
For rapid validation after changes:
```bash
# 5-minute smoke test
timeout 300 npm run bc-monitor | grep -E "(Statistics:|GRADUATION|error|Error)"
```