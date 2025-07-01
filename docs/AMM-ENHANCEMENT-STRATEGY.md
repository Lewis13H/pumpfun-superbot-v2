# AMM Monitor Enhancement Strategy

## Overview

This document outlines a comprehensive multi-session implementation strategy to enhance our AMM monitors with advanced features identified from Shyft code examples. This strategy complements the existing BONDING-CURVE-ENHANCEMENT-PLAN.md by focusing specifically on AMM-unique features not covered in the BC roadmap.

## Alignment with Existing Roadmap

### What's Already Covered in BC Enhancement Plan:
- ✅ **Phase 1**: IDL parsing, event extraction (applies to both BC and AMM)
- ✅ **Phase 2**: Advanced subscriptions, filtering (shared infrastructure)
- ✅ **Phase 3**: Migration detection (BC→AMM graduation tracking)
- ✅ **Phase 4**: Failed transaction analysis (applies to all programs)
- ✅ **Phase 5**: State tracking, slot monitoring (shared infrastructure)
- ✅ **Phase 6**: Performance optimization (system-wide)

### AMM-Specific Gaps to Address:
- ❌ Liquidity provider operations (deposit/withdraw)
- ❌ Fee collection and distribution events
- ❌ LP token tracking and positions
- ❌ Pool-specific analytics (TVL, APY, IL)
- ❌ AMM-specific price impact calculations
- ❌ Liquidity depth analysis

## Implementation Sessions

### Session 1: AMM Event Enhancement (4-5 hours)
**Builds on BC Phase 1 infrastructure**

**Objective**: Extend event parsing to capture AMM-specific events

**Tasks**:
1. **Extend Event Parser Service**
   ```typescript
   // Add to existing event-parser-service.ts
   interface AmmEventTypes {
     DepositEvent: {
       user: PublicKey;
       lpAmount: BN;
       baseAmount: BN;
       quoteAmount: BN;
       poolBaseReserve: BN;
       poolQuoteReserve: BN;
     };
     WithdrawEvent: {
       user: PublicKey;
       lpAmount: BN;
       baseReceived: BN;
       quoteReceived: BN;
       remainingBaseReserve: BN;
       remainingQuoteReserve: BN;
     };
     CollectCoinCreatorFeeEvent: {
       recipient: PublicKey;
       coinAmount: BN;
       pcAmount: BN;
     };
     CollectProtocolFeeEvent: {
       poolAddress: PublicKey;
       protocolCoinFee: BN;
       protocolPcFee: BN;
     };
   }
   ```

2. **Create Liquidity Event Handlers**
   ```typescript
   // New file: handlers/liquidity-event-handler.ts
   export class LiquidityEventHandler {
     constructor(
       private eventBus: EventBus,
       private dbService: UnifiedDatabaseService,
       private poolStateService: AmmPoolStateService
     ) {}

     async handleDepositEvent(event: DepositEvent, signature: string) {
       // Update pool reserves
       // Calculate LP token value
       // Store liquidity event
       // Emit LIQUIDITY_ADDED event
     }

     async handleWithdrawEvent(event: WithdrawEvent, signature: string) {
       // Update pool reserves
       // Calculate impermanent loss
       // Store liquidity event
       // Emit LIQUIDITY_REMOVED event
     }
   }
   ```

3. **Database Schema for Liquidity Events**
   ```sql
   CREATE TABLE amm_liquidity_events (
     id SERIAL PRIMARY KEY,
     signature VARCHAR(88) NOT NULL,
     event_type VARCHAR(20) NOT NULL, -- 'deposit' or 'withdraw'
     pool_address VARCHAR(64) NOT NULL,
     user_address VARCHAR(64) NOT NULL,
     lp_amount BIGINT NOT NULL,
     base_amount BIGINT NOT NULL,
     quote_amount BIGINT NOT NULL,
     base_price_usd DECIMAL(20, 4),
     quote_price_usd DECIMAL(20, 4),
     total_value_usd DECIMAL(20, 4),
     impermanent_loss DECIMAL(10, 4), -- for withdrawals
     slot BIGINT NOT NULL,
     block_time TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     FOREIGN KEY (pool_address) REFERENCES amm_pools(pool_address)
   );

   CREATE INDEX idx_liquidity_events_pool ON amm_liquidity_events(pool_address);
   CREATE INDEX idx_liquidity_events_user ON amm_liquidity_events(user_address);
   ```

### Session 2: Fee Tracking System (3-4 hours)
**Complements BC Phase 4 MEV analysis**

**Objective**: Comprehensive fee tracking and analytics

**Tasks**:
1. **Fee Event Service**
   ```typescript
   // New file: services/amm-fee-service.ts
   export class AmmFeeService {
     private feeAccumulator = new Map<string, FeeMetrics>();

     async processFeeEvent(event: FeeEvent, poolAddress: string) {
       // Accumulate fees per pool
       // Calculate fee APY
       // Track protocol vs LP fees
       // Store fee events
     }

     async calculateFeeMetrics(poolAddress: string): Promise<FeeMetrics> {
       return {
         totalFeesUSD: number,
         protocolFeesUSD: number,
         lpFeesUSD: number,
         feeAPY: number,
         avgDailyFees: number,
         topFeeGenerators: UserFeeContribution[]
       };
     }
   }
   ```

2. **Database Schema**
   ```sql
   CREATE TABLE amm_fee_events (
     id SERIAL PRIMARY KEY,
     signature VARCHAR(88) NOT NULL,
     event_type VARCHAR(30) NOT NULL,
     pool_address VARCHAR(64) NOT NULL,
     recipient VARCHAR(64) NOT NULL,
     coin_amount BIGINT,
     pc_amount BIGINT,
     coin_value_usd DECIMAL(20, 4),
     pc_value_usd DECIMAL(20, 4),
     total_value_usd DECIMAL(20, 4),
     slot BIGINT NOT NULL,
     block_time TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE TABLE amm_fee_metrics_daily (
     pool_address VARCHAR(64) NOT NULL,
     date DATE NOT NULL,
     total_fees_usd DECIMAL(20, 4),
     protocol_fees_usd DECIMAL(20, 4),
     lp_fees_usd DECIMAL(20, 4),
     volume_usd DECIMAL(20, 4),
     fee_apy DECIMAL(10, 4),
     trade_count INTEGER,
     unique_traders INTEGER,
     PRIMARY KEY (pool_address, date)
   );
   ```

### Session 3: LP Token & Position Tracking (4-5 hours)
**Extends BC Phase 5 state tracking**

**Objective**: Track LP tokens and user positions

**Tasks**:
1. **LP Token Monitor Service**
   ```typescript
   // New file: services/lp-token-monitor.ts
   export class LpTokenMonitor extends BaseMonitor {
     protected buildSubscribeRequest() {
       return {
         accounts: {
           lp_tokens: {
             owner: [TOKEN_PROGRAM_ID],
             filters: [{
               memcmp: {
                 offset: 0,
                 bytes: this.getLpMintAddresses() // Track LP token accounts
               }
             }]
           }
         }
       };
     }

     async processAccount(account: AccountInfo) {
       // Parse token account
       // Update user LP balance
       // Calculate position value
       // Emit LP_POSITION_UPDATED
     }
   }
   ```

2. **Position Calculation Service**
   ```typescript
   // New file: services/lp-position-calculator.ts
   export class LpPositionCalculator {
     calculatePositionValue(
       lpBalance: bigint,
       lpSupply: bigint,
       poolReserves: PoolReserves,
       prices: TokenPrices
     ): PositionValue {
       const shareOfPool = Number(lpBalance) / Number(lpSupply);
       const baseShare = poolReserves.base * shareOfPool;
       const quoteShare = poolReserves.quote * shareOfPool;
       
       return {
         baseAmount: baseShare,
         quoteAmount: quoteShare,
         totalValueUSD: (baseShare * prices.base) + (quoteShare * prices.quote),
         sharePercentage: shareOfPool * 100
       };
     }

     calculateImpermanentLoss(
       initialDeposit: DepositInfo,
       currentPosition: PositionValue,
       currentPrices: TokenPrices
     ): number {
       // Calculate IL based on price divergence
       // Return percentage loss/gain
     }
   }
   ```

3. **Database Schema**
   ```sql
   CREATE TABLE lp_positions (
     id SERIAL PRIMARY KEY,
     pool_address VARCHAR(64) NOT NULL,
     user_address VARCHAR(64) NOT NULL,
     lp_token_account VARCHAR(64) NOT NULL,
     lp_balance BIGINT NOT NULL,
     base_share BIGINT,
     quote_share BIGINT,
     total_value_usd DECIMAL(20, 4),
     share_percentage DECIMAL(10, 6),
     last_deposit_time TIMESTAMPTZ,
     last_withdraw_time TIMESTAMPTZ,
     realized_pnl_usd DECIMAL(20, 4),
     last_updated TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE(pool_address, user_address)
   );

   CREATE TABLE lp_position_history (
     id SERIAL PRIMARY KEY,
     position_id INTEGER REFERENCES lp_positions(id),
     lp_balance BIGINT NOT NULL,
     value_usd DECIMAL(20, 4),
     impermanent_loss DECIMAL(10, 4),
     timestamp TIMESTAMPTZ NOT NULL
   );
   ```

### Session 4: Advanced Pool Analytics (5-6 hours)
**Complements BC Phase 5 analytics**

**Objective**: Comprehensive pool metrics and analytics

**Tasks**:
1. **Pool Analytics Service**
   ```typescript
   // New file: services/amm-pool-analytics.ts
   export class AmmPoolAnalytics {
     async calculatePoolMetrics(poolAddress: string): Promise<PoolMetrics> {
       const pool = await this.poolStateService.getPoolState(poolAddress);
       const trades = await this.getRecentTrades(poolAddress);
       const liquidity = await this.getLiquidityEvents(poolAddress);
       
       return {
         tvl: this.calculateTVL(pool),
         volume24h: this.calculate24hVolume(trades),
         volume7d: this.calculate7dVolume(trades),
         fees24h: this.calculate24hFees(trades),
         apy: this.calculateAPY(pool, trades),
         priceImpact: this.calculateAveragePriceImpact(trades),
         liquidityDepth: this.calculateLiquidityDepth(pool),
         utilizationRate: this.calculateUtilization(pool, trades),
         volatility: this.calculateVolatility(trades)
       };
     }

     calculateLiquidityDepth(pool: PoolState): LiquidityDepth {
       // Calculate depth at various price levels
       return {
         buy2Percent: this.depthForPriceImpact(pool, 0.02, 'buy'),
         buy5Percent: this.depthForPriceImpact(pool, 0.05, 'buy'),
         buy10Percent: this.depthForPriceImpact(pool, 0.10, 'buy'),
         sell2Percent: this.depthForPriceImpact(pool, 0.02, 'sell'),
         sell5Percent: this.depthForPriceImpact(pool, 0.05, 'sell'),
         sell10Percent: this.depthForPriceImpact(pool, 0.10, 'sell')
       };
     }
   }
   ```

2. **Historical Metrics Aggregator**
   ```typescript
   // Extends existing stats aggregator
   export class AmmMetricsAggregator {
     async aggregateHourlyMetrics() {
       // Calculate hourly snapshots
       // Store TVL progression
       // Track volume patterns
       // Monitor fee generation
     }

     async generatePoolReport(poolAddress: string): Promise<PoolReport> {
       return {
         overview: await this.getPoolOverview(poolAddress),
         performance: await this.getPerformanceMetrics(poolAddress),
         liquidity: await this.getLiquidityAnalysis(poolAddress),
         users: await this.getUserAnalytics(poolAddress),
         comparison: await this.getMarketComparison(poolAddress)
       };
     }
   }
   ```

3. **Database Schema**
   ```sql
   CREATE TABLE amm_pool_metrics_hourly (
     pool_address VARCHAR(64) NOT NULL,
     timestamp TIMESTAMPTZ NOT NULL,
     tvl_usd DECIMAL(20, 4),
     volume_usd DECIMAL(20, 4),
     fees_usd DECIMAL(20, 4),
     trade_count INTEGER,
     unique_traders INTEGER,
     avg_trade_size_usd DECIMAL(20, 4),
     price_base_quote DECIMAL(20, 12),
     base_reserve BIGINT,
     quote_reserve BIGINT,
     lp_supply BIGINT,
     utilization_rate DECIMAL(10, 4),
     PRIMARY KEY (pool_address, timestamp)
   );

   CREATE TABLE amm_liquidity_depth (
     pool_address VARCHAR(64) NOT NULL,
     timestamp TIMESTAMPTZ NOT NULL,
     buy_2pct_usd DECIMAL(20, 4),
     buy_5pct_usd DECIMAL(20, 4),
     buy_10pct_usd DECIMAL(20, 4),
     sell_2pct_usd DECIMAL(20, 4),
     sell_5pct_usd DECIMAL(20, 4),
     sell_10pct_usd DECIMAL(20, 4),
     PRIMARY KEY (pool_address, timestamp)
   );
   ```

### Session 5: Enhanced Price Impact & Slippage (3-4 hours)
**Extends existing price calculations**

**Objective**: Detailed price impact analysis per trade

**Tasks**:
1. **Enhanced Price Impact Calculator**
   ```typescript
   // Enhance existing amm-price-calculator.ts
   export class EnhancedAmmPriceCalculator extends AmmPriceCalculator {
     calculateDetailedPriceImpact(
       inputAmount: bigint,
       inputReserve: bigint,
       outputReserve: bigint,
       fee: number = 0.003
     ): PriceImpactDetails {
       const spotPrice = this.getSpotPrice(inputReserve, outputReserve);
       const executionPrice = this.getExecutionPrice(inputAmount, inputReserve, outputReserve, fee);
       const priceImpact = (executionPrice - spotPrice) / spotPrice;
       
       return {
         spotPrice,
         executionPrice,
         priceImpact,
         priceImpactPercent: priceImpact * 100,
         outputAmount: this.getOutputAmount(inputAmount, inputReserve, outputReserve, fee),
         minimumReceived: this.applySlippage(outputAmount, slippageTolerance),
         effectiveFee: this.calculateEffectiveFee(inputAmount, fee, priceImpact)
       };
     }

     simulateLargeTrade(
       tradeSize: bigint,
       pool: PoolState,
       direction: 'buy' | 'sell'
     ): TradeSim
ulation {
       // Simulate trade in chunks
       // Show progressive price impact
       // Calculate average execution price
     }
   }
   ```

2. **Store Impact Metrics**
   ```sql
   ALTER TABLE trades_unified ADD COLUMN price_impact DECIMAL(10, 6);
   ALTER TABLE trades_unified ADD COLUMN effective_fee DECIMAL(10, 6);
   ALTER TABLE trades_unified ADD COLUMN spot_price DECIMAL(20, 12);
   ALTER TABLE trades_unified ADD COLUMN execution_price DECIMAL(20, 12);
   ```

### Session 6: Dashboard & API Enhancements (4-5 hours)
**Builds on existing dashboard**

**Objective**: Comprehensive AMM analytics dashboard

**Tasks**:
1. **New Dashboard Components**
   - Pool analytics page with TVL/volume charts
   - Liquidity provider leaderboard
   - Fee analytics dashboard
   - LP position tracker
   - Impermanent loss calculator

2. **Enhanced API Endpoints**
   ```typescript
   // Pool analytics endpoints
   router.get('/api/pools/:address/analytics', getPoolAnalytics);
   router.get('/api/pools/:address/liquidity-depth', getLiquidityDepth);
   router.get('/api/pools/:address/providers', getLiquidityProviders);
   router.get('/api/pools/:address/fees', getFeeAnalytics);

   // User position endpoints
   router.get('/api/users/:address/lp-positions', getUserLpPositions);
   router.get('/api/users/:address/liquidity-history', getUserLiquidityHistory);
   router.get('/api/users/:address/impermanent-loss', calculateUserIL);

   // Market overview
   router.get('/api/amm/top-pools', getTopPoolsByTVL);
   router.get('/api/amm/trending', getTrendingPools);
   router.get('/api/amm/new-pools', getNewPools);
   ```

3. **WebSocket Events**
   ```typescript
   // New event types
   ws.emit('LIQUIDITY_ADDED', liquidityEvent);
   ws.emit('LIQUIDITY_REMOVED', liquidityEvent);
   ws.emit('FEE_COLLECTED', feeEvent);
   ws.emit('LP_POSITION_UPDATED', positionUpdate);
   ws.emit('POOL_METRICS_UPDATED', metricsUpdate);
   ```

## Implementation Timeline

### Week 1: Core AMM Features
- **Days 1-2**: Session 1 - AMM Event Enhancement
- **Day 3**: Session 2 - Fee Tracking System
- **Days 4-5**: Session 3 - LP Token & Position Tracking

### Week 2: Analytics & UI
- **Days 6-8**: Session 4 - Advanced Pool Analytics
- **Day 9**: Session 5 - Enhanced Price Impact
- **Days 10-11**: Session 6 - Dashboard & API

### Week 3: Integration & Testing
- **Days 12-13**: Integration with existing BC enhancements
- **Days 14-15**: Testing, optimization, and deployment

## Integration Points with BC Enhancement Plan

1. **Shared Infrastructure** (BC Phases 1-2)
   - Reuse IDL parser service
   - Leverage subscription builder
   - Share event bus architecture

2. **Migration Tracking** (BC Phase 3)
   - Connect graduation events to pool creation
   - Track token journey from BC to AMM
   - Unified lifecycle monitoring

3. **Failed Transaction Analysis** (BC Phase 4)
   - Analyze failed liquidity operations
   - Detect MEV in AMM trades
   - Shared failure categorization

4. **State Tracking** (BC Phase 5)
   - Unified slot monitoring
   - Shared consistency validation
   - Combined state history

5. **Performance** (BC Phase 6)
   - Shared commitment strategies
   - Unified recovery mechanisms
   - Combined monitoring dashboard

## Success Metrics

1. **Event Coverage**
   - 100% of AMM events parsed
   - All liquidity operations tracked
   - Complete fee event capture

2. **Analytics Quality**
   - Accurate TVL calculations
   - Precise IL calculations
   - Real-time position tracking

3. **Performance**
   - <50ms event processing
   - <200ms analytics calculation
   - Minimal memory overhead

## Risk Mitigation

1. **Incremental Deployment**
   - Feature flags for new functionality
   - Gradual rollout per session
   - Backward compatibility maintained

2. **Data Validation**
   - Cross-check with on-chain data
   - Validate calculations against DexScreener
   - Audit trail for all calculations

3. **Performance Testing**
   - Load test each new feature
   - Monitor resource usage
   - Optimize before production

## Conclusion

This AMM enhancement strategy provides comprehensive monitoring capabilities that complement the existing BC enhancement plan. By focusing on AMM-specific features like liquidity operations, fee tracking, and LP analytics, we create a complete DEX monitoring solution without duplicating efforts from the BC roadmap.

The modular approach allows incremental implementation while maintaining system stability. Integration points with the BC plan ensure a unified monitoring platform that leverages shared infrastructure while providing specialized functionality for each program type.