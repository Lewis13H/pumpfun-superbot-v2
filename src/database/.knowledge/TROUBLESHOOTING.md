# Database Troubleshooting Guide

## Overview
This guide provides solutions to common database issues encountered in the pumpfun-superbot-v2 system, with step-by-step debugging approaches and fixes.

## Common Issues & Solutions

### 1. Foreign Key Constraint Violations

#### Problem: "trades_unified_mint_address_fkey" violation
```
ERROR: insert or update on table "trades_unified" violates foreign key constraint "trades_unified_mint_address_fkey"
DETAIL: Key (mint_address)=(ABC123) is not present in table "tokens_unified".
```

#### Solution:
```sql
-- Check if trigger exists
SELECT * FROM pg_trigger WHERE tgname = 'ensure_token_exists';

-- If missing, recreate the trigger
CREATE OR REPLACE FUNCTION create_token_if_not_exists()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO tokens_unified (mint_address, symbol, name, first_seen_at, first_program)
    VALUES (NEW.mint_address, 'UNKNOWN', 'Unknown Token', CURRENT_TIMESTAMP, NEW.program)
    ON CONFLICT (mint_address) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_token_exists
BEFORE INSERT ON trades_unified
FOR EACH ROW EXECUTE FUNCTION create_token_if_not_exists();

-- Fix existing orphaned trades
INSERT INTO tokens_unified (mint_address, symbol, name, first_seen_at)
SELECT DISTINCT t.mint_address, 'UNKNOWN', 'Unknown Token', MIN(t.created_at)
FROM trades_unified t
WHERE NOT EXISTS (SELECT 1 FROM tokens_unified tok WHERE tok.mint_address = t.mint_address)
GROUP BY t.mint_address;
```

### 2. Duplicate Key Violations

#### Problem: Duplicate signature in trades
```
ERROR: duplicate key value violates unique constraint "trades_unified_signature_key"
DETAIL: Key (signature)=(5abc...) already exists.
```

#### Solution:
```sql
-- Use ON CONFLICT for inserts
INSERT INTO trades_unified (signature, mint_address, ...)
VALUES ($1, $2, ...)
ON CONFLICT (signature) DO UPDATE SET
    updated_at = CURRENT_TIMESTAMP
WHERE trades_unified.signature = EXCLUDED.signature;

-- Find and remove duplicates
WITH duplicates AS (
    SELECT signature, 
           ROW_NUMBER() OVER (PARTITION BY signature ORDER BY created_at DESC) as rn
    FROM trades_unified
)
DELETE FROM trades_unified
WHERE signature IN (
    SELECT signature FROM duplicates WHERE rn > 1
);
```

### 3. Decimal Precision Errors

#### Problem: Token prices showing as $0.00
```
-- Prices stored as DECIMAL(20,4) lose precision for small values
```

#### Solution:
```sql
-- Check current precision
SELECT 
    column_name,
    data_type,
    numeric_precision,
    numeric_scale
FROM information_schema.columns
WHERE table_name = 'tokens_unified'
AND column_name LIKE '%price%';

-- Fix precision
ALTER TABLE tokens_unified
ALTER COLUMN latest_price_usd TYPE DECIMAL(30,12),
ALTER COLUMN first_price_usd TYPE DECIMAL(30,12);

-- Recalculate USD prices from SOL prices
UPDATE tokens_unified t
SET latest_price_usd = t.latest_price_sol * s.price
FROM (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1) s
WHERE t.latest_price_sol IS NOT NULL;
```

### 4. Stale Price Data

#### Problem: Tokens showing outdated prices
```
-- is_stale flag not updating correctly
-- last_trade_at not being maintained
```

#### Solution:
```sql
-- Manually update stale flags
UPDATE tokens_unified
SET is_stale = true,
    stale_marked_at = CURRENT_TIMESTAMP
WHERE last_trade_at < NOW() - INTERVAL '1 hour'
AND is_stale = false;

-- Fix trigger if not working
CREATE OR REPLACE FUNCTION update_token_latest_prices()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE tokens_unified
    SET latest_price_sol = NEW.price_sol,
        latest_price_usd = NEW.price_usd,
        latest_market_cap_usd = NEW.market_cap_usd,
        last_trade_at = NEW.block_time,
        is_stale = false,
        latest_update_slot = NEW.slot
    WHERE mint_address = NEW.mint_address;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Check trigger is active
SELECT * FROM pg_trigger WHERE tgname = 'trigger_update_token_latest_prices';
```

### 5. Slow Query Performance

#### Problem: Dashboard queries timing out
```
-- Queries taking > 5 seconds
-- High CPU usage during queries
```

#### Solution:
```sql
-- Identify slow queries
SELECT 
    query,
    calls,
    mean_exec_time,
    total_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 1000
ORDER BY mean_exec_time DESC;

-- Check missing indexes
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats
WHERE tablename = 'tokens_unified'
AND n_distinct > 100
AND schemaname = 'public'
ORDER BY n_distinct DESC;

-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_tokens_active_market_cap 
ON tokens_unified(latest_market_cap_usd DESC)
WHERE is_stale = false AND should_remove = false;

-- Update table statistics
ANALYZE tokens_unified;
ANALYZE trades_unified;
```

### 6. Database Connection Errors

#### Problem: "too many connections" error
```
FATAL: remaining connection slots are reserved for non-replication superuser connections
```

#### Solution:
```sql
-- Check current connections
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    state,
    query_start,
    state_change
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start;

-- Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
AND state_change < CURRENT_TIMESTAMP - INTERVAL '10 minutes';

-- Increase connection limit (requires restart)
-- In postgresql.conf:
-- max_connections = 200

-- Better solution: Use connection pooling
-- Install pgBouncer and configure pool settings
```

### 7. Disk Space Issues

#### Problem: "could not extend file" errors
```
ERROR: could not extend file "base/16384/24692": No space left on device
```

#### Solution:
```sql
-- Check table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Clean up old data
DELETE FROM price_snapshots_unified
WHERE created_at < NOW() - INTERVAL '30 days';

DELETE FROM trades_unified
WHERE block_time < NOW() - INTERVAL '90 days'
AND mint_address IN (
    SELECT mint_address FROM tokens_unified WHERE should_remove = true
);

-- VACUUM to reclaim space
VACUUM FULL VERBOSE trades_unified;
VACUUM FULL VERBOSE price_snapshots_unified;

-- Check for bloated indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- Rebuild bloated indexes
REINDEX INDEX CONCURRENTLY idx_trades_block_time;
```

### 8. Transaction Lock Issues

#### Problem: Queries hanging indefinitely
```
-- Blocked by locks from other transactions
```

#### Solution:
```sql
-- Find blocking queries
SELECT 
    blocked.pid AS blocked_pid,
    blocked.usename AS blocked_user,
    blocking.pid AS blocking_pid,
    blocking.usename AS blocking_user,
    blocked.query AS blocked_query,
    blocking.query AS blocking_query
FROM pg_locks blocked_locks
JOIN pg_stat_activity blocked ON blocked.pid = blocked_locks.pid
JOIN pg_locks blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.relation = blocked_locks.relation
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_stat_activity blocking ON blocking.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- Kill blocking query if safe
SELECT pg_cancel_backend(blocking_pid);  -- Gentle cancel
SELECT pg_terminate_backend(blocking_pid);  -- Force kill

-- Set lock timeout for applications
SET lock_timeout = '10s';
```

### 9. Data Integrity Issues

#### Problem: Inconsistent graduation status
```
-- Token shows graduated_to_amm = false but has AMM trades
```

#### Solution:
```sql
-- Find inconsistent tokens
SELECT t.mint_address, t.graduated_to_amm, COUNT(tr.id) as amm_trades
FROM tokens_unified t
JOIN trades_unified tr ON t.mint_address = tr.mint_address
WHERE tr.program = 'amm_pool'
AND t.graduated_to_amm = false
GROUP BY t.mint_address, t.graduated_to_amm;

-- Fix graduation status
UPDATE tokens_unified t
SET graduated_to_amm = true,
    graduation_at = COALESCE(graduation_at, first_amm.block_time),
    current_program = 'amm_pool'
FROM (
    SELECT mint_address, MIN(block_time) as block_time
    FROM trades_unified
    WHERE program = 'amm_pool'
    GROUP BY mint_address
) first_amm
WHERE t.mint_address = first_amm.mint_address
AND t.graduated_to_amm = false;
```

### 10. UTF-8 Encoding Errors

#### Problem: "invalid byte sequence for encoding UTF8"
```
ERROR: invalid byte sequence for encoding "UTF8": 0x00
```

#### Solution:
```sql
-- Create sanitization function
CREATE OR REPLACE FUNCTION sanitize_utf8(input_text TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Remove null bytes and invalid UTF-8
    RETURN regexp_replace(
        convert_from(
            convert_to(input_text, 'UTF8', 'IGNORE'), 
            'UTF8'
        ), 
        '[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]', 
        '', 
        'g'
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Return cleaned ASCII if UTF-8 fails
        RETURN regexp_replace(input_text, '[^\x20-\x7E]', '', 'g');
END;
$$ LANGUAGE plpgsql;

-- Apply to data before insert
INSERT INTO tokens_unified (symbol, name, description)
VALUES (
    sanitize_utf8($1),
    sanitize_utf8($2),
    sanitize_utf8($3)
);
```

## Diagnostic Queries

### System Health Check
```sql
-- Overall database health
SELECT 
    'Database Size' as metric,
    pg_size_pretty(pg_database_size(current_database())) as value
UNION ALL
SELECT 
    'Cache Hit Ratio',
    round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2)::text || '%'
FROM pg_statio_user_tables
UNION ALL
SELECT 
    'Active Connections',
    count(*)::text
FROM pg_stat_activity
WHERE state = 'active'
UNION ALL
SELECT 
    'Longest Running Query',
    max(extract(epoch from (now() - query_start)))::text || ' seconds'
FROM pg_stat_activity
WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%';
```

### Table Health Check
```sql
-- Check for table issues
WITH table_stats AS (
    SELECT 
        schemaname,
        tablename,
        n_live_tup,
        n_dead_tup,
        n_dead_tup::float / NULLIF(n_live_tup, 0) as dead_ratio,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
    FROM pg_stat_user_tables
)
SELECT 
    tablename,
    n_live_tup as live_rows,
    n_dead_tup as dead_rows,
    round(dead_ratio * 100, 2) as dead_percent,
    age(last_vacuum) as since_vacuum,
    age(last_analyze) as since_analyze
FROM table_stats
WHERE schemaname = 'public'
ORDER BY dead_ratio DESC;
```

## Preventive Maintenance

### Daily Tasks
```sql
-- Update statistics
ANALYZE tokens_unified;
ANALYZE trades_unified;

-- Check for issues
SELECT * FROM db_performance_metrics;
```

### Weekly Tasks
```sql
-- Full vacuum small tables
VACUUM ANALYZE tokens_unified;
VACUUM ANALYZE amm_pool_state;

-- Check index usage
SELECT 
    indexrelname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND indexrelname NOT LIKE '%pkey%';
```

### Monthly Tasks
```sql
-- Reindex large tables
REINDEX TABLE CONCURRENTLY trades_unified;
REINDEX TABLE CONCURRENTLY price_snapshots_unified;

-- Archive old data
INSERT INTO trades_archive
SELECT * FROM trades_unified
WHERE block_time < NOW() - INTERVAL '6 months';

DELETE FROM trades_unified
WHERE block_time < NOW() - INTERVAL '6 months';
```

## Emergency Procedures

### Database Recovery
```bash
# If database corrupted
# 1. Stop application
# 2. Backup current state
pg_dump -h localhost -d pump_monitor -f emergency_backup.sql

# 3. Check for corruption
postgres -D /var/lib/postgresql/data --single pump_monitor
REINDEX DATABASE pump_monitor;

# 4. If severe, restore from backup
psql -h localhost -d pump_monitor -f last_good_backup.sql
```

### Performance Emergency
```sql
-- Kill all queries except this session
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid != pg_backend_pid()
AND state = 'active';

-- Reset connections
ALTER SYSTEM SET max_connections = 50;
SELECT pg_reload_conf();

-- Emergency VACUUM
SET vacuum_cost_limit = 0;
VACUUM ANALYZE;
```

## Monitoring Alerts Setup

### Create Alert Functions
```sql
-- High connection alert
CREATE OR REPLACE FUNCTION check_connection_limit()
RETURNS boolean AS $$
DECLARE
    current_connections integer;
    max_connections integer;
BEGIN
    SELECT count(*) INTO current_connections FROM pg_stat_activity;
    SELECT setting::integer INTO max_connections FROM pg_settings WHERE name = 'max_connections';
    
    IF current_connections > max_connections * 0.8 THEN
        INSERT INTO system_alerts (alert_type, severity, message)
        VALUES ('connections', 'warning', 
                format('High connection count: %s of %s', current_connections, max_connections));
        RETURN true;
    END IF;
    RETURN false;
END;
$$ LANGUAGE plpgsql;
```