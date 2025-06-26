# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Pump.fun token monitor with real-time price streaming, bonding curve progress tracking, and database persistence for high-value tokens. Uses Shyft's gRPC endpoint to stream Solana blockchain data.

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
npm run trades       # Trade monitor with buy/sell tracking

# Database & Enrichment
npm run view-tokens  # View saved tokens from threshold monitor
npm run enrich-tokens # Fetch metadata from Helius API
npm run view-enriched # View enriched token data
npm run update-ages  # Update token creation times from blockchain

# Web Dashboard
npm run dashboard    # Start web dashboard (http://localhost:3001)
```

## Architecture

### Data Flow
1. **gRPC Stream** → Receives raw transaction data from Shyft
2. **Event Parser** → Uses IDL-based parsing for TradeEvents and graduation events
3. **Price Calculator** → Computes prices using virtual reserves
4. **Monitors** → Display data and optionally save to PostgreSQL

### Core Components

#### Stream Management (`src/stream/`)
- **client.ts**: Singleton gRPC client
  - CRITICAL: Endpoint must be full URL (e.g., `https://grpc.ams.shyft.to`)
  - Handles authentication with SHYFT_GRPC_TOKEN
- **subscription.ts**: Transaction stream handler
  - Slot-based reconnection (tracks lastProcessedSlot)
  - 30 retry attempts before resetting to latest
  - Handles ping/pong keepalive
- **account-subscription.ts**: Bonding curve account updates
  - Uses Borsh decoding for account data
  - Less frequent than transaction updates

#### Price Calculations (`src/utils/`)
- **Constants**: 
  - Pump.fun tokens: 6 decimal places
  - SOL: 9 decimal places (lamports)
  - Market cap: Assumes 1B token supply
- **Formula**: `price = (virtualSolReserves / 1e9) / (virtualTokenReserves / 1e6)`
- **Progress**: 30 SOL start → 115 SOL = 100% (migration threshold ~85-86 SOL)

#### Event Parsing
**IDL-Based Parsing** (Recommended):
- Uses Anchor's BorshCoder and EventParser
- Parses complete TradeEvent structure including:
  - is_buy: Boolean to distinguish buy/sell
  - user: Trader's address
  - sol_amount/token_amount: Trade amounts
  - virtual reserves and fees

**Legacy Manual Parsing** (Deprecated):
- TradeEvent (225 bytes):
  - Bytes 0-7: Discriminator
  - Bytes 8-40: Mint address (32 bytes)
  - Bytes 97-104: Virtual SOL reserves (u64)
  - Bytes 105-112: Virtual token reserves (u64)

#### Database (`src/database.ts`)
PostgreSQL with connection pooling:
- **tokens**: Basic token info
- **price_updates**: Historical prices with progress
- **trades**: Individual trades (not currently populated)

$8888 threshold monitor saves tokens when market cap ≥ $8888.

### Services
- **sol-price.ts**: CoinGecko integration
  - 60-second cache
  - Fallback price: $180
- **threshold-tracker.ts**: Monitors for $8888+ tokens
  - Tracks saved tokens in memory
  - Saves price updates for tracked tokens
- **helius.ts**: Fetches token metadata and holder distribution
  - Enriches tokens with metadata
  - Tracks top 20 holders
- **trade-event-parser.ts**: IDL-based event parsing
  - Parses buy/sell events with full details
  - Provides trade statistics and summaries
- **graduation-tracker.ts**: Tracks token graduations
  - Uses IDL to parse migration events
  - Updates database when tokens graduate

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

3. **Bonding Curve Account Updates**
   - Much less frequent than transactions
   - Use transaction-based progress tracking for real-time updates

4. **Rate Limit: RESOURCE_EXHAUSTED Error**
   - Shyft limits: 50 subscriptions per 60 seconds per token
   - Solution implemented:
     - Tracks subscription timestamps
     - Enforces rate limit (max 45 subscriptions/minute)
     - Exponential backoff (2s → 60s max)
     - Proper stream cleanup with destroy() fallback

### Type Safety
- Cast base58 encoding: `toString('base58' as any)`
- Ping ID access: `(data.ping as any).id`
- Buffer handling for pubkeys and data

## Testing Single Features

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Test specific monitor with timeout
timeout 30 npm run threshold  # macOS: use gtimeout

# View database content
psql $DATABASE_URL -c "SELECT COUNT(*) FROM tokens"
```