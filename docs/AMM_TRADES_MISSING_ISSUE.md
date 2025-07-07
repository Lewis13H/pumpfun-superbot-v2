# AMM Trades Missing Issue

## Problem
- System shows 0 AMM trades despite running for 30+ minutes
- ALPACU graduated to pump.fun AMM but no trades captured
- BC trades working fine (58,980 trades)

## Root Cause Analysis

### 1. Monitor Configuration Issue
The `TradingActivityMonitor` is constructed with:
```typescript
programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // BC program only!
```

### 2. Subscription Problem
In `base-monitor.ts`, the subscription only includes the single programId:
```typescript
builder.addTransactionSubscription(subscriptionKey, {
  accountInclude: [this.options.programId], // Only BC program!
  // ...
});
```

### 3. The getProgramIds() Method Is Not Used
TradingActivityMonitor has:
```typescript
protected getProgramIds(): string[] {
  return Object.values(this.PROGRAMS); // Returns [BC, AMM, RAYDIUM]
}
```
But this method is NOT used in the subscription building!

## Why BC Works but AMM Doesn't
- BaseMonitor subscribes only to `this.options.programId`
- TradingActivityMonitor is initialized with BC program ID only
- Despite having logic to handle AMM trades, it never receives them

## Solution
TradingActivityMonitor needs to override `buildEnhancedSubscribeRequest()` to subscribe to ALL programs:

```typescript
protected buildEnhancedSubscribeRequest(): any {
  const builder = this.subscriptionBuilder;
  builder.setCommitment('confirmed');
  
  // Subscribe to ALL trading programs
  builder.addTransactionSubscription('trading_activity', {
    vote: false,
    failed: false,
    accountInclude: this.getProgramIds(), // Use ALL programs!
    accountRequired: [],
    accountExclude: []
  });
  
  return builder.build();
}
```

## Verification
The monitor has all the logic to process AMM trades:
- Line 204: Checks for AMM program in accounts
- Line 240: Processes AMM trades
- Line 77: Tracks ammTrades stat

But it never receives AMM transactions because it's not subscribed to them!