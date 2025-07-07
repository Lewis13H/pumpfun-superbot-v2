# Database Knowledge Base Overview

## Purpose
This knowledge base provides comprehensive documentation for the pumpfun-superbot-v2 PostgreSQL database, including schema design, relationships, optimization strategies, and best practices.

## Database Architecture

### Core Design Principles
1. **Unified Tables**: Single source of truth with `tokens_unified` and `trades_unified`
2. **Event-Driven Updates**: Triggers maintain data consistency automatically
3. **Audit Trail**: Comprehensive logging for all operations
4. **Performance First**: Strategic indexing and partitioning strategies
5. **Recovery Built-in**: Automatic error handling and data recovery

### Key Statistics
- **Total Tables**: 37 active tables (+ 16 deprecated)
- **Core Tables**: 2 (`tokens_unified`, `trades_unified`)
- **Support Tables**: 35 (analytics, monitoring, recovery)
- **Indexes**: 50+ strategic indexes
- **Triggers**: 5 automatic data maintenance triggers

## Schema Categories

### 1. Core Trading System
- `tokens_unified`: Master token registry with 70+ columns
- `trades_unified`: All trading activity across BC & AMM
- `bonding_curve_mappings`: BC to token mint mappings

### 2. AMM Enhancement System
- `amm_pool_state`: Current pool states
- `amm_pool_states`: Historical pool states
- `liquidity_events`: Liquidity add/remove tracking
- `amm_fee_events`: Fee collection tracking
- `lp_positions`: LP token positions
- `amm_pool_metrics_hourly`: Hourly analytics

### 3. Monitoring & Recovery
- `recovery_progress`: Historical data recovery
- `stale_detection_runs`: Stale token detection logs
- `stale_token_recovery`: Recovery batch tracking
- `downtime_periods`: System downtime tracking
- `metadata_enrichment_runs`: Enrichment audit logs

### 4. Analytics & Snapshots
- `price_snapshots_unified`: Price history
- `sol_prices`: SOL/USD price tracking
- `creator_analysis`: Creator analytics
- `token_holders_unified`: Holder distribution
- `trade_simulations`: Price impact analysis

### 5. Deprecated Tables
16 legacy tables replaced by unified schema (see DEPRECATED_TABLES.md)

## Data Flow Architecture

```
gRPC Stream → Domain Monitors → Event Bus → DB Service → PostgreSQL
                                              ↓
                                         Triggers → Auto Updates
                                              ↓
                                         API/Dashboard
```

## Key Features

### Automatic Data Maintenance
- Price updates on every trade
- Stale detection with configurable thresholds
- Trade statistics aggregation
- Bonding curve progress calculation
- Graduation status tracking

### Performance Optimizations
- Strategic composite indexes
- Partial indexes for filtered queries
- Time-based partitioning ready
- Materialized view candidates identified

### Data Integrity
- Foreign key constraints
- NOT NULL constraints on critical fields
- Check constraints for valid ranges
- Unique constraints preventing duplicates
- Trigger-based validation

## Quick Reference

### Most Important Tables
1. `tokens_unified`: Token metadata and state
2. `trades_unified`: All trading activity
3. `amm_pool_state`: Current AMM pool states
4. `liquidity_events`: Liquidity tracking
5. `sol_prices`: SOL price reference

### Critical Indexes
- `idx_tokens_market_cap`: Market cap sorting
- `idx_trades_block_time`: Time-based queries
- `idx_tokens_graduated`: Graduated token filtering
- `idx_tokens_stale`: Stale token detection
- `idx_trades_unified_composite`: Multi-column lookups

### Essential Relationships
- `trades_unified.mint_address` → `tokens_unified.mint_address`
- `liquidity_events.pool_address` → `amm_pool_state.pool_address`
- `bonding_curve_mappings.mint_address` → `tokens_unified.mint_address`

## Knowledge Base Structure

1. **DATABASE_OVERVIEW.md** (this file): High-level architecture
2. **SCHEMA_DETAILS.md**: Detailed table specifications
3. **RELATIONSHIPS.md**: Foreign keys and data relationships
4. **REFACTORING_GUIDE.md**: SQL optimization recommendations
5. **BEST_PRACTICES.md**: Development and maintenance guidelines
6. **MIGRATION_STRATEGY.md**: Schema evolution approach
7. **PERFORMANCE_TUNING.md**: Query optimization techniques
8. **DATA_INTEGRITY.md**: Constraints and validation rules
9. **DEPRECATED_TABLES.md**: Legacy table documentation
10. **TROUBLESHOOTING.md**: Common issues and solutions

## Usage Guide

### For Developers
- Start with SCHEMA_DETAILS.md for table structures
- Review RELATIONSHIPS.md for data connections
- Follow BEST_PRACTICES.md for new features

### For DBAs
- Use PERFORMANCE_TUNING.md for optimization
- Refer to MIGRATION_STRATEGY.md for updates
- Check TROUBLESHOOTING.md for issues

### For Analysts
- Review SCHEMA_DETAILS.md for available data
- Use query examples in BEST_PRACTICES.md
- Understand metrics in relevant table docs