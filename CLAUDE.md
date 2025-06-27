# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Pump.fun token monitor with real-time price streaming, bonding curve progress tracking, database persistence for high-value tokens, and dual-program monitoring for both pump.fun bonding curve and pump.swap AMM programs. Uses Shyft's gRPC endpoint to stream Solana blockchain data.

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Core monitors
npm run dev          # Basic price monitor
npm run progress     # Monitor with progress bars
npm run threshold    # Save tokens ≥$8888 to database
npm run bonding      # Stream bonding curve accounts
npm run unified      # Combined price + progress monitor
npm run trades       # Track buy/sell activity with statistics

# Dual-Program Monitoring
npm run dual         # Monitor both pump.fun and pump.swap programs
npm run dual-debug   # Dual monitor with debug logging
npm run test-stream  # Test stream connectivity
npm run comprehensive # Monitor transactions AND accounts for both programs

# Database & Enrichment
npm run view-tokens  # View saved tokens from threshold monitor
npm run enrich-tokens # Fetch metadata from Helius API
npm run view-enriched # View enriched token data
npm run update-ages  # Update token creation times from blockchain

# Web Dashboard
npm run dashboard    # Start web dashboard (http://localhost:3001)

# SOL Price Service
npm run sol-price-updater  # Run SOL price updater service (updates every 30s)

# Threshold monitor variants
npm run threshold-plus  # Threshold monitor that tracks graduations
npm run threshold-auto  # Threshold monitor with auto-enrichment

# Additional database viewers
npm run view-graduated    # View graduated tokens
npm run update-graduated  # Update prices for graduated tokens
npm run check-graduations # Check which tokens have graduated

# Database trades monitor
npm run trades-db     # Trade monitor that saves to database
```

## Architecture

### Data Flow
1. **gRPC Stream** → Receives raw transaction/account data from Shyft
2. **Event Parser** → Extracts events from logs or account data
3. **Price Calculator** → Computes prices using virtual reserves
4. **Monitors** → Display data and optionally save to PostgreSQL

### Core Components

#### Stream Management (`src/stream/`)
- **client.ts**: Singleton gRPC client
  - CRITICAL: Endpoint must be full URL (e.g., `https://grpc.ams.shyft.to`)
  - Handles authentication with SHYFT_GRPC_TOKEN
  - Implements keepalive for connection stability
- **subscription.ts**: Transaction stream handler
  - Slot-based reconnection (tracks lastProcessedSlot)
  - 30 retry attempts before resetting to latest
  - Handles ping/pong keepalive
- **subscription-simple.ts**: Simplified handler without IDL dependencies
  - Used by trade-monitor-v2 and threshold monitor
  - Implements rate limiting (30 subscriptions per minute)
- **account-subscription.ts**: Bonding curve account updates
  - Uses Borsh decoding for account data
  - Less frequent than transaction updates
- **dual-program-subscription.ts**: Dual-program monitoring
  - Monitors both pump.fun and pump.swap programs simultaneously
  - Routes transactions to appropriate parsers
  - Supports both bonding curve trades and AMM swaps
- **comprehensive-subscription.ts**: Advanced monitoring
  - Monitors both transactions AND account updates
  - Supports all four data streams (2 programs × 2 event types)
  - Parses bonding curve and AMM pool account states

#### Price Calculations (`src/utils/`)
- **Constants**: 
  - Pump.fun tokens: 6 decimal places
  - SOL: 9 decimal places (lamports)
  - Market cap: Assumes 1B token supply
  - Pump.fun program: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
  - Pump.swap AMM program: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- **Formula**: `price = (virtualSolReserves / 1e9) / (virtualTokenReserves / 1e6)`
- **Progress**: 30 SOL start → 85 SOL = 100% (migration threshold)

#### Event Parsing
- **trade-event-parser-simple.ts**: Manual parsing for pump.fun trades
  - Parses buy/sell events with isBuy boolean field
  - Extracts user addresses and trade amounts
  - Handles IDL parsing issues with manual decoding
- **amm-swap-parser.ts**: AMM swap transaction parser
  - Detects buy/sell using discriminators
  - Buy: `[102, 6, 61, 18, 1, 218, 235, 234]`
  - Sell: `[51, 230, 133, 164, 1, 127, 131, 173]`
  - Extracts swap amounts from inner instructions
  - Handles Buffer-based account indexes
- **amm-account-parser-simple.ts**: AMM pool account parser
  - Parses pool reserves without IDL dependencies
  - Scans for reasonable reserve values

#### Database (`src/database.ts`)
PostgreSQL with connection pooling:
- **tokens**: Basic token info with first_seen timestamp
- **price_updates**: Historical prices with progress percentage
- **trades**: Individual trades (populated by trades-db monitor)
- **graduated_tokens**: Tokens that migrated to Raydium
- **token_metadata**: Helius-enriched data
- **token_holders**: Top 20 holders per token
- **sol_prices**: SOL price history for dashboard

$8888 threshold monitor saves tokens when market cap ≥ $8888.

### Services
- **sol-price.ts**: SOL price fetching service
  - Reads from database first (10-second cache)
  - Falls back to CoinGecko API if needed
  - Returns fallback price: $180 if all sources fail
- **sol-price-updater.ts**: Independent SOL price updater
  - Updates database every 2 seconds (respects 30 calls/minute limit)
  - Uses multiple sources: CoinGecko (primary), Binance (fallback)
  - Implements exponential backoff on rate limits (up to 60s)
  - Automatically starts with trade and threshold monitors
  - Cleans up old prices after 24 hours
- **threshold-tracker.ts**: Monitors for $8888+ tokens
  - Tracks saved tokens in memory
  - Auto-enriches new tokens if HELIUS_API_KEY is set
- **helius.ts**: Fetches token metadata and holder distribution
  - Enriches tokens with metadata
  - Tracks top 20 holders
- **graduation-tracker.ts**: Monitors bonding curve graduations
  - Uses SimpleGraduationTracker to avoid IDL issues

### Web Dashboard (`src/api/`)
Express server with real-time token monitoring:
- **server.ts**: Main API server
- **dashboard/**: Static HTML/CSS/JS files
- Endpoints:
  - `/api/tokens` - All saved tokens
  - `/api/tokens/graduated` - Graduated tokens only
  - `/api/tokens/bonding` - Bonding curve tokens only
  - `/api/sol-price` - Current SOL price

### Monitors (`src/monitors/`)

#### Core Monitors
- **threshold-monitor.ts**: Saves tokens with market cap ≥ $8888
- **trade-monitor-v2.ts**: Tracks buy/sell activity with statistics
- **simple-progress.ts**: Shows progress bars for bonding curves
- **bonding-curve-monitor.ts**: Streams bonding curve account updates
- **unified-monitor.ts**: Combined price + progress monitor

#### Dual-Program Monitors
- **dual-program-monitor.ts**: Monitors pump.fun + pump.swap simultaneously
  - Tracks separate statistics for each program
  - Shows recent trades from both programs
  - Displays combined volume totals
- **dual-program-monitor-debug.ts**: Same as above with debug logging
- **test-stream.ts**: Tests gRPC stream connectivity
- **comprehensive-monitor.ts**: Advanced 4-stream monitor
  - Monitors transactions for both programs
  - Monitors account updates for both programs
  - Shows bonding curve state changes
  - Shows AMM pool state changes
  - Visual display only, no database persistence

## Critical Implementation Details

### Environment Variables
```bash
# Required
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to  # Must include https://
SHYFT_GRPC_TOKEN=your-token-here
DATABASE_URL=postgresql://user@localhost:5432/pump_monitor

# Optional
HELIUS_API_KEY=your-helius-api-key-here  # For token enrichment
API_PORT=3001                            # Dashboard server port
SHYFT_API_KEY=your-api-key-here         # For Shyft REST API
SHYFT_RPC_URL=https://rpc.shyft.to?api_key=your-api-key-here
```

### Known Issues & Solutions
1. **gRPC Serialization Error (code 13)**
   - Occurs during reconnection
   - Doesn't affect functionality
   - Suppressed in error handlers

2. **Endpoint Format**
   - Must be full URL with protocol
   - ❌ `grpc.shyft.to`
   - ✅ `https://grpc.shyft.to`

3. **IDL Parsing Errors**
   - BorshCoder has issues with Pump.fun IDL format
   - Solution: Use SimpleTradeEventParser for manual decoding
   - Error: "Cannot use 'in' operator to search for 'vec' in pubkey"

4. **Rate Limit: RESOURCE_EXHAUSTED Error**
   - Shyft limits: 50 subscriptions per 60 seconds per token
   - Solution implemented:
     - Tracks subscription timestamps
     - Enforces rate limit (max 30 subscriptions/minute for safety)
     - Exponential backoff (2s → 60s max)
     - Proper stream cleanup with destroy() fallback

5. **Account Index Parsing**
   - Account indexes may come as Buffer instead of array
   - Solution: Convert Buffer to array with `Array.from(buffer)`
   - Required for proper user/token address extraction in AMM swaps

### Type Safety
- Cast base58 encoding: `toString('base58' as any)`
- Ping ID access: `(data.ping as any).id`
- Buffer handling for pubkeys and data
- Program ID conversion: `bs58.encode(programKey as unknown as Uint8Array)`

## Event Types

### Transaction Events
- **Bonding Curve Trades**: Buy/sell on pump.fun bonding curves
- **AMM Swaps**: Buy/sell on pump.swap AMM pools

### Account Events  
- **Bonding Curve Accounts**: State updates for bonding curves
- **AMM Pool Accounts**: State updates for AMM liquidity pools

## Testing Single Features

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Test specific monitor with timeout
timeout 30 npm run threshold  # macOS: use gtimeout

# View database content
psql $DATABASE_URL -c "SELECT COUNT(*) FROM tokens"

# Test dashboard API
curl http://localhost:3001/api/tokens | jq

# Test dual-program monitoring
npm run dual-debug  # Shows detailed parsing logs
```

## Monitor Organization

All monitoring scripts are in `src/monitors/`:
- Core monitors: threshold, trades, progress, bonding, unified
- Dual-program: dual, dual-debug, comprehensive
- Variants: threshold-auto, threshold-plus, trades-db
- Each uses appropriate stream handler based on requirements

Database utilities are in `src/examples/`:
- Viewers: view-saved-tokens, view-enriched-tokens, view-graduated-tokens
- Enrichment: enrich-tokens, update-token-ages, update-graduated-prices
- Utilities: check-graduations, modify-subscription

## Database Schema

Key tables and their purposes:
- `tokens`: Core token information, saved when market cap ≥ $8888
- `price_updates`: Time-series price data with bonding curve progress
- `trades`: Individual trade records (requires trades-db monitor)
- `graduated_tokens`: Tokens that completed bonding curve
- `token_metadata`: Enriched data from Helius API
- `token_holders`: Top 20 holders per token
- `sol_prices`: SOL/USD price history for accurate valuations