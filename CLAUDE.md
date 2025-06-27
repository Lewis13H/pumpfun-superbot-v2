# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Real-time Solana token monitor for pump.fun bonding curves and pump.swap AMM pools. Streams blockchain data via Shyft's gRPC endpoint, tracks token prices and market caps, saves high-value tokens (≥$8,888) to PostgreSQL, and provides a web dashboard for monitoring.

## Development Commands

```bash
# Build & Run
npm install                 # Install dependencies
npm run build              # Build TypeScript
npm run dev                # Basic price monitor

# Main Monitors
npm run unified-v2         # Unified monitor for both programs (recommended)
npm run threshold          # Save tokens ≥$8,888 to database
npm run trades             # Track buy/sell activity with statistics
npm run trades-db          # Trade monitor that saves to database

# Database Operations
npm run view-tokens        # View saved tokens
npm run enrich-tokens      # Fetch metadata from Helius API
npm run view-enriched      # View enriched token data
npm run migrate-unified    # Run database migrations

# Services
npm run dashboard          # Web dashboard (http://localhost:3001)
npm run sol-price-updater  # SOL price updater (runs automatically with monitors)

# Testing & Debug
npm run test-stream        # Test gRPC connectivity
npm run test-idl          # Test manual parsers
npm run debug-amm         # Debug AMM pool structure
psql $DATABASE_URL -c "SELECT COUNT(*) FROM tokens"  # Check database
```

## Architecture

### Core Data Flow
1. **gRPC Stream** (Shyft) → Raw blockchain data
2. **Event Parser** → Extract trades from transaction logs
3. **Price Calculator** → Compute prices from virtual reserves
4. **Database Service** → Batch processing with caching
5. **Monitors/Dashboard** → Display and track tokens

### Key Services & Patterns

#### Unified Monitor V2 (`unified-monitor-v2.ts`)
The main production monitor that:
- Monitors both pump.fun and pump.swap programs simultaneously
- Uses simple log parsing for maximum event detection
- Implements batch database operations (100 records/batch)
- Tracks tokens crossing $8,888 threshold
- Shows real-time dashboard with statistics

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
- Handles Buffer-encoded account keys from gRPC
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
```

#### Transaction Structure (gRPC)
```javascript
// Nested structure from Shyft gRPC
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

1. **AMM trades not detected**
   - Account keys are Buffers, need bs58.encode()
   - Simple log parsing works better than strict IDL parsing
   - Mint extraction requires checking multiple log entries

2. **Rate limits**
   - Shyft: 50 subscriptions/60s per token
   - Binance API: No limits for public endpoints
   - Implemented exponential backoff

3. **Database performance**
   - Use batch inserts (100 records/batch)
   - In-memory cache for recent tokens
   - Mint address as primary key prevents duplicates

4. **Price accuracy**
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

## Testing Approach

1. **Check stream connectivity**: `npm run test-stream`
2. **Verify database**: `psql $DATABASE_URL -c "\dt"`
3. **Monitor with timeout**: `timeout 30 npm run unified-v2`
4. **Check recent trades**: View dashboard or query database
5. **Debug specific program**: Check logs for [AMM Debug] or transaction counts

## Performance Optimization

- Batch database operations reduce connection overhead
- In-memory token cache minimizes database queries
- Simple parsing catches ~15% more events than strict parsing
- Concurrent monitoring of both programs in single process
- Rate limiting prevents API exhaustion