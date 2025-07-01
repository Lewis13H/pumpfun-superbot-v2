# Pump.fun & Pump.swap Real-Time Token Monitor

Advanced Solana token monitoring system for pump.fun bonding curves and pump.swap AMM pools. Features real-time blockchain streaming via Shyft's gRPC, comprehensive price tracking, high-value token detection (≥$8,888), and a professional web dashboard.

## 🚀 Quick Start

```bash
# Clone and setup
git clone <repo-url>
cd pumpfun-superbot-v2
cp .env.example .env
# Edit .env with your credentials
npm install

# Run everything (RECOMMENDED)
npm run start      # Starts all 4 monitors with production features
npm run dashboard  # In another terminal - Web UI at http://localhost:3001
```

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 12+
- Shyft gRPC API token
- Optional: Helius API key (for metadata enrichment)

## 🔧 Configuration

### Environment Variables

```bash
# Required
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to  # Must include https://
SHYFT_GRPC_TOKEN=your-token-here
DATABASE_URL=postgresql://user@localhost:5432/pump_monitor

# Optional
HELIUS_API_KEY=your-api-key          # For metadata enrichment (fallback)
SHYFT_API_KEY=your-api-key           # For Shyft DAS API (primary metadata source)
API_PORT=3001                        # Dashboard port (default: 3001)

# Monitor Configuration
BC_SAVE_THRESHOLD=8888               # Market cap threshold for saving BC tokens
SAVE_ALL_TOKENS=false                # Save all tokens regardless of threshold
DEBUG_PARSE_ERRORS=false             # Enable detailed parse error logging
```

## 🏗️ Architecture Overview

### 4-Monitor System (Refactored January 2025)

The system uses a clean architecture with dependency injection and event-driven communication:

```
1. BC Monitor         - Bonding curve trade monitoring (>95% parse rate)
2. BC Account Monitor - Bonding curve graduations detection
3. AMM Monitor        - AMM pool trades for graduated tokens
4. AMM Account Monitor - AMM pool state and reserves tracking
```

### Core Components

- **Dependency Injection Container**: All services managed centrally
- **Event Bus**: Components communicate via events (`TRADE_PROCESSED`, `TOKEN_GRADUATED`, etc.)
- **Shared Stream Manager**: Single gRPC connection for all monitors
- **Repository Pattern**: Clean data access layer
- **Base Monitor Abstraction**: Common functionality across all monitors

### Data Flow

```
Shyft gRPC Stream
    ↓
Stream Manager (shared connection)
    ↓
4 Monitors (BC Trade, BC Account, AMM Trade, AMM Account)
    ↓
Event Bus → Services → Database
    ↓
Dashboard API → Web UI
```

## 📦 All Commands

### Production Commands
```bash
npm run start               # Run all 4 monitors (RECOMMENDED)
npm run dev                 # Same as start (for development)
npm run start:performance   # Run with all performance optimizations
```

### Individual Monitors
```bash
npm run bc-monitor          # Bonding curve trades only
npm run bc-account-monitor  # Bonding curve account states
npm run amm-monitor         # AMM pool trades only
npm run amm-account-monitor # AMM pool states only
```

### Dashboard & API
```bash
npm run dashboard           # Web dashboard (http://localhost:3001)
npm run performance:metrics # Performance metrics API (http://localhost:3002)
```

### Utilities
```bash
npm run sol-price-updater   # Update SOL prices (runs automatically)
npm run startup-recovery    # Recover stale tokens on startup
```

### Development
```bash
npm run build              # Build TypeScript
npm run test               # Run all tests
npm run test:integration   # Integration tests only
npm run test:coverage      # Test coverage report
```

## 🎯 Key Features

### Real-Time Monitoring
- **>95% parse rate** for bonding curve trades
- Automatic graduation detection (BC → AMM)
- Different thresholds: $8,888 for BC, $1,000 for AMM
- Real-time price tracking with SOL/USD conversion

### Advanced Analytics (6 Enhancement Phases Complete)
- **Phase 1**: IDL-based parsing with event extraction
- **Phase 2**: Advanced subscriptions with slot tracking
- **Phase 3**: Token lifecycle tracking from creation to graduation
- **Phase 4**: MEV detection and failed transaction analysis
- **Phase 5**: State tracking with historical reconstruction
- **Phase 6**: Performance optimization with multi-region failover

### Production Features
- Batch database operations (1-second intervals)
- In-memory caching for recent tokens
- Automatic metadata enrichment
- DexScreener integration for graduated tokens
- Comprehensive error handling and retry logic
- Performance monitoring and alerts

## 🗄️ Database Schema

The system uses PostgreSQL with optimized schemas:

### Main Tables
- `tokens_unified` - Token information with mint_address as PRIMARY KEY
- `trades_unified` - All trades with efficient indexing
- `bonding_curve_mappings` - BC to token mappings for graduation tracking

### Analytics Tables
- `token_lifecycle` - Complete token journey tracking
- `failed_transactions` - Categorized failures with MEV detection
- `liquidity_snapshots` - Periodic liquidity depth analysis
- `slot_progression` - Blockchain state tracking

## 📊 Dashboard Features

Professional web interface with:
- Real-time token prices and market caps
- Graduation progress indicators
- Creator analytics and risk assessment
- Network congestion monitoring
- MEV activity detection
- Historical price charts
- Auto-refresh every 10 seconds

## 🔍 Monitoring & Debugging

### View Logs
```bash
# Monitor specific parse errors
DEBUG_PARSE_ERRORS=true npm run bc-monitor

# Custom threshold testing
BC_SAVE_THRESHOLD=1000 npm run bc-monitor
```

### Database Queries
```bash
# Recent trades
psql $DATABASE_URL -c "SELECT * FROM trades_unified ORDER BY block_time DESC LIMIT 10"

# High-value tokens
psql $DATABASE_URL -c "SELECT * FROM tokens_unified WHERE first_market_cap_usd > 10000"
```

## 🚨 Troubleshooting

### Common Issues

1. **No transactions received**
   - Check SHYFT_GRPC_ENDPOINT includes `https://`
   - Verify SHYFT_GRPC_TOKEN is valid
   - Ensure PostgreSQL is running

2. **Metadata enrichment failing**
   - Check rate limits (200ms between requests)
   - Verify API keys for Shyft/Helius

3. **Build errors**
   - Run `npm run build` to check TypeScript
   - All errors should be fixed as of January 2025

## 📚 Documentation

- `CLAUDE.md` - Comprehensive developer guide
- `docs/BONDING-CURVE-ENHANCEMENT-PLAN.md` - Complete 6-phase roadmap
- `docs/api-docs.md` - API endpoint reference

## 🤝 Contributing

1. Check existing issues and PRs
2. Follow the established architecture patterns
3. Ensure tests pass: `npm test`
4. Update documentation as needed

## 📄 License

[Your License Here]