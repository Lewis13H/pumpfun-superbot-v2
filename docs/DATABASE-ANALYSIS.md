# Database Schema Analysis & Data Extraction Documentation

## Overview
This document provides a comprehensive analysis of the current database schema, data extraction processes, and recommendations for building an optimal pump.fun token monitoring system.

## Database Schema

### 1. `tokens_unified` Table
Primary table for token metadata and state tracking.

| Field | Type | Description | Source | Extraction Status |
|-------|------|-------------|--------|-------------------|
| `mint_address` | VARCHAR(64) PK | Unique token identifier | BC/AMM Monitors | ✅ Fully Extracted |
| `symbol` | VARCHAR(50) | Token symbol | Metadata Services | ✅ Enriched |
| `name` | VARCHAR(255) | Token name | Metadata Services | ✅ Enriched |
| `first_price_sol` | DECIMAL(20,12) | Initial SOL price | First trade | ✅ Extracted |
| `first_price_usd` | DECIMAL(20,4) | Initial USD price | First trade + SOL price | ✅ Calculated |
| `first_market_cap_usd` | DECIMAL(20,4) | Initial market cap | Calculated (1B supply) | ✅ Calculated |
| `threshold_crossed_at` | TIMESTAMP | When crossed $8,888 | DB Service | ✅ Tracked |
| `graduated_to_amm` | BOOLEAN | AMM graduation status | BC Account Monitor | ✅ Tracked |
| `graduation_at` | TIMESTAMP | Graduation time | Graduation Handler | ✅ Tracked |
| `graduation_slot` | BIGINT | Blockchain slot | Graduation Handler | ✅ Tracked |
| `price_source` | TEXT | Data source type | Various | ✅ Tracked |
| `last_graphql_update` | TIMESTAMP | GraphQL update time | GraphQL Service | ✅ Tracked |
| `last_rpc_update` | TIMESTAMP | RPC update time | RPC Service | ❌ Not Used |
| `last_dexscreener_update` | TIMESTAMP | DexScreener update | DexScreener Service | ✅ Tracked |
| `created_at` | TIMESTAMP | Record creation | Database | ✅ Automatic |

**Additional Fields in Code (Not in Schema):**
- `latest_price_sol` - Current SOL price
- `latest_price_usd` - Current USD price 
- `latest_market_cap_usd` - Current market cap
- `volume_24h_usd` - 24h trading volume
- `liquidity_usd` - Total liquidity
- `holder_count` - Number of holders
- `metadata_updated_at` - Metadata update time

### 2. `trades_unified` Table
Stores all trade transactions for both BC and AMM.

| Field | Type | Description | Source | Extraction Status |
|-------|------|-------------|--------|-------------------|
| `signature` | VARCHAR(88) PK | Transaction signature | gRPC Stream | ✅ Extracted |
| `mint_address` | VARCHAR(64) | Token traded | Event Parser | ✅ Extracted |
| `program` | ENUM | 'bonding_curve' or 'amm_pool' | Monitor Type | ✅ Set |
| `trade_type` | ENUM | 'buy' or 'sell' | Event Parser | ✅ Extracted |
| `user_address` | VARCHAR(64) | Trader wallet | Event Parser | ✅ Extracted |
| `sol_amount` | BIGINT | SOL amount (lamports) | Event Parser | ✅ Extracted |
| `token_amount` | BIGINT | Token amount | Event Parser | ✅ Extracted |
| `price_sol` | DECIMAL(20,12) | Token price in SOL | Calculated | ✅ Calculated |
| `price_usd` | DECIMAL(20,4) | Token price in USD | Calculated | ✅ Calculated |
| `market_cap_usd` | DECIMAL(20,4) | Market cap at trade | Calculated | ✅ Calculated |
| `volume_usd` | DECIMAL(20,4) | Trade volume USD | Calculated | ⚠️ Not in schema |
| `virtual_sol_reserves` | BIGINT | Virtual SOL reserves | BC Events | ⚠️ BC only |
| `virtual_token_reserves` | BIGINT | Virtual token reserves | BC Events | ⚠️ BC only |
| `bonding_curve_key` | VARCHAR(64) | BC address | BC Monitor | ✅ Extracted |
| `bonding_curve_progress` | DECIMAL(5,2) | Progress to graduation | Calculated | ✅ Calculated |
| `slot` | BIGINT | Blockchain slot | gRPC Stream | ✅ Extracted |
| `block_time` | TIMESTAMPTZ | Transaction time | gRPC Stream | ✅ Extracted |

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

## Conclusion
The current system successfully extracts core trading data and tracks token lifecycles effectively. Key improvements needed:
1. Schema normalization and missing field additions
2. Enhanced metadata extraction from events
3. Better aggregation and analytics capabilities
4. Performance optimizations for scale

With these enhancements, the system would provide comprehensive coverage of pump.fun token activity with high reliability and performance.