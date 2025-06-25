# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Minimal Pump.fun token price monitor that streams real-time token prices via Shyft's gRPC endpoint. Displays token addresses, prices in SOL/USD, and market caps.

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start

# Run subscription modification example
npx tsx src/examples/modify-subscription.ts
```

## Architecture

### Core Components

1. **gRPC Streaming** (`src/stream/`)
   - `client.ts`: Singleton client managing gRPC connection. Requires full URL format (e.g., `https://grpc.ams.shyft.to`)
   - `subscription.ts`: Handles stream lifecycle, reconnection logic, and slot-based resumption

2. **Price Calculation** (`src/utils/`)
   - Pump.fun tokens have 6 decimal places
   - Virtual reserves are in lamports (must divide by 1e9 for SOL)
   - Price formula: `(virtualSolReserves / 1e9) / (virtualTokenReserves / 1e6)`
   - Market cap assumes 1B token supply

3. **Event Parsing**
   - TradeEvent is 225 bytes with specific offsets:
     - Mint: bytes 8-40
     - Virtual SOL reserves: bytes 97-104
     - Virtual token reserves: bytes 105-112

### Critical Implementation Details

1. **Environment Variables**
   - `SHYFT_GRPC_ENDPOINT`: Must be full URL with protocol (https://)
   - `SHYFT_GRPC_TOKEN`: Required for authentication

2. **Reconnection Behavior**
   - Tracks last processed slot for resumption
   - Retries up to 30 times with slot resumption
   - Falls back to latest slot after max retries
   - 1-second delay between reconnection attempts

3. **Known Issues**
   - Serialization error (code 13) occurs occasionally during reconnection but doesn't affect functionality
   - Stream automatically recovers and resumes from last slot

4. **SOL Price Service**
   - Fetches from CoinGecko API
   - 60-second cache to respect rate limits
   - Falls back to $180 if API fails

## Subscription Modification

To modify subscription filters without disconnecting:
```typescript
subscriptionHandler.updateSubscription(newRequest)
```

See `src/examples/modify-subscription.ts` for switching between different programs.