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

# Testing
npm run test                 # Run all tests
npm run test:integration     # Integration tests only
npm run test:coverage        # Test coverage report
```

## Architecture After Refactoring

### Directory Structure
```
src/
├── core/                           # Foundation layer
│   ├── container.ts               # Dependency injection container
│   ├── container-factory.ts       # DI container setup
│   ├── event-bus.ts              # Event-driven communication
│   ├── config.ts                 # Centralized configuration
│   ├── logger.ts                 # Structured logging
│   └── base-monitor.ts           # Base monitor abstraction
├── monitors/
│   ├── bc-monitor.ts               # Bonding curve trade monitor (refactored with DI)
│   ├── bc-account-monitor.ts       # BC account state monitor (refactored with DI)
│   ├── amm-monitor.ts              # AMM pool trade monitor (wrapped legacy with DI)
│   └── amm-account-monitor.ts      # AMM account state monitor (wrapped legacy with DI)
├── services/                        # 15 essential services
│   ├── sol-price.ts                # Binance API integration
│   ├── sol-price-updater.ts        # Automatic price updates
│   ├── bc-price-calculator.ts      # BC-specific price calculations
│   ├── bc-monitor-stats-aggregator.ts # Statistics aggregation
│   ├── enhanced-auto-enricher.ts   # Enhanced enricher with GraphQL + API fallbacks
│   ├── graphql-metadata-enricher.ts # GraphQL bulk metadata queries (50 tokens/query)
│   ├── shyft-metadata-service.ts   # Shyft REST API for metadata
│   ├── helius.ts                   # Helius DAS API client
│   ├── amm-pool-state-service.ts   # AMM pool state tracking and caching
│   ├── graphql-client.ts           # Shyft GraphQL client with retry logic
│   ├── unified-graphql-price-recovery.ts # Unified BC/AMM price recovery
│   ├── stale-token-detector.ts     # Automatic stale token detection/recovery
│   ├── dexscreener-price-service.ts    # DexScreener API client
│   ├── dexscreener-price-recovery.ts   # Stale graduated token recovery
│   └── price-calculator.ts         # General price calculations
├── api/
│   ├── server-unified.ts           # Main API server
│   ├── server-refactored.ts        # Refactored API server
│   ├── bc-monitor-endpoints.ts     # BC monitor specific endpoints
│   └── amm-endpoints.ts            # AMM analytics endpoints
├── database/
│   └── unified-db-service.ts       # High-performance DB service
├── parsers/
│   ├── unified-event-parser.ts     # Main parser for both programs
│   ├── strategies/
│   │   ├── base-strategy.ts        # Base parsing strategy
│   │   ├── bc-trade-strategy.ts    # BC trade parsing
│   │   └── amm-trade-strategy.ts   # AMM trade parsing
│   └── bc-event-parser.ts          # Legacy BC parser
├── handlers/
│   ├── trade-handler.ts            # Unified trade handler
│   └── graduation-handler.ts       # Graduation event handler
├── repositories/                    # Data access layer
│   ├── base-repository.ts          # Base repository pattern
│   ├── token-repository.ts         # Token data access
│   └── trade-repository.ts         # Trade data access
├── stream/
│   └── client.ts                   # Singleton gRPC client
├── utils/                          # 9 essential utilities
│   ├── constants.ts                # Shared constants
│   ├── amm-pool-decoder.ts         # AMM pool decoding
│   ├── amm-price-calculator.ts     # AMM price calculations
│   ├── bn-layout-formatter.ts      # BN layout formatting
│   ├── event-parser.ts             # Event parsing utilities (from Shyft)
│   ├── pump-addresses.ts           # Address derivation utilities
│   ├── suppress-parser-warnings.ts # Suppress ComputeBudget warnings
│   ├── swapTransactionParser.ts    # AMM swap parsing (from Shyft)
│   └── transaction-formatter.ts    # gRPC transaction formatting (from Shyft)
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

#### Refactored Architecture (NEW - December 2024)
The system has been refactored to use clean architecture principles:
- **Dependency Injection**: All services managed by DI container
- **Event-Driven**: Components communicate via EventBus
- **Repository Pattern**: Clean data access layer
- **Base Abstractions**: Common monitor functionality in BaseMonitor
- **No Singletons**: All services are injected, not imported

To use the refactored monitors:
```bash
npm run start           # RECOMMENDED: Runs all 4 monitors with production features
npm run dev             # Same as npm run start
```

#### Monitor Architecture (December 2024)
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

#### Unified Monitor V2 (`unified-monitor-v2.ts`)
**DEPRECATED** - This monitor has issues with AMM trade detection. Use separate monitors instead:
- `npm run bc-monitor` for bonding curve trades
- `npm run bc-account-monitor` for bonding curve graduations
- `npm run amm-monitor` for AMM pool trades
- `npm run amm-account-monitor` for AMM pool states

#### AMM Monitor (`amm-monitor.ts`)
Dedicated monitor for pump.swap AMM graduated tokens:
- Follows Shyft example code patterns exactly
- Integrates with pool state service for accurate reserve tracking
- Uses actual pool reserves instead of hardcoded zeros
- **Trade Detection Fix**: Correctly identifies buy/sell based on base/quote asset configuration
  - When base is SOL: instruction 'buy' = user sells tokens, 'sell' = user buys tokens
  - When base is token: instruction 'buy' = user buys tokens, 'sell' = user sells tokens

#### AMM Account Monitor (`amm-account-monitor.ts`)
Monitors AMM pool account states in real-time:
- Subscribes to all accounts owned by pump.swap AMM program
- Decodes pool state using BorshAccountsCoder
- Tracks LP supply and pool token accounts
- Provides foundation for accurate price calculations
- Uses TransactionFormatter for gRPC data conversion
- Implements IDL-based parsing with SolanaParser
- Captures all trade details including user addresses
- Processes trades with `dbService.processTrade()`
- Suppresses parser warnings with `suppressParserWarnings()`

#### BC Monitor (`bc-monitor.ts`)
Enhanced bonding curve trade monitor:
- Fully refactored with clean architecture
- Handles both 225-byte and 113-byte events
- Parse rate >95% (up from 82.9%)
- Configurable thresholds via environment variables
- Retry logic for database saves
- Real-time progress tracking to graduation
- Integrated with DI container and EventBus

#### BC Account Monitor (`bc-account-monitor.ts`)
Bonding curve account state monitor:
- Subscribes to all pump.fun program accounts
- Uses Borsh decoding for BondingCurve account data
- Detects graduations when progress >= 100% or complete = true
- Reverse-engineers mint addresses from bonding curve PDAs
- Updates graduation status in real-time
- **Critical**: Required for proper graduation detection

#### Database Service (`unified-db-service-v2.ts`)
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
// Nested structure from Shyft gRPC - IMPORTANT!
data.transaction.transaction.transaction.message.accountKeys  // Buffer[]
data.transaction.transaction.meta                            // Contains logs
```

#### Key Constants
- Token decimals: 6
- SOL decimals: 9 (1 SOL = 1e9 lamports)
- Market cap calculation: Assumes 1B token supply
- Bonding curve progress: 30 SOL → 85 SOL = 100%
- Threshold: $8,888 USD market cap

#### Shyft Integration Notes

1. **Example Code Authority**
   - Files in `shyft-code-examples/` are authoritative
   - AMM monitor must follow Shyft patterns exactly
   - Use TransactionFormatter for gRPC data conversion
   - Parser warnings about ComputeBudget are harmless

2. **Database Interface**
   - BC monitors use `processTransaction()` method
   - AMM monitor uses `processTrade()` method
   - Both save to `trades_unified` table
   - User addresses and mint addresses are indexed

#### Common Issues & Solutions

1. **Parse errors (17% rate)**
   - Events come in both 225-byte and 113-byte formats
   - Use `bc-monitor-quick-fix` or `bc-event-parser-v2.ts` to handle both
   - Enable `DEBUG_PARSE_ERRORS=true` to see error samples
   - Solution: Flexible parsing that accepts multiple event sizes

2. **Low token save rate (81%)**
   - Default threshold filters out tokens < $8,888
   - Use `BC_SAVE_THRESHOLD=1000` to lower threshold
   - Use `SAVE_ALL_TOKENS=true` to save everything
   - Database deduplication fixed in `unified-db-service-v2.ts`

3. **AMM trades not detected**
   - Account keys are Buffers, need bs58.encode()
   - Simple log parsing works better than strict IDL parsing
   - Mint extraction requires checking multiple log entries

4. **AMM Buy/Sell Detection (FIXED)**
   - The pump.fun AMM instruction names depend on whether SOL is base or quote
   - When base is SOL: 'buy' = selling tokens, 'sell' = buying tokens
   - When base is token: 'buy' = buying tokens, 'sell' = selling tokens
   - Fix implemented in `swapTransactionParser.ts` with comprehensive logic

5. **WebSocket Server Conflicts (FIXED)**
   - BC WebSocket uses `/ws` path
   - Unified WebSocket uses `/ws-unified` path
   - Import issues: Use `import { WebSocket, Server as WSServer } from 'ws'`
   - Timer type: Use `NodeJS.Timeout` not `NodeJS.Timer`
   - **Frame Header Fix**: Initialize WebSocket servers BEFORE Express middleware
   - Static file middleware must come AFTER WebSocket initialization

6. **Database Column Issues (FIXED)**
   - `volume_usd` column doesn't exist in trades_unified
   - Calculate from: `sol_amount::numeric / 1e9 * sol_price`
   - Parse PostgreSQL bigint results with `parseInt()`

7. **TypeScript Compilation Errors (PARTIALLY FIXED)**
   - WebSocket imports fixed with proper syntax
   - 'open' module removed (not critical)
   - Some warnings remain but don't affect functionality

8. **Graduation Detection Issues (FIXED)**
   - BC monitor had account decoding disabled (hardcoded to `complete: false`)
   - Solution: Created separate `bc-account-monitor` for account state tracking
   - 62 tokens with 100% progress weren't marked as graduated - now fixed

9. **Graduated Token Price Updates (FIXED)**
   - GraphQL `pump_fun_amm_Pool` table is empty (no AMM pools indexed)
   - Real-time updates work via AMM monitor trades
   - **NEW**: DexScreener API integration for stale graduated tokens
   - Successfully recovers prices from multiple DEXs
   - Includes liquidity, volume, and price change data

10. **AMM Token Creation (FIXED)**
    - AMM monitor now creates token entries for new AMM tokens
    - Lower threshold for AMM tokens ($1,000 vs $8,888)
    - Automatically marks as graduated
    - Enables price tracking for all traded tokens

11. **Refactored AMM Account Monitor gRPC Issues (FIXED)**
    - The refactored AMM account monitor had gRPC subscription format issues
    - Solution: Created wrapper classes for legacy AMM monitors
    - `amm-monitor-wrapper.ts` - Wraps proven AMM trade monitor
    - `amm-account-monitor-wrapper.ts` - Wraps AMM account monitor
    - Both integrate with DI container and emit events through EventBus

12. **AMM Trade Verification (VERIFIED)**
    - Tested buy/sell detection against Solscan.io
    - All trade types correctly identified
    - SOL and token amounts accurate
    - Prices calculated correctly
    - Market cap calculations verified

5. **Rate limits**
   - Shyft: 50 subscriptions/60s per token
   - Binance API: No limits for public endpoints
   - Implemented exponential backoff

6. **Database performance**
   - Use batch inserts (100-500 records/batch)
   - In-memory cache for recent tokens
   - Mint address as primary key prevents duplicates
   - Retry logic for failed saves

7. **Price accuracy**
   - SOL price updates every 5 seconds from Binance
   - Falls back to database cache
   - Default $180 if all sources fail

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
    price_source TEXT DEFAULT 'unknown', -- 'bonding_curve', 'amm', 'graphql', 'dexscreener', 'rpc'
    last_graphql_update TIMESTAMP,
    last_rpc_update TIMESTAMP,
    last_dexscreener_update TIMESTAMP,  -- NEW: DexScreener update tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trades with efficient indexing (full schema)
CREATE TABLE trades_unified (
    signature VARCHAR(88) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    program program_type NOT NULL,  -- 'bonding_curve' or 'amm_pool'
    trade_type trade_type,          -- 'buy' or 'sell'
    user_address VARCHAR(64) NOT NULL,  -- Wallet performing the trade
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    price_sol DECIMAL(20, 12) NOT NULL,
    price_usd DECIMAL(20, 4) NOT NULL,
    market_cap_usd DECIMAL(20, 4) NOT NULL,
    volume_usd DECIMAL(20, 4),
    virtual_sol_reserves BIGINT,
    virtual_token_reserves BIGINT,
    bonding_curve_key VARCHAR(64),  -- NEW: BC address for graduation tracking
    bonding_curve_progress DECIMAL(5, 2),
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_trades_unified_user ON trades_unified(user_address);
CREATE INDEX idx_trades_unified_mint_time ON trades_unified(mint_address, block_time DESC);
CREATE INDEX idx_trades_unified_bonding_curve_key ON trades_unified(bonding_curve_key) WHERE bonding_curve_key IS NOT NULL;

-- Bonding Curve Mappings (NEW: For graduation tracking)
CREATE TABLE bonding_curve_mappings (
    bonding_curve_key VARCHAR(64) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(mint_address)
);

CREATE INDEX idx_bc_mappings_mint ON bonding_curve_mappings(mint_address);

-- AMM Pool State Tracking (AMM Session 1)
CREATE TABLE amm_pool_states (
    id BIGSERIAL PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    pool_address VARCHAR(64) NOT NULL,
    virtual_sol_reserves BIGINT NOT NULL,
    virtual_token_reserves BIGINT NOT NULL,
    real_sol_reserves BIGINT,
    real_token_reserves BIGINT,
    pool_open BOOLEAN DEFAULT TRUE,
    slot BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for AMM pool states
CREATE INDEX idx_amm_pool_states_mint ON amm_pool_states(mint_address, created_at DESC);
CREATE INDEX idx_amm_pool_states_pool ON amm_pool_states(pool_address, created_at DESC);
```

## Testing & Debugging

1. **Integration Tests**: `npm run test:integration` - Test DI container, monitors, and WebSocket
2. **Custom threshold testing**: `BC_SAVE_THRESHOLD=1000 npm run bc-monitor`
3. **Debug parse errors**: `DEBUG_PARSE_ERRORS=true npm run bc-monitor`
4. **Check recent trades**: View dashboard at http://localhost:3001
5. **Database verification**: `psql $DATABASE_URL -c "SELECT * FROM trades_unified ORDER BY block_time DESC LIMIT 10"`
6. **Suppress parser warnings**: `suppressParserWarnings()` utility filters ComputeBudget warnings

## Performance Optimization

- Parse rate improved from 82.9% to >95% by handling multiple event sizes
- Token save rate improved from 81% to >95% with retry logic
- Batch database operations reduce connection overhead by 90%
- In-memory token cache minimizes database queries
- Simple parsing catches ~15% more events than strict IDL parsing
- Concurrent monitoring of both programs in single process
- Rate limiting prevents API exhaustion
- Enhanced statistics tracking for better monitoring

## Bonding Curve Monitor Development

The bonding curve monitor (`bc-monitor.ts`) was developed in 5 phases:

### Phase 1-5 Complete ✅
1. **Core Infrastructure** - gRPC streaming connection
2. **Transaction Parsing** - Extract trade events (225-byte format)
3. **Price Calculations** - Real-time SOL/USD pricing
4. **Database Integration** - Persist tokens above threshold
5. **Progress Tracking** - Monitor bonding curve completion

### Key Features
- Handles ~18 transactions/second sustained
- Detects graduations at 85+ SOL
- Visual progress bars with milestones
- Batch processing with deduplication
- Configurable save thresholds

### Running the Monitors
```bash
# Recommended: Run all refactored monitors
npm run start              # Run all 4 monitors with production features

# Or run individually
npm run bc-monitor          # BC trades
npm run bc-account-monitor  # BC graduations  
npm run amm-monitor         # AMM trades
npm run amm-account-monitor # AMM pool states

# With custom settings
BC_SAVE_THRESHOLD=5000 SAVE_ALL_TOKENS=false npm run bc-monitor
```

## Price Recovery & Stale Token Handling

### Price Update Sources
1. **Real-time Monitors** (Primary)
   - BC trades update non-graduated token prices
   - AMM trades update graduated token prices
   - Account monitors track state changes
   - **NEW**: AMM monitor creates tokens automatically

2. **GraphQL Bulk Recovery** (Secondary)
   - `UnifiedGraphQLPriceRecovery` handles BC tokens
   - Bonding curves: Working via `pump_BondingCurve` table
   - AMM pools: Not working - `pump_fun_amm_Pool` table is empty

3. **DexScreener Recovery** (NEW - Working!)
   - `DexScreenerPriceService` - API client for token prices
   - `DexScreenerPriceRecovery` - Automated recovery service
   - Successfully recovers graduated token prices
   - Includes liquidity, volume, and 24h change data
   - Rate limited to 300ms between requests
   - Runs every 30 minutes for stale tokens

4. **Pool State Recovery** (Broken)
   - Uses cached data from `amm-account-monitor`
   - Data quality issues prevent proper recovery

### Graduation Detection
- **BC Account Monitor** detects graduations in real-time
- Monitors `complete` flag and progress >= 100%
- Updates `graduated_to_amm` in database
- **Issue**: BC trade monitor has account decoding disabled
- **Solution**: Run both BC monitors for complete coverage

## AMM Monitor Development

### AMM Session 1: Pool Reserve Monitoring ✅

The AMM monitor was initially using hardcoded zeros for pool reserves, making price calculations inaccurate. This session adds real-time pool state monitoring.

#### Implementation Components

1. **AMM Account Monitor** (`amm-account-monitor.ts`)
   - Subscribes to pump.swap AMM program accounts
   - Decodes pool state using BorshAccountsCoder
   - Tracks LP supply and pool token accounts
   - Updates pool state service with decoded data

2. **Pool State Service** (`amm-pool-state-service.ts`)
   - Manages in-memory cache of pool states
   - Calculates prices from actual reserves
   - Batch updates to database
   - Provides fast lookups for current prices

3. **Database Schema** (`amm_pool_states` table)
   - Stores historical pool state snapshots
   - Tracks virtual and real reserves
   - Enables price history analysis

#### Key Features
- Real-time pool state updates via account subscriptions
- Accurate price calculations using constant product formula
- Reserve data extracted from trade events
- In-memory caching for performance
- Batch database updates

#### Running the Monitors
```bash
# Run all three monitors for complete coverage
npm run amm-monitor          # Trade events
npm run amm-account-monitor  # Pool states
npm run bc-monitor-quick-fix # Bonding curves

# Verify implementation
npm run verify-amm-session-1
```

#### Success Metrics
- Pool state decode rate: >95%
- Reserve accuracy: Exact match with on-chain
- Price deviation: <1% from DEX aggregators
- Update latency: <100ms

### AMM Session 2: Real-time Price Calculations ✅

The second AMM session implements accurate price calculations using the constant product formula and adds comprehensive price tracking capabilities.

#### Implementation Components

1. **AMM Price Calculator** (`amm-price-calculator.ts`)
   - Constant product formula: x * y = k
   - Price impact calculations for trades
   - Slippage and execution price calculations
   - Market cap and liquidity calculations

2. **AMM Price Tracker** (`amm-price-tracker.ts`)
   - Real-time price history tracking
   - Price change metrics (1m, 5m, 15m, 1h, 24h)
   - 24h high/low tracking
   - Batch database persistence

3. **Database Schema** (`price_update_sources` table)
   - Tracks all price updates with source
   - Stores reserve snapshots
   - Enables historical analysis

#### Key Features
- Accurate price calculations using actual reserves
- Price impact shown before trade execution
- Historical price tracking with configurable intervals
- Integration with SOL price service for USD calculations
- Constant K validation for security

#### Running the Tests
```bash
# Run price tracking migration
npm run add-price-tables

# Test AMM Session 2 implementation
npm run test-amm-session-2
```

#### Success Metrics
- Price accuracy: Within 0.01% of constant product formula
- Price impact calculations: Accurate for all trade sizes
- History tracking: <5 second batch saves
- USD calculations: Real-time SOL price integration

## Dashboard Development

### ⚠️ DASHBOARD IMPROVEMENTS ON HOLD (June 28, 2025)

**Status**: ON HOLD - Unified WebSocket causing connection issues, disabled to allow core system enhancements to continue.

**Reason**: The unified WebSocket server implementation was causing immediate disconnection issues that were blocking progress on core system features. Rather than spend more time debugging, the decision was made to:
1. Disable the unified WebSocket server
2. Keep the existing BC WebSocket functional
3. Continue with core system enhancements from master-plan.md
4. Return to dashboard improvements later

**To Re-enable**: 
1. Fix WebSocket import/connection issues in `unified-websocket-server.ts`
2. Remove the disabled code in `server-unified.ts` lines 25-54
3. Remove the return statement in `unified-websocket-client.js` line 45
4. Test thoroughly before proceeding with Session 1 implementation

### Dashboard Session 1: AMM Integration & Real-time Infrastructure

**Status**: Partially implemented - ON HOLD due to WebSocket issues

#### Completed Components

1. **Unified WebSocket Server** (`unified-websocket-server.ts`)
   - Multi-source event handling (BC, AMM, AMM Account)
   - Client subscription management
   - Event type filtering
   - Path: `/ws-unified` (separate from BC WebSocket)

2. **AMM API Endpoints** (`amm-endpoints.ts`)
   - `/api/amm/trades/recent` - Recent AMM trades
   - `/api/amm/pools` - Pool listings with liquidity
   - `/api/amm/stats` - Aggregate statistics
   - `/api/amm/pools/:mintAddress` - Pool details

3. **Monitor WebSocket Integration**
   - AMM monitor broadcasts trade events
   - AMM account monitor broadcasts pool state changes
   - Periodic statistics updates

4. **Frontend Components**
   - `unified-websocket-client.js` - Handles all WebSocket events
   - `amm-dashboard.html` - AMM analytics dashboard
   - Updated navigation with AMM Analytics link

#### Known Issues Requiring Debug

1. **WebSocket Connection Errors**
   - Server initialization conflicts
   - Path routing issues
   - Import syntax problems

2. **API Response Errors**
   - Database query column mismatches
   - Type conversion issues with PostgreSQL
   - Missing error handling

3. **TypeScript Compilation**
   - WebSocket module imports
   - Timer type definitions
   - Missing module declarations

#### Testing Setup
```bash
# Terminal 1: API Server
npm run dashboard

# Terminal 2: BC Monitor
npm run bc-monitor-quick-fix

# Terminal 3: AMM Monitor
npm run amm-monitor

# Terminal 4: AMM Account Monitor  
npm run amm-account-monitor

# Terminal 5: SOL Price Updater
npm run sol-price-updater
```

#### Dashboard URLs
- Main Dashboard: http://localhost:3001
- BC Monitor: http://localhost:3001/bc-monitor.html
- AMM Analytics: http://localhost:3001/amm-dashboard.html

#### Next Steps
1. Fix WebSocket server initialization
2. Resolve TypeScript compilation errors
3. Add proper error handling to API endpoints
4. Test end-to-end data flow
5. Implement missing UI components

## Current System Status (December 2024)

### ✅ Working Components

1. **Real-time Monitoring**
   - BC Monitor: Captures bonding curve trades with >95% parse rate
   - BC Account Monitor: Detects graduations in real-time
   - AMM Monitor: Captures AMM trades AND creates token entries automatically
   - AMM Account Monitor: Tracks pool states and reserves

2. **Price Recovery**
   - GraphQL: Works for bonding curve tokens only
   - DexScreener: Successfully recovers graduated token prices
   - Includes liquidity, volume, and 24h change data

3. **Enhanced Token Enrichment**
   - **NEW**: Automatic metadata enrichment for tokens above $8,888
   - **GraphQL bulk queries** as primary source (50 tokens per query - 50x faster!)
   - Shyft REST API as secondary fallback
   - Helius DAS API as tertiary fallback
   - Batch processing for efficiency
   - Immediate enrichment when tokens cross threshold or AMM creation
   - Background service runs automatically with monitors
   - Comprehensive metadata: name, symbol, description, image, creators, supply, decimals, authorities

4. **Key Improvements**
   - AMM tokens now created automatically with $1,000 threshold
   - DexScreener integration provides fallback for stale graduated tokens
   - Complete monitoring script runs all services
   - All tokens above $8,888 market cap automatically get metadata

### 🚀 Quick Start

```bash
# Run the recommended setup
npm run start            # Starts all 4 monitors with DI
npm run dashboard         # In another terminal, starts API & dashboard

# Optional services
npm run sol-price-updater # SOL price updates (automatic with monitors)
npm run startup-recovery  # Stale token recovery
```

### 🎯 Token Metadata Enrichment

The system automatically enriches all tokens above $8,888 market cap with comprehensive metadata:

**Metadata Collection Priority**:
1. **GraphQL bulk queries** (50 tokens per query - fastest)
2. **Shyft REST API** (fallback for tokens not in GraphQL)
3. **Helius DAS API** (final fallback)
4. **Basic RPC data** (minimal metadata)

**Collected Metadata**:
- Basic: name, symbol, description, image, uri
- Extended: creators array, supply, decimals, is_mutable
- Authorities: mint_authority, freeze_authority
- Tracking: metadata_source, metadata_updated_at

**Automatic Enrichment**:
- Runs automatically with monitors
- Checks every 30 seconds for new tokens
- Immediate enrichment when tokens cross $8,888
- Immediate enrichment for all new AMM tokens

### 📊 System Architecture

```
Real-time Data Flow:
├── Shyft gRPC → Monitors → Database → Dashboard
├── BC trades → Non-graduated prices
├── AMM trades → Graduated prices + new tokens
└── Account updates → Graduation detection

Recovery Flow:
├── Stale BC tokens → GraphQL recovery
└── Stale graduated tokens → DexScreener API
```

