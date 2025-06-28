# Master Implementation Plan

## Overview

This document unifies all implementation plans for the Pump.fun monitoring system. It consolidates the original unified monitoring plan with the AMM-specific upgrades into a single, coherent roadmap.

## System Architecture

The complete system consists of three main components:

1. **Bonding Curve Monitor** (`bc-monitor.ts`) - Monitors pump.fun bonding curves
2. **AMM Monitor** (`amm-monitor.ts`) - Monitors pump.swap graduated tokens
3. **Unified Services** - Shared services for both monitors (GraphQL, enrichment, etc.)

## Implementation Tracks

### Track A: AMM Monitor Upgrades (Priority: HIGH)
Fix critical issues with the newly created AMM monitor, particularly the hardcoded zero reserves.

### Track B: Unified System Enhancements (Priority: HIGH)
Implement GraphQL bulk recovery and stale token detection for both monitors.

### Track C: Advanced Features (Priority: MEDIUM-LOW)
Add historical backfilling, metadata enrichment, and performance optimizations.

---

## Detailed Session Plan

### 🔴 Critical Foundation (Complete First)

#### AMM-1: Pool Reserve Monitoring
**Track**: AMM Upgrades  
**Priority**: CRITICAL  
**Duration**: 1 week  
**Dependencies**: None

**Goals**:
- Add real-time pool state monitoring
- Decode actual reserves using BorshAccountsCoder
- Replace hardcoded zeros with real data

**Key Files**:
- Create: `src/monitors/amm-account-monitor.ts`
- Create: `src/types/amm-pool-state.ts`
- Create: `src/utils/amm-account-decoder.ts`

**Success Criteria**:
- Decode 95%+ of pool updates
- Reserve values match on-chain data
- No memory leaks during monitoring

---

#### AMM-2: Real-time Price Calculations
**Track**: AMM Upgrades  
**Priority**: CRITICAL  
**Duration**: 1 week  
**Dependencies**: AMM-1

**Goals**:
- Calculate accurate prices from actual reserves
- Implement constant product formula
- Track price impact

**Key Files**:
- Update: `src/utils/amm-price-calculator.ts`
- Update: `src/monitors/amm-monitor.ts`
- Create: `src/services/amm-price-tracker.ts`

**Success Criteria**:
- Prices match DEX aggregators within 1%
- Price updates in <100ms after trades

---

### 🟡 Core System Enhancements

#### SYSTEM-1: GraphQL Bulk Price Recovery
**Track**: Unified System  
**Priority**: HIGH  
**Duration**: 1 week  
**Dependencies**: None

**Goals**:
- Implement efficient bulk price queries (100 tokens/query)
- Create GraphQL client with connection pooling
- Build price calculation from virtual reserves

**Key Files**:
- Create: `src/services/graphql-price-recovery.ts`
- Create: `src/services/graphql-client.ts`
- Update: `src/database/unified-db-service-v2.ts`

**Success Criteria**:
- Query 100 tokens in <1 second
- Price calculations match on-chain
- Proper error handling and retries

---

#### SYSTEM-2: Stale Token Detection
**Track**: Unified System  
**Priority**: HIGH  
**Duration**: 3-4 days  
**Dependencies**: SYSTEM-1

**Goals**:
- Detect tokens with outdated prices
- Implement recovery priority queue
- Handle startup recovery after downtime

**Key Files**:
- Create: `src/services/stale-token-detector.ts`
- Create: `src/services/recovery-queue.ts`
- Create: `src/scripts/startup-recovery.ts`

**Success Criteria**:
- Detect stale tokens within 5 minutes
- Recover 1000 tokens in <30 seconds
- Prioritize by market cap and activity

---

#### SYSTEM-3: Tiered Monitoring System
**Track**: Unified System  
**Priority**: HIGH  
**Duration**: 3-4 days  
**Dependencies**: SYSTEM-2

**Goals**:
- Classify tokens into monitoring tiers
- Assign appropriate update methods
- Dynamic tier transitions

**Key Files**:
- Create: `src/services/token-tier-manager.ts`
- Create: `src/types/monitoring-tiers.ts`
- Update: `src/monitors/unified-monitor-v3.ts`

**Tier Structure**:
- **Tier 1**: Top 50 tokens - WebSocket real-time
- **Tier 2**: $100K+ market cap - GraphQL frequent (1 min)
- **Tier 3**: All others - GraphQL periodic (5 min)

**Success Criteria**:
- Correct tier assignment for 100% of tokens
- Smooth tier transitions
- Monitoring method routing works correctly

---

### 🟢 Enhanced Monitoring Features

#### AMM-3: Transaction Status Monitoring
**Track**: AMM Upgrades  
**Priority**: MEDIUM  
**Duration**: 3-4 days  
**Dependencies**: AMM-2

**Goals**:
- Track confirmation states (processed → confirmed → finalized)
- Handle transaction failures and reorgs
- Update database with status changes

**Success Criteria**:
- Track 100% of trades through status changes
- Proper reorg handling
- Database consistency maintained

---

#### SYSTEM-4: Selective WebSocket Monitoring
**Track**: Unified System  
**Priority**: MEDIUM  
**Duration**: 3-4 days  
**Dependencies**: SYSTEM-3

**Goals**:
- Real-time account monitoring for Tier 1 tokens
- Manage WebSocket subscription limits
- Implement connection pooling

**Key Files**:
- Create: `src/services/selective-account-monitor.ts`
- Create: `src/services/websocket-pool.ts`
- Update: `src/config/monitoring-limits.ts`

**Success Criteria**:
- Monitor 50 tokens simultaneously
- Update latency <100ms
- Automatic reconnection on failures

---

#### SYSTEM-5: Unified Event Processor
**Track**: Unified System  
**Priority**: MEDIUM  
**Duration**: 1 week  
**Dependencies**: SYSTEM-4, AMM-2

**Goals**:
- Coordinate all data sources
- Implement deduplication
- Handle source priorities

**Key Files**:
- Create: `src/services/unified-event-processor.ts`
- Create: `src/types/event-types.ts`
- Update: `src/monitors/bc-monitor.ts`
- Update: `src/monitors/amm-monitor.ts`

**Source Priority**:
1. WebSocket (most recent)
2. Trade events (accurate)
3. GraphQL (bulk updates)

**Success Criteria**:
- No duplicate price updates
- Correct source priority handling
- Process 1000+ events/second

---

### 🔵 Production Features

#### AMM-4: File Logging System
**Track**: AMM Upgrades  
**Priority**: MEDIUM  
**Duration**: 2-3 days  
**Dependencies**: AMM-3

**Goals**:
- Structured JSON logging
- Log rotation by date/size
- Analysis tools

**Success Criteria**:
- Zero data loss
- Proper log rotation
- <5% performance impact

---

#### AMM-5: Comprehensive Error Handling
**Track**: AMM Upgrades  
**Priority**: MEDIUM  
**Duration**: 3-4 days  
**Dependencies**: AMM-4

**Goals**:
- Categorize and handle all error types
- Implement retry strategies
- Add circuit breakers

**Success Criteria**:
- 99.9% uptime with auto-recovery
- <0.1% data loss during failures
- Recovery within 30 seconds

---

#### SYSTEM-6: Historical Trade Backfilling
**Track**: Unified System  
**Priority**: MEDIUM  
**Duration**: 1 week  
**Dependencies**: SYSTEM-5

**Goals**:
- Fetch trade history at $18,888 threshold
- Parse historical pump.fun transactions
- Analyze trade patterns

**Key Files**:
- Create: `src/services/trade-backfill-service.ts`
- Create: `src/services/pattern-analyzer.ts`
- Create: `src/utils/rpc-transaction-fetcher.ts`

**Success Criteria**:
- Backfill 1000+ trades in <30 seconds
- Detect trading patterns (snipers, wash)
- Queue management works smoothly

---

### ⚪ Optimization & Polish

#### SYSTEM-7: Metadata Enrichment
**Track**: Unified System  
**Priority**: LOW  
**Duration**: 3-4 days  
**Dependencies**: None

**Goals**:
- Fetch token metadata via DAS API
- Implement caching strategy
- Validate metadata quality

**Success Criteria**:
- Enrich 100 tokens in batch
- Cache hit rate >80%
- Metadata validation works

---

#### AMM-6: Configurable Parameters
**Track**: AMM Upgrades  
**Priority**: LOW  
**Duration**: 2-3 days  
**Dependencies**: AMM-5

**Goals**:
- Make all parameters configurable
- Support runtime updates
- Add CLI configuration

**Success Criteria**:
- All parameters configurable
- Runtime updates apply <10 seconds
- Clear validation errors

---

#### AMM-7: Enhanced Analytics
**Track**: AMM Upgrades  
**Priority**: LOW  
**Duration**: 3-4 days  
**Dependencies**: AMM-6

**Goals**:
- Add trade routing details
- Calculate advanced metrics (VWAP, MEV)
- Create analytics API

**Success Criteria**:
- Routing details 100% accurate
- MEV detection works
- API responds <100ms

---

#### SYSTEM-8: Performance Optimization
**Track**: Unified System  
**Priority**: LOW  
**Duration**: 1 week  
**Dependencies**: All previous

**Goals**:
- Multi-level caching
- Connection pooling
- Database optimization

**Success Criteria**:
- Handle 10,000 tokens
- <50MB memory growth/24h
- API usage minimized

---

#### AMM-8: Production Hardening
**Track**: AMM Upgrades  
**Priority**: LOW  
**Duration**: 1 week  
**Dependencies**: AMM-7

**Goals**:
- Add monitoring/alerting
- Security hardening
- Load testing

**Success Criteria**:
- Handle 1000+ trades/second
- 99.99% uptime
- Pass security audit

---

#### SYSTEM-9: Dashboard Updates
**Track**: Unified System  
**Priority**: LOW  
**Duration**: 3-4 days  
**Dependencies**: SYSTEM-8

**Goals**:
- Show monitoring sources
- Add tier visualization
- Real-time indicators

**Success Criteria**:
- Real-time updates work
- Performance with 1000+ tokens
- Mobile responsive

---

#### SYSTEM-10: Integration Testing
**Track**: Unified System  
**Priority**: LOW  
**Duration**: 1 week  
**Dependencies**: All previous

**Goals**:
- Full system testing
- Deployment automation
- Monitoring setup

**Success Criteria**:
- All components integrated
- Gradual rollout successful
- Alerts working correctly

---

## Implementation Schedule

### Phase 1: Critical Foundation (Weeks 1-2)
- AMM-1: Pool Reserve Monitoring
- AMM-2: Real-time Price Calculations
- SYSTEM-1: GraphQL Bulk Recovery

### Phase 2: Core Systems (Weeks 3-4)
- SYSTEM-2: Stale Token Detection
- SYSTEM-3: Tiered Monitoring
- AMM-3: Transaction Status

### Phase 3: Enhanced Features (Weeks 5-6)
- SYSTEM-4: WebSocket Monitoring
- SYSTEM-5: Unified Event Processor
- AMM-4: File Logging
- AMM-5: Error Handling

### Phase 4: Production Features (Weeks 7-8)
- SYSTEM-6: Historical Backfilling
- SYSTEM-7: Metadata Enrichment
- AMM-6: Configurable Parameters

### Phase 5: Optimization (Weeks 9-10)
- AMM-7: Enhanced Analytics
- SYSTEM-8: Performance Optimization
- AMM-8: Production Hardening

### Phase 6: Final Polish (Week 11)
- SYSTEM-9: Dashboard Updates
- SYSTEM-10: Integration Testing

---

## Success Metrics

### System-Wide Metrics
- **Price Accuracy**: Within 0.1% of on-chain
- **Update Latency**: <100ms for Tier 1 tokens
- **API Efficiency**: <10 calls per token per day
- **System Uptime**: >99.9%
- **Total Cost**: <$50/month for all APIs

### AMM-Specific Metrics
- **Parse Rate**: >99% for AMM transactions
- **Reserve Accuracy**: Exact match with on-chain
- **Price Deviation**: <1% from DEX aggregators

### BC-Specific Metrics
- **Parse Rate**: >95% maintained
- **Graduation Detection**: Within 5 seconds
- **Stale Recovery**: <30 seconds for 1000 tokens

---

## Database Schema Updates

```sql
-- Monitoring tier system
ALTER TABLE tokens_unified ADD COLUMN IF NOT EXISTS 
  monitoring_tier INTEGER DEFAULT 3,
  monitoring_method VARCHAR(20) DEFAULT 'graphql-periodic',
  last_graphql_update TIMESTAMPTZ,
  last_websocket_update TIMESTAMPTZ,
  last_account_update TIMESTAMPTZ,
  tier_assigned_at TIMESTAMPTZ DEFAULT NOW(),
  tier_transition_count INTEGER DEFAULT 0;

-- AMM pool state tracking
CREATE TABLE IF NOT EXISTS amm_pool_states (
  id BIGSERIAL PRIMARY KEY,
  mint_address VARCHAR(64) NOT NULL,
  pool_address VARCHAR(64) NOT NULL,
  virtual_sol_reserves BIGINT NOT NULL,
  virtual_token_reserves BIGINT NOT NULL,
  real_sol_reserves BIGINT,
  real_token_reserves BIGINT,
  pool_open BOOLEAN DEFAULT TRUE,
  slot BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address)
);

CREATE INDEX idx_amm_pool_states_lookup ON amm_pool_states(mint_address, created_at DESC);

-- Price update tracking
CREATE TABLE IF NOT EXISTS price_update_sources (
  id BIGSERIAL PRIMARY KEY,
  mint_address VARCHAR(64) REFERENCES tokens_unified(mint_address),
  update_source VARCHAR(20) NOT NULL,
  price_sol DECIMAL(20,12),
  price_usd DECIMAL(20,4),
  market_cap_usd DECIMAL(20,4),
  reserves_sol BIGINT,
  reserves_token BIGINT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stale token recovery tracking
CREATE TABLE IF NOT EXISTS stale_token_recovery (
  id BIGSERIAL PRIMARY KEY,
  recovery_batch_id UUID DEFAULT gen_random_uuid(),
  tokens_checked INTEGER NOT NULL,
  tokens_stale INTEGER NOT NULL,
  tokens_recovered INTEGER NOT NULL,
  graphql_queries INTEGER NOT NULL,
  total_duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction status tracking
ALTER TABLE trades_unified ADD COLUMN IF NOT EXISTS
  confirmation_status VARCHAR(20) DEFAULT 'confirmed',
  confirmed_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  failed BOOLEAN DEFAULT FALSE,
  failure_reason VARCHAR(255);
```

---

## Risk Mitigation

### Technical Risks
- **API Rate Limits**: Circuit breakers, exponential backoff
- **Data Inconsistency**: Source priorities, deduplication
- **Memory Leaks**: Regular profiling, automatic restarts
- **Network Failures**: Connection pooling, auto-reconnect

### Operational Risks
- **Feature Flags**: Every major feature can be toggled
- **Gradual Rollout**: Start with 10% of tokens
- **Rollback Plan**: Git tags for each phase
- **Monitoring**: Comprehensive metrics and alerts

---

## Testing Strategy

### Unit Tests
- Each new service gets comprehensive unit tests
- Mock external dependencies
- Test error conditions

### Integration Tests
- Test data flow between components
- Verify database consistency
- Test failover scenarios

### Performance Tests
- Load test with 10x normal volume
- Memory leak detection
- API usage optimization

### Verification Scripts
```bash
# After each session
npm run verify-amm-1     # Verify pool state decoding
npm run verify-system-1  # Verify GraphQL recovery
# ... etc

# Full system verification
npm run verify-all-systems
```

---

## Next Steps

1. **Immediate Priority**: Start with AMM-1 (Pool Reserve Monitoring) to fix the critical issue of hardcoded zeros in the AMM monitor

2. **Parallel Work**: While working on AMM fixes, another developer can start SYSTEM-1 (GraphQL Bulk Recovery)

3. **Weekly Reviews**: Assess progress and adjust priorities based on findings

4. **Documentation**: Update CLAUDE.md after each major session

This master plan provides a clear path forward with well-defined sessions, dependencies, and success criteria. Each session builds upon the previous ones while maintaining system stability.