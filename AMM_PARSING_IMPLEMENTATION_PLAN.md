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

#### 1.3 Add Metrics Dashboard Endpoint
```typescript
// src/api/metrics-endpoint.ts
router.get('/api/parsing-metrics', async (req, res) => {
  const metrics = ParsingMetricsService.getInstance().getMetrics();
  
  res.json({
    success: true,
    data: {
      overallSuccessRate: metrics.totalSuccesses / metrics.totalAttempts,
      totalTransactions: metrics.totalAttempts,
      strategies: metrics.byStrategy.map(s => ({
        name: s.strategy,
        successRate: `${(s.successRate * 100).toFixed(1)}%`,
        attempts: s.attempts,
        topErrors: s.topErrors
      }))
    }
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

#### 4.2 Real-time Parse Failure Dashboard
```typescript
// src/dashboard/components/ParseMetrics.tsx
export function ParseMetrics() {
  const [metrics, setMetrics] = useState<ParseMetricsSummary | null>(null);
  
  useEffect(() => {
    const fetchMetrics = async () => {
      const response = await fetch('/api/parsing-metrics');
      const data = await response.json();
      setMetrics(data.data);
    };
    
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="parse-metrics">
      <h3>AMM Parse Performance</h3>
      <div className="metric-grid">
        <div className="metric">
          <label>Overall Success Rate</label>
          <value>{(metrics?.overallSuccessRate * 100).toFixed(1)}%</value>
        </div>
        {metrics?.strategies.map(strategy => (
          <div key={strategy.name} className="strategy-metric">
            <label>{strategy.name}</label>
            <value>{strategy.successRate}</value>
            <small>{strategy.attempts} attempts</small>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 4.3 Cross-venue Correlation
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
- [ ] Dashboard showing parse success rates by strategy
- [ ] Identified top parsing failure reasons

### Week 2  
- [ ] Unified parser achieving >80% success rate
- [ ] AMM trade detection increased 10x (from ~3 to ~30+ per day)
- [ ] All AMM trades have virtual reserves populated

### Week 3
- [ ] Overall AMM parse rate >90%
- [ ] Parse failure dashboard integrated
- [ ] Cross-venue correlation working for graduations

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

## Conclusion

This plan focuses on practical improvements:
- **Metrics** to identify what's broken
- **Consolidation** from 6 strategies to 2 reliable ones  
- **Integration** of existing account monitoring
- **Analysis tools** to debug issues

No over-engineering, just fixes for real problems.