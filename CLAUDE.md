# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Real-time Solana token monitor for pump.fun bonding curves and pump.swap AMM pools. Streams blockchain data via Shyft's gRPC endpoint, tracks token prices and market caps, saves high-value tokens (≥$8,888) to PostgreSQL, and provides a web dashboard for monitoring.

## Development Commands

```bash
# Recommended Production Setup (run all three monitors)
npm run bc-monitor-quick-fix  # Bonding curve monitor (>95% parse rate)
npm run amm-monitor           # AMM pool monitor for graduated tokens
npm run amm-account-monitor   # AMM account state monitor for pool reserves

# Legacy Monitors
npm run unified-v2         # DEPRECATED - has AMM detection issues
npm run bc-monitor         # Original BC monitor (lower parse rate)

# Database Operations
npm run migrate-unified    # Run database migrations
npm run migrate-amm-pools  # Run AMM pool states migration (or use fix-amm-pool-states.ts if table exists)
npm run view-tokens-unified # View saved tokens
npm run enrich-tokens-unified # Fetch metadata from Helius API
npm run query-trades       # Query recent trades

# Dashboard & Services
npm run dashboard          # Web dashboard (http://localhost:3001)
npm run sol-price-updater  # SOL price updater (runs automatically with monitors)

# Testing & Debugging
npm run debug-amm          # Debug AMM pool structure
npm run verify-amm-session-1  # Verify pool reserve monitoring
npm run bc-monitor-watch   # Watch parse/save rates only
./scripts/quick-test-bc-monitor.sh   # 5-minute quick test
./scripts/test-bc-monitor.sh         # 1-hour comprehensive test
./scripts/monitor-improvements.sh    # Run monitor with custom settings
psql $DATABASE_URL -c "SELECT COUNT(*) FROM tokens_unified"  # Check database
```

## Architecture After Refactoring

### Directory Structure
```
src/
├── monitors/
│   ├── unified-monitor-v2.ts       # Main production monitor (DEPRECATED - has issues)
│   ├── bc-monitor.ts               # Bonding curve focused monitor
│   ├── bc-monitor-quick-fixes.ts   # Improved BC monitor (handles 225 & 113 byte events)
│   ├── amm-monitor.ts              # Dedicated AMM monitor following Shyft examples
│   ├── amm-account-monitor.ts      # AMM account state monitor for pool reserves
│   ├── bc-monitor-plan.md          # Phased implementation plan
│   └── debug/
│       └── debug-amm-pool.ts       # AMM debugging tool
├── services/
│   ├── sol-price.ts                # Binance API integration
│   ├── sol-price-updater.ts        # Automatic price updates
│   ├── bc-price-calculator.ts      # BC-specific price calculations
│   ├── bc-progress-tracker.ts      # Bonding curve progress tracking
│   ├── bc-monitor-stats.ts         # Enhanced statistics tracking
│   ├── auto-enricher.ts            # Token metadata enrichment
│   ├── helius.ts                   # Helius API client
│   └── amm-pool-state-service.ts   # AMM pool state tracking and caching
├── database/
│   └── unified-db-service-v2.ts    # High-performance DB service
├── parsers/
│   ├── unified-parser.ts           # Main parser for both programs
│   ├── bc-event-parser.ts          # Bonding curve event parser (225 bytes)
│   ├── bc-event-parser-v2.ts       # Improved parser (225 & 113 bytes)
│   └── amm-swap-parser.ts          # Reference AMM parser
├── handlers/
│   ├── bc-db-handler.ts            # BC database integration
│   └── bc-db-handler-v2.ts         # Improved with retry logic
├── stream/
│   └── client.ts                   # Singleton gRPC client
├── utils/
│   ├── constants.ts                # Shared constants
│   ├── price-calculator.ts         # Price calculations
│   ├── formatters.ts               # Display formatters
│   ├── transaction-formatter.ts    # gRPC transaction formatting (from Shyft)
│   ├── event-parser.ts             # Event parsing utilities (from Shyft)
│   ├── swapTransactionParser.ts    # AMM swap parsing (from Shyft)
│   └── suppress-parser-warnings.ts # Suppress ComputeBudget warnings
└── tests/
    ├── verify-amm-trades.ts        # Capture AMM trades for verification
    └── verify-amm-session-1.ts     # Verify pool reserve monitoring
```

### Core Data Flow
1. **gRPC Stream** (Shyft) → Raw blockchain data
2. **Event Parser** → Extract trades from transaction logs
3. **Price Calculator** → Compute prices from virtual reserves
4. **Database Service** → Batch processing with caching
5. **Dashboard** → Display and track tokens

### Key Implementation Details

#### Unified Monitor V2 (`unified-monitor-v2.ts`)
**DEPRECATED** - This monitor has issues with AMM trade detection. Use separate monitors instead:
- `npm run bc-monitor-quick-fix` for bonding curves
- `npm run amm-monitor` for AMM pools

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

#### BC Monitor Quick Fix (`bc-monitor-quick-fixes.ts`)
Enhanced bonding curve monitor:
- Handles both 225-byte and 113-byte events
- Parse rate >95% (up from 82.9%)
- Configurable thresholds via environment variables
- Retry logic for database saves
- Real-time progress tracking to graduation

#### Database Service (`unified-db-service-v2.ts`)
High-performance service using:
- Mint addresses as primary keys (not UUIDs)
- Batch processing with 1-second intervals
- In-memory cache for recent tokens
- Atomic threshold crossing detection
- Connection pooling for PostgreSQL

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
HELIUS_API_KEY=your-api-key          # For metadata enrichment
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
    bonding_curve_progress DECIMAL(5, 2),
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_trades_unified_user ON trades_unified(user_address);
CREATE INDEX idx_trades_unified_mint_time ON trades_unified(mint_address, block_time DESC);

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

1. **Quick 5-minute test**: `./scripts/quick-test-bc-monitor.sh`
2. **Comprehensive 1-hour test**: `./scripts/test-bc-monitor.sh`
3. **Watch parse/save rates**: `npm run bc-monitor-watch` or `./scripts/monitor-improvements.sh -w`
4. **Custom threshold testing**: `BC_SAVE_THRESHOLD=1000 npm run bc-monitor-quick-fix`
5. **Debug parse errors**: `DEBUG_PARSE_ERRORS=true npm run bc-monitor-quick-fix`
6. **Verify AMM trades**: `npm run verify-amm-trades` - Captures 5 recent trades with Solscan links
7. **Check recent trades**: View dashboard or query database
8. **Debug AMM issues**: Use `npm run debug-amm` to see pool structure
9. **Database verification**: `psql $DATABASE_URL < scripts/validate-bc-monitor-data.sql`
10. **Suppress parser warnings**: `suppressParserWarnings()` utility filters ComputeBudget warnings

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

### Running the Monitor
```bash
# Standard bonding curve monitor
npm run bc-monitor

# Improved version with better parse rates
npm run bc-monitor-quick-fix

# With custom settings
BC_SAVE_THRESHOLD=5000 SAVE_ALL_TOKENS=false npm run bc-monitor-quick-fix

# Using helper script
./scripts/monitor-improvements.sh -t 5000 -d  # $5k threshold with debug
```

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