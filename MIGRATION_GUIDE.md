# Migration Guide: Connection Pool Architecture

## Overview
This guide documents the migration from the single StreamClient/StreamManager architecture to the new connection pool-based SmartStreamManager system.

## Current State (Before Migration)
- Single `StreamClient` singleton managing one gRPC connection
- `StreamManager` handles all monitors through one shared stream
- All monitors share the same connection, creating a single point of failure

## Target State (After Migration)
- `ConnectionPool` manages 2-3 gRPC connections
- `SmartStreamManager` intelligently routes monitors to connections
- Fault isolation between monitor groups
- Automatic failover and recovery

## Migration Status

### ✅ Completed (Session 1)
1. Created `ConnectionPool` class with health monitoring
2. Created `SmartStreamManager` extending `StreamManager`
3. Added pool configuration system
4. Implemented connection health checks and metrics
5. Removed obsolete test script: `test-amm-monitors.ts`

### 🔄 Keep For Now (Until Full Migration)
1. `StreamClient` singleton - Still used by container factory
2. Original `StreamManager` - Base class for `SmartStreamManager`
3. Current monitor implementations - Will be updated in Session 4-6

### 📋 To Be Migrated (Future Sessions)

#### Session 2: Subscription Strategy
- Implement subscription grouping in `SmartStreamManager`
- Add priority-based routing logic
- Create subscription builder with merging

#### Session 4-6: Monitor Updates
Replace monitor initialization in `index.ts`:
```typescript
// OLD
const streamManager = container.get(TOKENS.StreamManager);
const bcMonitor = new BCTransactionMonitor({ programId: '...', streamManager });

// NEW
const smartStreamManager = new SmartStreamManager({ poolConfig });
await smartStreamManager.registerMonitor({
  monitorId: 'bc-transaction-monitor',
  monitorType: 'BC',
  programId: '...',
  subscriptionConfig: { ... }
});
```

#### Session 10: Final Cleanup
- Remove `StreamClient` singleton
- Update container factory to use `SmartStreamManager`
- Remove old `StreamManager` if no longer needed

## Code That Will Become Redundant

### After Full Migration:
1. `src/stream/client.ts` - Replaced by connection pool
2. Original monitor construction in `index.ts`
3. Direct `StreamManager` usage in monitors

### Already Removed:
1. `src/scripts/test-amm-monitors.ts` - Referenced non-existent services

## Testing the Migration

Use the test script to validate:
```bash
npx tsx --env-file=.env src/scripts/test-connection-pool.ts
```

## Notes
- The migration is designed to be incremental
- Each session builds on the previous one
- Backward compatibility is maintained until full migration
- No breaking changes to the running system during migration