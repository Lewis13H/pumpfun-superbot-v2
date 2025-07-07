# Database Migrations

This directory contains all database migrations for the pumpfun-superbot-v2 project. Migrations should be run in numerical order.

## Migration Structure

All migrations follow the naming pattern: `XXX_description.sql` where XXX is a 3-digit number.

## Migration List

### Core Schema
- `001_initial_schema.sql` - Base database schema with all core tables, indexes, and functions

### Feature Additions (Already included in initial schema, kept for historical reference)
- `add-amm-enhancements.sql` - AMM pool enhancements (ALREADY IN 001)
- `add-bonding-curve-complete-status.sql` - Bonding curve completion tracking (ALREADY IN 001)
- `add-dexscreener-timestamp.sql` - DEX screener integration (ALREADY IN 001)
- `add-metadata-columns.sql` - Basic metadata columns (ALREADY IN 001)
- `add-price-tracking-columns.sql` - Price tracking enhancements (ALREADY IN 001)
- `add-recovery-progress-table.sql` - Recovery progress tracking (ALREADY IN 001)
- `add-social-metadata-columns.sql` - Social metadata and scoring (PARTIALLY IN 001)
- `update-fee-events-schema.sql` - Fee events updates (ALREADY IN 001)
- `update-liquidity-events-schema.sql` - Liquidity events updates (ALREADY IN 001)

## Running Migrations

### For a new database:
```bash
# Run the initial schema
psql -U pump_user -d pump_monitor -f src/database/migrations/001_initial_schema.sql
```

### For an existing database:
If you have an existing database with some of these changes already applied, the migrations use `IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` to be idempotent.

### Master Fix Script:
If you need to fix an existing database with missing columns or tables, use:
```bash
psql -U pump_user -d pump_monitor -f exports/master_database_fix.sql
```

## Best Practices

1. **Always use IF NOT EXISTS** - Makes migrations idempotent
2. **Include comments** - Document the purpose of tables and columns
3. **Add indexes** - Include necessary indexes in the same migration
4. **Test rollback** - Consider how to undo changes if needed
5. **One feature per migration** - Keep migrations focused and atomic

## Notes

- The `exports/master_database_fix.sql` is a consolidated fix script that can repair any database state
- All new features should be added as new numbered migrations (002, 003, etc.)
- The initial schema (001) includes all features that were previously in separate migration files