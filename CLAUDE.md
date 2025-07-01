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

# Performance Optimized Mode (Phase 6)
npm run start:performance    # Run monitors with all performance optimizations
npm run performance:metrics  # Performance metrics API (http://localhost:3002)

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
│   ├── amm-monitor.ts              # AMM pool trade monitor (wrapped legacy with DI)
│   └── amm-account-monitor.ts      # AMM account state monitor (wrapped legacy with DI)
├── services/                        # 30+ essential services
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
│   ├── token-creation-detector.ts  # New token detection (Phase 3)
│   ├── migration-tracker.ts        # BC to AMM migration tracking (Phase 3)
│   ├── pool-creation-monitor.ts    # Pool creation detection (Phase 3)
│   ├── token-lifecycle-service.ts  # Token lifecycle tracking (Phase 3)
│   ├── failed-tx-analyzer.ts       # Failed transaction analysis (Phase 4)
│   ├── mev-detector.ts            # MEV pattern detection (Phase 4)
│   ├── slippage-analyzer.ts       # Slippage analysis & recommendations (Phase 4)
│   ├── congestion-monitor.ts      # Network congestion monitoring (Phase 4)
│   ├── block-tracker.ts           # Block & slot tracking (Phase 5)
│   ├── state-history-service.ts   # State history & write versions (Phase 5)
│   ├── liquidity-depth-tracker.ts # Liquidity depth analysis (Phase 5)
│   ├── fork-detector.ts          # Fork detection & handling (Phase 5)
│   ├── consistency-validator.ts   # Cross-service validation (Phase 5)
│   ├── commitment-strategy.ts     # Dynamic commitment level management (Phase 6)
│   ├── multi-region-manager.ts    # Geographic failover and redundancy (Phase 6)
│   ├── slot-recovery-service.ts   # Historical data recovery (Phase 6)
│   ├── performance-monitor.ts     # Comprehensive performance tracking (Phase 6)
│   └── alert-manager.ts          # Intelligent alert aggregation (Phase 6)
├── api/
│   ├── server-unified.ts           # Main API server
│   ├── server-refactored.ts        # Refactored API server
│   ├── bc-monitor-endpoints.ts     # BC monitor specific endpoints
│   ├── amm-endpoints.ts            # AMM analytics endpoints
│   ├── migration-analytics-endpoints.ts # Migration analytics API (Phase 3)
│   ├── failure-analytics-endpoints.ts   # Failure analytics API (Phase 4)
│   └── performance-metrics-endpoints.ts # Performance metrics API (Phase 6)
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
│   └── graduation-handler.ts       # Graduation event handler
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
   - Proper subscription keys: `pumpfun`, `pumpswap_amm`, `pumpAMM`
   - Fixed StreamManager subscription format conversion from monitor configs to gRPC format
2. **Metadata Enrichment**: Fixed rate limiting and efficiency
   - Batch size: 20 tokens
   - Rate limit: 200ms between requests
   - Intelligent caching to prevent redundant API calls
3. **TypeScript Errors**: All build errors resolved
   - IDL type compatibility fixed
   - Proper error handling
   - No implicit any types
   - Fixed unused imports

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

2. **Metadata enrichment rate limits (FIXED January 2025)**
   - GraphQL doesn't have required tables
   - Solution: Disabled GraphQL, use Shyft API with 200ms rate limit
   - Batch size: 20 tokens, intelligent caching

3. **TypeScript build errors (FIXED January 2025)**
   - IDL type incompatibility between Anchor versions
   - Solution: Cast to `any` for IDL types
   - All implicit any types now have proper annotations

4. **BC Monitor Data Quality Fixes (July 2025)**
   - Fixed timestamp conversion: Unix timestamps (seconds) now properly converted to JavaScript Date objects
   - Fixed bonding curve key extraction: Now uses account array index 1 instead of incorrect event data
   - Fixed creator extraction: Removed from trade events (only available in creation transactions)
   - Fixed BC Account Monitor: Now uses enhanced subscription builder for proper account updates
   - Enabled automatic metadata enrichment: EnhancedAutoEnricher starts with monitors

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

## Complete System Architecture After All Enhancements

### Enhanced Monitoring Pipeline
```
1. Data Ingestion Layer
   ├── Shared gRPC Stream Manager
   ├── Enhanced Subscription Builder (Phase 2)
   └── Filter Factory for targeted monitoring

2. Parsing & Analysis Layer
   ├── IDL-based Event Parser (Phase 1)
   ├── Inner Instruction Analyzer
   ├── Failed Transaction Analyzer (Phase 4)
   └── MEV Pattern Detector

3. State Tracking Layer (Phase 5)
   ├── Block & Slot Tracker
   ├── State History Service
   ├── Fork Detection
   └── Write Version Tracking

4. Token Lifecycle Layer (Phase 3)
   ├── Creation Detection
   ├── Migration Tracking
   ├── Pool Creation Monitoring
   └── Abandonment Detection

5. Market Intelligence Layer
   ├── Liquidity Depth Analysis (Phase 5)
   ├── Price Impact Calculations
   ├── Slippage Recommendations (Phase 4)
   └── Manipulation Risk Assessment

6. Network Health Layer (Phase 4)
   ├── Congestion Monitoring
   ├── Failure Rate Analysis
   ├── MEV Activity Tracking
   └── Performance Metrics

7. Consistency & Recovery Layer (Phase 5)
   ├── Cross-Service Validation
   ├── Automatic Repair
   ├── Historical Reconstruction
   └── Orphaned Transaction Recovery

8. Performance & Production Layer (Phase 6)
   ├── Adaptive Commitment Strategy
   ├── Multi-Region Failover
   ├── Performance Monitoring
   ├── Alert Management
   └── Slot Recovery Service
```

### Database Schema Overview

After all phases, the system uses these primary tables:

1. **Core Trading Data**
   - `tokens_unified` - Token information with lifecycle status
   - `trades_unified` - All trades with enhanced metadata
   - `bonding_curve_mappings` - BC to token mappings

2. **Lifecycle Tracking** (Phase 3)
   - `token_lifecycle` - Complete token journey tracking
   - `creator_analysis` - Creator performance analytics
   - `migration_events` - BC to AMM migrations

3. **Failed Transaction Analysis** (Phase 4)
   - `failed_transactions` - Categorized failures
   - `mev_events` - Detected MEV activity
   - `slippage_analysis` - Historical slippage data

4. **State & Chain Tracking** (Phase 5)
   - `slot_progression` - Complete slot history
   - `account_state_history` - State changes with write versions
   - `liquidity_snapshots` - Periodic liquidity depth
   - `fork_events` - Detected forks and orphaned slots
   - `consistency_issues` - Validation failures

### API Endpoints Summary

The system provides comprehensive REST APIs:

1. **Core Monitoring** (`/api/v1/`)
   - Token data and trades
   - Real-time price feeds
   - Volume analytics

2. **Migration Analytics** (`/api/v1/lifecycle/`)
   - Token creation tracking
   - Graduation statistics
   - Creator leaderboards

3. **Failure Analytics** (`/api/v1/failures/`)
   - Failed transaction analysis
   - MEV detection stats
   - Slippage recommendations
   - Network congestion status

4. **Historical Queries** (`/api/v1/history/`)
   - State reconstruction
   - Historical liquidity
   - Fork information

## Current System Status (January 2025)

### ✅ Working Components

1. **Real-time Monitoring**
   - BC Monitor: Captures bonding curve trades with >95% parse rate
   - BC Account Monitor: Detects graduations in real-time
   - AMM Monitor: Captures AMM trades AND creates token entries automatically
   - AMM Account Monitor: Tracks pool states and reserves
   - Shared Stream Manager: Single gRPC connection for all monitors

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

4. **Key Improvements**
   - AMM tokens now created automatically with $1,000 threshold
   - DexScreener integration provides fallback for stale graduated tokens
   - Complete monitoring script runs all services
   - All tokens above $8,888 market cap automatically get metadata
   - TypeScript build errors fully resolved
   - Proper error handling and type safety

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

## Phase 3 Enhancements (January 2025) - Token Lifecycle Tracking

### ✅ New Components Added

1. **Token Creation Detector** (`services/token-creation-detector.ts`)
   - Detects new token creation from transactions
   - Multiple detection methods: postTokenBalances, instructions, logs
   - Emits `token:created` events

2. **Migration Tracker** (`services/migration-tracker.ts`)
   - Tracks BC to AMM graduations
   - Monitors migration lifecycle phases
   - Maintains creator statistics

3. **Pool Creation Monitor** (`services/pool-creation-monitor.ts`)
   - Detects new pool creation events
   - Supports pump AMM, Raydium, and Orca pools
   - Links graduated tokens to their pools

4. **Token Lifecycle Service** (`services/token-lifecycle-service.ts`)
   - Comprehensive lifecycle tracking from creation to graduation
   - Abandoned token detection
   - Creator analysis and statistics

5. **Migration Analytics API** (`api/migration-analytics-endpoints.ts`)
   - Lifecycle statistics endpoint
   - Migration flow analysis
   - Top creators leaderboard
   - Abandoned tokens analytics

### 🔧 Key Features

- **Complete Lifecycle Tracking**: From token creation through graduation
- **Creator Analytics**: Track success rates and patterns
- **Migration Detection**: Real-time BC to AMM migration tracking
- **Abandoned Token Detection**: Identify failed projects
- **Analytics Dashboard**: Comprehensive migration analytics

## Phase 4 Enhancements (January 2025) - Failed Transaction & MEV Analysis

### ✅ New Components Added

1. **Failed Transaction Analyzer** (`services/failed-tx-analyzer.ts`)
   - Analyzes failed transactions to determine failure reasons
   - Tracks slippage, insufficient funds, MEV, and other failures
   - Builds analysis metadata for each failure type
   - Maintains statistics on failure patterns

2. **MEV Detector** (`services/mev-detector.ts`)
   - Detects sandwich attacks, frontrunning, and arbitrage
   - Tracks suspicious addresses and MEV patterns
   - Analyzes slot-level transaction ordering
   - Stores MEV events in database with evidence

3. **Slippage Analyzer** (`services/slippage-analyzer.ts`)
   - Analyzes slippage failures and price movements
   - Tracks token volatility and slippage patterns
   - Provides slippage recommendations per token
   - Identifies high slippage and potential MEV activity

4. **Congestion Monitor** (`services/congestion-monitor.ts`)
   - Monitors network congestion in real-time
   - Tracks failure rates and TPS metrics
   - Detects congestion patterns and periods
   - Provides recommendations based on congestion level

5. **Failure Analytics API** (`api/failure-analytics-endpoints.ts`)
   - REST endpoints for failure analysis data
   - MEV statistics and recent events
   - Slippage recommendations and patterns
   - Congestion status and network health
   - Comprehensive failure summary endpoint

### 🔧 Key Features

- **Comprehensive Failure Analysis**: Categorizes failures by type with detailed metadata
- **MEV Detection**: Identifies sandwich attacks and frontrunning patterns
- **Slippage Intelligence**: Per-token slippage recommendations based on history
- **Network Health Monitoring**: Real-time congestion detection and alerts
- **Analytics API**: Rich endpoints for monitoring and analysis

## Phase 5 Enhancements (January 2025) - Advanced State Tracking & Analytics

### ✅ New Components Added

1. **Block Tracker** (`services/block-tracker.ts`)
   - Tracks blocks and slots with parent relationships
   - Detects slot gaps and missing blocks
   - Calculates chain statistics (avg block time, TPS)
   - Monitors finalization lag

2. **State History Service** (`services/state-history-service.ts`)
   - Tracks account state changes with write versions
   - Ensures write version monotonic consistency
   - Enables historical state reconstruction at any slot
   - Detects missing state updates

3. **Liquidity Depth Tracker** (`services/liquidity-depth-tracker.ts`)
   - Takes periodic liquidity snapshots
   - Calculates price impact for different trade sizes
   - Analyzes liquidity trends and volatility
   - Detects manipulation risk levels

4. **Fork Detector** (`services/fork-detector.ts`)
   - Detects blockchain forks in real-time
   - Identifies orphaned slots and transactions
   - Classifies fork severity (minor, major, critical)
   - Tracks affected transactions for reprocessing

5. **Consistency Validator** (`services/consistency-validator.ts`)
   - Cross-service consistency validation
   - Runs periodic health checks
   - Identifies and attempts to repair inconsistencies
   - Generates recommendations for issues

### 🔧 Key Features

- **Complete Chain State Tracking**: Every slot and block is tracked with relationships
- **Write Version Consistency**: Ensures state changes are properly ordered
- **Historical Reconstruction**: Query any account state at any past slot
- **Liquidity Intelligence**: Deep liquidity analysis with manipulation detection
- **Fork Safety**: Automatic detection and handling of chain reorganizations
- **Self-Healing**: Consistency validation with automatic repair attempts

### Integration with Existing System

The Phase 5 services integrate seamlessly with the existing monitoring infrastructure:

1. **Event-Driven Integration**
   - Block Tracker listens to `slot:update` events from monitors
   - State History tracks `account:updated` and `transaction:processed` events
   - Liquidity Tracker monitors `TRADE_PROCESSED` and `POOL_STATE_UPDATED` events
   - Fork Detector emits `fork:detected` for other services to handle

2. **Data Flow**
   ```
   Monitors → EventBus → Phase 5 Services → Database
                      ↓
                Consistency Validator
                      ↓
               Repair & Alerts
   ```

3. **Service Dependencies**
   - Consistency Validator depends on all other Phase 5 services
   - Monitors can query historical state via State History Service
   - Failed Transaction Analyzer (Phase 4) uses Fork Detector for orphaned tx detection
   - Liquidity analytics integrate with price calculations

### Advanced Capabilities

1. **Historical Queries**
   ```typescript
   // Reconstruct any account state at any past slot
   const historicalState = await stateHistory.reconstructStateAtSlot(pubkey, slot);
   
   // Get all state changes for an account
   const changes = await stateHistory.getStateChanges(pubkey, startSlot, endSlot);
   ```

2. **Liquidity Analysis**
   ```typescript
   // Get current liquidity depth
   const snapshot = liquidityTracker.getCurrentLiquidity(mintAddress);
   
   // Calculate price impact
   const impact = liquidityTracker.calculatePriceImpact(snapshot, tradeSizeSol);
   
   // Check manipulation risk
   const risk = await liquidityTracker.analyzeDepth(mintAddress, snapshot);
   ```

3. **Fork Handling**
   ```typescript
   // Automatically detects forks
   forkDetector.on('fork:detected', (event) => {
     // Identifies orphaned slots and transactions
     const orphaned = event.orphanedSlots;
     const affected = event.affectedTransactions;
   });
   ```

4. **Consistency Validation**
   ```typescript
   // Run full validation
   const report = await consistencyValidator.runValidation();
   
   // Auto-repair inconsistencies
   const { repaired, failed } = await consistencyValidator.repairInconsistencies();
   ```

## Enhancement Roadmap

See `BONDING-CURVE-ENHANCEMENT-PLAN.md` for the complete 6-phase enhancement plan:
- **Phase 1**: ✅ Core Infrastructure & Parser Upgrade (COMPLETED)
- **Phase 2**: ✅ Advanced Subscription & Filtering (COMPLETED)
- **Phase 3**: ✅ New Token & Migration Detection (COMPLETED)
- **Phase 4**: ✅ Failed Transaction & MEV Analysis (COMPLETED)
- **Phase 5**: ✅ Advanced State Tracking & Analytics (COMPLETED)
- **Phase 6**: ✅ Performance Optimization & Production Features (COMPLETED)

# important-instruction-reminders
- Do what has been asked; nothing more, nothing less.
- NEVER create files unless they're absolutely necessary for achieving your goal.
- ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- When running monitors, check that transactions are being received and parsed correctly.
- All TypeScript code must pass `npm run build` without errors.