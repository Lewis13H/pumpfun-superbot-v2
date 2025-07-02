# Pump.fun & Pump.swap Unified Token Monitor

Real-time Solana token monitor for pump.fun bonding curves and pump.swap AMM pools. Streams blockchain data via Shyft's gRPC endpoint, tracks token prices and market caps, saves high-value tokens (≥$8,888) to PostgreSQL, and provides a web dashboard for monitoring.

## Setup

1. Copy `.env.example` to `.env`
2. Add your credentials:
   ```
   SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to
   SHYFT_GRPC_TOKEN=your-token-here
   DATABASE_URL=postgresql://user@localhost:5432/pump_monitor
   HELIUS_API_KEY=your-key-here  # Optional, for token enrichment
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Run database migration:
   ```bash
   npm run migrate-unified
   ```

## Main Monitor

Run the unified monitor (recommended):
```bash
npm run unified-v2
```

This monitor:
- Tracks both pump.fun bonding curves and pump.swap AMM pools
- Saves tokens that reach $8,888 market cap
- Uses simple parsing for maximum event detection (~15% more trades)
- Implements efficient batch processing (100 records/batch)
- Shows real-time dashboard with statistics

## Other Commands

```bash
# Dashboard
npm run dashboard          # Web dashboard (http://localhost:3002)

# Database Operations
npm run view-tokens-unified    # View saved tokens from unified system
npm run enrich-tokens-unified  # Fetch metadata from Helius API
npm run query-trades          # Query and analyze trade history

# Utilities
npm run sol-price-updater  # SOL price updater (runs automatically with monitors)
npm run debug-amm          # Debug AMM pool structure
npm run check-sol-prices   # Check SOL price table structure
```

## Architecture

### Core Data Flow
1. **gRPC Stream** (Shyft) → Raw blockchain data
2. **Event Parser** → Extract trades from transaction logs
3. **Price Calculator** → Compute prices from virtual reserves
4. **Database Service** → Batch processing with caching
5. **Monitors/Dashboard** → Display and track tokens

### Key Features
- Monitors both pump.fun and pump.swap programs simultaneously
- Uses mint addresses as primary keys (no UUID conflicts)
- Batch database operations for high performance
- In-memory cache for recent tokens
- Automatic SOL price updates from Binance
- Token metadata enrichment via Helius API
- Clean terminal UI with statistics

### Environment Variables
```bash
# Required
SHYFT_GRPC_ENDPOINT=https://grpc.ams.shyft.to  # Must include https://
SHYFT_GRPC_TOKEN=your-token-here
DATABASE_URL=postgresql://user@localhost:5432/pump_monitor

# Optional
HELIUS_API_KEY=your-api-key          # For metadata enrichment
API_PORT=3001                        # Dashboard port
```

## Build

To build for production:
```bash
npm run build
npm start
```

## Dashboard

The web dashboard provides a DexScreener-style interface for monitoring saved tokens:
- Real-time token prices and market caps
- Price changes (5M, 1H, 6H, 24H)
- Token age from blockchain creation time
- Holder count and top holder percentage
- Progress bars for Raydium migration
- Auto-refresh every 10 seconds

Access at http://localhost:3001 after running `npm run dashboard`.