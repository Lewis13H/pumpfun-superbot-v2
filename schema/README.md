# Database Schema Documentation

This directory contains documentation and archived schema files for the pumpfun-superbot-v2 database.

## Current Database Structure

The active database schema is managed through migrations in `/src/database/migrations/`. 

### Key Design Principles

1. **Efficient Filtering**
   - Market cap thresholds enforced at multiple levels
   - Service layer pre-filters before database insertion
   - Indexes optimized for common query patterns

2. **High Performance**
   - Comprehensive indexing strategy
   - In-memory caching for frequently accessed data
   - Efficient batch processing for high-throughput data

3. **Data Completeness**
   - Tracks full token lifecycle from bonding curve to AMM
   - Stores both transaction and state data
   - Maintains price snapshots and historical data

## Schema Overview

### Core Tables

- **`tokens_unified`** - Master token registry with metadata and current state
- **`trades_unified`** - All trades from both bonding curve and AMM
- **`amm_pool_states`** - AMM pool state snapshots
- **`liquidity_events`** - Liquidity add/remove events
- **`price_snapshots`** - Historical price data
- **`sol_prices`** - SOL/USD price tracking

### Migration Management

All database changes are managed through numbered migrations in `/src/database/migrations/`:

1. `001_initial_schema.sql` - Complete base schema
2. `002_extended_metadata_features.sql` - Additional metadata features

To apply migrations:
```bash
# For new database
psql -U pump_user -d pump_monitor -f src/database/migrations/001_initial_schema.sql
psql -U pump_user -d pump_monitor -f src/database/migrations/002_extended_metadata_features.sql

# For existing database (idempotent)
psql -U pump_user -d pump_monitor -f exports/master_database_fix.sql
```

## Archive

The `archive/` directory contains historical schema files that have been consolidated into the migration system. These are kept for reference but should not be used for new deployments.

## Best Practices

1. All new database changes should be added as numbered migrations
2. Use `IF NOT EXISTS` to make migrations idempotent
3. Include appropriate indexes with new columns
4. Document the purpose of new tables and columns
5. Test migrations on a copy of production data before deployment