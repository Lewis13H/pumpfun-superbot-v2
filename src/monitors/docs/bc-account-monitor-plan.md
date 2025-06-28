# Bonding Curve Account Monitoring Implementation Plan

## Overview

This document outlines the implementation plan for adding real-time account monitoring to our bonding curve monitor. This feature will provide accurate, real-time data about bonding curve states without relying solely on trade events.

## Problem Statement

Currently, our bonding curve monitor only updates token data when trades occur. This leads to:
- Stale progress data (tokens showing 100% when actually at 95%)
- Delayed graduation detection
- Inaccurate prices during low-activity periods
- Missing non-trade events (migrations, admin actions)

## Solution: Direct Account Monitoring

By subscribing to bonding curve account changes on-chain, we can:
- Get real-time updates whenever reserves change
- Maintain accurate progress percentages
- Detect graduations instantly
- Provide better data during quiet periods

## Technical Architecture

### 1. Core Components

#### 1.1 Bonding Curve Account Parser
```typescript
// src/parsers/bc-account-parser.ts
export interface BondingCurveAccountData {
  // Account discriminator
  discriminator: Buffer;
  
  // Reserve data
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  
  // Token info
  tokenMint: PublicKey;
  tokenTotalSupply: bigint;
  
  // State
  complete: boolean;
  buyingEnabled: boolean;
  sellingEnabled: boolean;
  
  // Migration info
  migrationTarget?: PublicKey;
  
  // Metadata
  lastUpdateSlot: bigint;
  lastUpdateTimestamp: Date;
}

export class BondingCurveAccountParser {
  static parse(data: Buffer): BondingCurveAccountData {
    // Parse account data based on pump.fun's account structure
    // Handle different account versions
    // Validate data integrity
  }
  
  static deriveAddress(mint: PublicKey): PublicKey {
    // Derive bonding curve PDA from mint
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMP_PROGRAM_ID
    )[0];
  }
}
```

#### 1.2 Account Subscription Manager
```typescript
// src/services/bc-account-subscription-manager.ts
export class AccountSubscriptionManager {
  private subscriptions: Map<string, number> = new Map();
  private connection: Connection;
  private maxSubscriptions: number = 100;
  
  async subscribe(mintAddress: string, callback: (data: BondingCurveAccountData) => void): Promise<void> {
    // Check subscription limits
    // Derive bonding curve address
    // Set up account change listener
    // Handle errors and reconnections
  }
  
  async unsubscribe(mintAddress: string): Promise<void> {
    // Remove subscription
    // Clean up resources
  }
  
  getActiveSubscriptions(): string[] {
    // Return list of actively monitored tokens
  }
}
```

#### 1.3 Account Monitor Service
```typescript
// src/services/bc-account-monitor.ts
export class BondingCurveAccountMonitor {
  private subscriptionManager: AccountSubscriptionManager;
  private updateProcessor: AccountUpdateProcessor;
  private stats: AccountMonitorStats;
  
  async startMonitoring(mintAddresses: string[]): Promise<void> {
    // Initialize subscriptions for high-value tokens
    // Set up error handling
    // Start statistics collection
  }
  
  async addToken(mintAddress: string): Promise<void> {
    // Add new token to monitoring
    // Check if already monitored
    // Subscribe to account changes
  }
  
  async removeToken(mintAddress: string): Promise<void> {
    // Remove token from monitoring
    // Unsubscribe from updates
  }
  
  private async processAccountUpdate(
    mintAddress: string, 
    data: BondingCurveAccountData
  ): Promise<void> {
    // Calculate progress
    // Update database
    // Broadcast via WebSocket
    // Check for graduation
  }
}
```

### 2. Database Schema Updates

```sql
-- Add account monitoring fields to tokens_unified
ALTER TABLE tokens_unified ADD COLUMN IF NOT EXISTS 
  last_account_update TIMESTAMPTZ,
  account_subscription_active BOOLEAN DEFAULT FALSE,
  real_sol_reserves BIGINT,
  real_token_reserves BIGINT,
  account_complete_flag BOOLEAN DEFAULT FALSE;

-- Create account updates history table
CREATE TABLE IF NOT EXISTS account_updates_unified (
  id BIGSERIAL PRIMARY KEY,
  mint_address VARCHAR(64) REFERENCES tokens_unified(mint_address),
  
  -- Reserve data
  virtual_sol_reserves BIGINT NOT NULL,
  virtual_token_reserves BIGINT NOT NULL,
  real_sol_reserves BIGINT,
  real_token_reserves BIGINT,
  
  -- Calculated values
  progress DECIMAL(5,2) NOT NULL,
  price_sol DECIMAL(20,12),
  market_cap_usd DECIMAL(20,4),
  
  -- State
  complete BOOLEAN DEFAULT FALSE,
  buying_enabled BOOLEAN DEFAULT TRUE,
  selling_enabled BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  update_slot BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_account_updates_mint (mint_address),
  INDEX idx_account_updates_created (created_at DESC)
);

-- Create materialized view for latest account states
CREATE MATERIALIZED VIEW latest_account_states AS
SELECT DISTINCT ON (mint_address)
  mint_address,
  virtual_sol_reserves,
  virtual_token_reserves,
  progress,
  complete,
  created_at as last_update
FROM account_updates_unified
ORDER BY mint_address, created_at DESC;

-- Refresh every minute
CREATE INDEX ON latest_account_states (mint_address);
```

### 3. Integration Strategy

#### 3.1 Phased Rollout

**Phase 1: Proof of Concept (Week 1)**
- Implement account parser
- Test with single token
- Verify data accuracy

**Phase 2: Core Implementation (Week 2)**
- Build subscription manager
- Implement update processor
- Database integration

**Phase 3: Integration (Week 3)**
- Integrate with bc-monitor
- Update WebSocket broadcasts
- Dashboard modifications

**Phase 4: Scale & Optimize (Week 4)**
- Scale to 100+ tokens
- Performance optimization
- Production deployment

#### 3.2 Subscription Strategy

```typescript
// Subscription rules
const SUBSCRIPTION_RULES = {
  // Always monitor
  HIGH_VALUE: { marketCap: 50000 },        // > $50k
  NEAR_GRADUATION: { progress: 90 },       // > 90%
  HIGH_ACTIVITY: { tradesPerHour: 10 },    // > 10 trades/hour
  
  // Conditional monitoring
  MEDIUM_VALUE: { marketCap: 10000 },      // > $10k
  TRENDING: { volumeIncrease: 200 },       // 200% volume increase
  
  // Unsubscribe conditions
  GRADUATED: { complete: true },           // Graduated to AMM
  INACTIVE: { hoursWithoutTrade: 24 },     // 24h no activity
  LOW_VALUE: { marketCap: 5000 }           // < $5k
};
```

### 4. Performance Considerations

#### 4.1 Connection Management
```typescript
class ConnectionPool {
  private connections: Connection[] = [];
  private currentIndex: number = 0;
  
  constructor(endpoints: string[], commitment: Commitment = 'confirmed') {
    // Initialize multiple connections
    // Distribute load across endpoints
  }
  
  getConnection(): Connection {
    // Round-robin connection selection
    // Handle failed connections
    // Automatic failover
  }
}
```

#### 4.2 Rate Limiting
- Maximum 100 concurrent subscriptions per connection
- Implement exponential backoff for failures
- Queue subscription requests
- Prioritize high-value tokens

#### 4.3 Data Optimization
- Only store significant changes (> 0.1% progress)
- Batch database writes (100ms intervals)
- Use in-memory cache for frequent reads
- Compress historical data after 7 days

### 5. Error Handling

```typescript
class AccountMonitorErrorHandler {
  async handleSubscriptionError(
    mintAddress: string, 
    error: Error
  ): Promise<void> {
    // Log error
    // Attempt reconnection
    // Alert if critical
    // Fallback to RPC polling if needed
  }
  
  async handleParseError(
    mintAddress: string,
    data: Buffer
  ): Promise<void> {
    // Log raw data for debugging
    // Skip update
    // Mark token for manual review
  }
}
```

### 6. Monitoring & Metrics

#### 6.1 Key Metrics to Track
```typescript
interface AccountMonitorMetrics {
  // Subscription metrics
  activeSubscriptions: number;
  subscriptionFailures: number;
  reconnections: number;
  
  // Update metrics
  updatesReceived: number;
  updatesProcessed: number;
  updateErrors: number;
  averageLatency: number;
  
  // Data metrics
  progressAccuracy: number;
  graduationsDetected: number;
  staleDataPercentage: number;
}
```

#### 6.2 Health Checks
- Monitor WebSocket connection health
- Track subscription success rate
- Alert on high error rates
- Automatic recovery procedures

### 7. API Updates

#### 7.1 New Endpoints
```typescript
// Get real-time account data
GET /api/bc-monitor/account/:mintAddress

// Get account update history
GET /api/bc-monitor/account/:mintAddress/history

// Manage subscriptions
POST /api/bc-monitor/subscribe/:mintAddress
DELETE /api/bc-monitor/unsubscribe/:mintAddress

// Get monitoring stats
GET /api/bc-monitor/account-stats
```

#### 7.2 WebSocket Events
```typescript
// New WebSocket message types
interface AccountUpdateMessage {
  type: 'account-update';
  mint: string;
  progress: number;
  solReserves: number;
  tokenReserves: number;
  complete: boolean;
  timestamp: Date;
}

interface GraduationAlertMessage {
  type: 'graduation-alert';
  mint: string;
  symbol: string;
  finalProgress: number;
  migrationTarget: string;
  timestamp: Date;
}
```

### 8. Dashboard Updates

#### 8.1 UI Enhancements
- Real-time progress indicator (no refresh needed)
- "Last Updated" timestamp for each token
- Live reserve amounts display
- Account subscription status indicator

#### 8.2 New Features
- Graduation countdown timer
- Real-time price updates
- Liquidity depth visualization
- Account update frequency chart

### 9. Testing Plan

#### 9.1 Unit Tests
- Account parser accuracy
- Subscription manager reliability
- Update processor logic
- Error handling scenarios

#### 9.2 Integration Tests
- End-to-end account monitoring
- Database update verification
- WebSocket broadcast testing
- Performance under load

#### 9.3 Production Testing
- Monitor 10 tokens for 24 hours
- Compare with trade-based data
- Verify graduation detection
- Measure performance impact

### 10. Rollback Plan

If issues arise:
1. Disable account monitoring via feature flag
2. Fall back to trade-only monitoring
3. Preserve account update history
4. Debug issues offline
5. Implement fixes and re-enable

### 11. Success Criteria

- [ ] Progress accuracy within 0.1% of actual
- [ ] Graduation detection within 5 seconds
- [ ] Less than 100ms update latency
- [ ] 99.9% subscription uptime
- [ ] No increase in database load > 10%
- [ ] Dashboard updates feel "instant"

### 12. Future Enhancements

1. **Predictive Analytics**
   - Estimate time to graduation
   - Predict price movements
   - Identify manipulation patterns

2. **Advanced Monitoring**
   - Multi-token correlation analysis
   - Whale wallet tracking
   - Liquidity flow patterns

3. **Automated Actions**
   - Auto-subscribe based on patterns
   - Graduation alerts via webhook
   - Trading bot integration

## Implementation Timeline

### Week 1: Foundation
- Day 1-2: Implement account parser
- Day 3-4: Build subscription manager
- Day 5: Single token testing

### Week 2: Core Features
- Day 1-2: Database integration
- Day 3-4: Update processor
- Day 5: Error handling

### Week 3: Integration
- Day 1-2: BC Monitor integration
- Day 3-4: WebSocket updates
- Day 5: Dashboard updates

### Week 4: Production
- Day 1-2: Scale testing
- Day 3-4: Performance optimization
- Day 5: Production deployment

## Conclusion

Account monitoring will transform our bonding curve monitor from a reactive system (waiting for trades) to a proactive one (real-time state tracking). This will provide users with accurate, up-to-the-second data and enable new features like graduation prediction and real-time alerts.