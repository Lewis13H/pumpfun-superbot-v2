# Monitors Knowledge Base

## Overview
This knowledge base contains deep insights about the monitoring system that tracks Solana tokens through their lifecycle.

## Quick Links
- [Bonding Curve Progress Issues](./bonding-curve-progress.md) - Why progress calculation was wrong
- [Graduation Detection](./graduation-detection.md) - How we detect token graduation
- [Creator Tracking](./creator-tracking.md) - How we capture and display token creators
- [Account Monitoring](./account-monitoring.md) - Why transaction monitoring isn't enough
- [Common Issues](./troubleshooting.md) - Frequent problems and solutions

## Architecture
The monitoring system uses three domain-driven monitors:
- **TokenLifecycleMonitor**: Creation → Trading → Graduation
- **TradingActivityMonitor**: MEV detection, cross-venue tracking
- **LiquidityMonitor**: Pool state and liquidity events

## Key Insights

### The 84 SOL Truth
Despite widespread belief that graduation happens at 85 SOL, the actual threshold is 84 SOL. This was confirmed through Shyft examples and on-chain observation.

### Progress != Virtual Reserves
The biggest misconception: bonding curve progress cannot be calculated from virtualSolReserves in trade events. These show post-trade values, not locked SOL.

### The Complete Flag
Graduation isn't just about SOL threshold. The bonding curve account has a `complete` boolean that definitively indicates graduation.

## Related Files
- Implementation: `token-lifecycle-monitor.ts`
- Original issues: `monitors.md` (migrating here)
- Test scripts: `/src/scripts/test-bc-*.ts`