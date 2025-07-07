# Database Migration Strategy

## Overview
This document outlines the migration strategy for database schema changes in the pumpfun-superbot-v2 system.

## Migration Principles

### 1. Sequential Numbering
- All migrations use 3-digit prefixes (001, 002, 003, etc.)
- Numbers indicate execution order
- Never reuse or skip numbers

### 2. Idempotent Migrations
All migrations must be safe to run multiple times:
```sql
-- ✅ Good: Idempotent
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS new_column VARCHAR(100);

-- ❌ Bad: Will fail on second run
ALTER TABLE tokens_unified 
ADD COLUMN new_column VARCHAR(100);
```

### 3. Forward-Only Migrations
- No rollback scripts (use backups for emergency rollback)
- Each migration moves the schema forward
- Test thoroughly before production deployment

## Migration File Structure

### Naming Convention
```
NNN_description_of_change.sql

Examples:
001_initial_schema.sql
002_extended_metadata_features.sql
003_add_performance_indexes.sql
```

### File Template
```sql
-- Migration: NNN_description_of_change.sql
-- Author: [Your Name]
-- Date: [YYYY-MM-DD]
-- Description: [What this migration does and why]

-- =====================================================
-- Migration Script Start
-- =====================================================

-- Your DDL statements here
-- Remember: Make everything idempotent!

-- =====================================================
-- Migration Complete
-- =====================================================
```

## Migration Process

### 1. Development
```bash
# Create new migration
touch src/database/migrations/003_your_change.sql

# Test locally
psql -U pump_user -d pump_monitor_dev -f src/database/migrations/003_your_change.sql

# Verify changes
psql -U pump_user -d pump_monitor_dev -c "\dt"
```

### 2. Testing
```sql
-- Always test on copy of production data
pg_dump pump_monitor > test_backup.sql
createdb pump_monitor_test
psql pump_monitor_test < test_backup.sql

-- Run migration
psql pump_monitor_test < src/database/migrations/003_your_change.sql

-- Verify application still works
```

### 3. Production Deployment
```bash
# 1. Backup production
pg_dump pump_monitor > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Run migration
psql -U pump_user -d pump_monitor -f src/database/migrations/003_your_change.sql

# 3. Verify
psql -U pump_user -d pump_monitor -c "SELECT * FROM migration_history"
```

## Migration Tracking

### Create Migration History Table
```sql
CREATE TABLE IF NOT EXISTS migration_history (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    applied_by VARCHAR(100) DEFAULT CURRENT_USER,
    execution_time_ms INTEGER,
    success BOOLEAN DEFAULT true,
    error_message TEXT
);
```

### Track Migrations
```sql
-- At start of each migration
INSERT INTO migration_history (migration_name, applied_at)
VALUES ('003_your_change.sql', CURRENT_TIMESTAMP)
ON CONFLICT (migration_name) DO NOTHING;
```

## Common Migration Patterns

### 1. Adding Columns
```sql
-- Safe column addition with defaults
ALTER TABLE tokens_unified
ADD COLUMN IF NOT EXISTS new_feature BOOLEAN DEFAULT false;

-- Backfill data if needed
UPDATE tokens_unified
SET new_feature = true
WHERE some_condition = true
AND new_feature = false;
```

### 2. Creating Indexes
```sql
-- Create index without blocking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_new_feature
ON tokens_unified(new_feature)
WHERE new_feature = true;
```

### 3. Renaming Columns (2-phase)
```sql
-- Phase 1: Add new column, copy data
ALTER TABLE tokens_unified
ADD COLUMN IF NOT EXISTS new_name VARCHAR(100);

UPDATE tokens_unified
SET new_name = old_name
WHERE new_name IS NULL;

-- Phase 2 (separate migration after code deploy): Drop old column
ALTER TABLE tokens_unified
DROP COLUMN IF EXISTS old_name;
```

### 4. Adding Constraints
```sql
-- Add constraint with validation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_positive_price'
    ) THEN
        ALTER TABLE tokens_unified
        ADD CONSTRAINT chk_positive_price
        CHECK (latest_price_usd >= 0);
    END IF;
END $$;
```

## Migration Best Practices

### DO:
- ✅ Test on production-like data
- ✅ Include descriptive comments
- ✅ Make operations idempotent
- ✅ Use transactions for multi-step changes
- ✅ Monitor migration performance
- ✅ Keep migrations focused and small

### DON'T:
- ❌ Mix schema and data migrations
- ❌ Drop columns immediately (use 2-phase approach)
- ❌ Make breaking changes without coordination
- ❌ Run migrations during peak hours
- ❌ Forget to backup before major changes

## Emergency Procedures

### If Migration Fails
```bash
# 1. Don't panic
# 2. Check error
psql -c "SELECT * FROM migration_history ORDER BY applied_at DESC LIMIT 1"

# 3. If needed, restore from backup
pg_restore -d pump_monitor backup_file.sql

# 4. Fix migration script
# 5. Test thoroughly
# 6. Re-attempt during maintenance window
```

### Hotfix Process
For urgent production fixes:
```sql
-- 1. Create hotfix migration with next number
-- 2. Test on staging
-- 3. Apply with monitoring
-- 4. Document in migration_history
```

## Migration History

### Completed Migrations
1. **001_initial_schema.sql** - Complete base schema with all core tables
2. **002_extended_metadata_features.sql** - Additional metadata functionality
3. **003_add_holder_analysis_tables.sql** - Token holder analysis system (Session 1)

### Future Migrations Queue

Planned migrations should be documented here:
1. **004_partition_trades_table.sql** - Partition trades_unified by month
2. **005_add_analytics_indexes.sql** - Performance indexes for analytics
3. **006_create_archival_tables.sql** - Archive old data