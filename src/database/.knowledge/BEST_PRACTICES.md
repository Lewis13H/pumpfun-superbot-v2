# Database Best Practices Guide

## Overview
This guide outlines best practices for working with the pumpfun-superbot-v2 database, ensuring optimal performance, data integrity, and maintainability.

## Development Best Practices

### 1. Query Writing Standards

#### Always Use Explicit Column Lists
```sql
-- ❌ Bad: Avoid SELECT *
SELECT * FROM tokens_unified WHERE graduated_to_amm = true;

-- ✅ Good: Explicit columns
SELECT 
    mint_address,
    symbol,
    name,
    latest_market_cap_usd,
    graduated_to_amm
FROM tokens_unified 
WHERE graduated_to_amm = true;
```

#### Use Proper Join Types
```sql
-- ✅ Use LEFT JOIN for optional relationships
SELECT 
    t.symbol,
    t.latest_price_usd,
    p.pool_address
FROM tokens_unified t
LEFT JOIN amm_pool_state p ON t.mint_address = p.mint_address;

-- ✅ Use INNER JOIN when relationship must exist
SELECT 
    t.mint_address,
    tr.volume_usd
FROM trades_unified tr
INNER JOIN tokens_unified t ON tr.mint_address = t.mint_address;
```

#### Optimize for Pagination
```sql
-- ❌ Bad: OFFSET gets slower with larger values
SELECT * FROM tokens_unified 
ORDER BY latest_market_cap_usd DESC 
LIMIT 20 OFFSET 1000;

-- ✅ Good: Keyset pagination
SELECT * FROM tokens_unified 
WHERE latest_market_cap_usd < $1  -- Last value from previous page
ORDER BY latest_market_cap_usd DESC 
LIMIT 20;
```

### 2. Index Usage Best Practices

#### Check Query Plans
```sql
-- Always EXPLAIN your queries before production
EXPLAIN (ANALYZE, BUFFERS) 
SELECT COUNT(DISTINCT user_address) 
FROM trades_unified 
WHERE mint_address = 'ABC123' 
AND block_time >= NOW() - INTERVAL '24 hours';
```

#### Create Covering Indexes
```sql
-- ✅ Good: Index covers all needed columns
CREATE INDEX idx_trades_mint_time_user 
ON trades_unified(mint_address, block_time DESC) 
INCLUDE (user_address);
```

#### Use Partial Indexes
```sql
-- ✅ Good: Index only relevant rows
CREATE INDEX idx_active_tokens 
ON tokens_unified(latest_market_cap_usd DESC) 
WHERE is_stale = false AND should_remove = false;
```

### 3. Transaction Management

#### Use Appropriate Isolation Levels
```sql
-- For read-heavy operations
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- Your queries here
COMMIT;

-- For reports that need consistency
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- Your report queries here
COMMIT;
```

#### Keep Transactions Short
```sql
-- ❌ Bad: Long transaction
BEGIN;
SELECT * FROM tokens_unified;
-- Processing in application... (slow)
UPDATE tokens_unified SET ...;
COMMIT;

-- ✅ Good: Short transaction
-- Do processing outside transaction
BEGIN;
UPDATE tokens_unified SET ... WHERE mint_address = ANY($1);
COMMIT;
```

### 4. Data Insertion Patterns

#### Batch Inserts
```sql
-- ❌ Bad: Individual inserts
INSERT INTO trades_unified (...) VALUES (...);
INSERT INTO trades_unified (...) VALUES (...);

-- ✅ Good: Batch insert
INSERT INTO trades_unified (signature, mint_address, ...) 
VALUES 
    ('sig1', 'mint1', ...),
    ('sig2', 'mint2', ...),
    ('sig3', 'mint3', ...)
ON CONFLICT (signature) DO NOTHING;
```

#### Use COPY for Bulk Data
```sql
-- ✅ Best for large imports
COPY trades_unified (signature, mint_address, trade_type, ...) 
FROM '/tmp/trades.csv' 
WITH (FORMAT csv, HEADER true);
```

## Monitoring & Maintenance

### 1. Regular Health Checks

#### Monitor Table Sizes
```sql
-- Check table sizes weekly
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_stat_user_tables.n_live_tup as row_estimate
FROM pg_tables
JOIN pg_stat_user_tables ON pg_tables.tablename = pg_stat_user_tables.relname
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Check Index Usage
```sql
-- Find unused indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### 2. Performance Monitoring

#### Track Slow Queries
```sql
-- Enable pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find slow queries
SELECT 
    substring(query, 1, 100) as query_preview,
    calls,
    total_exec_time,
    mean_exec_time,
    stddev_exec_time,
    rows
FROM pg_stat_statements
WHERE mean_exec_time > 100  -- queries taking > 100ms
ORDER BY mean_exec_time DESC
LIMIT 20;
```

#### Monitor Lock Contention
```sql
-- Check for blocking queries
SELECT 
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_statement,
    blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.relation = blocked_locks.relation
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

### 3. Maintenance Tasks

#### Regular VACUUM
```sql
-- Analyze and vacuum important tables daily
VACUUM ANALYZE tokens_unified;
VACUUM ANALYZE trades_unified;
VACUUM ANALYZE amm_pool_state;

-- Full vacuum monthly (requires downtime)
VACUUM FULL tokens_unified;
```

#### Update Statistics
```sql
-- Update planner statistics
ANALYZE tokens_unified;
ANALYZE trades_unified;
ANALYZE amm_pool_state;
```

## Data Integrity Practices

### 1. Use Constraints Wisely
```sql
-- Add constraints to enforce business rules
ALTER TABLE tokens_unified
ADD CONSTRAINT chk_graduation_logic 
CHECK (
    (graduated_to_amm = false) OR 
    (graduated_to_amm = true AND graduation_at IS NOT NULL)
);
```

### 2. Implement Soft Deletes
```sql
-- Don't DELETE, mark for removal
UPDATE tokens_unified 
SET should_remove = true,
    updated_at = CURRENT_TIMESTAMP
WHERE mint_address = 'ABC123';

-- Archive before hard delete
INSERT INTO tokens_archive 
SELECT * FROM tokens_unified 
WHERE should_remove = true 
AND updated_at < NOW() - INTERVAL '30 days';
```

### 3. Audit Critical Changes
```sql
-- Log important updates
CREATE OR REPLACE FUNCTION log_critical_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.graduated_to_amm != NEW.graduated_to_amm THEN
        INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value)
        VALUES ('tokens_unified', NEW.mint_address, 'graduated_to_amm', 
                OLD.graduated_to_amm::text, NEW.graduated_to_amm::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## Common Patterns & Solutions

### 1. Getting Latest Token Prices
```sql
-- ✅ Efficient: Use denormalized fields
SELECT 
    symbol,
    latest_price_usd,
    latest_market_cap_usd
FROM tokens_unified
WHERE is_stale = false
ORDER BY latest_market_cap_usd DESC
LIMIT 100;
```

### 2. Calculating 24h Volume
```sql
-- ✅ Use materialized view (refreshed every 5 min)
SELECT * FROM token_metrics_24h
WHERE mint_address = 'ABC123';

-- Or calculate on-demand for specific token
WITH volume_calc AS (
    SELECT 
        SUM(volume_usd) as volume_24h,
        COUNT(DISTINCT user_address) as unique_traders
    FROM trades_unified
    WHERE mint_address = 'ABC123'
    AND block_time >= NOW() - INTERVAL '24 hours'
)
UPDATE tokens_unified t
SET volume_24h_usd = v.volume_24h,
    unique_traders_24h = v.unique_traders
FROM volume_calc v
WHERE t.mint_address = 'ABC123';
```

### 3. Finding Graduated Tokens
```sql
-- ✅ Use indexed boolean flag
SELECT 
    t.*,
    p.pool_address,
    p.virtual_sol_reserves
FROM tokens_unified t
JOIN amm_pool_state p ON t.mint_address = p.mint_address
WHERE t.graduated_to_amm = true
AND t.latest_market_cap_usd > 10000
ORDER BY t.graduation_at DESC;
```

### 4. Tracking Creator Performance
```sql
-- ✅ Use pre-calculated creator_analysis
SELECT 
    ca.*,
    COUNT(t.mint_address) as active_tokens
FROM creator_analysis ca
LEFT JOIN tokens_unified t ON ca.creator_address = t.creator
    AND t.is_stale = false
GROUP BY ca.creator_address
ORDER BY ca.successful_graduations DESC;
```

## Security Best Practices

### 1. Use Parameterized Queries
```javascript
// ❌ Bad: SQL injection vulnerable
const query = `SELECT * FROM tokens_unified WHERE symbol = '${userInput}'`;

// ✅ Good: Parameterized
const query = 'SELECT * FROM tokens_unified WHERE symbol = $1';
const values = [userInput];
```

### 2. Principle of Least Privilege
```sql
-- Create read-only user for dashboard
CREATE USER dashboard_user WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE pump_monitor TO dashboard_user;
GRANT USAGE ON SCHEMA public TO dashboard_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_user;

-- Create write user for monitors
CREATE USER monitor_user WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE pump_monitor TO monitor_user;
GRANT ALL ON SCHEMA public TO monitor_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO monitor_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO monitor_user;
```

### 3. Encrypt Sensitive Data
```sql
-- Use pgcrypto for sensitive fields
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Example: Encrypt user addresses
ALTER TABLE trades_unified 
ADD COLUMN user_address_encrypted BYTEA;

UPDATE trades_unified 
SET user_address_encrypted = pgp_sym_encrypt(user_address, 'encryption_key');
```

## Disaster Recovery

### 1. Regular Backups
```bash
# Daily logical backup
pg_dump -h localhost -U pump_user -d pump_monitor -f backup_$(date +%Y%m%d).sql

# Continuous archiving with WAL
# In postgresql.conf:
archive_mode = on
archive_command = 'cp %p /backup/wal/%f'
```

### 2. Test Recovery Procedures
```sql
-- Regular recovery drills
-- 1. Restore to test server
-- 2. Verify data integrity
-- 3. Document recovery time
```

### 3. Monitor Replication Lag
```sql
-- Check replication status
SELECT 
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    write_lag,
    flush_lag,
    replay_lag
FROM pg_stat_replication;
```

## Performance Optimization Checklist

### Before Deployment
- [ ] EXPLAIN all new queries
- [ ] Add appropriate indexes
- [ ] Test with production-size data
- [ ] Check for N+1 query patterns
- [ ] Verify connection pooling

### Weekly Checks
- [ ] Review slow query log
- [ ] Check table and index bloat
- [ ] Verify backup completion
- [ ] Monitor disk space
- [ ] Update table statistics

### Monthly Tasks
- [ ] Full VACUUM on large tables
- [ ] Review and drop unused indexes
- [ ] Archive old data
- [ ] Update PostgreSQL statistics
- [ ] Review security permissions