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

### Key Services (Organized by Directory)
#### Core Services (`services/core/`)
- Event parsing, IDL parsing, block tracking

#### Pricing Services (`services/pricing/`)
- `price-calculator.ts` - Unified price calculator for BC and AMM
- `sol-price-service.ts` - SOL/USD price tracking (merged sol-price + updater)
- `realtime-price-cache.ts` - In-memory cache for instant price access

#### Metadata Services (`services/metadata/`)
- `enhanced-auto-enricher.ts` - Orchestrates metadata enrichment
- `providers/helius.ts` - Helius API provider
- `providers/shyft-metadata-service.ts` - Shyft DAS API provider

#### AMM Services (`services/amm/`)
- `amm-pool-state-service.ts` - Pool state tracking
- `amm-pool-analytics.ts` - Pool analytics (AMM Session 4)
- `amm-fee-service.ts` - Fee tracking (AMM Session 2)
- `lp-position-calculator.ts` - LP positions (AMM Session 3)

#### Token Management (`services/token-management/`)
- `graduation-fixer-service.ts` - Auto-fixes graduated tokens
- `enhanced-stale-token-detector.ts` - Removes stale tokens
- `token-creation-time-service.ts` - Fetches creation timestamps

#### Monitoring Services (`services/monitoring/`)
- Performance monitoring, stats aggregation, alerts

#### Analysis Services (`services/analysis/`)
- MEV detection, slippage analysis, fork detection

#### Recovery Services (`services/recovery/`)
- Recovery queue, pool creation monitoring

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

### Latest Changes (Jan 3-4)
- ✅ **Major Code Reorganization**:
  - Reorganized `src/services/` from 40 files to 28 files in logical subdirectories
  - Reorganized `src/utils/` from 12 files to 10 files in logical subdirectories
  - Deleted 15 redundant/unused files
  - Merged sol-price.ts and sol-price-updater.ts into single sol-price-service.ts
  - Fixed all import paths throughout codebase
  - Build completes successfully with no TypeScript errors
- ✅ **Dashboard Price Display Issue**:
  - Identified that tokens showing $0.0001 are graduated to Raydium AMM
  - Current system only monitors pump.swap AMM, missing Raydium graduations
  - This causes 100% progress tokens to show default price of $0.0001
  - Workaround: Run `npx tsx src/scripts/fix-graduated-tokens.ts`
  - Proper fix: Implement Raydium AMM monitoring
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
- ✅ Real-time price updates:
  - Added RealtimePriceCache service for instant price updates
  - Reduced batch processing delays from 1s to 250ms
  - Dashboard refresh interval reduced to 3 seconds
  - New /api/tokens/realtime endpoint bypasses database for fresh prices
  - Prices now update within seconds instead of minutes
- ✅ **Parser Directory Reorganization** (Jan 4):
  - Moved `src/parsers/` to `src/utils/parsers/` for better organization
  - Updated all import paths throughout codebase
  - Removed redundant `base-strategy.ts` file
  - Fixed import issues in strategy files
- 🚧 **Raydium Monitor Implementation** (Jan 4):
  - Created RaydiumMonitor class to track graduated tokens on Raydium AMM
  - Implemented SimpleRaydiumTradeStrategy parser for swap detection
  - Added to main application startup sequence
  - **ISSUE: 0% parse rate - no Raydium transactions being received**
  - Created debugging scripts to investigate subscription issues
  - Needs further investigation - see "Raydium Monitor Issues" section below

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

### Raydium Monitor Issues (Jan 4, 2025)
**Status**: Implemented but not receiving transactions (0% parse rate)

**What was done**:
1. Created `RaydiumMonitor` class extending BaseMonitor
2. Implemented `SimpleRaydiumTradeStrategy` parser for swap detection
3. Added Raydium events to EventBus (RAYDIUM_SWAP, RAYDIUM_LIQUIDITY)
4. Integrated with main application startup
5. Created standalone runner: `npm run raydium-monitor`

**Issues Found**:
1. **No Raydium transactions received**: The gRPC subscription filter doesn't seem to work
   - Tried `accountInclude: [RAYDIUM_PROGRAM_ID]` - no transactions received
   - Direct monitor also receives 0 Raydium transactions
   - Shared stream manager might be overriding subscription configs
2. **Parser shows 0% success rate**: No transactions to parse
3. **Subscription mechanism unclear**: Need to investigate proper Raydium filtering

**Debugging Scripts Created**:
- `src/run-raydium-monitor-direct.ts` - Direct gRPC connection test
- `src/scripts/test-raydium-stream.ts` - Test subscription
- `src/scripts/find-raydium-transactions.ts` - Search all transactions

**Next Steps**:
1. Verify Raydium program ID is correct: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
2. Test different subscription approaches (monitor all, filter client-side)
3. Check if graduated tokens are actually using Raydium vs other AMMs
4. Consider monitoring pump.fun graduations first, then track on Raydium

**Original Issue**: Pump.fun tokens graduating to Raydium show $0.0001 price
- Dashboard shows incorrect price for Raydium-graduated tokens
- Need working Raydium monitor to fix this

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

## Code Structure

### Directory Organization
```
src/
├── services/          # Business logic services
│   ├── core/         # Core infrastructure (event parsing, IDL, blocks)
│   ├── pricing/      # Price calculations and SOL price tracking
│   ├── metadata/     # Token metadata enrichment
│   ├── amm/          # AMM-specific services
│   ├── monitoring/   # System monitoring and stats
│   ├── token-management/  # Token lifecycle management
│   ├── analysis/     # MEV, slippage, fork analysis
│   └── recovery/     # Data recovery services
├── utils/            # Utility functions
│   ├── amm/          # AMM utilities (decoders, calculators)
│   ├── config/       # Constants and configuration
│   ├── parsers/      # Event and transaction parsers
│   └── formatters/   # Data formatting utilities
└── ...
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
- **Graduated tokens showing $0.0001**: These graduated to Raydium (not monitored)