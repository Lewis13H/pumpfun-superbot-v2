# Bonding Curve Monitor Implementation Plan

## Overview
This document outlines a phased implementation plan for `bc-monitor.ts`, a focused pump.fun bonding curve monitoring service. Each phase builds upon the previous one, allowing thorough testing before proceeding.

## Architecture Goals
- Single-purpose service focused on pump.fun bonding curves only
- Reliable event detection using both log parsing and IDL parsing
- Efficient database operations with batching
- Real-time price calculations and market cap tracking
- Clean separation of concerns for maintainability

## Phase 1: Core Infrastructure (Foundation) ✅ COMPLETED
**Goal**: Establish basic streaming connection and data flow
**Status**: ✅ Completed on 2025-06-28
**Test Result**: Successfully streamed 60 transactions in 30 seconds with 0 errors

### Components Built:
1. **Basic Monitor Setup**
   ```typescript
   // bc-monitor.ts
   - Initialize gRPC client connection
   - Set up subscription to pump.fun transactions
   - Basic error handling and reconnection logic
   - Ping/pong handling for connection keepalive
   ```

2. **Configuration Management**
   ```typescript
   // Constants and configuration
   - PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
   - Token decimals (6), SOL decimals (9)
   - Batch sizes and intervals
   - Default virtual reserves
   ```

3. **Basic Logging & Statistics**
   ```typescript
   - Connection status tracking
   - Transaction counter
   - Basic console output
   - Error logging
   ```

### Testing Checklist:
- [x] Successfully connects to Shyft gRPC
- [x] Receives pump.fun transactions
- [x] Handles disconnections gracefully
- [x] Logs basic statistics

### Success Criteria:
- Monitor runs for 5 minutes without crashing ✅
- Logs show consistent transaction flow ✅
- Reconnects automatically after network issues ✅

### Implementation Notes:
- Used existing `StreamClient` singleton for connection management
- Implemented exponential backoff for reconnection (5s → 60s max)
- Added comprehensive statistics tracking with 5-second updates
- Clean shutdown handling with SIGINT/SIGTERM
- Transaction rate observed: ~2 per second for pump.fun

---

## Phase 2: Transaction Parsing ✅ COMPLETED
**Goal**: Extract trade events from pump.fun transactions
**Status**: ✅ Completed on 2025-06-28
**Test Result**: Successfully parsed 754 trades from 700 transactions with 107.3% detection rate

### Components Built:
1. **Event Parser Module**
   ```typescript
   // parsers/bc-event-parser.ts
   - Parse "Program data:" logs for trade events
   - Extract mint, virtual reserves from event data
   - Handle event data structure (113 bytes)
   ```

2. **Trade Detection**
   ```typescript
   - Identify buy/sell from instruction names
   - Extract user addresses from accounts
   - Parse SOL and token amounts
   - Handle failed transactions
   ```

3. **Data Validation**
   ```typescript
   - Validate mint addresses (44 chars, base58)
   - Verify event data size (113 bytes)
   - Check reserve values are reasonable
   - Filter out invalid events
   ```

### Testing Checklist:
- [x] Correctly parses buy events
- [x] Correctly parses sell events
- [x] Extracts accurate mint addresses
- [x] Handles malformed events gracefully

### Success Criteria:
- Parse 100+ trades with 0 errors ✅
- Mint addresses match on-chain data ✅
- Buy/sell detection accuracy > 99% ✅

### Implementation Notes:
- Created `bc-event-parser.ts` module with proper event structure handling
- Confirmed 225-byte event size (not 113 as in some old code)
- Virtual reserves at offsets 97 and 105 (verified)
- Detection rate > 100% due to multiple trades per transaction
- Successfully tracked 52 unique tokens in 30-second test
- Buy/sell ratio approximately 2:1

---

## Phase 3: Price Calculations & Market Cap ✅ COMPLETED
**Goal**: Calculate accurate prices and market caps
**Status**: ✅ Completed on 2025-06-28
**Test Result**: Successfully calculated prices for 2,206 trades with market caps up to $44K

### Components to Build:
1. **Price Calculator Service**
   ```typescript
   // services/bc-price-calculator.ts
   - Calculate price from virtual reserves
   - Convert SOL prices to USD
   - Calculate market cap (1B supply assumption)
   - Handle precision for small values
   ```

2. **SOL Price Integration**
   ```typescript
   - Integrate existing SolPriceService
   - Cache current SOL price
   - Fallback to default if unavailable
   ```

3. **Market Cap Tracking**
   ```typescript
   - Track first seen price/market cap
   - Monitor threshold crossings ($8,888)
   - Calculate price changes
   ```

### Testing Checklist:
- [x] Price calculations match pump.fun UI
- [x] Market cap calculations are accurate
- [x] USD conversions use current SOL price
- [x] Handles edge cases (very small/large values)

### Success Criteria:
- Price accuracy within 0.1% of pump.fun ✅
- Market cap calculations verified against known tokens ✅
- Threshold detection works reliably ✅

### Implementation Notes:
- Created `bc-price-calculator.ts` with comprehensive price calculation functions
- Integrated SolPriceService for live SOL prices ($143.16 during test)
- Added formatPrice and formatMarketCap for proper display formatting
- Implemented visual progress bars showing bonding curve completion
- Successfully tracked 1,330 tokens above $8,888 threshold
- Total volume tracked: $72,560.29 in 2-minute test
- Highest market cap observed: $44.11K
- Found tokens at 100% progress (ready for graduation)

---

## Phase 4: Database Integration
**Goal**: Persist tokens and trades efficiently

### Components to Build:
1. **Token Discovery Handler**
   ```typescript
   // handlers/bc-token-handler.ts
   - Process new token discoveries
   - Store initial price and market cap
   - Track first seen slot/time
   - Update token cache
   ```

2. **Trade Storage**
   ```typescript
   // handlers/bc-trade-handler.ts
   - Batch trade inserts
   - Deduplication by signature
   - Efficient queue processing
   - Statistics updates
   ```

3. **Database Service Integration**
   ```typescript
   - Use existing UnifiedDbServiceV2
   - Implement batching (100 records)
   - Handle database errors gracefully
   - Update token statistics
   ```

### Testing Checklist:
- [ ] New tokens saved to database
- [ ] Trades linked to correct tokens
- [ ] No duplicate trades (by signature)
- [ ] Batch processing works efficiently

### Success Criteria:
- Zero data loss over 1 hour run
- Database operations < 50ms average
- Successful deduplication of all trades

---

## Phase 5: Progress & Graduation Tracking
**Goal**: Monitor bonding curve completion

### Components to Build:
1. **Progress Calculator**
   ```typescript
   // services/bc-progress-tracker.ts
   - Calculate progress from reserves/lamports
   - Track progression over time
   - Detect 100% completion
   - Flag tokens ready for graduation
   ```

2. **Account State Monitoring** (Optional)
   ```typescript
   - Subscribe to bonding curve accounts
   - Parse account data for progress
   - Detect completion from account state
   ```

3. **Graduation Events**
   ```typescript
   - Detect graduation transactions
   - Update token status
   - Record graduation details
   - Track migration to AMM
   ```

### Testing Checklist:
- [ ] Progress calculations accurate
- [ ] Graduation detection works
- [ ] Status updates correctly
- [ ] No missed graduations

### Success Criteria:
- Track 10+ graduations accurately
- Progress matches pump.fun UI
- Graduation events captured in real-time

---

## Phase 6: New Token Detection
**Goal**: Identify and track newly minted tokens

### Components to Build:
1. **Mint Detection**
   ```typescript
   // handlers/bc-mint-detector.ts
   - Extract CA from postTokenBalances
   - Identify creation transactions
   - Extract creator address
   - Initial metadata capture
   ```

2. **Token Enrichment**
   ```typescript
   - Basic metadata extraction
   - Creator tracking
   - Initial holder analysis
   - Risk assessment (basic)
   ```

### Testing Checklist:
- [ ] Detects all new tokens
- [ ] Extracts correct mint addresses
- [ ] Links to creator correctly
- [ ] Captures initial metadata

### Success Criteria:
- 100% new token detection rate
- Metadata captured for 90%+ tokens
- Creator tracking accurate

---

## Phase 7: Real-time Dashboard
**Goal**: Display comprehensive monitoring data

### Components to Build:
1. **Statistics Aggregation**
   ```typescript
   - Real-time stats calculation
   - Performance metrics
   - Error tracking
   - Activity feed
   ```

2. **Console Dashboard**
   ```typescript
   - Clean terminal UI
   - Color-coded outputs
   - Recent activity feed
   - Performance graphs (ASCII)
   ```

3. **Web Dashboard Integration**
   ```typescript
   - Update existing dashboard
   - Real-time WebSocket updates
   - Token listings
   - Trade activity
   ```

### Testing Checklist:
- [ ] Dashboard updates in real-time
- [ ] Statistics are accurate
- [ ] No memory leaks
- [ ] Responsive under load

### Success Criteria:
- Dashboard runs 24+ hours stable
- Updates within 1 second
- Memory usage stable

---

## Phase 8: Advanced Analytics (Optional)
**Goal**: Add sophisticated analysis features

### Components to Build:
1. **Trading Analytics**
   ```typescript
   // analytics/bc-analytics.ts
   - Buy/sell pressure ratios
   - Volume analysis
   - Velocity tracking
   - Whale detection
   ```

2. **Risk Scoring**
   ```typescript
   - Creator reputation
   - Trading pattern analysis
   - Liquidity assessment
   - Rug pull indicators
   ```

3. **Alerts & Notifications**
   ```typescript
   - Threshold crossing alerts
   - Unusual activity detection
   - Graduation notifications
   - High-value trade alerts
   ```

### Testing Checklist:
- [ ] Analytics calculations correct
- [ ] Risk scores meaningful
- [ ] Alerts trigger appropriately
- [ ] No false positives

### Success Criteria:
- Detect 90%+ of significant events
- Risk scores correlate with outcomes
- Alerts have < 5% false positive rate

---

## Testing Strategy

### Unit Tests
- Event parser accuracy
- Price calculation precision
- Database operations
- Progress calculations

### Integration Tests
- End-to-end data flow
- Database persistence
- Multi-component coordination
- Error recovery

### Performance Tests
- Handle 100+ trades/second
- Database batch efficiency
- Memory usage stability
- CPU usage optimization

### Stress Tests
- 24-hour continuous run
- Network interruption recovery
- Database connection issues
- High-volume scenarios

---

## Implementation Timeline

### Week 1: Foundation
- Phase 1: Core Infrastructure (2 days)
- Phase 2: Transaction Parsing (2 days)
- Phase 3: Price Calculations (1 day)

### Week 2: Data Layer
- Phase 4: Database Integration (2 days)
- Phase 5: Progress Tracking (2 days)
- Phase 6: New Token Detection (1 day)

### Week 3: Polish & Advanced
- Phase 7: Dashboard (2 days)
- Phase 8: Advanced Analytics (3 days)
- Testing & optimization

---

## Key Success Metrics

1. **Reliability**
   - 99.9% uptime
   - < 0.1% data loss
   - Automatic recovery

2. **Performance**
   - < 100ms processing latency
   - Handle 1000+ tokens
   - Efficient resource usage

3. **Accuracy**
   - 100% trade detection
   - < 0.1% price error
   - No missed graduations

4. **Scalability**
   - Support 10,000+ active tokens
   - Process 1000+ trades/second
   - Minimal database growth

---

## Dependencies

### External Services
- Shyft gRPC endpoint
- PostgreSQL database
- Binance API (SOL price)
- Helius API (optional enrichment)

### Internal Modules
- UnifiedDbServiceV2
- SolPriceService
- Price calculators
- Event parsers

### NPM Packages
- @triton-one/yellowstone-grpc
- @solana/web3.js
- @project-serum/anchor
- @shyft-to/solana-transaction-parser
- bs58
- pg (PostgreSQL)

---

## Error Handling Strategy

### Connection Errors
- Exponential backoff reconnection
- Maximum retry limits
- Fallback endpoints

### Parsing Errors
- Log and skip invalid events
- Track error rates
- Alert on high error rates

### Database Errors
- Retry with backoff
- Queue overflow handling
- Transaction rollback

### Price Errors
- Use cached values
- Default fallbacks
- Mark as estimated

---

## Monitoring & Maintenance

### Health Checks
- Connection status
- Processing rate
- Error rate
- Database health

### Alerts
- Connection failures
- High error rates
- Performance degradation
- Missed events

### Maintenance Tasks
- Database cleanup
- Cache optimization
- Log rotation
- Performance tuning

---

## Future Enhancements

1. **Multi-program Support**
   - Add other bonding curve programs
   - Cross-program analytics
   - Unified token tracking

2. **Machine Learning**
   - Price prediction
   - Rug pull detection
   - Trading pattern recognition

3. **Advanced Features**
   - Automated trading signals
   - Portfolio tracking
   - Social sentiment analysis

4. **Infrastructure**
   - Horizontal scaling
   - Multi-region deployment
   - Real-time data streaming API