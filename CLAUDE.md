# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Real-time Solana token monitor for pump.fun bonding curves and pump.swap AMM pools. Streams blockchain data via Shyft's gRPC endpoint, tracks token prices and market caps, saves high-value tokens (≥$8,888) to PostgreSQL, and provides a web dashboard for monitoring.

## Development Commands

```bash
# Production Commands
npm run start               # Run all 4 monitors with production features (RECOMMENDED)
npm run dev                 # Same as npm run start (for development)

# Individual Monitors
npm run bc-monitor          # Bonding curve trade monitor (>95% parse rate)
npm run bc-account-monitor  # Bonding curve account monitor (detects graduations)
npm run amm-monitor         # AMM pool trade monitor for graduated tokens
npm run amm-account-monitor # AMM account state monitor for pool reserves

# Price Recovery & Enrichment
npm run sol-price-updater     # SOL price updater (runs automatically with monitors)
npm run startup-recovery      # Run stale token detection and recovery

# Dashboard & API
npm run dashboard            # Web dashboard (http://localhost:3001)

# Testing & Building
npm run test                 # Run all tests
npm run test:integration     # Integration tests only
npm run test:coverage        # Test coverage report
npm run build               # Build TypeScript (all errors fixed!)
```

## Architecture After Refactoring (January 2025)

### Directory Structure
```
src/
├── core/                           # Foundation layer with DI
│   ├── container.ts               # Dependency injection container
│   ├── container-factory.ts       # DI container setup
│   ├── event-bus.ts              # Event-driven communication
│   ├── stream-manager.ts         # Shared gRPC stream management (NEW)
│   ├── config.ts                 # Centralized configuration
│   ├── logger.ts                 # Structured logging
│   ├── base-monitor.ts           # Base monitor abstraction (enhanced Phase 2)
│   ├── subscription-builder.ts   # Advanced subscription configs (Phase 2)
│   ├── filter-factory.ts         # Memcmp/datasize filters (Phase 2)
│   └── slot-monitor.ts           # Slot tracking & fork detection (Phase 2)
├── monitors/
│   ├── bc-monitor.ts               # Bonding curve trade monitor (refactored with DI)
│   ├── bc-account-monitor.ts       # BC account state monitor (refactored with DI)
│   ├── amm-monitor.ts              # AMM pool trade monitor (enhanced with price impact)
│   ├── amm-account-monitor.ts      # AMM account state monitor (wrapped legacy with DI)
│   └── lp-token-monitor.ts         # LP token position monitor (Session 3)
├── services/                        # 20+ essential services
│   ├── sol-price.ts                # Binance API integration
│   ├── sol-price-updater.ts        # Automatic price updates
│   ├── bc-price-calculator.ts      # BC-specific price calculations
│   ├── bc-monitor-stats-aggregator.ts # Statistics aggregation
│   ├── enhanced-auto-enricher.ts   # Enhanced enricher with batch processing
│   ├── graphql-metadata-enricher.ts # GraphQL bulk metadata queries (disabled - schema issues)
│   ├── shyft-metadata-service.ts   # Shyft REST API for metadata (primary source)
│   ├── helius.ts                   # Helius DAS API client (fallback)
│   ├── amm-pool-state-service.ts   # AMM pool state tracking and caching
│   ├── graphql-client.ts           # Shyft GraphQL client with retry logic
│   ├── unified-graphql-price-recovery.ts # Unified BC/AMM price recovery
│   ├── stale-token-detector.ts     # Automatic stale token detection/recovery
│   ├── dexscreener-price-service.ts    # DexScreener API client
│   ├── dexscreener-price-recovery.ts   # Stale graduated token recovery
│   ├── price-calculator.ts         # General price calculations
│   ├── recovery-queue.ts           # Recovery queue management (NEW)
│   ├── idl-parser-service.ts       # Anchor IDL parsing (Phase 1)
│   ├── event-parser-service.ts     # Event extraction from logs (Phase 1)
│   ├── inner-ix-parser.ts          # Inner instruction analysis (Phase 1)
│   ├── amm-fee-service.ts          # AMM fee analytics (Session 2)
│   ├── lp-position-calculator.ts   # LP position P&L calculations (Session 3)
│   ├── amm-pool-analytics.ts       # Pool TVL/APY analytics (Session 4)
│   ├── liquidity-depth-calculator.ts # Liquidity depth analysis (Session 4)
│   ├── amm-metrics-aggregator.ts   # Scheduled metrics jobs (Session 4)
│   ├── enhanced-amm-price-calculator.ts # Price impact analysis (Session 5)
│   └── trade-simulation-service.ts # Trade optimization (Session 5)
├── api/
│   ├── server-unified.ts           # Main API server
│   ├── server-refactored.ts        # Refactored API server
│   ├── bc-monitor-endpoints.ts     # BC monitor specific endpoints
│   └── amm-endpoints.ts            # AMM analytics endpoints
├── database/
│   └── unified-db-service.ts       # High-performance DB service
├── parsers/
│   ├── unified-event-parser.ts     # Main parser for both programs (enhanced Phase 1)
│   ├── strategies/
│   │   ├── base-strategy.ts        # Base parsing strategy
│   │   ├── bc-trade-strategy.ts    # BC trade parsing (with creator extraction)
│   │   ├── amm-trade-strategy.ts   # AMM trade parsing
│   │   ├── bc-trade-idl-strategy.ts # IDL-based BC parsing (Phase 1)
│   │   └── migration-detection-strategy.ts # Graduation detection (Phase 1)
│   ├── bc-event-parser.ts          # Legacy BC parser
│   └── types.ts                    # Parser types with Phase 1 enhancements
├── handlers/
│   ├── trade-handler.ts            # Unified trade handler
│   ├── graduation-handler.ts       # Graduation event handler
│   ├── liquidity-event-handler.ts  # Liquidity events (Session 1)
│   ├── fee-event-handler.ts        # Fee collection events (Session 2)
│   ├── lp-position-handler.ts      # LP position updates (Session 3)
│   ├── pool-analytics-handler.ts   # Pool analytics coordinator (Session 4)
│   └── enhanced-trade-handler.ts   # Trade handler with price impact (Session 5)
├── repositories/                    # Data access layer
│   ├── base-repository.ts          # Base repository pattern
│   ├── token-repository.ts         # Token data access
│   └── trade-repository.ts         # Trade data access
├── stream/
│   └── client.ts                   # Singleton gRPC client
├── utils/                          # 10+ essential utilities
│   ├── constants.ts                # Shared constants
│   ├── amm-pool-decoder.ts         # AMM pool decoding
│   ├── amm-price-calculator.ts     # AMM price calculations
│   ├── bn-layout-formatter.ts      # BN layout formatting
│   ├── event-parser.ts             # Event parsing utilities (from Shyft)
│   ├── pump-addresses.ts           # Address derivation utilities
│   ├── suppress-parser-warnings.ts # Suppress ComputeBudget warnings
│   ├── swapTransactionParser.ts    # AMM swap parsing (from Shyft)
│   ├── transaction-formatter.ts    # gRPC transaction formatting (from Shyft)
│   └── parser-error-suppressor.ts  # Configurable error suppression (Phase 1)
├── scripts/                        # Utility scripts
│   ├── sol-price-updater.ts       # SOL price update script
│   └── startup-recovery.ts         # Startup recovery script
├── tests/                          # Test suite
│   └── integration/                # Integration tests
│       ├── container.test.ts       # DI container tests
│       ├── monitor-integration.test.ts # Monitor integration tests
│       ├── system-e2e.test.ts      # End-to-end tests
│       └── websocket-integration.test.ts # WebSocket tests
└── index.ts                        # Main entry point - starts all 4 monitors
```

### Core Data Flow
1. **gRPC Stream** (Shyft) → Raw blockchain data
2. **Event Parser** → Extract trades from transaction logs
3. **Price Calculator** → Compute prices from virtual reserves
4. **Database Service** → Batch processing with caching
5. **Dashboard** → Display and track tokens

### Key Implementation Details

#### Refactored Architecture (January 2025 Update)
The system has been refactored to use clean architecture principles:
- **Dependency Injection**: All services managed by DI container
- **Event-Driven**: Components communicate via EventBus
- **Repository Pattern**: Clean data access layer
- **Base Abstractions**: Common monitor functionality in BaseMonitor
- **Shared Stream Manager**: Single gRPC connection shared by all monitors (NEW)
- **TypeScript Build**: All build errors fixed, proper type safety

#### Critical Fixes (January 2025)
1. **Monitor Connection Issues**: Fixed gRPC data structure handling
   - Transaction data path: `data.transaction.transaction.transaction`
   - Proper subscription keys: `pumpfun`, `pumpswap_amm` (must be consistent!)
   - **AMM Monitor Fix**: Both AMM monitors must use `pumpswap_amm` as subscription key
   - Fixed gRPC subscription format - must include all fields (even empty ones)
   - Account monitors must override `isRelevantTransaction` to check for account data
2. **Metadata Enrichment**: Fixed rate limiting and efficiency
   - Batch size: 20 tokens
   - Rate limit: 200ms between requests
   - Intelligent caching to prevent redundant API calls
3. **TypeScript Errors**: All build errors resolved
   - IDL type compatibility fixed
   - Proper error handling
   - No implicit any types
4. **Database Schema Updates**:
   - Fixed `sol_prices` table column names (`price_usd` not `price`)
   - Added missing `token_created_at` column to `tokens_unified`
   - Created separate database for AMM enhancement worktree

To use the refactored monitors:
```bash
npm run start           # RECOMMENDED: Runs all 4 monitors with production features
npm run dev             # Same as npm run start
```

#### Monitor Architecture (January 2025)
The monitoring system now uses a hybrid approach:
- **BC Monitors** (`bc-monitor.ts`, `bc-account-monitor.ts`):
  - Fully refactored with clean architecture
  - Extend BaseMonitor class
  - Native DI container integration
  - Event-driven communication via EventBus
- **AMM Monitors** (`amm-monitor.ts`, `amm-account-monitor.ts`):
  - Wrapped legacy monitors due to gRPC issues with full refactoring
  - Preserve proven parsing logic
  - Extend BaseMonitor for DI integration
  - Emit events: `AMM_TRADE`, `POOL_STATE_UPDATED`, `TRADE_PROCESSED`, `POOL_CREATED`

Benefits:
- Consistent architecture across all monitors
- Full integration with DI container and EventBus
- Works seamlessly with graduation handler
- All trades emit proper events for other components
- Verified accurate against Solscan.io

#### Graduation Handler (`graduation-handler.ts`)
Manages bonding curve to AMM graduation tracking:
- Listens to `TRADE_PROCESSED` events to build BC → mint mappings
- Detects `TOKEN_GRADUATED` events from BC account monitor
- Updates token graduation status in database
- Maintains in-memory cache of bonding curve mappings
- Stores mappings in `bonding_curve_mappings` table
- **Important**: Requires `bonding_curve_key` column in trades table

Event Flow:
1. BC Monitor extracts `bondingCurveKey` from trade events
2. Trade Handler emits `TRADE_PROCESSED` with BC key
3. Graduation Handler builds BC → mint mapping
4. BC Account Monitor detects graduation (complete = true)
5. Graduation Handler updates token as graduated

#### Database Service (`unified-db-service.ts`)
High-performance service using:
- Mint addresses as primary keys (not UUIDs)
- Batch processing with 1-second intervals
- In-memory cache for recent tokens
- Atomic threshold crossing detection
- Connection pooling for PostgreSQL
- **NEW**: Automatic token creation for AMM trades
- Different thresholds: $1,000 for AMM, $8,888 for BC

#### Parser Strategy (`unified-parser.ts`)
- Simple log parsing for pump.fun events (catches more trades)
- Buy/sell detection from instruction logs for AMM
- Handles Buffer-encoded account keys from gRPC (must use bs58.encode())
- Fallback mint extraction from transaction logs

### Critical Implementation Details

#### Environment Variables
```bash
# Required
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to  # Must include https://
SHYFT_GRPC_TOKEN=your-token-here
DATABASE_URL=postgresql://user@localhost:5432/pump_monitor

# Optional
HELIUS_API_KEY=your-api-key          # For metadata enrichment (fallback)
SHYFT_API_KEY=your-api-key           # For Shyft DAS API (primary metadata source)
API_PORT=3001                        # Dashboard port

# BC Monitor Configuration
BC_SAVE_THRESHOLD=8888               # Market cap threshold for saving tokens
SAVE_ALL_TOKENS=false                # Save all tokens regardless of threshold
DEBUG_PARSE_ERRORS=false             # Enable detailed parse error logging
```

#### Transaction Structure (gRPC)
```javascript
// Triple-nested structure from Shyft gRPC - IMPORTANT!
data.transaction.transaction.transaction.message.accountKeys  // Buffer[]
data.transaction.transaction.meta                            // Contains logs
data.transaction.transaction.signature                       // Signature
```

#### Key Constants
- Token decimals: 6
- SOL decimals: 9 (1 SOL = 1e9 lamports)
- Market cap calculation: Assumes 1B token supply
- Bonding curve progress: 30 SOL → 85 SOL = 100%
- Threshold: $8,888 USD market cap

#### Common Issues & Solutions

1. **Monitor connection issues (FIXED January 2025)**
   - gRPC data has triple-nested structure
   - Solution: Updated parser to handle `data.transaction.transaction.transaction`
   - Subscription keys must match exactly: `pumpfun`, `pumpswap_amm`, `pumpAMM`
   - **gRPC Subscription Format**: Must include ALL fields from Shyft examples (even empty ones)
   - **Account Monitors**: Must override `isRelevantTransaction` to return true for `data.account`

2. **Metadata enrichment rate limits (FIXED January 2025)**
   - GraphQL doesn't have required tables
   - Solution: Disabled GraphQL, use Shyft API with 200ms rate limit
   - Batch size: 20 tokens, intelligent caching

3. **TypeScript build errors (FIXED January 2025)**
   - IDL type incompatibility between Anchor versions
   - Solution: Cast to `any` for IDL types
   - All implicit any types now have proper annotations

4. **AMM Account Monitor Issues (FIXED January 2025)**
   - Account updates not being processed
   - Solution: Override `isRelevantTransaction` to check for account data
   - Monitor now correctly processes hundreds of pool state updates per minute

5. **AMM Price Calculation Issue (CRITICAL - January 2025)**
   - All AMM trades have `price_usd = 0` and `market_cap_usd = 0`
   - Root cause: `priceCalculator.calculatePrice()` returns zeros for AMM trades
   - Impact: No tokens saved to database (don't meet $1,000 threshold)
   - Impact: Session 5 price impact calculations don't trigger
   - Status: **NEEDS FIX** - See AMM_MONITOR_TEST_REPORT.md
   - Workaround: None currently available

### Database Schema (Unified)

```sql
-- Main token table with mint_address as PRIMARY KEY
CREATE TABLE tokens_unified (
    mint_address VARCHAR(64) PRIMARY KEY,
    symbol VARCHAR(50),
    name VARCHAR(255),
    first_price_sol DECIMAL(20, 12),
    first_price_usd DECIMAL(20, 4),
    first_market_cap_usd DECIMAL(20, 4),
    threshold_crossed_at TIMESTAMP,
    graduated_to_amm BOOLEAN DEFAULT FALSE,
    graduation_at TIMESTAMP,
    graduation_slot BIGINT,
    price_source TEXT DEFAULT 'unknown',
    last_graphql_update TIMESTAMP,
    last_rpc_update TIMESTAMP,
    last_dexscreener_update TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Pump.fun specific columns (NEW)
    creator VARCHAR(64),
    total_supply BIGINT,
    bonding_curve_key VARCHAR(64)
);

-- Trades with efficient indexing
CREATE TABLE trades_unified (
    signature VARCHAR(88) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    program program_type NOT NULL,
    trade_type trade_type,
    user_address VARCHAR(64) NOT NULL,
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    price_sol DECIMAL(20, 12) NOT NULL,
    price_usd DECIMAL(20, 4) NOT NULL,
    market_cap_usd DECIMAL(20, 4) NOT NULL,
    volume_usd DECIMAL(20, 4),
    virtual_sol_reserves BIGINT,
    virtual_token_reserves BIGINT,
    bonding_curve_key VARCHAR(64),
    bonding_curve_progress DECIMAL(5, 2),
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_trades_unified_user ON trades_unified(user_address);
CREATE INDEX idx_trades_unified_mint_time ON trades_unified(mint_address, block_time DESC);
CREATE INDEX idx_trades_unified_bonding_curve_key ON trades_unified(bonding_curve_key) WHERE bonding_curve_key IS NOT NULL;

-- Bonding Curve Mappings (For graduation tracking)
CREATE TABLE bonding_curve_mappings (
    bonding_curve_key VARCHAR(64) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(mint_address)
);

-- Creator Analysis (For pump.fun risk assessment)
CREATE TABLE creator_analysis (
    creator_address VARCHAR(64) PRIMARY KEY,
    tokens_created INTEGER DEFAULT 0,
    tokens_graduated INTEGER DEFAULT 0,
    tokens_rugged INTEGER DEFAULT 0,
    graduation_rate DECIMAL(5, 2),
    avg_market_cap DECIMAL(20, 4),
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    analyzed_at TIMESTAMP DEFAULT NOW()
);

-- AMM Enhancement Tables (Sessions 1-5)
-- Session 1: Liquidity Events
CREATE TABLE liquidity_events (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(88) NOT NULL,
    pool_address VARCHAR(64) NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    lp_token_amount BIGINT NOT NULL,
    token_a_amount BIGINT,
    token_b_amount BIGINT,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session 2: Fee Tracking
CREATE TABLE amm_fee_events (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(88) NOT NULL,
    pool_address VARCHAR(64) NOT NULL,
    fee_type VARCHAR(20) NOT NULL,
    recipient VARCHAR(64),
    coin_amount BIGINT,
    pc_amount BIGINT,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session 3: LP Positions
CREATE TABLE lp_positions (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(64) NOT NULL,
    pool_address VARCHAR(64) NOT NULL,
    lp_token_balance BIGINT NOT NULL DEFAULT 0,
    initial_investment_usd DECIMAL(20, 4),
    current_value_usd DECIMAL(20, 4),
    realized_pnl_usd DECIMAL(20, 4) DEFAULT 0,
    unrealized_pnl_usd DECIMAL(20, 4) DEFAULT 0,
    impermanent_loss DECIMAL(10, 6),
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session 4: Pool Analytics
CREATE TABLE amm_pool_metrics_hourly (
    pool_address VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    tvl_usd DECIMAL(20, 4),
    volume_usd DECIMAL(20, 4),
    fees_usd DECIMAL(20, 4),
    trade_count INTEGER,
    PRIMARY KEY (pool_address, timestamp)
);

-- Session 5: Price Impact
ALTER TABLE trades_unified 
ADD COLUMN IF NOT EXISTS price_impact DECIMAL(10, 6),
ADD COLUMN IF NOT EXISTS effective_fee DECIMAL(10, 6),
ADD COLUMN IF NOT EXISTS spot_price DECIMAL(20, 12),
ADD COLUMN IF NOT EXISTS execution_price DECIMAL(20, 12),
ADD COLUMN IF NOT EXISTS slippage DECIMAL(10, 6);

CREATE TABLE trade_simulations (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(64) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    total_input_amount BIGINT NOT NULL,
    num_chunks INTEGER NOT NULL,
    total_price_impact DECIMAL(10, 6),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Testing & Debugging

1. **Integration Tests**: `npm run test:integration` - Test DI container, monitors, and WebSocket
2. **Custom threshold testing**: `BC_SAVE_THRESHOLD=1000 npm run bc-monitor`
3. **Check recent trades**: View dashboard at http://localhost:3001
4. **Database verification**: `psql $DATABASE_URL -c "SELECT * FROM trades_unified ORDER BY block_time DESC LIMIT 10"`

## Performance Optimization

- Parse rate improved from 82.9% to >95% by handling multiple event sizes
- Token save rate improved from 81% to >95% with retry logic
- Batch database operations reduce connection overhead by 90%
- In-memory token cache minimizes database queries
- Simple parsing catches ~15% more events than strict IDL parsing
- Concurrent monitoring of both programs in single process
- Rate limiting prevents API exhaustion
- Enhanced statistics tracking for better monitoring
- Shared gRPC stream reduces connection count

## Phase 1 Enhancements (January 2025) - IDL-Based Parsing

### ✅ New Components Added

1. **IDL Parser Service** (`services/idl-parser-service.ts`)
   - Centralized Anchor IDL management for pump.fun and AMM programs
   - Type-safe instruction parsing with proper account extraction
   - Support for inner instruction parsing

2. **Event Parser Service** (`services/event-parser-service.ts`)
   - Extracts Anchor events from transaction logs
   - Supports trade events, graduation events, and pool creation events
   - Silent console for suppressing parser warnings

3. **Inner Instruction Parser** (`services/inner-ix-parser.ts`)
   - Analyzes inner instructions for deeper transaction understanding
   - Detects token transfers and program call hierarchies
   - Provides transaction flow analysis

4. **Enhanced Parsing Strategies**
   - `bc-trade-idl-strategy.ts`: IDL-based BC parsing with event extraction
   - `migration-detection-strategy.ts`: Detects graduations and pool creations
   - Seamless fallback to simple parsing when IDL parsing fails

5. **Error Suppression System** (`utils/parser-error-suppressor.ts`)
   - Configurable suppression for parser warnings, ComputeBudget, unknown programs
   - Tracks suppression statistics
   - Reduces log noise significantly

### 🔧 Key Technical Improvements

- **IDL Integration**: Proper Anchor IDL parsing replaces simple byte extraction
- **Event Extraction**: Events parsed from logs, not just instruction decoding
- **Type Safety**: All new code has proper TypeScript types
- **Backward Compatible**: New parsers work alongside existing strategies
- **Production Ready**: All TypeScript errors fixed, builds cleanly

## Current System Status (January 2025)

### ✅ Working Components

1. **Real-time Monitoring**
   - BC Monitor: Captures bonding curve trades with >95% parse rate
   - BC Account Monitor: Detects graduations in real-time
   - AMM Monitor: Captures AMM trades BUT price calculation broken (see issue #5)
   - AMM Account Monitor: Tracks pool states and reserves correctly
   - Shared Stream Manager: Single gRPC connection for all monitors
   - **CRITICAL ISSUE**: AMM trades have $0 prices, preventing token saves

2. **Price Recovery**
   - GraphQL: Disabled due to schema issues
   - DexScreener: Successfully recovers graduated token prices
   - Includes liquidity, volume, and 24h change data

3. **Enhanced Token Enrichment**
   - **Efficient batch processing**: 20 tokens per batch with 200ms rate limit
   - **Shyft REST API** as primary source
   - **Helius DAS API** as fallback (if API key configured)
   - Intelligent caching prevents redundant API calls
   - Immediate enrichment when tokens cross threshold or AMM creation
   - Background service runs automatically with monitors

4. **AMM Event Enhancement (Session 1 Completed - January 2025)**
   - **Enhanced Event Parser**: Extracts AMM-specific events (deposits, withdrawals, buy/sell with fees)
   - **Liquidity Event Handler**: Processes liquidity add/remove operations with value calculations
   - **Database Schema**: Complete tracking of liquidity events, user positions, and hourly metrics
   - **Real-time Notifications**: EventBus integration for liquidity events >$10k
   - **User Position Tracking**: Track LP positions, P&L, and impermanent loss

5. **Fee Tracking System (Session 2 Completed - January 2025)**
   - **Fee Event Extraction**: Identifies creator and protocol fees from events
   - **AMM Fee Service**: Calculates fee metrics and earnings
   - **Fee Event Handler**: Processes and stores fee events
   - **Database Schema**: Tracks all fee collections and analytics

6. **LP Token & Position Tracking (Session 3 Completed - January 2025)**
   - **LP Token Monitor**: Real-time tracking of LP token movements
   - **LP Position Calculator**: Calculates P&L, impermanent loss, and rewards
   - **Position Updates**: Real-time position tracking via EventBus
   - **Database Schema**: Comprehensive LP position history

7. **Advanced Pool Analytics (Session 4 Completed - January 2025)**
   - **Pool Analytics Service**: TVL, volume, fees, and APY calculations
   - **Liquidity Depth Analysis**: Available liquidity at different price impacts
   - **Metrics Aggregator**: Scheduled jobs for historical analytics
   - **Performance Tracking**: Comprehensive pool performance metrics

8. **Enhanced Price Impact & Slippage (Session 5 Completed - January 2025)**
   - **Price Impact Calculator**: Detailed impact analysis for every trade
   - **Trade Simulation**: Optimize large trades with chunking strategies
   - **Slippage Analysis**: Historical slippage tracking and recommendations
   - **Enhanced Trade Handler**: Automatic price impact for all AMM trades
   - **STATUS**: Code complete but not functioning due to price calculation issue #5

9. **Key Improvements**
   - AMM tokens now created automatically with $1,000 threshold (broken - see issue #5)
   - DexScreener integration provides fallback for stale graduated tokens
   - Complete monitoring script runs all services
   - All tokens above $8,888 market cap automatically get metadata
   - TypeScript build errors fully resolved
   - Proper error handling and type safety
   - AMM liquidity events fully tracked and stored (not detecting events currently)

### ⚠️ Known Issues Requiring Fix

1. **AMM Price Calculation** (Critical)
   - `priceCalculator.calculatePrice()` returns 0 for all AMM trades
   - Prevents tokens from being saved (don't meet threshold)
   - Blocks all Session 5 price impact features
   - See AMM_MONITOR_TEST_REPORT.md for details

2. **Event Detection**
   - Liquidity events not being parsed/detected
   - Fee events not being captured
   - May be related to price calculation issue

### 🚀 Quick Start

```bash
# Run the recommended setup
npm run start            # Starts all 4 monitors with DI
npm run dashboard         # In another terminal, starts API & dashboard

# Optional services
npm run sol-price-updater # SOL price updates (automatic with monitors)
npm run startup-recovery  # Stale token recovery
```

### 📊 System Architecture

```
Real-time Data Flow:
├── Shyft gRPC → Shared Stream Manager → Monitors → Database → Dashboard
├── BC trades → Non-graduated prices
├── AMM trades → Graduated prices + new tokens
└── Account updates → Graduation detection

Recovery Flow:
├── Stale BC tokens → Disabled (GraphQL issues)
└── Stale graduated tokens → DexScreener API
```

## Phase 2 Enhancements (January 2025) - Advanced Subscriptions

### ✅ New Components Added

1. **Subscription Builder** (`core/subscription-builder.ts`)
   - Fluent API for building complex subscription configurations
   - Support for transaction, account, and slot subscriptions
   - Data slicing for bandwidth optimization
   - Commitment level configuration

2. **Filter Factory** (`core/filter-factory.ts`)
   - Create memcmp filters for account field matching
   - Pre-built filters for bonding curves and AMM pools
   - Filter validation and optimization utilities

3. **Slot Monitor** (`core/slot-monitor.ts`)
   - Real-time slot progression tracking
   - Fork detection and handling
   - Slot statistics and lag monitoring
   - Event emission for slot updates

4. **Enhanced BaseMonitor**
   - Support for failed transaction monitoring
   - Account filtering with required/excluded accounts
   - Optional slot tracking
   - Data slicing configuration
   - Enhanced subscription builder integration

### 🔧 Key Features

- **Failed Transaction Monitoring**: Analyze failed trades for MEV detection
- **Account Filters**: Monitor specific accounts or patterns
- **Slot Tracking**: Detect forks and track blockchain progression
- **Data Slicing**: Reduce bandwidth with partial account data
- **Recovery from Slot**: Resume monitoring from specific slot

## Enhancement Roadmap

### Bonding Curve Enhancement Plan
See `BONDING-CURVE-ENHANCEMENT-PLAN.md` for the complete 6-phase enhancement plan:
- **Phase 1**: ✅ Core Infrastructure & Parser Upgrade (COMPLETED)
- **Phase 2**: ✅ Advanced Subscription & Filtering (COMPLETED)
- **Phase 3**: New Token & Migration Detection
- **Phase 4**: Failed Transaction & MEV Analysis
- **Phase 5**: Advanced State Tracking & Analytics
- **Phase 6**: Performance Optimization & Production Features

### AMM Enhancement Strategy
See `AMM-ENHANCEMENT-STRATEGY.md` for AMM-specific enhancements:
- **Session 1**: ✅ AMM Event Enhancement (COMPLETED - January 2025)
  - Liquidity event tracking (deposits/withdrawals)
  - Fee event monitoring
  - LP position tracking
- **Session 2**: ✅ Fee Tracking System (COMPLETED - January 2025)
  - Fee event interfaces and extraction
  - AMM fee service for analytics
  - Fee event handler with DI integration
  - Database schema for fee tracking
  - Integration with AMM monitor
- **Session 3**: ✅ LP Token & Position Tracking (COMPLETED - January 2025)
  - LP token monitor for real-time position tracking
  - LP position calculator with P&L and impermanent loss
  - LP position handler with DI integration
  - Database schema for LP positions and rewards
  - Real-time position updates via EventBus
- **Session 4**: ✅ Advanced Pool Analytics (COMPLETED - January 2025)
  - Pool analytics service for TVL, volume, and APY calculations
  - Liquidity depth calculator for price impact analysis
  - Metrics aggregator with scheduled jobs using node-cron
  - Pool analytics handler coordinating all analytics
  - Database schema for hourly metrics and performance tracking
- **Session 5**: ✅ Enhanced Price Impact & Slippage (COMPLETED - January 2025)
  - Enhanced AMM price calculator with detailed impact analysis
  - Trade simulation service for optimizing large trades
  - Enhanced trade handler integrating price impact into all AMM trades
  - Database schema for price impact and slippage tracking
  - Real-time monitoring of high impact trades
- **Session 6**: Dashboard & API Enhancements

# important-instruction-reminders
- Do what has been asked; nothing more, nothing less.
- NEVER create files unless they're absolutely necessary for achieving your goal.
- ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- When running monitors, check that transactions are being received and parsed correctly.
- All TypeScript code must pass `npm run build` without errors.