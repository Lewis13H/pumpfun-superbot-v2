# Complete Data Capture Strategy for Pump.fun Monitoring

## Overview
This document outlines how to capture 100% of available data from pump.fun bonding curves and AMM pools.

## 1. Enhanced Event Parsing Strategy

### A. Dual Parsing Approach
```typescript
// Use BOTH raw byte parsing AND IDL parsing
class EnhancedEventParser {
  // 1. Raw byte parsing (current approach - robust)
  parseRawEvent(data: Buffer): ParsedEvent | null {
    // Handle both 225-byte and 113-byte events
    // Extract basic trade data
  }
  
  // 2. IDL-based parsing (structured data)
  parseWithIDL(logs: string[], events: any[]): StructuredEvent | null {
    // Use SolanaParser with pump.fun IDL
    // Extract ALL event fields including metadata
  }
  
  // 3. Merge both results for complete data
  mergeResults(raw: ParsedEvent, structured: StructuredEvent): CompleteEvent {
    // Combine data, preferring structured when available
  }
}
```

### B. Complete Field Extraction
```typescript
interface CompleteTradeData {
  // Currently extracted
  signature: string;
  mintAddress: string;
  tradeType: 'buy' | 'sell';
  userAddress: string;
  solAmount: bigint;
  tokenAmount: bigint;
  
  // Missing but available
  creator: string;              // Token creator address
  realSolReserves: bigint;      // Actual SOL in pool
  realTokenReserves: bigint;    // Actual tokens in pool
  bondingCurveKey: string;      // BC address
  tokenDecimals: number;        // From metadata
  tokenSupply: bigint;          // Total supply
  isMigration: boolean;         // Graduation event
  
  // From transaction metadata
  computeUnits: number;         // Priority/MEV detection
  priorityFee: number;          // Fee analysis
  innerInstructions: any[];     // Cross-program calls
  preBalances: Balance[];       // Exact balance changes
  postBalances: Balance[];      
  
  // Calculated fields
  priceImpact: number;          // Slippage calculation
  effectivePrice: number;       // Actual execution price
  liquidityDepth: number;       // Available liquidity
}
```

## 2. Transaction Metadata Extraction

### A. Complete Metadata Parser
```typescript
class TransactionMetadataExtractor {
  extract(transaction: any): TransactionMetadata {
    return {
      // Token balances for accurate amounts
      tokenBalances: this.extractTokenBalances(
        transaction.meta.preTokenBalances,
        transaction.meta.postTokenBalances
      ),
      
      // Inner instructions for complete flow
      innerInstructions: this.parseInnerInstructions(
        transaction.meta.innerInstructions
      ),
      
      // Compute and fees
      computeUnits: transaction.meta.computeUnitsConsumed,
      priorityFee: this.calculatePriorityFee(transaction),
      
      // Account access patterns
      readonlyAccounts: this.extractReadonlyAccounts(transaction),
      writableAccounts: this.extractWritableAccounts(transaction),
      
      // Error handling
      error: transaction.meta.err,
      logs: transaction.meta.logMessages
    };
  }
  
  extractTokenBalances(pre: any[], post: any[]): BalanceChange[] {
    // Calculate exact token movements
    return pre.map((preBalance, index) => {
      const postBalance = post[index];
      return {
        mint: preBalance.mint,
        owner: preBalance.owner,
        change: postBalance.uiTokenAmount.amount - preBalance.uiTokenAmount.amount,
        decimals: preBalance.uiTokenAmount.decimals
      };
    });
  }
}
```

### B. Log Pattern Extraction
```typescript
class LogPatternExtractor {
  patterns = {
    // Bonding curve patterns
    bcTrade: /ray_log: (.+)/,
    migrate: /Program log: Instruction: Migrate/,
    bondingCurveComplete: /Bonding curve complete/,
    
    // AMM patterns
    poolCreated: /Pool created: (.+)/,
    swapExecuted: /ray_log: (.+)/,
    
    // Price/amount patterns
    solAmount: /sol_amount: (\d+)/,
    tokenAmount: /token_amount: (\d+)/,
    price: /price: ([\d.]+)/
  };
  
  extractFromLogs(logs: string[]): ExtractedData {
    const data: any = {};
    
    for (const log of logs) {
      // Check each pattern
      for (const [key, pattern] of Object.entries(this.patterns)) {
        const match = log.match(pattern);
        if (match) {
          data[key] = this.parseMatch(key, match);
        }
      }
    }
    
    return data;
  }
}
```

## 3. Account State Monitoring Enhancement

### A. Complete Account Decoding
```typescript
class EnhancedAccountMonitor {
  // Bonding Curve Account - ALL fields
  decodeBondingCurve(data: Buffer): CompleteBondingCurve {
    const decoded = BONDING_CURVE_SCHEMA.decode(data);
    
    return {
      virtualTokenReserves: decoded.virtualTokenReserves,
      virtualSolReserves: decoded.virtualSolReserves,
      realTokenReserves: decoded.realTokenReserves,      // Currently missed
      realSolReserves: decoded.realSolReserves,          // Currently missed
      tokenTotalSupply: decoded.tokenTotalSupply,        // Currently missed
      complete: decoded.complete,
      creator: decoded.creator.toString(),               // Currently missed
      
      // Calculated fields
      progress: this.calculateProgress(decoded),
      liquidityUsd: this.calculateLiquidity(decoded),
      pricePerToken: this.calculatePrice(decoded)
    };
  }
  
  // AMM Pool Account - ALL fields
  decodeAmmPool(data: Buffer): CompleteAmmPool {
    const decoded = AMM_POOL_SCHEMA.decode(data);
    
    return {
      poolBump: decoded.poolBump,
      index: decoded.index,
      creator: decoded.creator.toString(),
      baseMint: decoded.baseMint.toString(),
      quoteMint: decoded.quoteMint.toString(),
      lpMint: decoded.lpMint.toString(),
      baseVault: decoded.poolBaseTokenAccount.toString(),
      quoteVault: decoded.poolQuoteTokenAccount.toString(),
      lpSupply: decoded.lpSupply,
      
      // Additional fields from vault monitoring
      baseReserves: 0,  // Updated from token account
      quoteReserves: 0, // Updated from token account
      
      // Calculated fields
      constantK: 0n,
      pricePerToken: 0,
      liquidityUsd: 0,
      impactThresholds: {}
    };
  }
}
```

### B. Multi-Account Subscription Strategy
```typescript
class MultiAccountSubscriber {
  async subscribeToAllRelatedAccounts(mint: string) {
    // 1. Subscribe to bonding curve
    const bcAddress = await this.deriveBondingCurve(mint);
    await this.subscribeToBondingCurve(bcAddress);
    
    // 2. Subscribe to token mint account
    await this.subscribeToMintAccount(mint);
    
    // 3. Subscribe to associated pool (if graduated)
    const poolAddress = await this.derivePoolAddress(mint);
    if (poolAddress) {
      await this.subscribeToPool(poolAddress);
      
      // 4. Subscribe to pool vault accounts
      const vaults = await this.getPoolVaults(poolAddress);
      await this.subscribeToTokenAccounts(vaults);
    }
    
    // 5. Subscribe to metadata account
    const metadataAddress = await this.deriveMetadataAddress(mint);
    await this.subscribeToMetadata(metadataAddress);
  }
}
```

## 4. Real-time Aggregation Pipeline

### A. Stream Processing Architecture
```typescript
class DataAggregationPipeline {
  // Process each event through multiple analyzers
  async processEvent(event: CompleteEvent) {
    await Promise.all([
      this.updateTokenMetrics(event),
      this.updateVolumeAggregates(event),
      this.updatePriceHistory(event),
      this.updateLiquidityMetrics(event),
      this.detectAnomalies(event),
      this.trackHolderMetrics(event)
    ]);
  }
  
  // Real-time volume aggregation
  async updateVolumeAggregates(event: CompleteEvent) {
    const periods = ['1m', '5m', '15m', '1h', '24h', '7d'];
    
    for (const period of periods) {
      await this.volumeAggregator.update({
        mint: event.mintAddress,
        period,
        volumeUsd: event.volumeUsd,
        timestamp: event.timestamp
      });
    }
  }
  
  // Holder tracking via balance changes
  async trackHolderMetrics(event: CompleteEvent) {
    const balanceChanges = event.metadata.tokenBalances;
    
    for (const change of balanceChanges) {
      if (change.mint === event.mintAddress) {
        await this.holderTracker.update({
          mint: event.mintAddress,
          holder: change.owner,
          balance: change.postBalance,
          change: change.change
        });
      }
    }
  }
}
```

### B. Missing Data Recovery Service
```typescript
class DataRecoveryService {
  async recoverMissingData(mint: string) {
    // 1. Get historical transactions
    const signatures = await this.getHistoricalSignatures(mint);
    
    // 2. Fetch full transaction data
    const transactions = await this.fetchTransactions(signatures);
    
    // 3. Re-parse with complete extractor
    for (const tx of transactions) {
      const completeData = await this.completeParser.parse(tx);
      await this.backfillDatabase(completeData);
    }
    
    // 4. Fetch current account states
    const accounts = await this.fetchAllAccounts(mint);
    await this.updateCurrentState(accounts);
    
    // 5. Calculate missing aggregates
    await this.calculateHistoricalAggregates(mint);
  }
}
```

## 5. Database Schema for Complete Data

```sql
-- Enhanced tokens table
CREATE TABLE tokens_complete (
    mint_address VARCHAR(64) PRIMARY KEY,
    symbol VARCHAR(50),
    name VARCHAR(255),
    decimals SMALLINT NOT NULL DEFAULT 6,
    total_supply BIGINT NOT NULL,
    creator_address VARCHAR(64) NOT NULL,
    creation_signature VARCHAR(88),
    creation_slot BIGINT,
    
    -- Bonding curve data
    bonding_curve_key VARCHAR(64),
    initial_virtual_sol_reserves BIGINT,
    initial_virtual_token_reserves BIGINT,
    initial_real_sol_reserves BIGINT,
    initial_real_token_reserves BIGINT,
    
    -- Current state
    current_price_sol DECIMAL(20,12),
    current_price_usd DECIMAL(20,4),
    current_market_cap_usd DECIMAL(20,4),
    current_liquidity_usd DECIMAL(20,4),
    current_holder_count INTEGER DEFAULT 0,
    
    -- Volume metrics
    volume_1h_usd DECIMAL(20,4) DEFAULT 0,
    volume_24h_usd DECIMAL(20,4) DEFAULT 0,
    volume_7d_usd DECIMAL(20,4) DEFAULT 0,
    volume_total_usd DECIMAL(20,4) DEFAULT 0,
    
    -- Trade metrics
    trade_count_1h INTEGER DEFAULT 0,
    trade_count_24h INTEGER DEFAULT 0,
    unique_traders_24h INTEGER DEFAULT 0,
    
    -- Price metrics
    price_change_1h DECIMAL(10,4),
    price_change_24h DECIMAL(10,4),
    price_high_24h DECIMAL(20,12),
    price_low_24h DECIMAL(20,12),
    
    -- Lifecycle
    first_trade_at TIMESTAMP,
    threshold_crossed_at TIMESTAMP,
    graduated_to_amm BOOLEAN DEFAULT FALSE,
    graduation_at TIMESTAMP,
    graduation_signature VARCHAR(88),
    amm_pool_address VARCHAR(64),
    
    -- Metadata
    metadata_uri TEXT,
    image_uri TEXT,
    description TEXT,
    external_url TEXT,
    metadata_fetched_at TIMESTAMP,
    
    -- Tracking
    last_trade_at TIMESTAMP,
    last_price_update_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Complete trades table
CREATE TABLE trades_complete (
    signature VARCHAR(88) PRIMARY KEY,
    instruction_index SMALLINT DEFAULT 0,
    inner_instruction_index SMALLINT,
    
    -- Token info
    mint_address VARCHAR(64) NOT NULL,
    bonding_curve_key VARCHAR(64),
    
    -- Trade data
    program program_type NOT NULL,
    trade_type trade_type NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    
    -- Amounts
    sol_amount BIGINT NOT NULL,
    token_amount BIGINT NOT NULL,
    sol_amount_decimal DECIMAL(20,9),
    token_amount_decimal DECIMAL(20,9),
    
    -- Reserves before trade
    virtual_sol_reserves_before BIGINT,
    virtual_token_reserves_before BIGINT,
    real_sol_reserves_before BIGINT,
    real_token_reserves_before BIGINT,
    
    -- Reserves after trade
    virtual_sol_reserves_after BIGINT,
    virtual_token_reserves_after BIGINT,
    real_sol_reserves_after BIGINT,
    real_token_reserves_after BIGINT,
    
    -- Pricing
    price_sol DECIMAL(20,12) NOT NULL,
    price_usd DECIMAL(20,4) NOT NULL,
    market_cap_usd DECIMAL(20,4) NOT NULL,
    price_impact_percent DECIMAL(10,6),
    
    -- Execution details
    compute_units INTEGER,
    priority_fee_lamports BIGINT,
    total_fee_lamports BIGINT,
    
    -- Progress tracking
    bonding_curve_progress DECIMAL(5,2),
    is_migration BOOLEAN DEFAULT FALSE,
    
    -- Blockchain data
    slot BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    
    -- Indexing
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Holder tracking table
CREATE TABLE holder_balances (
    mint_address VARCHAR(64),
    holder_address VARCHAR(64),
    balance BIGINT NOT NULL DEFAULT 0,
    last_updated_slot BIGINT,
    last_updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (mint_address, holder_address)
);

-- Price history table (for charts)
CREATE TABLE price_history (
    mint_address VARCHAR(64),
    timestamp TIMESTAMP,
    price_sol DECIMAL(20,12),
    price_usd DECIMAL(20,4),
    volume_usd DECIMAL(20,4),
    liquidity_usd DECIMAL(20,4),
    market_cap_usd DECIMAL(20,4),
    PRIMARY KEY (mint_address, timestamp)
);

-- Create hypertable for time-series data (if using TimescaleDB)
-- SELECT create_hypertable('price_history', 'timestamp');
```

## 6. Implementation Priority

### Phase 1: Core Data Extraction (Week 1)
1. Add IDL-based parsing alongside raw parsing
2. Extract creator, real reserves, token supply
3. Parse transaction metadata (balances, inner instructions)
4. Store complete data in enhanced schema

### Phase 2: Real-time Aggregation (Week 2)
1. Implement volume aggregation pipeline
2. Add holder tracking via balance changes
3. Build price history tracking
4. Create materialized views for performance

### Phase 3: Advanced Analytics (Week 3)
1. Add anomaly detection
2. Implement MEV detection
3. Calculate price impact and slippage
4. Build liquidity depth tracking

### Phase 4: Historical Recovery (Week 4)
1. Backfill missing historical data
2. Reconcile inconsistencies
3. Build data quality monitoring
4. Implement continuous validation

## 7. Performance Considerations

### A. Optimized Data Pipeline
```typescript
class OptimizedDataPipeline {
  constructor() {
    // Use worker threads for CPU-intensive parsing
    this.parserPool = new WorkerPool('./parser-worker.js', 4);
    
    // Batch writes with write-ahead log
    this.writeBuffer = new WriteAheadLog();
    
    // In-memory cache for hot data
    this.cache = new LRUCache({ max: 10000 });
    
    // Separate queues by priority
    this.queues = {
      critical: new PriorityQueue(),  // Trades, prices
      normal: new Queue(),            // Metadata, aggregates
      low: new Queue()               // Historical backfill
    };
  }
}
```

### B. Database Optimizations
```sql
-- Partitioning for scale
CREATE TABLE trades_complete_2024_01 PARTITION OF trades_complete
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Optimal indexes
CREATE INDEX idx_trades_mint_time ON trades_complete(mint_address, block_time DESC);
CREATE INDEX idx_trades_user ON trades_complete(user_address, block_time DESC);
CREATE INDEX idx_tokens_volume ON tokens_complete(volume_24h_usd DESC);
CREATE INDEX idx_holders_balance ON holder_balances(mint_address, balance DESC);

-- Materialized views for common queries
CREATE MATERIALIZED VIEW top_tokens_24h AS
SELECT 
    mint_address,
    current_price_usd,
    current_market_cap_usd,
    volume_24h_usd,
    trade_count_24h,
    price_change_24h
FROM tokens_complete
WHERE volume_24h_usd > 0
ORDER BY volume_24h_usd DESC;
```

## Conclusion

To capture 100% of pump.fun data:

1. **Use dual parsing** (raw + IDL) for complete event extraction
2. **Parse all metadata** from transactions (balances, inner instructions, fees)
3. **Monitor all related accounts** (BC, mint, pool, vaults, metadata)
4. **Implement real-time aggregation** for volumes, holders, and prices
5. **Build recovery systems** for historical data and missed events
6. **Optimize for performance** with proper indexing and caching

This comprehensive approach ensures no data is missed while maintaining system performance.