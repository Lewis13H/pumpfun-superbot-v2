# Database Schema Analysis & Data Extraction Documentation

## Overview
This document provides a comprehensive analysis of the current database schema, data extraction processes, and recommendations for building an optimal pump.fun token monitoring system.

**Last Updated**: January 2025 - After Session 1 Database Schema Updates

## Database Schema

### 1. `tokens_unified` Table
Primary table for token metadata and state tracking.

**Core Fields:**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `mint_address` | VARCHAR(64) PK | Unique token identifier | BC/AMM Monitors | ✅ Extracted |
| `symbol` | VARCHAR(32) | Token symbol | Metadata Services | ✅ Enriched |
| `name` | VARCHAR(128) | Token name | Metadata Services | ✅ Enriched |
| `uri` | VARCHAR(512) | Metadata URI | Metadata Services | ✅ Enriched |
| `image_uri` | VARCHAR(512) | Token image URL | Metadata Services | ✅ Enriched |
| `description` | TEXT | Token description | Metadata Services | ✅ Enriched |
| `creator` | VARCHAR(64) | Creator address | BC Monitor | ✅ Extracted |

**Discovery & Pricing:**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `first_seen_at` | TIMESTAMPTZ | First detection time | Database | ✅ Automatic |
| `first_seen_slot` | BIGINT | First detection slot | Monitor | ✅ Extracted |
| `first_program` | VARCHAR(20) | Initial program type | Monitor | ✅ Set |
| `first_price_sol` | DECIMAL(20,12) | Initial SOL price | First trade | ✅ Extracted |
| `first_price_usd` | DECIMAL(20,4) | Initial USD price | Calculated | ✅ Calculated |
| `first_market_cap_usd` | DECIMAL(20,4) | Initial market cap | Calculated | ✅ Calculated |

**Latest State:**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `latest_price_sol` | DECIMAL(20,12) | Current SOL price | Trade updates | ✅ Updated |
| `latest_price_usd` | DECIMAL(20,4) | Current USD price | Trade updates | ✅ Updated |
| `latest_market_cap_usd` | DECIMAL(20,4) | Current market cap | Trade updates | ✅ Updated |
| `latest_virtual_sol_reserves` | BIGINT | Virtual SOL reserves | BC Events | ✅ BC only |
| `latest_virtual_token_reserves` | BIGINT | Virtual token reserves | BC Events | ✅ BC only |
| `latest_bonding_curve_progress` | DECIMAL(5,2) | BC progress % | Calculated | ✅ BC only |
| `latest_update_slot` | BIGINT | Last update slot | Trade updates | ✅ Updated |

**Threshold & Graduation:**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `threshold_crossed_at` | TIMESTAMPTZ | When crossed $8,888 | DB Service | ✅ Tracked |
| `threshold_price_sol` | DECIMAL(20,12) | Price at threshold | DB Service | ✅ Tracked |
| `threshold_price_usd` | DECIMAL(20,4) | USD price at threshold | DB Service | ✅ Tracked |
| `threshold_market_cap_usd` | DECIMAL(20,4) | Market cap at threshold | DB Service | ✅ Tracked |
| `threshold_slot` | BIGINT | Slot at threshold | DB Service | ✅ Tracked |
| `graduated_to_amm` | BOOLEAN | AMM graduation status | BC Account Monitor | ✅ Tracked |
| `graduation_at` | TIMESTAMPTZ | Graduation time | Graduation Handler | ✅ Tracked |
| `graduation_slot` | BIGINT | Graduation slot | Graduation Handler | ✅ Tracked |

**Trading Statistics:**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `total_trades` | INTEGER | Total trade count | Trigger | ✅ Updated |
| `total_buys` | INTEGER | Total buy count | Trigger | ✅ Updated |
| `total_sells` | INTEGER | Total sell count | Trigger | ✅ Updated |
| `volume_24h_sol` | DECIMAL(20,9) | 24h SOL volume | Aggregation | ⚠️ Manual |
| `volume_24h_usd` | DECIMAL(20,4) | 24h USD volume | Aggregation | ⚠️ Manual |
| `unique_traders_24h` | INTEGER | Unique traders | Aggregation | ⚠️ Manual |

**Enrichment & Metadata:**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `holder_count` | INTEGER | Token holders | Enrichment | ✅ Enriched |
| `top_holder_percentage` | DECIMAL(5,2) | Top holder % | Enrichment | ⚠️ Not used |
| `metadata_enriched` | BOOLEAN | Enrichment flag | Auto-enricher | ✅ Tracked |
| `metadata_enriched_at` | TIMESTAMPTZ | Enrichment time | Auto-enricher | ✅ Tracked |
| `metadata_source` | VARCHAR(50) | Metadata source | Auto-enricher | ✅ Tracked |
| `metadata_updated_at` | TIMESTAMPTZ | Last update | Auto-enricher | ✅ Tracked |

**Token Properties:**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `total_supply` | BIGINT | Token supply | Enrichment | ✅ Added |
| `supply` | NUMERIC(40,0) | Large supply field | Enrichment | ✅ Enriched |
| `decimals` | INTEGER | Token decimals | Enrichment | ✅ Enriched |
| `is_mutable` | BOOLEAN | Metadata mutability | Enrichment | ✅ Enriched |
| `mint_authority` | VARCHAR(64) | Mint authority | Enrichment | ✅ Enriched |
| `freeze_authority` | VARCHAR(64) | Freeze authority | Enrichment | ✅ Enriched |

**Stale Detection (NEW):**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `last_trade_at` | TIMESTAMP | Last trade timestamp | Trigger | ✅ Updated |
| `is_stale` | BOOLEAN | Stale price flag | Trigger/Detection | ✅ Updated |
| `should_remove` | BOOLEAN | Auto-removal flag | Detection | ✅ Set |
| `liquidity_usd` | DECIMAL(20,4) | Total liquidity | Enrichment | ✅ Added |
| `bonding_curve_key` | VARCHAR(64) | BC address | BC Monitor | ✅ Extracted |

**Recovery & Updates:**
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `price_source` | TEXT | Last price source | Various | ✅ Tracked |
| `last_graphql_update` | TIMESTAMPTZ | GraphQL update | GraphQL | ✅ Tracked |
| `last_rpc_update` | TIMESTAMPTZ | RPC update | RPC | ✅ Tracked |
| `last_dexscreener_update` | TIMESTAMP | DexScreener update | DexScreener | ✅ Tracked |
| `recovery_attempts` | INTEGER | Recovery count | Recovery | ✅ Tracked |
| `last_recovery_attempt` | TIMESTAMPTZ | Last recovery | Recovery | ✅ Tracked |

### 2. `trades_unified` Table
Stores all trade transactions for both BC and AMM.

| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| `id` | BIGSERIAL PK | Auto-increment ID | Database | ✅ Automatic |
| `signature` | VARCHAR(128) UNIQUE | Transaction signature | gRPC Stream | ✅ Extracted |
| `mint_address` | VARCHAR(64) | Token traded | Event Parser | ✅ Extracted |
| `program` | VARCHAR(20) | 'bonding_curve' or 'amm_pool' | Monitor Type | ✅ Set |
| `trade_type` | VARCHAR(10) | 'buy' or 'sell' | Event Parser | ✅ Extracted |
| `user_address` | VARCHAR(64) | Trader wallet | Event Parser | ✅ Extracted |
| `sol_amount` | BIGINT | SOL amount (lamports) | Event Parser | ✅ Extracted |
| `token_amount` | BIGINT | Token amount | Event Parser | ✅ Extracted |
| `price_sol` | DECIMAL(20,12) | Token price in SOL | Calculated | ✅ Calculated |
| `price_usd` | DECIMAL(20,12) | Token price in USD | Calculated | ✅ Calculated |
| `market_cap_usd` | DECIMAL(20,4) | Market cap at trade | Calculated | ✅ Calculated |
| `volume_usd` | DECIMAL(20,4) | Trade volume USD | Calculated | ✅ Added |
| `virtual_sol_reserves` | BIGINT | Virtual SOL reserves | BC Events | ✅ BC only |
| `virtual_token_reserves` | BIGINT | Virtual token reserves | BC Events | ✅ BC only |
| `bonding_curve_key` | VARCHAR(64) | BC address | BC Monitor | ✅ Extracted |
| `bonding_curve_progress` | DECIMAL(5,2) | Progress to graduation | Calculated | ✅ Calculated |
| `slot` | BIGINT | Blockchain slot | gRPC Stream | ✅ Extracted |
| `block_time` | TIMESTAMPTZ | Transaction time | gRPC Stream | ✅ Extracted |
| `created_at` | TIMESTAMPTZ | Record creation | Database | ✅ Automatic |

**Triggers:**
- `trigger_update_token_latest_prices` - Updates token prices and stats on new trades

### 3. `bonding_curve_mappings` Table
Maps bonding curves to token mints for graduation tracking.

| Field | Type | Description | Source | Extraction Status |
|-------|------|-------------|--------|-------------------|
| `bonding_curve_key` | VARCHAR(64) PK | BC address | BC Monitor | ✅ Extracted |
| `mint_address` | VARCHAR(64) | Token mint | BC Monitor | ✅ Extracted |
| `created_at` | TIMESTAMP | Mapping created | Database | ✅ Automatic |
| `updated_at` | TIMESTAMP | Last update | Database | ✅ Automatic |

### 4. `amm_pool_states` Table
Tracks AMM pool reserve states over time.

| Field | Type | Description | Source | Extraction Status |
|-------|------|-------------|--------|-------------------|
| `id` | BIGSERIAL PK | Auto ID | Database | ✅ Automatic |
| `mint_address` | VARCHAR(64) | Token mint | AMM Monitor | ✅ Extracted |
| `pool_address` | VARCHAR(64) | Pool address | AMM Monitor | ✅ Extracted |
| `virtual_sol_reserves` | BIGINT | Virtual SOL | AMM Events | ✅ Extracted |
| `virtual_token_reserves` | BIGINT | Virtual tokens | AMM Events | ✅ Extracted |
| `real_sol_reserves` | BIGINT | Real SOL | AMM Account Monitor | ⚠️ Partial |
| `real_token_reserves` | BIGINT | Real tokens | AMM Account Monitor | ⚠️ Partial |
| `pool_open` | BOOLEAN | Pool status | AMM Monitor | ✅ Default true |
| `slot` | BIGINT | Update slot | gRPC Stream | ✅ Extracted |

### 5. Additional Tables

#### `recovery_progress` Table
Tracks historical data recovery operations.

| Field | Type | Description |
|-------|------|-------------|
| `id` | SERIAL PK | Auto ID |
| `period_start` | TIMESTAMP | Recovery period start |
| `period_end` | TIMESTAMP | Recovery period end |
| `tokens_processed` | INTEGER | Tokens processed count |
| `tokens_total` | INTEGER | Total tokens to process |
| `trades_recovered` | INTEGER | Trades recovered count |
| `status` | VARCHAR(20) | pending/running/completed/failed |
| `started_at` | TIMESTAMP | Job start time |
| `completed_at` | TIMESTAMP | Job completion time |
| `error_message` | TEXT | Error details if failed |
| `created_at` | TIMESTAMP | Record creation |

#### `stale_detection_runs` Table
Audit log for stale token detection runs.

| Field | Type | Description |
|-------|------|-------------|
| `id` | SERIAL PK | Auto ID |
| `run_at` | TIMESTAMP | Run timestamp |
| `tokens_checked` | INTEGER | Tokens checked |
| `tokens_marked_stale` | INTEGER | Marked as stale |
| `tokens_marked_removal` | INTEGER | Marked for removal |
| `tokens_recovered` | INTEGER | Successfully recovered |
| `execution_time_ms` | INTEGER | Runtime in ms |
| `status` | VARCHAR(20) | running/completed/failed |
| `error_message` | TEXT | Error details |

### 6. Database Schema Status Summary

**✅ Fully Implemented (After Session 1):**
- All core token fields including latest prices
- Stale detection columns (last_trade_at, is_stale, should_remove)
- Liquidity and bonding curve tracking
- Automatic price update triggers
- Recovery and audit tables
- All necessary indexes for performance

**⚠️ Partially Implemented:**
- 24h volume aggregation (requires separate job)
- Unique trader counts (requires aggregation)
- Top holder percentage (not actively used)

**❌ Not Implemented (From Phase Plans):**
- Phase 3 tables: token_lifecycle, creator_analysis, migration_events
- Phase 4 tables: failed_transactions, mev_events, slippage_analysis
- Phase 5 tables: slot_progression, account_state_history, liquidity_snapshots, fork_events, consistency_issues

## Data Extraction Analysis

### ✅ Successfully Extracted Data
1. **Core Trading Data**
   - Transaction signatures, timestamps, slots
   - User addresses and trade directions
   - SOL and token amounts
   - Price calculations in SOL and USD

2. **Token Lifecycle**
   - Initial token detection and pricing
   - Threshold crossing ($8,888 market cap)
   - Graduation detection and tracking
   - AMM pool creation

3. **Metadata Enrichment**
   - Token names and symbols via GraphQL/REST
   - Multiple fallback sources (GraphQL → Shyft → Helius)
   - Automatic enrichment for high-value tokens

### ⚠️ Partially Extracted Data
1. **Reserve Data**
   - Virtual reserves extracted from BC events
   - Real reserves partially tracked via AMM account monitor
   - Inconsistent availability across programs

2. **Volume Metrics**
   - Individual trade volumes calculated
   - 24h aggregated volumes not consistently tracked
   - Missing historical volume rollups

### ❌ Missing Data
1. **Advanced Metrics**
   - Transaction fees
   - Slippage calculations
   - Price impact percentages
   - MEV detection

2. **Social/Holder Data**
   - Holder count and distribution
   - Creator reputation/history
   - Social metrics integration

3. **Liquidity Metrics**
   - Total liquidity in USD
   - Liquidity changes over time
   - LP token tracking

## Data Flow Architecture

```
gRPC Stream (Shyft)
    ├── BC Monitor ──────→ Trades & Token Creation
    ├── BC Account Monitor → Graduation Detection
    ├── AMM Monitor ─────→ AMM Trades & Pool Creation
    └── AMM Account Monitor → Pool State Updates
           ↓
    Event Bus System
           ↓
    Database Service (Batched Writes)
           ↓
    PostgreSQL Database
           ↓
    API/Dashboard
```

## Recommendations for Optimal System

### 1. Schema Improvements
```sql
-- Add missing columns to tokens_unified
ALTER TABLE tokens_unified ADD COLUMN latest_price_sol DECIMAL(20,12);
ALTER TABLE tokens_unified ADD COLUMN latest_price_usd DECIMAL(20,4);
ALTER TABLE tokens_unified ADD COLUMN latest_market_cap_usd DECIMAL(20,4);
ALTER TABLE tokens_unified ADD COLUMN volume_24h_usd DECIMAL(20,4);
ALTER TABLE tokens_unified ADD COLUMN liquidity_usd DECIMAL(20,4);
ALTER TABLE tokens_unified ADD COLUMN holder_count INTEGER;
ALTER TABLE tokens_unified ADD COLUMN creator_address VARCHAR(64);
ALTER TABLE tokens_unified ADD COLUMN token_supply BIGINT;
ALTER TABLE tokens_unified ADD COLUMN decimals SMALLINT DEFAULT 6;

-- Add indexes for performance
CREATE INDEX idx_tokens_market_cap ON tokens_unified(latest_market_cap_usd DESC);
CREATE INDEX idx_tokens_graduated ON tokens_unified(graduated_to_amm) WHERE graduated_to_amm = true;
CREATE INDEX idx_trades_block_time ON trades_unified(block_time DESC);

-- Add volume aggregation table
CREATE TABLE volume_aggregates (
    mint_address VARCHAR(64),
    period_start TIMESTAMP,
    period_type VARCHAR(10), -- '1h', '24h', '7d'
    volume_usd DECIMAL(20,4),
    trade_count INTEGER,
    unique_traders INTEGER,
    PRIMARY KEY (mint_address, period_start, period_type)
);
```

### 2. Additional Data to Extract
1. **From BC Events:**
   - Creator address (currently available but not stored)
   - Real reserves (in addition to virtual)
   - Token decimals from metadata

2. **From AMM Events:**
   - Pool creation parameters
   - Initial liquidity amounts
   - LP token supply

3. **From Transaction Metadata:**
   - preTokenBalances/postTokenBalances for accuracy
   - Inner instructions for complete flow
   - Compute units and priority fees

### 3. Architecture Enhancements
1. **Data Pipeline Optimization**
   - Implement write-ahead log for zero data loss
   - Add Kafka/Redis for event streaming
   - Separate hot/cold data storage

2. **Monitoring Improvements**
   - Add health checks for each monitor
   - Implement data quality metrics
   - Track extraction success rates

3. **Performance Optimization**
   - Partition trades table by time
   - Implement materialized views for aggregates
   - Add caching layer for frequently accessed data

### 4. Analytics Features
1. **Real-time Metrics**
   - Live price charts with WebSocket updates
   - Volume profiles and liquidity depth
   - Trader behavior patterns

2. **Historical Analysis**
   - Token performance over time
   - Graduation success rates
   - Creator track records

3. **Predictive Features**
   - Graduation likelihood scores
   - Rug pull risk indicators
   - Volume anomaly detection

## Token Enrichment Implementation Status

### ✅ Phase 1: Database Schema Updates (COMPLETED - Session 1)

**Implemented:**
1. Added all missing price tracking columns:
   - `last_trade_at` - Timestamp tracking for staleness
   - `is_stale` - Boolean flag for stale tokens
   - `should_remove` - Auto-removal flag
   - `liquidity_usd` - Liquidity tracking
   - `bonding_curve_key` - BC address tracking
   - `total_supply` - Token supply

2. Created performance indexes:
   - `idx_tokens_stale` - Efficient stale token queries
   - `idx_tokens_removal` - Removal candidate queries
   - `idx_tokens_last_trade` - Trade time queries
   - `idx_tokens_bonding_curve` - BC lookups

3. Added automatic triggers:
   - `update_token_latest_prices()` - Updates prices on new trades
   - Resets `is_stale` flag automatically
   - Updates trade statistics

4. Created supporting tables:
   - `recovery_progress` - Historical recovery tracking
   - `stale_detection_runs` - Audit logging

**Results:**
- 105 total tokens in database
- 58 tokens marked as stale (55%)
- 41 high-value stale tokens (>$10k)
- Database ready for enhanced stale detection

### Phase 2: Enhanced Stale Token Detection
1. **Improve Stale Detection Logic**
   - Mark tokens as stale when no trades for 30+ minutes
   - Different thresholds based on market cap tiers
   - Auto-remove tokens below $5k after 1 hour of no activity

2. **Multiple Recovery Sources**
   - Primary: Shyft RPC with DAS for current prices
   - Secondary: DexScreener for graduated tokens
   - Tertiary: Direct RPC calls to read account state

3. **Scheduled Price Updates**
   - Run every 5 minutes for high-value tokens ($50k+)
   - Run every 15 minutes for medium-value tokens ($10k-$50k)
   - Run every 30 minutes for low-value tokens ($5k-$10k)

### Phase 3: Data Extraction Improvements
1. **Extract More Fields from Existing Events**
   - Creator address from BC creation events
   - Real reserves from account updates
   - Fee tier from AMM pool creation

2. **Add Shyft DAS Integration**
   - Use `/sol/v1/token/get_info` for comprehensive metadata
   - Extract holder count, creator details, supply info
   - Cache results for 1 hour

3. **Historical Data Recovery**
   - Query Shyft GraphQL for missed trades during downtime
   - Backfill price history using transaction data
   - Mark recovered data with source flag

### Implementation Progress
1. **Session 1** ✅: Database schema updates completed
   - All missing columns added
   - Indexes and triggers created
   - 58 stale tokens identified

2. **Session 2** (Next): Enhanced stale token detection
   - Tier-based thresholds
   - Auto-removal logic
   - Recovery mechanisms

3. **Session 3** (Planned): Shyft DAS integration
   - Comprehensive metadata
   - Holder counts
   - Social links

4. **Session 4** (Planned): Historical recovery
   - Downtime detection
   - Multi-source recovery
   - Progress tracking

## Conclusion
The current system successfully extracts core trading data and tracks token lifecycles effectively. The main issue is stale tokens showing incorrect market caps when no recent trades occur. By implementing the simple plan above, we can:

1. Properly track and update stale token prices
2. Auto-remove dead tokens from the dashboard
3. Recover data missed during monitor downtime
4. Enrich tokens with more comprehensive metadata

This approach focuses on practical improvements that directly address the stale token problem without over-engineering the solution.