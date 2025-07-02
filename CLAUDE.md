# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Overview

Real-time Solana token monitor for pump.fun bonding curves and pump.swap AMM pools. Streams blockchain data via Shyft's gRPC, tracks prices/market caps, saves high-value tokens (≥$8,888) to PostgreSQL.

## Quick Start

```bash
npm run start        # Run all 4 monitors (RECOMMENDED)
npm run dashboard    # Web dashboard (http://localhost:3001)
npm run build       # Build TypeScript
```

## Architecture

### Core Components
- **Monitors**: BC (bonding curve) and AMM monitors for trades/accounts
- **Shared Stream**: Single gRPC connection shared by all monitors
- **Event Bus**: Components communicate via events
- **DI Container**: Dependency injection for all services

### Key Services
- `enhanced-auto-enricher.ts` - Metadata enrichment (Shyft/Helius)
- `amm-pool-state-service.ts` - Pool state tracking
- `enhanced-amm-price-calculator.ts` - Price calculations with fallback
- `liquidity-event-handler.ts` - Liquidity tracking (AMM Session 1)
- `amm-fee-service.ts` - Fee tracking (AMM Session 2)
- `lp-position-calculator.ts` - LP positions (AMM Session 3)
- `amm-pool-analytics.ts` - Pool analytics (AMM Session 4)
- `graduation-fixer-service.ts` - Auto-fixes tokens that graduated but weren't marked
- `enhanced-stale-token-detector.ts` - Removes stale tokens with no recent activity
- `sol-price-service.ts` - Tracks SOL/USD price from multiple sources

### Key Features
- ✅ BC & AMM monitoring with >95% parse rate
- ✅ Automatic graduation detection and fixing
- ✅ Price fallback for AMM (trade amounts when reserves unavailable)
- ✅ Metadata enrichment with rate limiting
- ✅ Dashboard with real-time token tracking
- ✅ Stale token detection and removal
- ✅ Bonding curve progress tracking (0-100%)
- ✅ FDV calculation (10x market cap for pump.fun tokens)

## Environment Variables

```bash
# Required
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to
SHYFT_GRPC_TOKEN=your-token
DATABASE_URL=postgresql://user@localhost:5432/pump_monitor

# Optional
HELIUS_API_KEY=your-key     # Metadata fallback
SHYFT_API_KEY=your-key      # Primary metadata
BC_SAVE_THRESHOLD=8888      # BC market cap threshold
AMM_SAVE_THRESHOLD=1000     # AMM market cap threshold
```

## Database Schema

Main tables:
- `tokens_unified` - Token data with metadata and graduation status
- `trades_unified` - All trades (BC & AMM) with bonding curve progress
- `liquidity_events` - Liquidity add/remove events
- `amm_fee_events` - Fee collection tracking
- `lp_positions` - LP token positions
- `amm_pool_metrics_hourly` - Hourly pool analytics
- `bonding_curve_mappings` - Maps bonding curves to mint addresses

## Dashboard Features

### Main Dashboard (http://localhost:3001)
- **Token List**: Real-time display of all monitored tokens
- **Columns**: 
  - #: Row number
  - Token: Symbol, name, icon, and trading pair
  - Market Cap: Current market cap and FDV (10x)
  - Price USD: Current token price
  - Age: Time since token creation/discovery
  - Liquidity: Estimated liquidity value
  - Progress: Bonding curve progress bar (0-100%) or "GRAD"
  - Links: Quick access to pump.fun and Solscan pages
- **Filters**: 
  - New Tokens (non-graduated only)
  - Graduated (AMM tokens only)
  - Market cap range
  - Token age
  - Liquidity range
- **Token Counters**: Shows total count for New Tokens and Graduated tokens
- **SOL Price**: Real-time SOL/USD price with last update timestamp
- **Stream Indicator**: Shows gRPC connection status with pulse animation

### Additional Dashboards
- **AMM Analytics** (http://localhost:3001/amm-dashboard.html): Pool analytics and metrics
- **Streaming Metrics** (http://localhost:3001/streaming-metrics.html): Monitor performance stats

## Recent Updates (January 2025)

### Latest Changes (Jan 3)
- ✅ Added GraduationFixerService - automatically detects and fixes graduated tokens
  - Runs on startup and every 5 minutes
  - Finds tokens with AMM trades that aren't marked as graduated
  - Updates graduation status and timestamps automatically
  - Integrated into main application lifecycle
- ✅ Dashboard improvements:
  - Token counters show total counts for each type (e.g., "New Tokens 154")
  - Removed 24hr % and Volume 24h columns for cleaner layout
  - Renamed "Holders" column to "Links" with pump.fun and Solscan icons
  - Icons link directly to token pages on respective platforms
  - Fixed token age display - now shows actual blockchain creation time when available
  - Unified header across all dashboard pages with live SOL price and connection status
  - Renamed "Streaming Metrics" to "Stream" for cleaner navigation
- ✅ Fixed graduated tokens detection for 10 tokens including SCAM token
- ✅ Token creation time improvements:
  - Dashboard displays actual blockchain creation time when available
  - Falls back to "first seen" time when creation time unavailable
  - Tooltip explains the source of the age data
  - Update script fetches creation times from multiple sources (RPC, Shyft, Helius)
- ✅ Code cleanup:
  - Removed .DS_Store files
  - TypeScript compilation verified (no errors)
  - Build process successful

### Previous Changes (Jan 2)
- ✅ Fixed AMM virtual reserves storage - changed from decimal to bigint
- ✅ Fixed bonding curve progress tracking - calculated for all BC trades
- ✅ SOL price updater starts automatically
- ✅ Dashboard shows token counters in sub-header
- ✅ All 4 monitors running successfully
- ✅ System processing ~38 TPS combined

### System Performance
- **BC Monitor**: ~24.5 trades/second
- **AMM Monitor**: ~13.8 trades/second
- **Total TPS**: ~38 combined
- **Parse Rate**: >95% for both BC and AMM
- **Enrichment**: Automatic with rate limiting
- **Graduation Detection**: Automatic with fixing service

## Known Issues & Solutions

### Common Issues
1. **Shyft gRPC connection limit**: "Maximum connection count reached"
   - Solution: Wait 5-10 minutes or use different token
   - Script available: `./scripts/fix-connection-limit.sh`

2. **Missed graduations**: Some tokens not marked as graduated
   - Solution: GraduationFixerService runs automatically
   - Manual fix: `npx tsx src/scripts/fix-graduated-tokens.ts`

3. **DNS resolution errors**: AMM account monitor connection issues
   - Solution: Usually resolves on retry

4. **Enrichment counter**: Shows 0 but enrichment is working
   - This is a cosmetic issue only

### Data Path Notes
- gRPC transaction path: `data.transaction.transaction.transaction`
- Price calculation fallback: Uses trade amounts when reserves unavailable
- Metadata rate limits: 200ms between requests, batch size 20

## Scripts & Utilities

### Token Management
```bash
# Fix graduated tokens manually
npx tsx src/scripts/fix-graduated-tokens.ts

# Update token creation times
npx tsx src/scripts/update-top-tokens-creation-times.ts  # Top tokens only
npx tsx src/scripts/update-token-creation-times.ts       # All tokens
```

### Development
```bash
npm run dev          # Development mode with hot reload
npm run test         # Run tests
npm run lint         # Check code quality
npm run typecheck    # TypeScript validation
```

## Important Notes

- Always use `npm run start` for production
- BC save threshold: $8,888 market cap
- AMM save threshold: $1,000 market cap
- All monitors use dependency injection
- Events drive cross-component communication
- Dashboard updates every 10 seconds
- Token age shows blockchain creation time when available
- FDV = Market Cap × 10 (pump.fun tokens have 10% circulating supply)