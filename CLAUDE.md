# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Overview

Real-time Solana token monitor & evaluator for pump.fun bonding curves and pump.swap AMM pools. Uses smart streaming architecture with domain-driven monitors to track tokens across their entire lifecycle. Streams blockchain data via Shyft's gRPC, tracks prices/market caps, saves high-value tokens (≥$8,888) to PostgreSQL.

## Quick Start

```bash
npm run start        # Run all domain monitors with smart streaming
npm run dashboard    # Web dashboard (http://localhost:3001)
npm run build       # Build TypeScript
```

## Architecture

### Core Components
- **Domain Monitors**: TokenLifecycle, TradingActivity, and Liquidity monitors
- **Smart Streaming**: Connection pooling with load balancing and rate limiting
- **Data Pipeline**: Unified event processing with batching and normalization
- **Event Bus**: Components communicate via events
- **DI Container**: Dependency injection for all services

### Key Services (Organized by Directory)
#### Core Services (`services/core/`)
- `smart-stream-manager.ts` - Enhanced stream manager with connection pooling
- `connection-pool.ts` - Manages multiple gRPC connections with health monitoring
- `subscription-builder.ts` - Groups and prioritizes subscriptions by domain
- `load-balancer.ts` - Distributes load across connections with predictive analytics
- `subscription-rate-limiter.ts` - Ensures Shyft rate limit compliance (100 subs/60s)
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

#### Pipeline Services (`services/pipeline/`)
- `data-pipeline.ts` - Central event processing hub with batching and routing
- `event-normalizer.ts` - Standardizes events from all domain monitors
- `batch-manager.ts` - Efficient event batching with timeout controls
- `event-processor.ts` - Handles batch processing with caching and retries
- `pipeline-metrics.ts` - Comprehensive performance tracking with percentiles

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

# Connection Pool Configuration
POOL_MAX_CONNECTIONS=3      # Maximum gRPC connections
POOL_MIN_CONNECTIONS=2      # Minimum gRPC connections
POOL_HEALTH_CHECK_INTERVAL=30000  # Health check interval (ms)
POOL_CONNECTION_TIMEOUT=10000     # Connection timeout (ms)
POOL_MAX_RETRIES=3          # Max reconnection attempts
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
- **Clickable Rows**: Click any token to view detailed information

### Token Detail Page (http://localhost:3001/token-detail.html?mint=ADDRESS)
- **Comprehensive Token Information**:
  - Basic info: Symbol, name, image, creator address
  - Price metrics: Current price, 24h change, market cap, FDV
  - Trading stats: Volume (1h/24h/7d/total), unique traders, total trades
  - Token age: Shows actual blockchain creation time when available
  - Pool information: For graduated tokens, displays AMM pool details
- **Interactive Price Chart**:
  - Time filters: 1 hour, 24 hours, 7 days
  - Shows price history with candlestick or line chart
  - Real-time updates every 10 seconds
- **Transaction History**:
  - Recent trades with type (buy/sell), user address, amount, price
  - Links to view transactions on Solscan
- **External Links**: Quick access to pump.fun and Solscan token pages

### Additional Dashboards
- **AMM Analytics** (http://localhost:3001/amm-dashboard.html): Pool analytics and metrics
- **Streaming Metrics** (http://localhost:3001/streaming-metrics.html): Monitor performance stats

## Smart Streaming Architecture

### Completed Implementation (Sessions 1-7)
The system now features a comprehensive smart streaming architecture with connection pooling, domain monitors, and a unified data pipeline:

#### Core Infrastructure
- **Connection Pool**: Manages multiple gRPC connections with health monitoring
- **Smart Stream Manager**: Extends StreamManager with intelligent routing
- **Subscription Builder**: Groups and prioritizes subscriptions
- **Load Balancer**: Distributes load across connections with predictive analytics
- **Rate Limiter**: Ensures compliance with Shyft's 100 subscriptions/60s limit

#### Domain Monitors
1. **TokenLifecycleMonitor** (`src/monitors/domain/token-lifecycle-monitor.ts`)
   - Consolidates BC transaction and account monitoring
   - Tracks token creation, trading, and graduation
   - Real-time bonding curve progress (0-100%)
   - Market cap milestone detection

2. **TradingActivityMonitor** (`src/monitors/domain/trading-activity-monitor.ts`)
   - Unified monitoring across BC, AMM, and Raydium
   - MEV detection (sandwich attacks, frontrunning, copy trading)
   - High slippage trade tracking
   - Cross-venue analytics

3. **LiquidityMonitor** (`src/monitors/domain/liquidity-monitor.ts`)
   - Liquidity add/remove event detection
   - Fee collection tracking
   - Pool state monitoring with TVL calculations
   - LP position tracking

#### Data Pipeline Architecture
- **DataPipeline** (`src/services/pipeline/data-pipeline.ts`): Central event processing hub
- **EventNormalizer**: Standardizes events from all sources
- **BatchManager**: Efficient event batching with timeout controls
- **EventProcessor**: Handles batch processing with caching and retries
- **PipelineMetrics**: Comprehensive performance tracking

#### Configuration
Smart streaming is now the default and only mode. The system automatically uses domain monitors.

Environment variables for connection pool:
```bash
POOL_MAX_CONNECTIONS=3
POOL_MIN_CONNECTIONS=2
POOL_HEALTH_CHECK_INTERVAL=30000
POOL_CONNECTION_TIMEOUT=10000
POOL_MAX_RETRIES=3
```

## Recent Updates (January 2025)

### Latest Changes (Jan 5-6)
- ✅ **Connection Pool Implementation (Session 1)**:
  - Created `ConnectionPool` class with health monitoring and metrics
  - Implemented `SmartStreamManager` extending current StreamManager
  - Added pool configuration with environment variables
  - Connection prioritization: BC (high), AMM (medium), Raydium (low)
  - Health checks every 30 seconds with auto-recovery
  - Supports 2-3 concurrent gRPC connections
  - Removed obsolete test script: `test-amm-monitors.ts`
  - Created `MIGRATION_GUIDE.md` for incremental migration
  - Fixed all TypeScript errors in test scripts
  - Build completes successfully
- ✅ **Subscription Strategy Implementation (Session 2)**:
  - Created `SubscriptionBuilder` with grouping and priority routing
  - Implemented 3 subscription groups:
    - `bonding_curve`: High priority (BC monitors)
    - `amm_pool`: Medium priority (AMM monitors)
    - `external_amm`: Low priority (Raydium monitors)
  - Enhanced SmartStreamManager to use subscription builder
  - Updated BaseMonitor with subscription group metadata
  - Added automatic group inference from program IDs
  - Priority-based connection assignment algorithm
  - Subscription merging for efficient resource usage
  - Metrics tracking per subscription group
  - Test script verifies all functionality
- ✅ **Load Balancing & Monitoring (Session 3)**:
  - Created `LoadBalancer` class with comprehensive metrics tracking
  - Real-time metrics collection:
    - TPS (transactions per second) per connection
    - Parse rates and error tracking
    - Latency measurements with exponential moving average
    - Bytes processed and message counts
  - Intelligent load calculation based on multiple factors:
    - 40% TPS, 30% latency, 20% error rate, 10% bytes processed
  - Automatic rebalancing with configurable thresholds
  - Load prediction using linear regression on historical data
  - SmartStreamManager integration:
    - Automatic metrics tracking for all messages
    - Migration support for overloaded connections
    - Enhanced statistics with load summary
  - Test demonstrates 95%+ parse rate tracking and load distribution
- ✅ **Domain Monitor - TokenLifecycle (Session 4)**:
  - Created `TokenLifecycleMonitor` consolidating BC functionality
  - Unified BC transaction and account monitoring
  - Integrated token state tracking:
    - Token creation detection
    - Trading activity monitoring
    - Graduation detection via account updates
    - Market cap milestone tracking
  - Implemented comprehensive lifecycle events:
    - `TOKEN_LIFECYCLE_CREATED`: When new token detected
    - `TOKEN_LIFECYCLE_PHASE_CHANGE`: Phase transitions
    - `TOKEN_MILESTONE_REACHED`: Market cap milestones
  - Smart routing with high-priority `bonding_curve` group
  - Real-time progress tracking (0-100% bonding curve)
  - Performance metrics and parse rate tracking
  - Located at: `src/monitors/domain/token-lifecycle-monitor.ts`
- ✅ **Smart Streaming Successfully Tested (Session 4.5)**:
  - Confirmed SmartStreamManager loads with `USE_SMART_STREAMING=true`
  - Connection pooling creates dedicated connections per monitor
  - Performance: 44.4 messages/second with single monitor
  - Event processing: >95% parse rate
  - All token lifecycle events working correctly
  - Load balancing metrics tracking functional
  - Ready for production with environment variable switch
- ✅ **Domain Monitor - TradingActivity (Session 5)**:
  - Created `TradingActivityMonitor` consolidating all trading venues
  - Unified monitoring for BC, AMM, and Raydium trades
  - Implemented MEV detection:
    - Sandwich attack detection
    - Frontrunning detection
    - Copy trading patterns
  - High slippage trade tracking
  - Trade window analysis for pattern detection
  - Cross-venue trade metrics and statistics
  - Located at: `src/monitors/domain/trading-activity-monitor.ts`
- ✅ **Sessions 1-5 Fully Tested & Operational**:
  - All components operational: Connection Pool, Subscription Strategy, Load Balancing
  - Domain monitors (TokenLifecycle, TradingActivity) working correctly
  - Test results: 2 active connections, >90% parse rate maintained
  - Ready for production with `USE_SMART_STREAMING=true`
  - Test command: `npx tsx src/scripts/test-sessions-1-5.ts`
- ✅ **Domain Monitor - Liquidity (Session 6)**:
  - Created `LiquidityMonitor` consolidating AMM liquidity tracking
  - Implemented liquidity event parsing strategy
  - Features:
    - Liquidity add/remove event detection
    - Fee collection tracking
    - Pool state monitoring with TVL calculations
    - LP position tracking
    - Integration with existing AMM services
  - Added new event types: `AMM_LIQUIDITY_ADD`, `AMM_LIQUIDITY_REMOVE`, `AMM_FEE_COLLECT`
  - Real-time TVL aggregation across all pools
  - Located at: `src/monitors/domain/liquidity-monitor.ts`
  - Test command: `npx tsx src/scripts/test-session-6.ts`
- ✅ **Shyft gRPC Rate Limit Compliance (Critical Fix)**:
  - Fixed connection pool to prevent exceeding 100 subscriptions/60s limit
  - Removed health check subscriptions that were consuming rate limit
  - Added `SubscriptionRateLimiter` class for global rate enforcement
  - Updated keepalive settings to Shyft recommendations (10s/1s)
  - Implemented proper stream closure pattern from Shyft examples
  - Health checks now use metrics instead of creating test streams
  - Real-time subscription rate monitoring with warnings
  - See `CONNECTION_POOL_FIXES.md` for detailed implementation
- ✅ **Session 7: Data Pipeline Architecture (Jan 5)**:
  - Created unified `DataPipeline` for central event processing
  - Implemented `EventNormalizer` for standardizing events from all sources
  - Added `BatchManager` for efficient event batching with configurable size/timeout
  - Built `EventProcessor` with retry logic and caching
  - Created `PipelineMetrics` for comprehensive performance tracking
  - Integrated pipeline with SmartStreamManager via dependency injection
  - Located at: `src/services/pipeline/`
  - Test command: `npx tsx src/scripts/test-session-7.ts`
- ✅ **gRPC Stream Error Fixes (Jan 5)**:
  - Fixed "Cancelled on client" errors in SmartStreamManager
  - Improved error handling to suppress expected cancellation errors
  - Added `unregisterMonitor` method for proper cleanup
  - Enhanced BaseMonitor stop method to unregister from stream manager
  - Used Promise.allSettled for graceful parallel stream shutdown
  - Added delays in test scripts to prevent race conditions
  - All session tests now run without gRPC errors
- ✅ **Legacy Monitor System Removal (Jan 5)**:
  - Removed 27 legacy files including monitors, run scripts, and parsers
  - Deleted legacy monitors: BCMonitor, AMMMonitor, RaydiumMonitor, and account monitors
  - Removed legacy parsing strategies: bc-trade, amm-trade, raydium-trade strategies
  - Cleaned up API endpoints: removed bc-monitor-endpoints and stats aggregator
  - Updated index.ts to use only domain monitors
  - Simplified unified-event-parser to only use LiquidityStrategy
  - System now exclusively uses smart streaming architecture
  - All functionality preserved with better organization and performance

### Previous Changes (Jan 4-5)
- ✅ **Raydium Monitor Fixed and Working** (Jan 4):
  - Fixed transaction parsing - now achieving ~85% parse rate
  - Created RaydiumTransactionFormatter to handle raw gRPC data format
  - Fixed account key handling (converts 32-byte Buffers to strings)
  - Implemented proper ray_log parsing to extract swap amounts
  - Added UTF-8 sanitizer to prevent database encoding errors
  - Monitor now successfully tracks graduated tokens on Raydium AMM
  - This fixes the $0.0001 price issue for Raydium-graduated tokens
  - Run with: `npm run raydium-monitor`
- ✅ **Token Detail Page Implementation**:
  - Created comprehensive token detail page accessible by clicking tokens in dashboard
  - Enhanced `/api/tokens/:mintAddress` endpoint with full token data aggregation
  - Added price history snapshots (24h detailed, 7d hourly)
  - Implemented interactive price charts using Chart.js with date-fns adapter
  - Real-time price updates via `/api/tokens/realtime` endpoint
  - Transaction history table with recent trades
  - Responsive design matching dashboard theme
  - Fixed various issues: type conversion errors, chart rendering, image placeholders
  - Dashboard rows now clickable with hover effects

### Previous Changes (Jan 3-4)
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
- ✅ **Raydium Monitor Implementation** (Jan 4):
  - Created RaydiumMonitor class to track graduated tokens on Raydium AMM
  - Implemented SimpleRaydiumTradeStrategy parser for swap detection
  - Added to main application startup sequence
  - Successfully parsing Raydium swaps with ~85% parse rate
  - Extracts actual trade amounts from ray_log data
  - Integrated with existing trade handler and database

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

### UTF-8 Encoding Issues (Fixed Jan 4, 2025)
**Issue**: PostgreSQL errors "invalid byte sequence for encoding UTF8"
- Some token names or addresses contained invalid UTF-8 characters
- Prevented trades from being saved to database

**Solution**: Created UTF-8 sanitizer utility
- Removes NULL bytes and control characters
- Handles Latin-1 to UTF-8 conversion
- Preserves valid Unicode (emojis, international chars)
- All string fields sanitized before database insertion

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

### Smart Streaming Test Scripts
```bash
# Test individual sessions
npx tsx src/scripts/test-session-1.ts    # Connection pool
npx tsx src/scripts/test-session-2.ts    # Subscription strategy
npx tsx src/scripts/test-session-3.ts    # Load balancing
npx tsx src/scripts/test-session-4.ts    # Token lifecycle monitor
npx tsx src/scripts/test-session-5.ts    # Trading activity monitor
npx tsx src/scripts/test-session-6.ts    # Liquidity monitor
npx tsx src/scripts/test-session-7.ts    # Data pipeline

# Combined tests
npx tsx src/scripts/test-sessions-1-5.ts  # All monitors without pipeline
npx tsx src/scripts/test-sessions-1-6.ts  # All monitors and liquidity
```

## Code Structure

### Directory Organization
```
src/
├── monitors/              # Monitor implementations
│   └── domain/           # Domain-driven monitors (only monitors in the system)
│       ├── token-lifecycle-monitor.ts
│       ├── trading-activity-monitor.ts
│       └── liquidity-monitor.ts
├── services/              # Business logic services
│   ├── core/             # Core infrastructure
│   │   ├── smart-stream-manager.ts      # Enhanced stream manager
│   │   ├── connection-pool.ts          # gRPC connection pooling
│   │   ├── subscription-builder.ts     # Subscription management
│   │   ├── load-balancer.ts           # Load distribution
│   │   └── subscription-rate-limiter.ts
│   ├── pipeline/         # Data pipeline (NEW)
│   │   ├── data-pipeline.ts           # Central event processing
│   │   ├── event-normalizer.ts        # Event standardization
│   │   ├── batch-manager.ts           # Batch processing
│   │   ├── event-processor.ts         # Event handlers
│   │   └── pipeline-metrics.ts        # Performance tracking
│   ├── pricing/          # Price calculations and SOL price tracking
│   ├── metadata/         # Token metadata enrichment
│   ├── amm/              # AMM-specific services
│   ├── monitoring/       # System monitoring and stats
│   ├── token-management/ # Token lifecycle management
│   ├── analysis/         # MEV, slippage, fork analysis
│   └── recovery/         # Data recovery services
├── utils/                # Utility functions
│   ├── amm/              # AMM utilities (decoders, calculators)
│   ├── config/           # Constants and configuration
│   ├── parsers/          # Event and transaction parsers
│   │   ├── strategies/   # Parsing strategies (only liquidity-strategy.ts remains)
│   │   └── types.ts      # Common types and interfaces
│   └── formatters/       # Data formatting utilities
└── scripts/              # Test and utility scripts
    ├── test-session-*.ts # Session test scripts
    └── [other scripts]
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
- TradingActivityMonitor tracks graduated tokens across all venues (BC, AMM, Raydium)

## Architecture Benefits

### Smart Streaming Architecture
1. **Connection Pooling**: Multiple gRPC connections prevent single point of failure
2. **Domain Monitors**: Consolidated functionality reduces code duplication
3. **Load Balancing**: Automatic distribution based on real-time metrics
4. **Rate Limiting**: Built-in compliance with Shyft's limits
5. **Data Pipeline**: Unified event processing with batching for efficiency
6. **MEV Detection**: Real-time detection of sandwich attacks and frontrunning
7. **Performance**: >95% parse rate maintained across all monitors
8. **Scalability**: Easy to add new domain monitors or event processors

### Production Ready
- Smart streaming is now the default and only mode
- All legacy code removed for cleaner architecture
- TypeScript builds successfully with no errors
- Comprehensive test coverage with session scripts
- Domain monitors handle all functionality previously split across multiple monitors