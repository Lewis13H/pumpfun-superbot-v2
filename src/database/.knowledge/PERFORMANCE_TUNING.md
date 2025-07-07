# Performance Tuning Guide

## Overview
This guide provides detailed performance tuning strategies for the pumpfun-superbot-v2 PostgreSQL database, focusing on query optimization, index strategies, and system configuration.

## Query Performance Analysis

### 1. Identifying Slow Queries

#### Enable Query Logging
```sql
-- In postgresql.conf
log_min_duration_statement = 100  -- Log queries taking > 100ms
log_statement = 'all'
log_duration = on
```

#### Using pg_stat_statements
```sql
-- Most time-consuming queries
SELECT 
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    min_exec_time,
    max_exec_time,
    stddev_exec_time,
    rows
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY total_exec_time DESC
LIMIT 20;

-- Queries with high variance (unstable performance)
SELECT 
    query,
    calls,
    mean_exec_time,
    stddev_exec_time,
    stddev_exec_time / NULLIF(mean_exec_time, 0) as coeff_variation
FROM pg_stat_statements
WHERE calls > 100
ORDER BY coeff_variation DESC
LIMIT 20;
```

### 2. Query Optimization Techniques

#### Optimize Token List Query
```sql
-- Original slow query
SELECT * FROM tokens_unified 
WHERE graduated_to_amm = false 
AND is_stale = false 
ORDER BY latest_market_cap_usd DESC;

-- Optimized with partial index
CREATE INDEX idx_active_bc_tokens ON tokens_unified(latest_market_cap_usd DESC)
WHERE graduated_to_amm = false AND is_stale = false AND should_remove = false;

-- Query now uses index efficiently
EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    mint_address,
    symbol,
    name,
    latest_price_usd,
    latest_market_cap_usd
FROM tokens_unified 
WHERE graduated_to_amm = false 
AND is_stale = false 
AND should_remove = false
ORDER BY latest_market_cap_usd DESC
LIMIT 100;
```

#### Optimize 24h Volume Calculation
```sql
-- Slow: Calculates on every request
SELECT 
    t.*,
    (SELECT SUM(volume_usd) FROM trades_unified 
     WHERE mint_address = t.mint_address 
     AND block_time >= NOW() - INTERVAL '24 hours') as volume_24h
FROM tokens_unified t;

-- Fast: Pre-aggregated with trigger
CREATE OR REPLACE FUNCTION update_24h_volume()
RETURNS void AS $$
BEGIN
    UPDATE tokens_unified t
    SET volume_24h_usd = COALESCE(v.total_volume, 0),
        unique_traders_24h = COALESCE(v.unique_traders, 0)
    FROM (
        SELECT 
            mint_address,
            SUM(volume_usd) as total_volume,
            COUNT(DISTINCT user_address) as unique_traders
        FROM trades_unified
        WHERE block_time >= NOW() - INTERVAL '24 hours'
        GROUP BY mint_address
    ) v
    WHERE t.mint_address = v.mint_address;
END;
$$ LANGUAGE plpgsql;
```

## Index Optimization Strategies

### 1. Index Analysis

#### Find Missing Indexes
```sql
-- Tables with sequential scans
SELECT 
    schemaname,
    tablename,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    CASE WHEN seq_scan + idx_scan > 0 
         THEN 100.0 * idx_scan / (seq_scan + idx_scan) 
         ELSE 0 END AS index_usage_percent
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC;

-- Find duplicate indexes
SELECT 
    pg_size_pretty(SUM(pg_relation_size(idx))::BIGINT) AS SIZE,
    (array_agg(idx))[1] AS idx1,
    (array_agg(idx))[2] AS idx2,
    (array_agg(idx))[3] AS idx3,
    (array_agg(idx))[4] AS idx4
FROM (
    SELECT 
        indexrelid::regclass AS idx,
        (indrelid::text ||E'\n'|| indclass::text ||E'\n'|| 
         indkey::text ||E'\n'|| COALESCE(indexprs::text,'') ||E'\n'|| 
         COALESCE(indpred::text,'')) AS KEY
    FROM pg_index
) sub
GROUP BY KEY 
HAVING COUNT(*) > 1
ORDER BY SUM(pg_relation_size(idx)) DESC;
```

### 2. Strategic Index Creation

#### Multi-Column Indexes
```sql
-- For common filter + sort combinations
CREATE INDEX idx_tokens_filter_sort ON tokens_unified(
    graduated_to_amm,
    is_stale,
    latest_market_cap_usd DESC
) WHERE should_remove = false;

-- For join + filter operations
CREATE INDEX idx_trades_join_filter ON trades_unified(
    mint_address,
    block_time DESC,
    trade_type
) WHERE volume_usd > 100;
```

#### Covering Indexes (Include Columns)
```sql
-- Avoid table lookups
CREATE INDEX idx_trades_covering ON trades_unified(
    mint_address,
    block_time DESC
) INCLUDE (
    user_address,
    volume_usd,
    price_usd
);
```

### 3. Index Maintenance

#### Regular Reindexing
```sql
-- Rebuild bloated indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    idx_scan as number_of_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE pg_relation_size(indexrelid) > 100000000  -- Indexes > 100MB
ORDER BY pg_relation_size(indexrelid) DESC;

-- Rebuild concurrently (no downtime)
REINDEX INDEX CONCURRENTLY idx_trades_block_time;
```

## Table Optimization

### 1. Partitioning Strategy

#### Time-Based Partitioning for trades_unified
```sql
-- Create partitioned table
CREATE TABLE trades_unified_new (
    LIKE trades_unified INCLUDING ALL
) PARTITION BY RANGE (block_time);

-- Create monthly partitions
CREATE TABLE trades_unified_2025_01 
PARTITION OF trades_unified_new
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Auto-create future partitions
CREATE OR REPLACE FUNCTION create_monthly_partition()
RETURNS void AS $$
DECLARE
    start_date date;
    end_date date;
    partition_name text;
BEGIN
    start_date := date_trunc('month', CURRENT_DATE + interval '1 month');
    end_date := start_date + interval '1 month';
    partition_name := 'trades_unified_' || to_char(start_date, 'YYYY_MM');
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF trades_unified_new 
                    FOR VALUES FROM (%L) TO (%L)',
                    partition_name, start_date, end_date);
END;
$$ LANGUAGE plpgsql;
```

### 2. Table Statistics

#### Update Table Statistics
```sql
-- Set custom statistics targets for important columns
ALTER TABLE tokens_unified ALTER COLUMN latest_market_cap_usd SET STATISTICS 1000;
ALTER TABLE tokens_unified ALTER COLUMN graduated_to_amm SET STATISTICS 100;
ALTER TABLE trades_unified ALTER COLUMN mint_address SET STATISTICS 500;

-- Analyze with new statistics
ANALYZE tokens_unified;
ANALYZE trades_unified;
```

### 3. Storage Optimization

#### TOAST Tuning
```sql
-- For tables with large text/jsonb columns
ALTER TABLE tokens_unified ALTER COLUMN description SET STORAGE EXTERNAL;
ALTER TABLE tokens_unified ALTER COLUMN helius_metadata SET STORAGE EXTERNAL;

-- Check TOAST usage
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - 
                   pg_relation_size(schemaname||'.'||tablename)) AS toast_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## PostgreSQL Configuration Tuning

### 1. Memory Settings
```ini
# postgresql.conf optimizations for 16GB RAM server

# Shared memory
shared_buffers = 4GB              # 25% of RAM
effective_cache_size = 12GB       # 75% of RAM
work_mem = 64MB                   # RAM per sort/hash
maintenance_work_mem = 1GB        # For VACUUM, indexes

# Write performance
wal_buffers = 16MB
checkpoint_completion_target = 0.9
max_wal_size = 4GB
min_wal_size = 1GB
```

### 2. Query Planner
```ini
# Planner cost settings
random_page_cost = 1.1           # SSD optimization
effective_io_concurrency = 200   # SSD parallel I/O
default_statistics_target = 100  # Default sample size

# Parallel query
max_parallel_workers_per_gather = 4
max_parallel_workers = 8
parallel_setup_cost = 100
parallel_tuple_cost = 0.01
```

### 3. Connection Management
```ini
# Connection settings
max_connections = 200
superuser_reserved_connections = 3

# Connection pooling (pgBouncer recommended)
# pgbouncer.ini
[databases]
pump_monitor = host=localhost port=5432 dbname=pump_monitor

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
```

## Monitoring & Alerts

### 1. Performance Metrics Dashboard
```sql
-- Create monitoring views
CREATE VIEW db_performance_metrics AS
SELECT 
    'cache_hit_ratio' as metric,
    round(100.0 * sum(heap_blks_hit) / 
          NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) as value
FROM pg_statio_user_tables
UNION ALL
SELECT 
    'index_usage_ratio',
    round(100.0 * sum(idx_scan) / NULLIF(sum(seq_scan + idx_scan), 0), 2)
FROM pg_stat_user_tables
UNION ALL
SELECT 
    'table_bloat_mb',
    round(sum(pg_total_relation_size(oid) - pg_relation_size(oid)) / 1024 / 1024)
FROM pg_class
WHERE relkind = 'r';
```

### 2. Automated Alerts
```sql
-- Alert on slow queries
CREATE OR REPLACE FUNCTION alert_slow_queries()
RETURNS void AS $$
DECLARE
    slow_query RECORD;
BEGIN
    FOR slow_query IN 
        SELECT query, mean_exec_time
        FROM pg_stat_statements
        WHERE mean_exec_time > 1000  -- queries > 1 second
        AND calls > 10
    LOOP
        -- Log to alert table or send notification
        INSERT INTO performance_alerts (alert_type, details, created_at)
        VALUES ('slow_query', slow_query::text, CURRENT_TIMESTAMP);
    END LOOP;
END;
$$ LANGUAGE plpgsql;
```

## Query Optimization Examples

### 1. Token Discovery Query
```sql
-- Before optimization: 2.5 seconds
SELECT DISTINCT ON (t.mint_address)
    t.*,
    tr.block_time as last_trade_time,
    tr.price_usd as last_price
FROM tokens_unified t
LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
WHERE t.first_seen_at > NOW() - INTERVAL '1 hour'
ORDER BY t.mint_address, tr.block_time DESC;

-- After optimization: 0.05 seconds
WITH latest_trades AS (
    SELECT DISTINCT ON (mint_address)
        mint_address,
        block_time,
        price_usd
    FROM trades_unified
    WHERE block_time > NOW() - INTERVAL '1 hour'
    ORDER BY mint_address, block_time DESC
)
SELECT 
    t.*,
    lt.block_time as last_trade_time,
    lt.price_usd as last_price
FROM tokens_unified t
LEFT JOIN latest_trades lt ON t.mint_address = lt.mint_address
WHERE t.first_seen_at > NOW() - INTERVAL '1 hour';
```

### 2. Liquidity Analysis Query
```sql
-- Before: Multiple scans
SELECT 
    p.pool_address,
    SUM(CASE WHEN l.event_type = 'add' THEN l.total_value_usd ELSE 0 END) as total_added,
    SUM(CASE WHEN l.event_type = 'remove' THEN l.total_value_usd ELSE 0 END) as total_removed
FROM amm_pool_state p
LEFT JOIN liquidity_events l ON p.pool_address = l.pool_address
GROUP BY p.pool_address;

-- After: Single scan with filter
CREATE INDEX idx_liquidity_events_type ON liquidity_events(pool_address, event_type, total_value_usd);

SELECT 
    pool_address,
    SUM(total_value_usd) FILTER (WHERE event_type = 'add') as total_added,
    SUM(total_value_usd) FILTER (WHERE event_type = 'remove') as total_removed
FROM liquidity_events
GROUP BY pool_address;
```

## Best Practices Summary

1. **Always EXPLAIN ANALYZE** before deploying new queries
2. **Monitor pg_stat_statements** weekly for regression
3. **Use partial indexes** for filtered queries
4. **Partition large tables** by time
5. **Update statistics** after major data changes
6. **Set work_mem** appropriately for sort-heavy queries
7. **Use connection pooling** to reduce overhead
8. **Regular VACUUM** to prevent bloat
9. **Archive old data** to maintain performance
10. **Test with production-size data** in staging