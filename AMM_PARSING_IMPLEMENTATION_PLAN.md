# AMM Parsing Implementation Plan

## Overview

This plan consolidates improvements for AMM trade parsing, focusing on practical fixes to increase parse rates and accuracy. The goal is to simplify from 6+ parsing strategies to 2 reliable ones while adding metrics to track success.

## Current Issues

1. **Low AMM Trade Detection**: Only capturing ~3 AMM trades vs thousands of BC trades
2. **Missing Reserves**: Many AMM trades have NULL virtual reserves
3. **Multiple Parsing Strategies**: 6+ strategies suggest ongoing reliability issues
4. **No Parse Metrics**: Can't identify which strategies are failing or why
5. **Poor Account Integration**: Account monitoring data not fully utilized

## Implementation Plan

### Phase 1: Add Parse Success Metrics (2 days)

#### 1.1 Create Parsing Metrics Service
```typescript
// src/services/monitoring/parsing-metrics-service.ts
export class ParsingMetricsService {
  private static instance: ParsingMetricsService;
  private metrics = new Map<string, ParseMetric>();
  
  trackParseAttempt(params: {
    strategy: string;
    programId: string;
    success: boolean;
    error?: Error;
    signature?: string;
    parseTime?: number;
  }): void {
    const key = `${params.programId}-${params.strategy}`;
    const metric = this.metrics.get(key) || {
      strategy: params.strategy,
      programId: params.programId,
      attempts: 0,
      successes: 0,
      failures: 0,
      avgParseTime: 0,
      errors: new Map<string, number>()
    };
    
    metric.attempts++;
    if (params.success) {
      metric.successes++;
    } else {
      metric.failures++;
      if (params.error) {
        const errorKey = params.error.message;
        metric.errors.set(errorKey, (metric.errors.get(errorKey) || 0) + 1);
      }
    }
    
    this.metrics.set(key, metric);
    
    // Log failures for debugging
    if (!params.success) {
      this.logger.debug('Parse failure', {
        strategy: params.strategy,
        signature: params.signature,
        error: params.error?.message
      });
    }
  }
  
  getMetrics(): ParseMetricsSummary {
    const summary = {
      totalAttempts: 0,
      totalSuccesses: 0,
      byStrategy: [] as StrategyMetric[]
    };
    
    for (const [key, metric] of this.metrics) {
      summary.totalAttempts += metric.attempts;
      summary.totalSuccesses += metric.successes;
      
      summary.byStrategy.push({
        strategy: metric.strategy,
        successRate: metric.successes / metric.attempts,
        attempts: metric.attempts,
        topErrors: Array.from(metric.errors.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
      });
    }
    
    return summary;
  }
}
```

#### 1.2 Integrate Metrics into Parser
```typescript
// src/utils/parsers/unified-event-parser.ts
export class UnifiedEventParser {
  private metricsService = ParsingMetricsService.getInstance();
  
  static parseTransaction(context: ParseContext): ParsedEvent[] {
    const strategies = this.strategies.filter(s => s.canParse(context));
    
    for (const strategy of strategies) {
      const startTime = Date.now();
      try {
        const result = strategy.parse(context);
        
        this.metricsService.trackParseAttempt({
          strategy: strategy.name,
          programId: context.programId,
          success: result !== null,
          signature: context.signature,
          parseTime: Date.now() - startTime
        });
        
        if (result) return [result];
      } catch (error) {
        this.metricsService.trackParseAttempt({
          strategy: strategy.name,
          programId: context.programId,
          success: false,
          error: error as Error,
          signature: context.signature
        });
      }
    }
    
    return [];
  }
}
```

#### 1.3 Add Comprehensive Metrics API Endpoints
```typescript
// src/api/metrics-endpoint.ts
router.get('/api/parsing-metrics/overview', async (req, res) => {
  const metrics = ParsingMetricsService.getInstance();
  const overview = metrics.getOverviewMetrics();
  
  res.json({
    success: true,
    data: {
      overall: {
        parseRate: overview.overallParseRate,
        totalTransactions: overview.totalTransactions,
        successfullyParsed: overview.successfullyParsed,
        avgParseTime: overview.avgParseTime
      },
      byProgram: {
        'pump.fun': metrics.getProgramMetrics(PUMP_PROGRAM_ID),
        'pump.swap': metrics.getProgramMetrics(AMM_PROGRAM_ID),
        'raydium': metrics.getProgramMetrics(RAYDIUM_PROGRAM_ID)
      },
      recentFailures: metrics.getRecentFailures(10)
    }
  });
});

router.get('/api/parsing-metrics/strategies', async (req, res) => {
  const metrics = ParsingMetricsService.getInstance();
  const strategies = metrics.getStrategyMetrics();
  
  res.json({
    success: true,
    data: strategies.map(s => ({
      name: s.strategy,
      successRate: s.successRate,
      attempts: s.attempts,
      avgParseTime: s.avgParseTime,
      topErrors: s.getTopErrors(5)
    }))
  });
});

router.get('/api/parsing-metrics/data-quality', async (req, res) => {
  const metrics = ParsingMetricsService.getInstance();
  
  res.json({
    success: true,
    data: {
      ammTradesWithReserves: metrics.getReserveDataQuality(),
      reserveDataSources: metrics.getReserveDataSources(),
      crossVenueCorrelation: metrics.getCrossVenueMetrics(),
      marketCapAccuracy: metrics.getMarketCapAccuracy()
    }
  });
});

router.get('/api/parsing-metrics/system', async (req, res) => {
  const metrics = ParsingMetricsService.getInstance();
  
  res.json({
    success: true,
    data: {
      parseQueueDepth: metrics.getQueueDepth(),
      memoryUsage: process.memoryUsage(),
      eventBusMessagesPerSec: metrics.getEventBusRate(),
      dbWriteThroughput: metrics.getDbWriteRate()
    }
  });
});

router.get('/api/parsing-metrics/alerts', async (req, res) => {
  const metrics = ParsingMetricsService.getInstance();
  const alerts = metrics.checkAlertThresholds();
  
  res.json({
    success: true,
    data: alerts
  });
});
```

### Phase 2: Consolidate Parsing Strategies (3 days)

#### 2.1 Create Unified AMM Trade Parser
```typescript
// src/utils/parsers/strategies/unified-amm-trade-strategy.ts
export class UnifiedAmmTradeStrategy implements ParseStrategy {
  name = 'UnifiedAmmTradeStrategy';
  private eventParser: EventParser;
  private innerIxParser: InnerInstructionParser;
  
  constructor() {
    // Initialize IDL-based event parser
    const ammIdl = require('../../../idls/pump_amm_0.1.0.json');
    const eventCoder = new BorshEventCoder(ammIdl);
    this.eventParser = new EventParser(AMM_PROGRAM_ID, eventCoder);
    this.innerIxParser = new InnerInstructionParser();
  }
  
  canParse(context: ParseContext): boolean {
    return context.programId === AMM_PROGRAM_ID.toBase58();
  }
  
  parse(context: ParseContext): AMMTradeEvent | null {
    // Primary method: Parse events from logs
    if (context.logs?.length > 0) {
      const events = this.eventParser.parseLogs(context.logs);
      const swapEvent = events.find(e => e.name === 'SwapEvent');
      
      if (swapEvent) {
        // Get actual amounts from inner instructions
        const { actualAmounts, poolAccounts } = this.parseInnerInstructions(context);
        
        return {
          type: EventType.AMM_TRADE,
          signature: context.signature,
          trader: swapEvent.data.user.toBase58(),
          mintAddress: swapEvent.data.inputMint.toBase58() === WSOL_ADDRESS 
            ? swapEvent.data.outputMint.toBase58()
            : swapEvent.data.inputMint.toBase58(),
          solAmount: actualAmounts.solAmount || swapEvent.data.inputAmount,
          tokenAmount: actualAmounts.tokenAmount || swapEvent.data.outputAmount,
          tradeType: swapEvent.data.inputMint.toBase58() === WSOL_ADDRESS 
            ? TradeType.BUY 
            : TradeType.SELL,
          poolAddress: poolAccounts.poolAddress,
          virtualSolReserves: swapEvent.data.poolSolReserves,
          virtualTokenReserves: swapEvent.data.poolTokenReserves,
          slot: context.slot,
          timestamp: context.timestamp
        };
      }
    }
    
    // Fallback: Parse from instruction data and inner instructions
    return this.parseFromInstructionData(context);
  }
  
  private parseInnerInstructions(context: ParseContext): {
    actualAmounts: { solAmount?: bigint; tokenAmount?: bigint };
    poolAccounts: { poolAddress?: string };
  } {
    const transfers = this.innerIxParser.extractTokenTransfers(context);
    
    // Aggregate transfers to/from pool
    const poolTransfers = transfers.filter(t => 
      this.isPoolAccount(t.source) || this.isPoolAccount(t.destination)
    );
    
    const solAmount = poolTransfers
      .filter(t => t.mint === WSOL_ADDRESS)
      .reduce((sum, t) => sum + t.amount, 0n);
      
    const tokenAmount = poolTransfers
      .filter(t => t.mint !== WSOL_ADDRESS)
      .reduce((sum, t) => sum + t.amount, 0n);
    
    return {
      actualAmounts: { solAmount, tokenAmount },
      poolAccounts: { 
        poolAddress: poolTransfers[0]?.source || poolTransfers[0]?.destination 
      }
    };
  }
}
```

#### 2.2 Create Fallback Heuristic Parser
```typescript
// src/utils/parsers/strategies/amm-trade-heuristic-strategy.ts
export class AmmTradeHeuristicStrategy implements ParseStrategy {
  name = 'AmmTradeHeuristicStrategy';
  
  canParse(context: ParseContext): boolean {
    // Only use for AMM transactions that unified parser couldn't handle
    return context.programId === AMM_PROGRAM_ID.toBase58() &&
           !context.parsedByUnified;
  }
  
  parse(context: ParseContext): AMMTradeEvent | null {
    // Pattern matching for edge cases
    // - Transactions with corrupted logs
    // - Non-standard instruction formats
    // - Legacy transaction versions
    
    const patterns = [
      this.checkTransferPattern,
      this.checkAccountPattern,
      this.checkDataPattern
    ];
    
    for (const pattern of patterns) {
      const result = pattern.call(this, context);
      if (result) return result;
    }
    
    return null;
  }
}
```

#### 2.3 Update Parser Registry
```typescript
// src/utils/parsers/parser-registry.ts
export class ParserRegistry {
  private strategies: Map<string, ParseStrategy[]> = new Map();
  
  constructor() {
    // AMM Strategies (reduced from 6 to 2)
    this.strategies.set(AMM_PROGRAM_ID.toBase58(), [
      new UnifiedAmmTradeStrategy(),     // Primary
      new AmmTradeHeuristicStrategy()    // Fallback
    ]);
    
    // Keep existing BC strategies
    this.strategies.set(PUMP_PROGRAM_ID.toBase58(), [
      new BCTradeStrategy(),
      new BCCreateStrategy(),
      new BCCompleteStrategy()
    ]);
  }
}
```

### Phase 3: Fix Account Monitoring Integration (2 days)

#### 3.1 Create Pool State Coordinator
```typescript
// src/services/amm/pool-state-coordinator.ts
export class PoolStateCoordinator {
  private poolStates = new Map<string, PoolState>();
  private poolByMint = new Map<string, string>(); // mint -> pool mapping
  
  // Update from account monitoring
  updatePoolState(poolAddress: string, state: PoolState): void {
    this.poolStates.set(poolAddress, state);
    this.poolByMint.set(state.tokenMint, poolAddress);
    
    // Emit event for other services
    this.eventBus.emit('POOL_STATE_UPDATED', {
      poolAddress,
      tokenMint: state.tokenMint,
      virtualSolReserves: state.virtualSolReserves,
      virtualTokenReserves: state.virtualTokenReserves
    });
  }
  
  // Get pool state for trade enrichment
  getPoolStateForMint(mintAddress: string): PoolState | null {
    const poolAddress = this.poolByMint.get(mintAddress);
    if (!poolAddress) return null;
    
    return this.poolStates.get(poolAddress) || null;
  }
  
  // Enrich trade with latest pool state
  enrichTradeWithPoolState(trade: AMMTradeEvent): void {
    const poolState = this.getPoolStateForMint(trade.mintAddress);
    
    if (poolState && !trade.virtualSolReserves) {
      trade.virtualSolReserves = poolState.virtualSolReserves;
      trade.virtualTokenReserves = poolState.virtualTokenReserves;
      trade.enrichmentSource = 'pool_state_monitor';
    }
  }
}
```

#### 3.2 Update Liquidity Monitor
```typescript
// src/monitors/domain/liquidity-monitor.ts
export class LiquidityMonitor extends BaseMonitor {
  private poolStateCoordinator: PoolStateCoordinator;
  
  protected async processAccountUpdate(data: any): Promise<void> {
    if (data.account?.owner === AMM_PROGRAM_ID.toBase58()) {
      const poolState = this.decodePoolAccount(data);
      if (poolState) {
        this.poolStateCoordinator.updatePoolState(
          data.pubkey,
          poolState
        );
      }
    }
  }
}
```

### Phase 4: Add Missing Features (3 days)

#### 4.1 Parse Rate Analysis Tool
```typescript
// src/scripts/analyze-parse-rates.ts
async function analyzeParsRates() {
  console.log('Analyzing AMM parse rates...\n');
  
  // Get recent transactions
  const recentTxns = await db.query(`
    SELECT signature, program_id, created_at
    FROM raw_transactions
    WHERE program_id = $1
    AND created_at > NOW() - INTERVAL '24 hours'
  `, [AMM_PROGRAM_ID.toBase58()]);
  
  // Get parsed trades
  const parsedTrades = await db.query(`
    SELECT signature
    FROM trades_unified
    WHERE venue = 'pump_amm'
    AND created_at > NOW() - INTERVAL '24 hours'
  `);
  
  const parseRate = parsedTrades.length / recentTxns.length;
  
  console.log(`Parse Rate: ${(parseRate * 100).toFixed(1)}%`);
  console.log(`Total AMM Transactions: ${recentTxns.length}`);
  console.log(`Successfully Parsed: ${parsedTrades.length}`);
  console.log(`Failed to Parse: ${recentTxns.length - parsedTrades.length}`);
  
  // Identify failed transactions
  const failedSigs = recentTxns
    .map(t => t.signature)
    .filter(sig => !parsedTrades.some(p => p.signature === sig));
  
  console.log('\nSample Failed Transactions:');
  for (const sig of failedSigs.slice(0, 5)) {
    console.log(`- https://solscan.io/tx/${sig}`);
  }
}
```

#### 4.2 Enhanced Streaming Metrics Dashboard
```typescript
// src/dashboard/streaming-metrics.ts
export class StreamingMetricsPage {
  private refreshInterval: number = 10000; // 10 seconds
  private metricsCache = {
    overview: null,
    strategies: null,
    dataQuality: null,
    system: null,
    alerts: []
  };

  async initializePage() {
    // Set up auto-refresh
    this.startAutoRefresh();
    
    // Load all metrics
    await this.refreshAllMetrics();
    
    // Set up real-time updates via WebSocket
    this.connectToMetricsStream();
  }

  private async refreshAllMetrics() {
    await Promise.all([
      this.updateOverviewMetrics(),
      this.updateStrategyMetrics(),
      this.updateDataQualityMetrics(),
      this.updateSystemMetrics(),
      this.checkAlerts()
    ]);
  }

  private async updateOverviewMetrics() {
    const response = await fetch('/api/parsing-metrics/overview');
    const data = await response.json();
    
    // Update UI
    this.updateElement('overall-parse-rate', `${data.data.overall.parseRate.toFixed(1)}%`);
    this.updateElement('transactions-per-second', data.data.overall.tps);
    this.updateElement('parse-latency', `${data.data.overall.avgParseTime}ms`);
    this.updateElement('failed-parses-24h', data.data.overall.failedCount);
    
    // Update venue-specific metrics
    Object.entries(data.data.byProgram).forEach(([venue, metrics]) => {
      this.updateVenueCard(venue, metrics);
    });
    
    // Update recent failures list
    this.renderRecentFailures(data.data.recentFailures);
  }

  private async updateStrategyMetrics() {
    const response = await fetch('/api/parsing-metrics/strategies');
    const data = await response.json();
    
    // Sort by success rate
    const strategies = data.data.sort((a, b) => b.successRate - a.successRate);
    
    // Render strategy performance table
    this.renderStrategyTable(strategies);
  }

  private renderStrategyTable(strategies: StrategyMetric[]) {
    const tableBody = document.querySelector('#strategy-table-body');
    tableBody.innerHTML = strategies.map(s => `
      <tr>
        <td>${s.name}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="${this.getSuccessRateClass(s.successRate)}">
              ${(s.successRate * 100).toFixed(1)}%
            </span>
            <div class="progress-bar" style="width: 100px;">
              <div class="progress-fill" style="width: ${s.successRate * 100}%;"></div>
            </div>
          </div>
        </td>
        <td>${s.attempts.toLocaleString()}</td>
        <td>${s.avgParseTime}ms</td>
        <td>${this.renderTopErrors(s.topErrors)}</td>
      </tr>
    `).join('');
  }

  private connectToMetricsStream() {
    // WebSocket connection for real-time updates
    const ws = new WebSocket('ws://localhost:3001/metrics-stream');
    
    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      this.handleRealtimeUpdate(update);
    };
  }

  private handleRealtimeUpdate(update: MetricsUpdate) {
    switch (update.type) {
      case 'PARSE_FAILURE':
        this.addFailureToList(update.data);
        this.flashElement(`strategy-${update.data.strategy}`, 'error');
        break;
      case 'PARSE_SUCCESS':
        this.incrementSuccessCounter(update.data.strategy);
        break;
      case 'ALERT':
        this.showAlert(update.data);
        break;
    }
  }
}
```

#### 4.3 Streaming Metrics HTML Implementation
The enhanced streaming metrics page (streaming-metrics-enhanced.html) includes:

1. **Overall Metrics Dashboard**
   - Real-time parse rate with trend indicators
   - TPS, latency, and failure counts
   - Visual alerts for threshold breaches

2. **Parse Success by Venue**
   - Separate cards for pump.fun BC, pump.swap AMM, and Raydium
   - Mini sparkline charts showing trends
   - Color-coded status (green >90%, yellow 80-90%, red <80%)

3. **Strategy Performance Table**
   - All parsing strategies ranked by success rate
   - Visual progress bars for quick scanning
   - Top error messages for each strategy
   - Parse time performance

4. **Data Quality Metrics**
   - AMM trades with reserves percentage
   - Reserve data source breakdown
   - Cross-venue correlation success
   - Market cap accuracy tracking

5. **Real-time Failure Stream**
   - Last 10 failed transactions with links
   - Error reason and strategy that failed
   - Time since failure

6. **System Performance**
   - Parse queue depth with capacity indicator
   - Memory usage visualization
   - Event bus message rate
   - Database write throughput

7. **Performance Trend Charts**
   - Tabbed interface: Parse Rate, Latency, Volume, Error Rate
   - 24-hour historical data
   - Venue breakdown overlays

8. **Alert System**
   - Configurable thresholds
   - Visual alerts at top of page
   - Auto-dismiss after resolution

#### 4.4 Cross-venue Correlation
```typescript
// src/services/correlation/graduation-pool-matcher.ts
export class GraduationPoolMatcher {
  async correlateGraduationToPool(graduation: GraduationEvent): Promise<void> {
    // Wait for pool creation (usually within 30 seconds)
    const pool = await this.waitForPool(graduation.mintAddress, 30000);
    
    if (pool) {
      await db.query(`
        UPDATE tokens_unified
        SET 
          amm_pool_address = $1,
          amm_pool_created_at = $2,
          graduation_to_pool_delay_ms = $3
        WHERE mint_address = $4
      `, [
        pool.poolAddress,
        pool.createdAt,
        pool.createdAt - graduation.timestamp,
        graduation.mintAddress
      ]);
      
      this.logger.info('Correlated graduation to pool', {
        mint: graduation.mintAddress,
        delayMs: pool.createdAt - graduation.timestamp
      });
    }
  }
}
```

## Success Metrics

### Week 1
- [ ] Parse metrics service deployed and collecting data
- [ ] Enhanced streaming metrics dashboard live at http://localhost:3001/streaming-metrics.html
- [ ] All metric categories visible: Overview, Strategies, Data Quality, System
- [ ] Identified top parsing failure reasons
- [ ] Alert system operational with configurable thresholds

### Week 2  
- [ ] Unified parser achieving >80% success rate
- [ ] AMM trade detection increased 10x (from ~3 to ~30+ per day)
- [ ] All AMM trades have virtual reserves populated
- [ ] Real-time failure stream showing problematic transactions
- [ ] Strategy consolidation complete (6→2)

### Week 3
- [ ] Overall AMM parse rate >90%
- [ ] Full metrics dashboard with historical charts
- [ ] Cross-venue correlation working for graduations
- [ ] Performance metrics (TPS, latency, queue depth) stable
- [ ] Data quality metrics showing improvement trends

## Testing

### Test Parse Metrics
```bash
npx tsx src/scripts/test-parse-metrics.ts
```

### Test Unified Parser
```bash
npx tsx src/scripts/test-unified-amm-parser.ts
```

### Integration Test
```bash
npx tsx src/scripts/test-amm-parsing-integration.ts
```

## Rollback Plan

1. **Feature Flag**: `USE_UNIFIED_PARSER=false` to revert to old strategies
2. **Gradual Rollout**: Test on 10% traffic first
3. **Monitoring**: Alert if parse rate drops below baseline

## Enhanced Metrics Dashboard

The comprehensive streaming metrics dashboard provides real-time visibility into:

### Key Metrics Tracked
1. **Parse Success Rates** - Overall and by venue (BC, AMM, Raydium)
2. **Strategy Performance** - Success rate, attempts, errors for each parser
3. **Data Quality** - Reserves population, source breakdown, accuracy
4. **System Health** - Queue depth, memory, throughput
5. **Failure Analysis** - Real-time stream with links to failed transactions

### Dashboard Features
- Auto-refresh every 10 seconds
- Real-time WebSocket updates for failures
- Visual alerts for threshold breaches
- Historical trend charts (24h)
- Exportable metrics for analysis

### Alert Thresholds
- Parse rate < 90%: Yellow alert
- Parse rate < 80%: Red alert
- Strategy < 50% success: Immediate investigation
- Queue depth > 80%: Scale warning
- Memory > 80%: Resource alert

## Conclusion

This plan focuses on practical improvements:
- **Comprehensive metrics** to identify what's broken in real-time
- **Consolidation** from 6 strategies to 2 reliable ones  
- **Integration** of existing account monitoring
- **Enhanced dashboard** for complete visibility
- **Analysis tools** to debug issues immediately

No over-engineering, just fixes for real problems with full observability.