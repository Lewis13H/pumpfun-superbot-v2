# Monitors

Real-time monitoring scripts for Pump.fun tokens.

## Available Monitors

### Core Monitors
- `threshold-monitor.ts` - Monitors and saves tokens that reach $8,888 market cap
- `trade-monitor-v2.ts` - Tracks buy/sell activity with detailed statistics
- `simple-progress.ts` - Basic monitor with progress bars
- `bonding-curve-monitor.ts` - Streams bonding curve account updates
- `unified-monitor.ts` - Combined price and progress monitor

### Threshold Variants
- `threshold-monitor-auto.ts` - Threshold monitor with auto-enrichment
- `threshold-monitor-with-graduated.ts` - Threshold monitor that tracks graduations

## Usage

```bash
npm run threshold    # Monitor for $8,888+ tokens
npm run trades       # Monitor buy/sell activity
npm run progress     # Simple progress monitor
npm run bonding      # Stream bonding curve accounts
npm run unified      # Combined monitor
```