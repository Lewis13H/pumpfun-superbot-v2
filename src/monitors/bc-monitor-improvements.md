# BC Monitor Improvements Implementation Guide

## Problem Analysis

### Current Issues:
1. **Parse Error Rate: 17.1%** (Target: <5%)
   - Parser only accepts 225-byte events, rejecting 113-byte events
   - Silent failures without detailed error logging
   - Overly strict validation

2. **Token Save Rate: 81%** (Target: 100%)
   - Tokens below $8,888 are discovered but not saved
   - Deduplication might drop valid updates
   - No retry mechanism for failed saves

## Implemented Solutions

### 1. Enhanced Event Parser (`bc-event-parser-v2.ts`)

**Key Improvements:**
- Supports both 225-byte and 113-byte event formats
- Returns parse statistics for monitoring
- More flexible mint validation (43-44 chars)
- Fallback mint extraction from logs
- Better error handling without throwing

**Usage:**
```typescript
import { extractTradeEventsFromLogsV2 } from '../parsers/bc-event-parser-v2';

// In parseTransaction method
const { events, parseStats } = extractTradeEventsFromLogsV2(logs);
console.log(`Parse rate: ${parseStats.success}/${parseStats.total} (${(parseStats.success/parseStats.total*100).toFixed(1)}%)`);
```

### 2. Enhanced Database Handler (`bc-db-handler-v2.ts`)

**Key Improvements:**
- Configuration options for flexible saving
- Detailed statistics tracking
- Retry mechanism with exponential backoff
- Tracks why tokens weren't saved
- Error categorization

**Configuration Options:**
```typescript
const dbHandler = new BondingCurveDbHandlerV2({
  saveAllTokens: false,      // Set to true to save ALL tokens
  thresholdUsd: 8888,        // Adjustable threshold
  retryFailedSaves: true,    // Automatic retry
  maxRetries: 3,             // Retry attempts
  logVerbose: true           // Detailed logging
});
```

### 3. Quick Implementation Changes

To immediately improve the current monitor without full refactor:

#### A. Update `bc-event-parser.ts` to handle 113-byte events:
```typescript
// In parsePumpFunTradeEvent function
if (data.length !== TRADE_EVENT_SIZE && data.length !== 113) {
  return null;
}

// Add 113-byte parsing logic
if (data.length === 113) {
  try {
    const mint = new PublicKey(data.slice(8, 40)).toString();
    const virtualSolReserves = data.readBigUInt64LE(73);
    const virtualTokenReserves = data.readBigUInt64LE(81);
    
    return {
      mint,
      virtualSolReserves,
      virtualTokenReserves,
      // Other fields may be undefined for compact format
    };
  } catch {
    return null;
  }
}
```

#### B. Add parse error logging in `bc-monitor.ts`:
```typescript
// Replace line 399
} catch (error) {
  this.stats.parseErrors++;
  if (this.stats.parseErrors % 100 === 0) {  // Log every 100th error
    console.error('Parse error sample:', {
      error: error.message,
      signature: this.extractSignature(transactionData),
      hasLogs: !!logs,
      logCount: logs?.length
    });
  }
}
```

#### C. Make threshold configurable via environment:
```typescript
// Add to bc-monitor.ts constructor
private readonly SAVE_THRESHOLD = Number(process.env.BC_SAVE_THRESHOLD || 8888);

// In parseTransaction, update line 369
if (priceData.marketCapUsd >= this.SAVE_THRESHOLD) {
```

## Testing the Improvements

### 1. Test Parse Rate Improvement:
```bash
# Run with detailed logging
BC_SAVE_THRESHOLD=1000 npm run bc-monitor 2>&1 | grep "Parse rate"
```

### 2. Monitor Save Rate:
```bash
# Check detailed stats every minute
watch -n 60 'psql $DATABASE_URL -c "SELECT COUNT(*) as saved FROM tokens_unified WHERE created_at > NOW() - INTERVAL '"'"'5 minutes'"'"'"'
```

### 3. Use Enhanced Components:
```typescript
// Update bc-monitor.ts imports
import { BondingCurveDbHandlerV2 } from '../handlers/bc-db-handler-v2';
import { extractTradeEventsFromLogsV2 } from '../parsers/bc-event-parser-v2';

// In constructor
this.dbHandler = new BondingCurveDbHandlerV2({
  saveAllTokens: process.env.SAVE_ALL_TOKENS === 'true',
  thresholdUsd: Number(process.env.BC_SAVE_THRESHOLD || 8888),
  retryFailedSaves: true,
  logVerbose: process.env.DEBUG === 'true'
});
```

## Expected Results

With these improvements:
1. **Parse Error Rate**: Should drop from 17.1% to <5%
2. **Token Save Rate**: Should increase from 81% to >95%
3. **Better Diagnostics**: Detailed error tracking and statistics

## Monitoring Command

```bash
# Run with enhanced monitoring
SAVE_ALL_TOKENS=false BC_SAVE_THRESHOLD=5000 DEBUG=true npm run bc-monitor
```

## Database Query to Verify Improvements

```sql
-- Check parse and save rates
WITH recent_stats AS (
  SELECT 
    COUNT(DISTINCT t.mint_address) as tokens_saved,
    COUNT(tr.signature) as trades_saved,
    MIN(t.created_at) as start_time,
    MAX(t.created_at) as end_time,
    EXTRACT(EPOCH FROM MAX(t.created_at) - MIN(t.created_at))/60 as duration_minutes
  FROM tokens_unified t
  LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address
  WHERE t.created_at > NOW() - INTERVAL '10 minutes'
)
SELECT 
  tokens_saved,
  trades_saved,
  ROUND(tokens_saved / NULLIF(duration_minutes, 0), 2) as tokens_per_minute,
  ROUND(trades_saved / NULLIF(duration_minutes, 0), 2) as trades_per_minute,
  duration_minutes
FROM recent_stats;
```