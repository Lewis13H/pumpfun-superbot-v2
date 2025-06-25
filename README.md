# Pump.fun Token Price Monitor

A minimal implementation for streaming Pump.fun token prices using Shyft's gRPC endpoint.

## Setup

1. Copy `.env.example` to `.env`
2. Add your Shyft credentials:
   ```
   SHYFT_GRPC_ENDPOINT=grpc.shyft.to
   SHYFT_GRPC_TOKEN=your-token-here
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

## Usage

Run the monitor:
```bash
npm run dev
```

## Output Format

```
Token Found: [TOKEN_ADDRESS]
Price: [PRICE] SOL ($[USD_PRICE])
Market Cap: [MCAP] SOL ($[USD_MCAP])
---
```

## SOL Price Updates

The monitor automatically fetches real-time SOL prices from CoinGecko API:
- Updates every 60 seconds (respects API rate limits)
- Caches prices to minimize API calls
- Falls back to $180 if API is unavailable
- Shows price updates in console

## Advanced Features

### Graceful Shutdown
- Press `Ctrl+C` to gracefully close the gRPC connection
- Handles SIGINT, SIGTERM, and SIGHUP signals
- Properly cancels active streams before exiting

### Robust Reconnection
- Automatic reconnection on stream errors
- Slot-based resumption to avoid missing transactions
- Configurable retry limits and delays
- Falls back to latest slot after max retries

### Dynamic Subscription Updates
- Modify subscription filters without disconnecting
- See `src/examples/modify-subscription.ts` for usage
- Useful for switching between different programs or filters

## Build

To build for production:
```bash
npm run build
npm start
```

## Additional Monitors

### Progress Tracker
Shows estimated progress to Raydium migration based on virtual SOL reserves:
```bash
npm run progress
```

Features:
- Visual progress bars (0-100%)
- Alerts when tokens are close to completion (>90%)
- Shows virtual SOL reserves
- Estimates based on 30 SOL start → 115 SOL completion range

### Bonding Curve Monitor (Experimental)
Attempts to stream bonding curve account updates:
```bash
npm run bonding
```

Note: Account updates are less frequent than transactions. The progress tracker provides more immediate feedback.

### $8888 Threshold Monitor
Automatically saves tokens that reach $8888 market cap to database:
```bash
npm run threshold
```

Features:
- Monitors all tokens in real-time
- Saves token data when market cap ≥ $8888
- Tracks price history with bonding curve progress
- Shows 💾 indicator for tracked tokens
- Stores virtual SOL reserves and progress percentage

View saved tokens:
```bash
npm run view-tokens
```

### Token Enrichment with Helius
Enrich saved tokens with additional data from Helius API:
```bash
npm run enrich-tokens
```

Features:
- Fetches token metadata (name, symbol, description, image)
- Gets holder count and distribution
- Identifies top holders and concentration
- Caches data to minimize API usage
- Saves top 20 holders to database

View enriched data:
```bash
npm run view-enriched
```

The threshold monitor automatically enriches tokens when they reach $8888.

## Web Dashboard

A DexScreener-style web dashboard for monitoring saved tokens:

```bash
npm run dashboard
```

Features:
- Real-time token prices and market caps
- Price changes (5M, 1H, 6H, 24H)
- Token age from blockchain creation time
- Holder count and top holder percentage
- Progress bars for Raydium migration
- Auto-refresh every 10 seconds
- Dark theme matching DexScreener style

Access the dashboard at http://localhost:3001 after starting the server.

Update token creation times from blockchain:
```bash
npm run update-ages
```