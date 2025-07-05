# Connection Pool Fixes for Shyft gRPC Limits

## Issue
Current implementation may exceed Shyft's rate limit of 100 subscriptions per 60 seconds.

## Problems Identified

1. **Health Check Subscriptions**
   - `checkConnectionHealth()` creates a test stream every 30 seconds per connection
   - With 3 connections, that's 6 subscriptions/minute just for health checks
   - These count towards the 100/60s limit

2. **Missing Global Rate Limiting**
   - No tracking of total subscriptions across all connections
   - No enforcement of the 100/60s limit

3. **Improper Stream Closure**
   - While we have proper closure methods, we need to ensure they match Shyft's patterns
   - Need to handle error code 1 and "Cancelled" messages properly

4. **Keepalive Configuration**
   - Current: 60s keepalive, 20s timeout
   - Shyft recommends: 10s keepalive, 1s timeout

## Recommended Fixes

### 1. Remove Health Check Subscriptions
```typescript
// Instead of creating test streams, use connection state tracking
private async checkConnectionHealth(connection: PooledConnection): Promise<void> {
  // Don't create test subscriptions!
  // Track health based on actual usage and error rates
  const timeSinceLastUse = Date.now() - connection.lastUsedAt.getTime();
  const isStale = timeSinceLastUse > 300000; // 5 minutes
  
  if (isStale || connection.metrics.errorRate > 0.5) {
    connection.status = ConnectionStatus.UNHEALTHY;
  }
}
```

### 2. Add Global Rate Limiter
```typescript
class SubscriptionRateLimiter {
  private subscriptions: Array<{ timestamp: number }> = [];
  private readonly MAX_SUBSCRIPTIONS = 100;
  private readonly TIME_WINDOW = 60000; // 60 seconds
  
  canSubscribe(): boolean {
    this.cleanup();
    return this.subscriptions.length < this.MAX_SUBSCRIPTIONS;
  }
  
  recordSubscription(): void {
    this.subscriptions.push({ timestamp: Date.now() });
  }
  
  private cleanup(): void {
    const cutoff = Date.now() - this.TIME_WINDOW;
    this.subscriptions = this.subscriptions.filter(s => s.timestamp > cutoff);
  }
}
```

### 3. Update Keepalive Settings
```typescript
const channelOptions: ChannelOptions = {
  'grpc.keepalive_time_ms': 10000,  // Changed from 60000
  'grpc.keepalive_timeout_ms': 1000, // Changed from 20000
  'grpc.keepalive_permit_without_calls': 1,
  'grpc.default_compression_algorithm': 2, // Add compression
  // ... rest of options
};
```

### 4. Proper Stream Closure Pattern
```typescript
async closeStream(stream: any): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.on("error", (err: any) => {
      if (err.code === 1 || err.message.includes("Cancelled")) {
        resolve(); // User cancellation, not an error
      } else {
        reject(err);
      }
    });
    
    stream.on("close", () => resolve());
    stream.on("end", () => resolve());
    
    // Cancel the stream
    stream.cancel();
  });
}
```

### 5. Dynamic Subscription Updates
Instead of creating new streams, modify existing ones:
```typescript
async updateSubscription(stream: any, newRequest: SubscribeRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(newRequest, (err: any) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
```

## Implementation Priority

1. **High Priority**: Remove health check subscriptions (immediate fix)
2. **High Priority**: Add global rate limiter
3. **Medium Priority**: Update keepalive settings
4. **Medium Priority**: Implement proper stream closure pattern
5. **Low Priority**: Add dynamic subscription updates

## Testing

1. Monitor subscription count: Log every subscription creation
2. Add metrics for subscription rate: Track subscriptions/minute
3. Test with multiple monitors to ensure we stay under limit
4. Verify streams are properly closed and don't leak

## Notes

- The 100 subscriptions/60s limit is global across all connections
- Each `stream.write()` with a new subscription request counts as a subscription
- Health checks should NOT create new subscriptions
- Prefer modifying existing streams over creating new ones
- Always use `stream.cancel()` for graceful shutdown