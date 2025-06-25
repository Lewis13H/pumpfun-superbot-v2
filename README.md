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

## Build

To build for production:
```bash
npm run build
npm start
```