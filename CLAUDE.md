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

## Recent Updates (January 2025)

### Dashboard Improvements
- Added SOL price timestamp display (shows when price was last updated)
- Added streaming indicator icon with pulse animation when connected
- New Tokens/Graduated toggle in sub-header for filtering token views
- Removed unnecessary navigation items (BC Monitor, New Pairs, Gainers, etc.)
- Token age now shows actual blockchain creation time when available

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

### Key Features
- ✅ BC & AMM monitoring with >95% parse rate
- ✅ Automatic graduation detection
- ✅ Price fallback for AMM (trade amounts when reserves unavailable)
- ✅ Metadata enrichment with rate limiting
- ✅ 6 BC Enhancement Phases implemented
- ✅ 5 AMM Enhancement Sessions integrated

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
```

## Database Schema

Main tables:
- `tokens_unified` - Token data with metadata
- `trades_unified` - All trades (BC & AMM)
- `liquidity_events` - Liquidity add/remove
- `amm_fee_events` - Fee tracking
- `lp_positions` - LP token positions
- `amm_pool_metrics_hourly` - Pool analytics

## Recent Updates (January 2025)

### Latest Changes (Jan 2)
- ✅ Fixed AMM virtual reserves storage - changed from decimal to bigint to match DB schema
- ✅ Fixed bonding curve progress tracking - now calculated and stored for all BC trades
- ✅ Added bondingCurveProgress field to BCTradeEvent type and parsers
- ✅ Fixed AMM trade counter - stats now properly increment for AMM trades
- ✅ SOL price updater now starts automatically with container initialization
- ✅ Dashboard shows token counters for New Tokens and Graduated tabs
- ✅ All 4 monitors (BC, BCAccount, AMM, AMMAccount) running successfully
- ✅ System processing ~38 TPS combined (24.5 BC + 13.8 AMM)

### Previous major fixes
- ✅ Fixed AMM event parsing issue - events now extracted correctly
- ✅ Fixed decimal conversion error in TradeRepository
- ✅ Created direct event decoder to bypass Anchor IDL compatibility issues
- ✅ AMM reserves now extracted from events (pool_base_token_reserves, pool_quote_token_reserves)
- ✅ Price calculation should now work with proper reserve data
- ✅ Fixed pool state persistence - reserves now saved to tokens_unified table
- ✅ Fixed current_program field - now properly set to 'amm_pool' for AMM trades
- ✅ Token decimal formatting verified - raw values stored, formatted on display
- ✅ Fixed BC monitor price_sol column error - updated field names to match schema
- ✅ Progress bar shows percentage for BC tokens, "GRAD" for graduated tokens

### Previous Updates
- ✅ Dashboard UI improvements (SOL price timestamp, stream indicator)
- ✅ Token creation time tracking with blockchain accuracy
- ✅ New Tokens/Graduated toggle for better token filtering
- ✅ Enhanced metadata enrichment with creation time fetching
- ✅ Integrated all AMM enhancement sessions
- ✅ Fixed TypeScript build errors
- ✅ Shared stream manager for efficiency
- ✅ Token Enrichment Sessions 1-4 completed

### AMM Enhancements Status
1. **Session 1**: ✅ Liquidity event tracking
2. **Session 2**: ✅ Fee tracking system
3. **Session 3**: ✅ LP position tracking
4. **Session 4**: ✅ Pool analytics
5. **Session 5**: ✅ Enhanced price impact

### Token Creation Time Service
- New `TokenCreationTimeService` fetches actual blockchain creation timestamps
- Uses multiple sources: Shyft TX history, Helius metadata, RPC signatures
- Automatically integrated into enrichment process
- Scripts available to backfill existing tokens:
  ```bash
  npx tsx src/scripts/update-top-tokens-creation-times.ts  # Top tokens only
  npx tsx src/scripts/update-token-creation-times.ts       # All tokens
  ```

### Known Issues
- GraphQL metadata disabled (schema issues)
- Shyft gRPC connection limits may cause "Maximum connection count reached" errors
- AMM account monitor may fail with DNS resolution errors - retry usually fixes this
- Enrichment counter shows 0 in stats but enrichment is working (cosmetic issue)
- Some tokens at 100% progress not marked as graduated (waiting for graduation event)

### AMM Event Parsing Fix
The AMM monitor was not extracting pool reserves due to an Anchor IDL compatibility issue. This has been fixed by:
1. Creating a direct event decoder (`src/utils/amm-event-decoder.ts`) that bypasses Anchor
2. Adding fallback mechanism in AMM monitor when Anchor parser fails
3. Correcting the BuyEvent discriminator (was [103,244,82,31,44,181,119,119] not [103,244,82,31,44,245,119,119])

## Common Issues & Solutions

1. **gRPC connection**: Data path is `data.transaction.transaction.transaction`
2. **Price calculation**: Falls back to trade amounts when reserves unavailable
3. **Metadata rate limit**: 200ms between requests, batch size 20

## Testing

```bash
npm run test:integration   # Integration tests
npm run test:coverage     # Coverage report
```

## Important Notes

- Always use `npm run start` for production
- BC threshold: $8,888, AMM threshold: $1,000
- All monitors use DI container
- Events drive cross-component communication
- Dashboard filters: "New Tokens" = un-graduated only, "Graduated" = graduated only
- Token age shows blockchain creation time when available, falls back to first detection