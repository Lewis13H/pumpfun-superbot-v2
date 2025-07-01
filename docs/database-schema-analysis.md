# Database Schema Analysis and Data Extraction Documentation

## Overview

This document provides a comprehensive analysis of the database schema and data extraction processes for the PumpFun SuperBot V2 monitoring system. The system tracks Solana tokens on pump.fun bonding curves and pump.swap AMM pools, capturing trades, prices, and market data in real-time.

## Database Schema

### 1. tokens_unified Table

**Purpose**: Master registry of all tokens that have crossed the market cap threshold ($8,888 for BC, $1,000 for AMM)

| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| **mint_address** | VARCHAR(64) | Primary key - Solana token mint address | All monitors | ✅ Extracted |
| **symbol** | VARCHAR(50) | Token symbol (e.g., "PUMP") | Metadata enrichers | ✅ Extracted |
| **name** | VARCHAR(255) | Token full name | Metadata enrichers | ✅ Extracted |
| **first_price_sol** | DECIMAL(20,12) | Initial price in SOL when first detected | Trade parsers | ✅ Extracted |
| **first_price_usd** | DECIMAL(20,4) | Initial price in USD | Price calculator | ✅ Extracted |
| **first_market_cap_usd** | DECIMAL(20,4) | Initial market cap in USD | Price calculator | ✅ Extracted |
| **threshold_crossed_at** | TIMESTAMP | When token crossed $8,888 threshold | DB service | ✅ Extracted |
| **graduated_to_amm** | BOOLEAN | Whether token graduated from BC to AMM | Graduation handler | ✅ Extracted |
| **graduation_at** | TIMESTAMP | When graduation occurred | BC account monitor | ✅ Extracted |
| **graduation_slot** | BIGINT | Blockchain slot of graduation | BC account monitor | ✅ Extracted |
| **price_source** | TEXT | Last price update source | Price services | ✅ Extracted |
| **last_graphql_update** | TIMESTAMP | Last GraphQL price update | GraphQL recovery | ✅ Extracted |
| **last_rpc_update** | TIMESTAMP | Last RPC price update | RPC services | ❌ Not used |
| **last_dexscreener_update** | TIMESTAMP | Last DexScreener update | DexScreener service | ✅ Extracted |
| **created_at** | TIMESTAMP | Database record creation | Automatic | ✅ Extracted |

**Additional Fields Used But Not in Documented Schema**:
| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| **latest_price_sol** | DECIMAL(20,12) | Current price in SOL | Trade monitors | ✅ Extracted |
| **latest_price_usd** | DECIMAL(20,4) | Current price in USD | Price calculator | ✅ Extracted |
| **latest_market_cap_usd** | DECIMAL(20,4) | Current market cap | Price calculator | ✅ Extracted |
| **latest_virtual_sol_reserves** | BIGINT | Current SOL reserves | Trade parsers | ✅ Extracted |
| **latest_virtual_token_reserves** | BIGINT | Current token reserves | Trade parsers | ✅ Extracted |
| **latest_bonding_curve_progress** | DECIMAL(5,2) | BC completion % | BC calculator | ✅ Extracted |
| **latest_update_slot** | BIGINT | Last update slot | All monitors | ✅ Extracted |
| **current_program** | VARCHAR(20) | Current program (BC/AMM) | Trade monitors | ✅ Extracted |
| **first_program** | VARCHAR(20) | Initial program | Trade monitors | ✅ Extracted |
| **first_seen_slot** | BIGINT | First detection slot | Trade monitors | ✅ Extracted |
| **threshold_price_sol** | DECIMAL(20,12) | Price when crossed threshold | DB service | ✅ Extracted |
| **threshold_price_usd** | DECIMAL(20,4) | USD price at threshold | DB service | ✅ Extracted |
| **threshold_market_cap_usd** | DECIMAL(20,4) | Market cap at threshold | DB service | ✅ Extracted |
| **threshold_slot** | BIGINT | Slot when crossed threshold | DB service | ✅ Extracted |
| **token_created_at** | TIMESTAMP | Blockchain creation time | Metadata services | ✅ Extracted |
| **uri** | VARCHAR(512) | Metadata URI | Metadata enrichers | ✅ Extracted |
| **description** | TEXT | Token description | Metadata enrichers | ✅ Extracted |
| **image** | VARCHAR(512) | Token image URL | Metadata enrichers | ✅ Extracted |
| **decimals** | INTEGER | Token decimals (usually 6) | Metadata enrichers | ✅ Extracted |
| **supply** | VARCHAR(64) | Total token supply | Metadata enrichers | ✅ Extracted |
| **metadata_source** | VARCHAR(50) | Metadata provider | Enrichers | ✅ Extracted |
| **last_metadata_update** | TIMESTAMP | Last metadata update | Enrichers | ✅ Extracted |
| **updated_at** | TIMESTAMP | Last record update | Automatic | ✅ Extracted |

### 2. trades_unified Table

**Purpose**: Stores all trades from both bonding curve and AMM programs

| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| **signature** | VARCHAR(88) | Primary key - Transaction signature | All monitors | ✅ Extracted |
| **mint_address** | VARCHAR(64) | Token mint address | Trade parsers | ✅ Extracted |
| **program** | ENUM | 'bonding_curve' or 'amm_pool' | Monitor context | ✅ Extracted |
| **trade_type** | ENUM | 'buy' or 'sell' | Trade parsers | ✅ Extracted |
| **user_address** | VARCHAR(64) | Wallet performing trade | Trade parsers | ✅ Extracted |
| **sol_amount** | BIGINT | SOL amount in lamports | Trade parsers | ✅ Extracted |
| **token_amount** | BIGINT | Token amount (with decimals) | Trade parsers | ✅ Extracted |
| **price_sol** | DECIMAL(20,12) | Price per token in SOL | Price calculator | ✅ Extracted |
| **price_usd** | DECIMAL(20,4) | Price per token in USD | Price calculator | ✅ Extracted |
| **market_cap_usd** | DECIMAL(20,4) | Market cap at trade time | Price calculator | ✅ Extracted |
| **volume_usd** | DECIMAL(20,4) | Trade volume in USD | Price calculator | ✅ Extracted |
| **virtual_sol_reserves** | BIGINT | Virtual SOL reserves after trade | Trade parsers | ✅ Extracted |
| **virtual_token_reserves** | BIGINT | Virtual token reserves after trade | Trade parsers | ✅ Extracted |
| **bonding_curve_key** | VARCHAR(64) | BC address for graduation tracking | BC parser | ✅ Extracted |
| **bonding_curve_progress** | DECIMAL(5,2) | BC completion percentage | BC calculator | ✅ Extracted |
| **slot** | BIGINT | Blockchain slot number | gRPC stream | ✅ Extracted |
| **block_time** | TIMESTAMPTZ | Blockchain timestamp | gRPC stream | ✅ Extracted |
| **created_at** | TIMESTAMPTZ | Database record creation | Automatic | ✅ Extracted |

### 3. bonding_curve_mappings Table

**Purpose**: Maps bonding curve addresses to token mints for graduation tracking

| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| **bonding_curve_key** | VARCHAR(64) | Primary key - BC address | BC trades | ✅ Extracted |
| **mint_address** | VARCHAR(64) | Associated token mint | BC trades | ✅ Extracted |
| **created_at** | TIMESTAMP | Creation time | Automatic | ✅ Extracted |
| **updated_at** | TIMESTAMP | Update time | Automatic | ✅ Extracted |

### 4. amm_pool_states Table

**Purpose**: Tracks AMM pool reserve states over time

| Field | Type | Description | Source | Status |
|-------|------|-------------|--------|--------|
| **id** | BIGSERIAL | Primary key | Automatic | ✅ Extracted |
| **mint_address** | VARCHAR(64) | Token mint address | AMM monitor | ✅ Extracted |
| **pool_address** | VARCHAR(64) | AMM pool address | AMM monitor | ✅ Extracted |
| **virtual_sol_reserves** | BIGINT | Virtual SOL reserves | AMM account monitor | ✅ Extracted |
| **virtual_token_reserves** | BIGINT | Virtual token reserves | AMM account monitor | ✅ Extracted |
| **real_sol_reserves** | BIGINT | Actual SOL reserves | AMM account monitor | ✅ Extracted |
| **real_token_reserves** | BIGINT | Actual token reserves | AMM account monitor | ✅ Extracted |
| **pool_open** | BOOLEAN | Whether pool is open | AMM account monitor | ✅ Extracted |
| **slot** | BIGINT | Blockchain slot | gRPC stream | ✅ Extracted |
| **created_at** | TIMESTAMPTZ | Creation time | Automatic | ✅ Extracted |

### 5. Additional Tables Referenced (Not in Main Schema)

**price_snapshots_unified**: Stores periodic price snapshots
- mint_address, price_sol, price_usd, market_cap_usd, reserves, slot

**account_states_unified**: Stores account state updates
- mint_address, program, account_type, reserves, bonding_curve_complete, slot

**sol_prices**: Stores SOL/USD price history
- price, timestamp

## Data Extraction Process

### 1. Bonding Curve (BC) Monitor

**Extracts from blockchain**:
- Trade events (buy/sell) from pump.fun program
- Mint addresses from event data or logs
- SOL and token amounts
- User wallet addresses
- Virtual reserves after each trade
- Bonding curve keys for graduation tracking

**Calculates**:
- Price per token in SOL
- USD prices using current SOL price
- Market cap (assumes 1B token supply)
- Bonding curve progress (0-100%)

### 2. BC Account Monitor

**Extracts from blockchain**:
- Bonding curve account states
- Completion status (graduated or not)
- Progress percentage
- Virtual reserves

**Triggers**:
- Graduation detection when complete = true
- Updates token graduation status

### 3. AMM Monitor

**Extracts from blockchain**:
- Swap events from pump.swap program
- Input/output token mints
- Swap amounts (in/out)
- Pool addresses
- User addresses

**Calculates**:
- Trade direction (buy/sell)
- Price based on swap ratio
- Market cap using pool reserves

**Special behavior**:
- Creates new token entries for AMM tokens
- Uses lower threshold ($1,000 vs $8,888)

### 4. AMM Account Monitor

**Extracts from blockchain**:
- Pool account states
- LP token supply
- Pool token account addresses
- Reserve balances

**Updates**:
- Pool state service with latest reserves
- Enables accurate price calculations

## Data Quality Assessment

### ✅ High Quality/Complete
- Transaction signatures and basic trade data
- SOL/token amounts and prices
- User addresses
- Market cap calculations
- Graduation detection
- Basic token metadata (via enrichers)

### ⚠️ Partial/Inconsistent
- Virtual reserves (not always available)
- Bonding curve progress (depends on reserves)
- Pool states (requires account monitor)
- Token metadata (depends on enricher success)

### ❌ Missing/Not Extracted
- Transaction fees
- Slippage/price impact
- MEV/sandwich attack detection
- Liquidity provider data
- Historical price charts (only snapshots)
- Token holder counts
- Social metrics

## Recommendations

### 1. Schema Improvements

**Normalize the schema**:
- Separate current/latest fields into a `token_states` table
- Move metadata to dedicated `token_metadata` table
- Create `token_prices` table for time-series data

**Add missing fields**:
```sql
ALTER TABLE tokens_unified ADD COLUMN IF NOT EXISTS
  holders_count INTEGER,
  liquidity_usd DECIMAL(20,4),
  volume_24h_usd DECIMAL(20,4),
  price_change_24h DECIMAL(10,4),
  fully_diluted_valuation DECIMAL(20,4);

ALTER TABLE trades_unified ADD COLUMN IF NOT EXISTS
  fee_amount BIGINT,
  price_impact DECIMAL(10,6),
  slippage DECIMAL(10,6);
```

### 2. Data Extraction Enhancements

**Enhanced monitoring**:
- Track liquidity changes
- Monitor holder distribution
- Detect rugpull patterns
- Track whale movements

**Additional calculations**:
- 24h volume aggregation
- Price volatility metrics
- Liquidity depth analysis
- Trade frequency patterns

### 3. Performance Optimizations

**Indexing strategy**:
```sql
-- Composite indexes for common queries
CREATE INDEX idx_tokens_price_tracking ON tokens_unified(mint_address, latest_update_slot DESC);
CREATE INDEX idx_trades_analysis ON trades_unified(mint_address, block_time DESC, trade_type);

-- Partial indexes for filtered queries
CREATE INDEX idx_tokens_active ON tokens_unified(latest_market_cap_usd) 
  WHERE latest_market_cap_usd >= 1000;
CREATE INDEX idx_tokens_graduated ON tokens_unified(graduated_to_amm, graduation_at DESC) 
  WHERE graduated_to_amm = true;
```

**Partitioning**:
- Partition trades_unified by block_time (monthly)
- Archive old trades to separate tables
- Use materialized views for analytics

### 4. System Design Recommendations

**Event-driven architecture**:
- Current system uses EventBus effectively
- Consider adding event sourcing for trade history
- Implement CQRS for read/write separation

**Microservices approach**:
- Separate price tracking service
- Dedicated metadata service
- Independent analytics service
- Real-time alerting service

**Data pipeline improvements**:
- Add data validation layer
- Implement data quality checks
- Create data lineage tracking
- Add monitoring and alerting

## Conclusion

The current database schema and extraction system effectively captures core trading data and token lifecycle events. The main areas for improvement are:

1. **Schema normalization** to reduce redundancy
2. **Additional metrics** for better market analysis
3. **Performance optimization** through better indexing
4. **System architecture** improvements for scalability

The data extraction is comprehensive for basic monitoring but could be enhanced with additional market metrics and analysis capabilities.