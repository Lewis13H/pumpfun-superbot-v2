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

### Completed
- ✅ Fixed AMM price calculation with fallback
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

### Known Issues
- AMM monitor shows 0 trades (subscription issue being debugged)
- GraphQL metadata disabled (schema issues)

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