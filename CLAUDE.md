# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Overview

Real-time Solana token monitor for pump.fun bonding curves and pump.swap AMM pools. Uses smart streaming architecture with domain monitors. Streams blockchain data via Shyft's gRPC, tracks prices/market caps, saves high-value tokens (≥$8,888) to PostgreSQL.

## Quick Start

```bash
npm run start        # Run all domain monitors
npm run dashboard    # Web dashboard (http://localhost:3001)
npm run build       # Build TypeScript
npm run test        # Run tests
npm run lint        # ESLint checks
npm run typecheck   # TypeScript validation
```

## Architecture

### Core Components
- **Domain Monitors**: TokenLifecycle, TradingActivity, Liquidity monitors
- **Smart Streaming**: Connection pooling with load balancing
- **Data Pipeline**: Unified event processing with batching
- **Event Bus**: Inter-component communication
- **DI Container**: Dependency injection

### Key Services
- **Core** (`services/core/`): Smart streaming, connection pool, subscriptions
- **Pricing** (`services/pricing/`): Price calculations, SOL tracking
- **Metadata** (`services/metadata/`): Token enrichment
- **AMM** (`services/amm/`): Pool state, analytics, fees, PoolStateCoordinator
- **Token Management**: Graduation fixing, stale detection
- **Monitoring**: Fault tolerance, performance, alerts, parsing metrics
- **Analysis**: MEV detection, slippage analysis
- **Recovery**: Circuit breakers, state recovery
- **Pipeline**: Event processing, normalization, batching
- **Holder Analysis**: Complete holder distribution analysis system
- **Parsing**: Unified strategies, metrics tracking, failure analysis

### Key Features
- BC & AMM monitoring with >95% parse rate
- Accurate graduation detection via `complete` field
- Real-time dashboard with token tracking
- Bonding curve progress (0-100% based on 84 SOL)
- FDV calculation (10x market cap)
- Fault tolerance with auto-recovery
- Token holder analysis with scoring (0-300)

## Environment Variables

```bash
# Required
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to
SHYFT_GRPC_TOKEN=your-token
DATABASE_URL=postgresql://user@localhost:5432/pump_monitor

# Optional
HELIUS_API_KEY=your-key
SHYFT_API_KEY=your-key
BC_SAVE_THRESHOLD=8888
AMM_SAVE_THRESHOLD=1000
POOL_MAX_CONNECTIONS=3
FAULT_TOLERANCE_ENABLED=true
USE_CONSOLIDATED_PARSERS=true
HOLDER_ANALYSIS_MARKET_CAP_THRESHOLD=18888
HOLDER_ANALYSIS_SOL_THRESHOLD=125
HOLDER_ANALYSIS_MAX_CONCURRENT=3
HOLDER_ANALYSIS_INTERVAL_HOURS=6
HOLDER_ANALYSIS_AUTO_ENABLED=true
```

## Database Schema

Main tables:
- `tokens_unified` - Token data with metadata
- `trades_unified` - All trades with BC progress
- `liquidity_events` - Liquidity events
- `holder_snapshots` - Holder distribution data
- `wallet_classifications` - Wallet types

## Dashboard Features

- **Main Dashboard**: Real-time token list with filters
- **Token Detail**: Comprehensive token info with charts
- **Holder Analysis**: Distribution metrics and scoring
- **Streaming Metrics**: Enhanced performance monitoring with:
  - Parse rate tracking by venue (BC/AMM/Raydium)
  - Strategy performance metrics
  - Data quality indicators
  - Real-time failure analysis
  - System resource monitoring

## Smart Streaming Architecture

### Domain Monitors
1. **TokenLifecycleMonitor**: BC creation, trading, graduation
2. **TradingActivityMonitor**: Cross-venue trading, MEV detection
3. **LiquidityMonitor**: Pool liquidity tracking
4. **PoolCreationMonitor**: AMM pool creation detection (graduations)
5. **BondingCurveCompletionMonitor**: BC completion tracking

### Infrastructure
- Connection pooling with health monitoring
- Load balancing with predictive analytics
- Rate limiting (100 subs/60s Shyft limit)
- Fault tolerance with circuit breakers
- Performance optimization with adaptive caching

## Recent Updates (July 2025)

### Latest Changes
- ✅ **Specialized Graduation Monitors** (July 10, 2025):
  - Added PoolCreationMonitor for detecting AMM pool creation (graduations)
  - Added BondingCurveCompletionMonitor for tracking BC completions
  - Triple redundancy for graduation detection (AMM trades, pool creation, BC completion)
  - Database schema enhanced with graduation tracking columns
  - Stores pool address and graduation signature for verification
- ✅ AMM Parsing Implementation (Phases 1-4):
  - Parse Success Metrics service with detailed tracking
  - Consolidated parsing strategies (6→2 for AMM)
  - PoolStateCoordinator for account monitoring integration
  - Enhanced streaming metrics dashboard
  - Parse rate analysis tool
  - Cross-venue correlation support
  - WebSocket endpoints for real-time metrics
- ✅ Holder Analysis Implementation (Sessions 1-9):
  - Database schema with 5 new tables
  - Helius/Shyft API integration
  - 0-300 point scoring algorithm
  - Job queue with priority processing
  - Web dashboard with visualizations
  - Historical tracking and trends
  - Performance optimization with caching
  - Complete holder fetching (not just top 20)
- ✅ API rate limiting (5 req/s Helius)
- ✅ Reduced logging verbosity
- ✅ Dashboard shows numeric scores (0-300)
- ✅ Metadata & Transaction History (Session 10):
  - Enabled automatic metadata enricher for $8,888+ tokens
  - Added Shyft GraphQL client for efficient batch operations
  - Integrated transaction history fetching with GraphQL
  - Enhanced caching: 1-hour for metadata, 5-min for GraphQL
  - COALESCE protection prevents metadata overwrites
  - Holder count now syncs properly to tokens_unified

### System Performance
- **Total TPS**: ~38 combined
- **Parse Rate**: >95%
- **Graduation Detection**: Automatic
- **Holder Analysis**: $18,888 threshold

## Known Issues & Solutions

1. **Shyft gRPC limit**: Wait 5-10 minutes
2. **Missed graduations**: Now handled by triple redundancy (PoolCreationMonitor + BCCompletionMonitor + AMM trades)
3. **Price precision**: API calculates from SOL price
4. **Shyft holder endpoints return 404**: Using Helius RPC for complete holder data
5. **20 holder RPC limit**: Resolved by using HeliusCompleteHolderFetcher

## Scripts & Utilities

### Development
```bash
npm run dev          # Hot reload
npx tsx src/scripts/fix-graduated-tokens.ts
```

### Test Scripts
```bash
# Smart streaming sessions
npx tsx src/scripts/test-session-[1-10].ts

# Holder analysis
npx tsx src/scripts/test-holder-analysis-session[1-9].ts
npx tsx src/scripts/analyze-tokens-with-rate-limits.ts
npx tsx src/scripts/test-complete-holder-fetching.ts

# AMM parsing analysis
npx tsx src/scripts/analyze-parse-rates.ts
npx tsx src/scripts/test-pool-state-coordinator.ts

# Metadata enrichment
npx tsx src/scripts/test-metadata-enrichment.ts
npx tsx src/scripts/enrich-high-value-tokens.ts

# Graduation detection
npx tsx src/scripts/test-specialized-monitors.ts
npx tsx src/scripts/analyze-graduation-system.ts
npx tsx src/scripts/monitor-pool-creation.ts
```

## Code Structure

```
src/
├── monitors/
│   ├── domain/              # Domain monitors
│   └── specialized/         # Specialized monitors
│       ├── pool-creation-monitor.ts
│       └── bonding-curve-completion-monitor.ts
├── services/
│   ├── core/                # Smart streaming
│   ├── pipeline/            # Event processing
│   ├── holder-analysis/     # Holder analysis
│   ├── metadata/            # Token metadata enrichment
│   │   └── providers/       # Shyft, Helius, GraphQL clients
│   └── [other services]
├── utils/                   # Utilities
└── scripts/                 # Test scripts
```

## Knowledge Base

Knowledge files in `.knowledge/` directories contain deep insights:
- `/src/database/.knowledge/` - Database best practices
- `/src/monitors/.knowledge/` - Monitoring insights
- `/src/services/holder-analysis/.knowledge/` - Analysis details

## Important Notes

- BC save threshold: $8,888
- AMM save threshold: $1,000
- Metadata enrichment threshold: $8,888
- Dashboard updates every 10 seconds
- FDV = Market Cap × 10
- Holder analysis threshold: $18,888
- All monitors use dependency injection
- Events drive cross-component communication
- Metadata is protected from overwrites via COALESCE
- Shyft GraphQL preferred for batch operations
- Helius RPC provides complete holder lists (all holders)

## Architecture Benefits

1. **Connection Pooling**: No single point of failure
2. **Domain Monitors**: Reduced code duplication
3. **Load Balancing**: Real-time distribution
4. **Rate Limiting**: Shyft compliance
5. **Data Pipeline**: Efficient batching
6. **MEV Detection**: Real-time alerts
7. **Fault Tolerance**: Auto-recovery
8. **Performance**: Adaptive optimization
9. **Scalability**: Easy extension

## Production Ready

- Smart streaming fully implemented
- Complete test suite
- TypeScript builds successfully
- >1000 TPS capability
- Production deployment scripts available