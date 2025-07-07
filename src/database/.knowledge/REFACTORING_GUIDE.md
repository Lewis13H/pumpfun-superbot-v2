# SQL Refactoring Guide

## Overview
This guide provides comprehensive refactoring recommendations for the pumpfun-superbot-v2 database, focusing on performance, maintainability, and scalability improvements.

## Priority 1: Critical Refactoring (Immediate Impact)

### 1.1 Consolidate Duplicate Price Columns
**Issue**: Multiple price columns store the same data
```sql
-- Current duplicate columns in tokens_unified:
latest_price_sol vs current_price_sol
latest_price_usd vs current_price_usd
metadata_updated_at vs metadata_last_updated
is_compressed vs compressed
```

**Solution**:
```sql
-- Step 1: Migrate data to primary columns
UPDATE tokens_unified 
SET latest_price_sol = COALESCE(latest_price_sol, current_price_sol),
    latest_price_usd = COALESCE(latest_price_usd, current_price_usd),
    metadata_updated_at = COALESCE(metadata_updated_at, metadata_last_updated),
    is_compressed = COALESCE(is_compressed, compressed);

-- Step 2: Drop duplicate columns
ALTER TABLE tokens_unified 
DROP COLUMN current_price_sol,
DROP COLUMN current_price_usd,
DROP COLUMN metadata_last_updated,
DROP COLUMN compressed;

-- Step 3: Update application code to use primary columns
```

### 1.2 Fix Decimal Precision Issues
**Issue**: Price columns use insufficient precision for micro-cap tokens
```sql
-- Current: DECIMAL(20,4) loses precision for tokens < $0.0001
current_price_usd DECIMAL(20,4)  -- Only 4 decimal places
```

**Solution**:
```sql
-- Increase precision for all USD price columns
ALTER TABLE tokens_unified
ALTER COLUMN latest_price_usd TYPE DECIMAL(30,12),
ALTER COLUMN first_price_usd TYPE DECIMAL(30,12),
ALTER COLUMN threshold_price_usd TYPE DECIMAL(30,12);

ALTER TABLE trades_unified
ALTER COLUMN price_usd TYPE DECIMAL(30,12);
```

### 1.3 Add Missing Foreign Key Constraints
**Issue**: Logical relationships exist without FK constraints
```sql
-- Currently missing FK constraints that should exist
```

**Solution**:
```sql
-- Add foreign key constraints with proper cascade rules
ALTER TABLE price_snapshots_unified
ADD CONSTRAINT fk_price_snapshots_token 
FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address) 
ON DELETE CASCADE;

ALTER TABLE amm_pool_state
ADD CONSTRAINT fk_pool_state_token
FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address)
ON DELETE RESTRICT;

ALTER TABLE bonding_curve_mappings
ADD CONSTRAINT fk_bc_mappings_token
FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address)
ON DELETE CASCADE;
```

## Priority 2: Performance Optimization

### 2.1 Implement Table Partitioning
**Issue**: Large tables growing without bounds
```sql
-- trades_unified: millions of rows
-- price_snapshots_unified: growing rapidly
```

**Solution**:
```sql
-- Partition trades_unified by month
CREATE TABLE trades_unified_partitioned (
    LIKE trades_unified INCLUDING ALL
) PARTITION BY RANGE (block_time);

-- Create monthly partitions
CREATE TABLE trades_unified_2025_01 PARTITION OF trades_unified_partitioned
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Migrate data
INSERT INTO trades_unified_partitioned SELECT * FROM trades_unified;

-- Swap tables
ALTER TABLE trades_unified RENAME TO trades_unified_old;
ALTER TABLE trades_unified_partitioned RENAME TO trades_unified;
```

### 2.2 Create Materialized Views for Analytics
**Issue**: Complex aggregations computed on every query
```sql
-- 24h volume calculations are expensive
-- Unique trader counts require full scans
```

**Solution**:
```sql
-- Materialized view for 24h token metrics
CREATE MATERIALIZED VIEW token_metrics_24h AS
SELECT 
    t.mint_address,
    t.symbol,
    t.name,
    COUNT(DISTINCT tr.user_address) as unique_traders_24h,
    COUNT(tr.id) as trades_24h,
    SUM(tr.volume_usd) as volume_24h_usd,
    SUM(tr.sol_amount / 1e9) as volume_24h_sol,
    MAX(tr.block_time) as last_trade_time
FROM tokens_unified t
LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
    AND tr.block_time >= NOW() - INTERVAL '24 hours'
GROUP BY t.mint_address, t.symbol, t.name;

-- Create index for fast lookups
CREATE UNIQUE INDEX idx_token_metrics_24h_mint ON token_metrics_24h(mint_address);

-- Refresh schedule (every 5 minutes)
CREATE OR REPLACE FUNCTION refresh_token_metrics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY token_metrics_24h;
END;
$$ LANGUAGE plpgsql;
```

### 2.3 Optimize Slow Queries with Better Indexes
**Issue**: Missing composite indexes for common query patterns

**Solution**:
```sql
-- Add composite indexes for common filter combinations
CREATE INDEX idx_tokens_graduated_market_cap 
ON tokens_unified(graduated_to_amm, latest_market_cap_usd DESC)
WHERE graduated_to_amm = true AND latest_market_cap_usd > 0;

CREATE INDEX idx_trades_user_time
ON trades_unified(user_address, block_time DESC);

CREATE INDEX idx_tokens_stale_removal
ON tokens_unified(is_stale, should_remove, last_trade_at)
WHERE is_stale = true OR should_remove = true;

-- Partial index for active tokens only
CREATE INDEX idx_tokens_active
ON tokens_unified(latest_market_cap_usd DESC)
WHERE is_stale = false AND should_remove = false;
```

## Priority 3: Data Integrity Improvements

### 3.1 Add Check Constraints
**Issue**: Invalid data can be inserted
```sql
-- No validation on price ranges
-- No validation on percentages
```

**Solution**:
```sql
-- Add check constraints for data validation
ALTER TABLE tokens_unified
ADD CONSTRAINT chk_price_positive CHECK (latest_price_sol >= 0 AND latest_price_usd >= 0),
ADD CONSTRAINT chk_progress_range CHECK (latest_bonding_curve_progress BETWEEN 0 AND 100),
ADD CONSTRAINT chk_holder_percentage CHECK (top_holder_percentage BETWEEN 0 AND 100);

ALTER TABLE trades_unified
ADD CONSTRAINT chk_trade_amounts CHECK (sol_amount > 0 AND token_amount > 0),
ADD CONSTRAINT chk_trade_type CHECK (trade_type IN ('buy', 'sell')),
ADD CONSTRAINT chk_program_type CHECK (program IN ('bonding_curve', 'amm_pool'));
```

### 3.2 Implement Audit Triggers
**Issue**: No history of data changes
```sql
-- Can't track who changed what and when
```

**Solution**:
```sql
-- Create audit table
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(100),
    record_id VARCHAR(100),
    action VARCHAR(10),
    changed_by VARCHAR(100),
    changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    old_values JSONB,
    new_values JSONB
);

-- Create generic audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_values, new_values)
        VALUES (TG_TABLE_NAME, NEW.mint_address, TG_OP, row_to_json(OLD), row_to_json(NEW));
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_values)
        VALUES (TG_TABLE_NAME, OLD.mint_address, TG_OP, row_to_json(OLD));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to critical tables
CREATE TRIGGER audit_tokens AFTER UPDATE OR DELETE ON tokens_unified
FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

## Priority 4: Schema Normalization

### 4.1 Extract Social Links to Separate Table
**Issue**: Social links columns mostly NULL, wasting space
```sql
-- 90% of tokens have NULL social links
-- Each link column uses space even when NULL
```

**Solution**:
```sql
-- Create normalized social links table
CREATE TABLE token_social_links (
    mint_address VARCHAR(64) PRIMARY KEY REFERENCES tokens_unified(mint_address),
    twitter VARCHAR(255),
    telegram VARCHAR(255),
    discord VARCHAR(255),
    website VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Migrate existing data
INSERT INTO token_social_links (mint_address, twitter, telegram, discord, website)
SELECT mint_address, twitter, telegram, discord, website
FROM tokens_unified
WHERE twitter IS NOT NULL OR telegram IS NOT NULL OR discord IS NOT NULL OR website IS NOT NULL;

-- Drop columns from main table
ALTER TABLE tokens_unified
DROP COLUMN twitter,
DROP COLUMN telegram,
DROP COLUMN discord,
DROP COLUMN website;
```

### 4.2 Consolidate Price Update Sources
**Issue**: Multiple timestamp columns for different update sources
```sql
last_graphql_update, last_rpc_update, last_dexscreener_update
```

**Solution**:
```sql
-- Create price source tracking table
CREATE TABLE price_update_log (
    id BIGSERIAL PRIMARY KEY,
    mint_address VARCHAR(64) REFERENCES tokens_unified(mint_address),
    source VARCHAR(50),
    price_sol DECIMAL(30,15),
    price_usd DECIMAL(30,12),
    success BOOLEAN,
    error_message TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_price_updates_mint_time (mint_address, updated_at DESC)
);

-- Drop redundant columns
ALTER TABLE tokens_unified
DROP COLUMN last_graphql_update,
DROP COLUMN last_rpc_update,
DROP COLUMN last_dexscreener_update;
```

## Priority 5: Maintenance & Cleanup

### 5.1 Automated Cleanup Jobs
**Issue**: Old data accumulates indefinitely

**Solution**:
```sql
-- Create cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
    -- Remove old price snapshots
    DELETE FROM price_snapshots_unified
    WHERE created_at < NOW() - INTERVAL '30 days';
    
    -- Remove old audit logs
    DELETE FROM audit_log
    WHERE changed_at < NOW() - INTERVAL '90 days';
    
    -- Archive removed tokens
    INSERT INTO tokens_archive
    SELECT * FROM tokens_unified
    WHERE should_remove = true 
    AND updated_at < NOW() - INTERVAL '7 days';
    
    DELETE FROM tokens_unified
    WHERE should_remove = true 
    AND updated_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Schedule with pg_cron
SELECT cron.schedule('cleanup-old-data', '0 2 * * *', 'SELECT cleanup_old_data()');
```

### 5.2 Statistics Maintenance
**Issue**: Query planner uses outdated statistics

**Solution**:
```sql
-- Create maintenance function
CREATE OR REPLACE FUNCTION maintain_statistics()
RETURNS void AS $$
BEGIN
    -- Update statistics on frequently queried tables
    ANALYZE tokens_unified;
    ANALYZE trades_unified;
    ANALYZE amm_pool_state;
    
    -- Rebuild indexes if needed
    REINDEX INDEX CONCURRENTLY idx_tokens_market_cap;
    REINDEX INDEX CONCURRENTLY idx_trades_block_time;
END;
$$ LANGUAGE plpgsql;

-- Schedule daily
SELECT cron.schedule('maintain-statistics', '0 3 * * *', 'SELECT maintain_statistics()');
```

## Implementation Plan

### Phase 1: Quick Wins (1-2 days)
1. Fix decimal precision issues
2. Add missing indexes
3. Create check constraints

### Phase 2: Performance (3-5 days)
1. Implement table partitioning
2. Create materialized views
3. Optimize slow queries

### Phase 3: Data Integrity (1 week)
1. Add foreign key constraints
2. Implement audit logging
3. Add data validation

### Phase 4: Schema Optimization (2 weeks)
1. Normalize social links
2. Consolidate duplicate columns
3. Archive old data

## Monitoring Recommendations

### Query Performance
```sql
-- Monitor slow queries
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find slowest queries
SELECT 
    query,
    mean_exec_time,
    calls,
    total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### Table Bloat
```sql
-- Check table bloat
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS external_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Risk Mitigation

### Before Any Major Change
1. Take full backup
2. Test in staging environment
3. Plan rollback strategy
4. Schedule during low traffic
5. Monitor for 24 hours post-change

### Rollback Templates
```sql
-- Keep rollback scripts ready
-- Example: Undo partition
ALTER TABLE trades_unified RENAME TO trades_unified_partitioned;
ALTER TABLE trades_unified_old RENAME TO trades_unified;
```