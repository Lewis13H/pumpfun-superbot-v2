# Examples

This directory contains examples demonstrating various features of the Pump.fun Token Price Monitor.

## Basic Monitoring

### simple-progress.ts
Shows token prices with bonding curve progress estimation.
```bash
npm run progress
```

## Advanced Monitoring

### threshold-monitor.ts
Monitors tokens and saves those reaching $8888 market cap to database.
```bash
npm run threshold
```

### view-saved-tokens.ts
Views tokens saved by the threshold monitor.
```bash
npm run view-tokens
```

### bonding-curve-monitor.ts
Streams bonding curve account updates (experimental).
```bash
npm run bonding
```

### unified-monitor.ts
Combines price monitoring with bonding curve progress tracking.
```bash
npm run unified
```

## Stream Management

### modify-subscription.ts
Demonstrates dynamic subscription modification without disconnecting.
```bash
npx tsx src/examples/modify-subscription.ts
```

Features:
- Starts with Pump.fun program filter
- Switches to Jupiter after 30 seconds
- Returns to Pump.fun after 60 seconds
- No stream disconnection required