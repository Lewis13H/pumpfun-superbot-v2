# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Real-time Solana token monitor for pump.fun bonding curves and pump.swap AMM pools. Streams blockchain data via Shyft's gRPC endpoint, tracks token prices and market caps, saves high-value tokens (≥$8,888) to PostgreSQL, and provides a web dashboard for monitoring.

## Development Commands

```bash
# Main Production Monitors
npm run unified-v2         # Unified monitor for both programs (MAIN SERVICE)
npm run bc-monitor         # Bonding curve focused monitor (Phase 5 complete)
npm run bc-monitor-quick-fix  # Improved BC monitor with better parse rates

# Database Operations
npm run migrate-unified    # Run database migrations
npm run view-tokens-unified # View saved tokens
npm run enrich-tokens-unified # Fetch metadata from Helius API
npm run query-trades       # Query recent trades

# Dashboard & Services
npm run dashboard          # Web dashboard (http://localhost:3001)
npm run sol-price-updater  # SOL price updater (runs automatically with monitors)

# Testing & Debugging
npm run debug-amm          # Debug AMM pool structure
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
│   ├── unified-monitor-v2.ts       # Main production monitor
│   ├── bc-monitor.ts               # Bonding curve focused monitor
│   ├── bc-monitor-quick-fixes.ts   # Improved BC monitor (handles 225 & 113 byte events)
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
│   └── helius.ts                   # Helius API client
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
└── utils/
    ├── constants.ts                # Shared constants
    ├── price-calculator.ts         # Price calculations
    └── formatters.ts               # Display formatters
```

### Core Data Flow
1. **gRPC Stream** (Shyft) → Raw blockchain data
2. **Event Parser** → Extract trades from transaction logs
3. **Price Calculator** → Compute prices from virtual reserves
4. **Database Service** → Batch processing with caching
5. **Dashboard** → Display and track tokens

### Key Implementation Details

#### Unified Monitor V2 (`unified-monitor-v2.ts`)
The main production monitor that:
- Monitors both pump.fun and pump.swap programs simultaneously
- Uses simple log parsing for maximum event detection (~15% more trades than IDL parsing)
- Implements batch database operations (100 records/batch)
- Tracks tokens crossing $8,888 threshold
- Shows real-time dashboard with statistics
- Creates its own subscription directly (doesn't use subscription classes)

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

4. **Rate limits**
   - Shyft: 50 subscriptions/60s per token
   - Binance API: No limits for public endpoints
   - Implemented exponential backoff

5. **Database performance**
   - Use batch inserts (100-500 records/batch)
   - In-memory cache for recent tokens
   - Mint address as primary key prevents duplicates
   - Retry logic for failed saves

6. **Price accuracy**
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

-- Trades with efficient indexing
CREATE TABLE trades_unified (
    signature VARCHAR(88) PRIMARY KEY,
    mint_address VARCHAR(64) REFERENCES tokens_unified(mint_address),
    program program_type NOT NULL,  -- 'bonding_curve' or 'amm_pool'
    trade_type trade_type,          -- 'buy' or 'sell'
    price_usd DECIMAL(20, 4),
    market_cap_usd DECIMAL(20, 4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Testing & Debugging

1. **Quick 5-minute test**: `./scripts/quick-test-bc-monitor.sh`
2. **Comprehensive 1-hour test**: `./scripts/test-bc-monitor.sh`
3. **Watch parse/save rates**: `npm run bc-monitor-watch` or `./scripts/monitor-improvements.sh -w`
4. **Custom threshold testing**: `BC_SAVE_THRESHOLD=1000 npm run bc-monitor-quick-fix`
5. **Debug parse errors**: `DEBUG_PARSE_ERRORS=true npm run bc-monitor-quick-fix`
6. **Check stream connectivity**: First verify gRPC is working
7. **Check recent trades**: View dashboard or query database
8. **Debug AMM issues**: Use `npm run debug-amm` to see pool structure
9. **Database verification**: `psql $DATABASE_URL < scripts/validate-bc-monitor-data.sql`

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