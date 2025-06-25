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

# Database
npm run view-tokens  # View saved tokens from threshold monitor
```

## Architecture

### Data Flow
1. **gRPC Stream** → Receives raw transaction data from Shyft
2. **Event Parser** → Extracts TradeEvents from logs (225 bytes)
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

#### Event Structure
TradeEvent (225 bytes):
- Bytes 0-7: Discriminator
- Bytes 8-40: Mint address (32 bytes)
- Bytes 97-104: Virtual SOL reserves (u64)
- Bytes 105-112: Virtual token reserves (u64)
- Remaining bytes: Unknown (likely trader, amounts, etc.)

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

## Critical Implementation Details

### Environment Variables
```bash
# Required
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to  # Must include https://
SHYFT_GRPC_TOKEN=your-token-here
DATABASE_URL=postgresql://user@localhost:5432/pump_monitor

# Optional (from .env)
SHYFT_API_KEY=...  # Not used in current implementation
SHYFT_RPC_URL=...  # Not used in current implementation
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