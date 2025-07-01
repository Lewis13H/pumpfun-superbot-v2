# Basic Implementation Plan - Complete Data Capture for Pump.fun

## Overview
This document combines the complete data capture strategy with phased implementation, starting with a basic version that can be enhanced over time. The goal is to capture 100% of available pump.fun data while maintaining system stability and performance.

## Current State Analysis

### What We Have Working
- ✅ BC Monitor capturing ~95% of trades
- ✅ AMM Monitor capturing trades
- ✅ Basic price calculations
- ✅ Database saving for tokens > $8,888
- ✅ Event-driven architecture with DI

### What We're Missing (Priority Order)
1. **Creator addresses** - Available but not extracted
2. **Real reserves** - Only tracking virtual reserves  
3. **Token decimals** - Hardcoded to 6
4. **Transaction metadata** - Compute units, fees, balance changes
5. **Volume aggregations** - No 24h rollups
6. **Holder tracking** - No holder counts
7. **Complete account states** - Missing some fields

## Phase 1: Core Data Extraction Enhancement (Days 1-3)
**Goal**: Capture all available fields from events without breaking existing functionality.

### 1.1 Enhanced Event Parser

First, let's add the missing fields to our existing parsers:

```typescript
// src/parsers/enhanced-bc-parser.ts
export interface CompleteBCTradeEvent {
  // Existing fields
  signature: string;
  mintAddress: string;
  tradeType: 'buy' | 'sell';
  userAddress: string;
  solAmount: bigint;
  tokenAmount: bigint;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  
  // NEW fields to extract
  creator: string;              // Token creator address
  realSolReserves: bigint;      // Actual SOL in bonding curve
  realTokenReserves: bigint;    // Actual tokens in bonding curve
  bondingCurveKey: string;      // Already extracted but ensure it's saved
  tokenSupply: bigint;          // Total token supply
  complete: boolean;            // Graduation flag
}

// Update the parser
export class EnhancedBCEventParser {
  parse(data: Buffer, logs: string[]): CompleteBCTradeEvent | null {
    // Keep existing 225-byte and 113-byte parsing
    const baseEvent = this.parseRawEvent(data);
    
    // Extract additional fields from logs
    const creator = this.extractCreator(logs);
    const realReserves = this.extractRealReserves(logs);
    
    return {
      ...baseEvent,
      creator,
      realSolReserves: realReserves.sol,
      realTokenReserves: realReserves.token,
      tokenSupply: BigInt(1000000000) * BigInt(10**6), // 1B tokens default
      complete: this.checkIfComplete(logs),
    };
  }
  
  private extractCreator(logs: string[]): string {
    // Look for creator in logs
    const creatorLog = logs.find(log => log.includes('creator:'));
    if (creatorLog) {
      const match = creatorLog.match(/creator: (\w+)/);
      return match ? match[1] : '';
    }
    return '';
  }
}
```

### 1.2 Database Schema Updates

```sql
-- Add missing columns gradually to avoid breaking changes
ALTER TABLE trades_unified 
ADD COLUMN IF NOT EXISTS creator_address VARCHAR(64),
ADD COLUMN IF NOT EXISTS real_sol_reserves BIGINT,
ADD COLUMN IF NOT EXISTS real_token_reserves BIGINT,
ADD COLUMN IF NOT EXISTS is_migration BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS compute_units INTEGER,
ADD COLUMN IF NOT EXISTS priority_fee BIGINT;

ALTER TABLE tokens_unified
ADD COLUMN IF NOT EXISTS creator_address VARCHAR(64),
ADD COLUMN IF NOT EXISTS token_decimals SMALLINT DEFAULT 6,
ADD COLUMN IF NOT EXISTS total_supply BIGINT,
ADD COLUMN IF NOT EXISTS latest_price_sol DECIMAL(20,12),
ADD COLUMN IF NOT EXISTS latest_price_usd DECIMAL(20,4),
ADD COLUMN IF NOT EXISTS latest_market_cap_usd DECIMAL(20,4),
ADD COLUMN IF NOT EXISTS volume_24h_usd DECIMAL(20,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS trade_count_24h INTEGER DEFAULT 0;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_trades_creator ON trades_unified(creator_address);
CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens_unified(creator_address);
CREATE INDEX IF NOT EXISTS idx_tokens_volume ON tokens_unified(volume_24h_usd DESC);
```

### 1.3 Update Monitors to Save New Fields

```typescript
// src/monitors/bc-monitor.ts - Update processStreamData method
async processStreamData(data: any): Promise<void> {
  // ... existing parsing logic ...
  
  if (parsedEvent) {
    // Add new fields to trade data
    const enhancedTrade = {
      ...parsedEvent,
      creator_address: parsedEvent.creator || null,
      real_sol_reserves: parsedEvent.realSolReserves?.toString() || null,
      real_token_reserves: parsedEvent.realTokenReserves?.toString() || null,
      is_migration: parsedEvent.complete || false,
    };
    
    // Process with enhanced data
    await this.dbService.processTrade(enhancedTrade);
    
    // Update token record with creator
    if (enhancedTrade.creator_address) {
      await this.dbService.updateToken(parsedEvent.mintAddress, {
        creator_address: enhancedTrade.creator_address
      });
    }
  }
}
```

### Deliverables
- ✅ All event fields captured
- ✅ Database schema updated
- ✅ Backward compatible implementation

---

## Phase 2: Transaction Metadata Extraction (Days 4-5)
**Goal**: Extract compute units, fees, and balance changes for complete transaction visibility.

### 2.1 Metadata Extractor Service

```typescript
// src/services/transaction-metadata-extractor.ts
export interface TransactionMetadata {
  computeUnits: number;
  priorityFee: bigint;
  totalFee: bigint;
  balanceChanges: BalanceChange[];
  innerInstructions: any[];
  signer: string;
  success: boolean;
}

export class TransactionMetadataExtractor {
  extract(transaction: any): TransactionMetadata {
    const meta = transaction.meta;
    
    return {
      // Compute units for MEV detection
      computeUnits: meta.computeUnitsConsumed || 0,
      
      // Fee calculation
      priorityFee: this.calculatePriorityFee(meta),
      totalFee: BigInt(meta.fee || 0),
      
      // Balance changes for holder tracking
      balanceChanges: this.extractBalanceChanges(
        meta.preTokenBalances || [],
        meta.postTokenBalances || []
      ),
      
      // Inner instructions for complete flow
      innerInstructions: meta.innerInstructions || [],
      
      // Transaction signer
      signer: this.extractSigner(transaction),
      
      // Success status
      success: meta.err === null,
    };
  }
  
  private extractBalanceChanges(
    preBalances: any[], 
    postBalances: any[]
  ): BalanceChange[] {
    const changes: BalanceChange[] = [];
    
    // Map post balances by account+mint
    const postMap = new Map();
    postBalances.forEach(balance => {
      const key = `${balance.accountIndex}-${balance.mint}`;
      postMap.set(key, balance);
    });
    
    // Calculate changes
    preBalances.forEach(preBalance => {
      const key = `${preBalance.accountIndex}-${preBalance.mint}`;
      const postBalance = postMap.get(key);
      
      if (postBalance) {
        const change = BigInt(postBalance.uiTokenAmount.amount) - 
                      BigInt(preBalance.uiTokenAmount.amount);
        
        if (change !== 0n) {
          changes.push({
            mint: preBalance.mint,
            owner: preBalance.owner,
            change,
            decimals: preBalance.uiTokenAmount.decimals,
            accountIndex: preBalance.accountIndex,
          });
        }
      }
    });
    
    return changes;
  }
}
```

### 2.2 Update Stream Processing

```typescript
// Update base-monitor.ts to extract metadata
protected async processTransaction(data: any): Promise<void> {
  const tx = data.transaction?.transaction;
  if (!tx) return;
  
  // Extract metadata
  const metadata = this.metadataExtractor.extract(data.transaction);
  
  // Parse trade event
  const trade = await this.parseTradeEvent(data);
  
  if (trade) {
    // Enhance trade with metadata
    const enhancedTrade = {
      ...trade,
      compute_units: metadata.computeUnits,
      priority_fee: metadata.priorityFee.toString(),
      signer: metadata.signer,
      
      // Track token decimals from balance changes
      token_decimals: this.getTokenDecimals(
        trade.mintAddress, 
        metadata.balanceChanges
      ),
    };
    
    // Process enhanced trade
    await this.processTrade(enhancedTrade);
    
    // Update holder tracking
    await this.updateHolders(trade.mintAddress, metadata.balanceChanges);
  }
}
```

### Deliverables
- ✅ Complete transaction metadata extraction
- ✅ MEV detection capability via fees
- ✅ Holder tracking via balance changes

---

## Phase 3: Real-time Aggregations (Days 6-7)
**Goal**: Implement efficient volume and metric aggregations without impacting performance.

### 3.1 Aggregation Service

```typescript
// src/services/aggregation-service.ts
export class AggregationService {
  private aggregationBuffer = new Map<string, TokenAggregates>();
  private flushInterval = 5000; // 5 seconds
  
  constructor(
    private dbService: DatabaseService,
    private redis: Redis,
  ) {
    setInterval(() => this.flush(), this.flushInterval);
  }
  
  async addTrade(trade: Trade): Promise<void> {
    const mint = trade.mintAddress;
    
    if (!this.aggregationBuffer.has(mint)) {
      this.aggregationBuffer.set(mint, {
        volume24h: 0,
        tradeCount24h: 0,
        uniqueTraders24h: new Set(),
        lastPrice: 0,
        highPrice24h: 0,
        lowPrice24h: Infinity,
      });
    }
    
    const agg = this.aggregationBuffer.get(mint)!;
    
    // Update aggregates
    agg.volume24h += Number(trade.volumeUsd);
    agg.tradeCount24h += 1;
    agg.uniqueTraders24h.add(trade.userAddress);
    agg.lastPrice = Number(trade.priceUsd);
    agg.highPrice24h = Math.max(agg.highPrice24h, Number(trade.priceUsd));
    agg.lowPrice24h = Math.min(agg.lowPrice24h, Number(trade.priceUsd));
    
    // Update Redis for real-time access
    await this.updateRedisMetrics(mint, trade);
  }
  
  private async flush(): Promise<void> {
    if (this.aggregationBuffer.size === 0) return;
    
    const updates = [];
    
    for (const [mint, agg] of this.aggregationBuffer) {
      updates.push({
        mint_address: mint,
        volume_24h_usd: agg.volume24h,
        trade_count_24h: agg.tradeCount24h,
        unique_traders_24h: agg.uniqueTraders24h.size,
        latest_price_usd: agg.lastPrice,
        high_24h: agg.highPrice24h,
        low_24h: agg.lowPrice24h === Infinity ? agg.lastPrice : agg.lowPrice24h,
      });
    }
    
    // Batch update database
    await this.dbService.batchUpdateTokenMetrics(updates);
    
    // Clear buffer
    this.aggregationBuffer.clear();
  }
}
```

### 3.2 Simple Volume Tracking Table

```sql
-- Simple volume tracking without complex time-series
CREATE TABLE IF NOT EXISTS volume_snapshots (
  mint_address VARCHAR(64),
  snapshot_time TIMESTAMP,
  volume_5m DECIMAL(20,4),
  volume_1h DECIMAL(20,4),
  volume_24h DECIMAL(20,4),
  trade_count INTEGER,
  unique_traders INTEGER,
  PRIMARY KEY (mint_address, snapshot_time)
);

-- Index for efficient queries
CREATE INDEX idx_volume_time ON volume_snapshots(snapshot_time DESC);

-- Cleanup old data (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_snapshots() RETURNS void AS $$
BEGIN
  DELETE FROM volume_snapshots WHERE snapshot_time < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
```

### Deliverables
- ✅ Real-time volume aggregation
- ✅ 24h metrics tracking
- ✅ Efficient batch updates

---

## Phase 4: Enhanced Account Monitoring (Days 8-9)
**Goal**: Extract all available data from account updates.

### 4.1 Complete Account Decoders

```typescript
// src/decoders/complete-account-decoders.ts
export class CompleteAccountDecoders {
  // Decode ALL bonding curve fields
  decodeBondingCurve(data: Buffer): CompleteBondingCurve {
    // Skip discriminator (8 bytes)
    const accountData = data.slice(8);
    
    const decoded = BONDING_CURVE_SCHEMA.decode(accountData);
    
    return {
      // All fields from the account
      virtualTokenReserves: decoded.virtualTokenReserves,
      virtualSolReserves: decoded.virtualSolReserves,
      realTokenReserves: decoded.realTokenReserves,
      realSolReserves: decoded.realSolReserves,
      tokenTotalSupply: decoded.tokenTotalSupply,
      complete: decoded.complete,
      creator: decoded.creator.toString(),
      
      // Calculated fields
      progress: this.calculateProgress(decoded),
      virtualPrice: this.calculatePrice(
        decoded.virtualSolReserves,
        decoded.virtualTokenReserves
      ),
      realPrice: this.calculatePrice(
        decoded.realSolReserves,
        decoded.realTokenReserves
      ),
    };
  }
  
  private calculateProgress(data: any): number {
    const virtualSol = Number(data.virtualSolReserves) / 1e9;
    // Progress: 30 SOL → 85 SOL = 100%
    return Math.min(100, ((virtualSol - 30) / 55) * 100);
  }
}
```

### 4.2 Update Account Monitors

```typescript
// Update bc-account-monitor.ts
async processStreamData(data: any): Promise<void> {
  const accountData = this.extractAccountData(data);
  if (!accountData) return;
  
  const decoded = this.accountDecoder.decodeBondingCurve(accountData);
  
  // Store complete account state
  await this.dbService.updateBondingCurveState({
    bonding_curve_key: accountPubkey,
    virtual_sol_reserves: decoded.virtualSolReserves,
    virtual_token_reserves: decoded.virtualTokenReserves,
    real_sol_reserves: decoded.realSolReserves,
    real_token_reserves: decoded.realTokenReserves,
    token_supply: decoded.tokenTotalSupply,
    creator: decoded.creator,
    complete: decoded.complete,
    progress: decoded.progress,
    slot: data.slot,
  });
  
  // Check for graduation
  if (decoded.complete || decoded.progress >= 100) {
    this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
      bondingCurveKey: accountPubkey,
      mintAddress: await this.getMintFromBC(accountPubkey),
      ...decoded,
    });
  }
}
```

### Deliverables
- ✅ Complete account state tracking
- ✅ Real reserves monitoring
- ✅ Creator address extraction

---

## Phase 5: Data Quality & Recovery (Days 10-11)
**Goal**: Ensure data completeness and implement recovery mechanisms.

### 5.1 Data Validation Service

```typescript
// src/services/data-validation-service.ts
export class DataValidationService {
  async validateTradeData(trade: Trade): Promise<ValidationResult> {
    const errors: string[] = [];
    
    // Check required fields
    if (!trade.mintAddress) errors.push('Missing mint address');
    if (!trade.signature) errors.push('Missing signature');
    if (!trade.userAddress) errors.push('Missing user address');
    
    // Validate amounts
    if (trade.solAmount <= 0) errors.push('Invalid SOL amount');
    if (trade.tokenAmount <= 0) errors.push('Invalid token amount');
    
    // Validate price calculation
    const calculatedPrice = Number(trade.solAmount) / Number(trade.tokenAmount);
    const reportedPrice = Number(trade.priceSol);
    const priceDiff = Math.abs(calculatedPrice - reportedPrice) / reportedPrice;
    
    if (priceDiff > 0.01) { // 1% tolerance
      errors.push(`Price mismatch: calculated ${calculatedPrice} vs reported ${reportedPrice}`);
    }
    
    // Validate reserves if available
    if (trade.virtualSolReserves && trade.virtualTokenReserves) {
      const k1 = trade.virtualSolReserves * trade.virtualTokenReserves;
      // Check constant product after trade
      const k2 = (trade.virtualSolReserves + trade.solAmount) * 
                 (trade.virtualTokenReserves - trade.tokenAmount);
      
      if (Math.abs(Number(k1 - k2)) / Number(k1) > 0.001) {
        errors.push('Constant product validation failed');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      trade,
    };
  }
}
```

### 5.2 Simple Recovery Mechanism

```typescript
// src/services/recovery-service.ts
export class RecoveryService {
  async recoverMissingData(mintAddress: string): Promise<void> {
    // 1. Check what data we have
    const token = await this.dbService.getToken(mintAddress);
    
    if (!token) {
      console.log(`Token ${mintAddress} not found`);
      return;
    }
    
    // 2. Identify missing fields
    const missingFields = [];
    if (!token.creator_address) missingFields.push('creator');
    if (!token.token_decimals || token.token_decimals === 6) missingFields.push('decimals');
    if (!token.total_supply) missingFields.push('supply');
    
    if (missingFields.length === 0) return;
    
    console.log(`Recovering ${missingFields.join(', ')} for ${mintAddress}`);
    
    // 3. Try to get data from recent trades
    const recentTrades = await this.dbService.getRecentTrades(mintAddress, 100);
    
    for (const trade of recentTrades) {
      if (trade.creator_address && !token.creator_address) {
        await this.dbService.updateToken(mintAddress, {
          creator_address: trade.creator_address
        });
        token.creator_address = trade.creator_address;
      }
    }
    
    // 4. If still missing, try RPC
    if (missingFields.includes('decimals') || missingFields.includes('supply')) {
      try {
        const mintInfo = await this.rpcService.getMintInfo(mintAddress);
        
        await this.dbService.updateToken(mintAddress, {
          token_decimals: mintInfo.decimals,
          total_supply: mintInfo.supply.toString(),
        });
      } catch (error) {
        console.error(`Failed to get mint info for ${mintAddress}:`, error);
      }
    }
  }
}
```

### Deliverables
- ✅ Data validation pipeline
- ✅ Automatic recovery for missing fields
- ✅ Data quality metrics

---

## Phase 6: Simple Dashboard Enhancements (Days 12-13)
**Goal**: Display the newly captured data in the existing dashboard.

### 6.1 API Updates

```typescript
// src/api/enhanced-endpoints.ts
router.get('/api/tokens/:mint/complete', async (req, res) => {
  const { mint } = req.params;
  
  // Get complete token data
  const token = await dbService.query(`
    SELECT 
      t.*,
      COUNT(DISTINCT tr.user_address) as unique_traders_24h,
      MAX(tr.price_usd) as high_24h,
      MIN(tr.price_usd) as low_24h,
      COUNT(tr.signature) as trade_count_24h
    FROM tokens_unified t
    LEFT JOIN trades_unified tr ON t.mint_address = tr.mint_address 
      AND tr.block_time > NOW() - INTERVAL '24 hours'
    WHERE t.mint_address = $1
    GROUP BY t.mint_address
  `, [mint]);
  
  res.json(token);
});

router.get('/api/tokens/by-creator/:creator', async (req, res) => {
  const { creator } = req.params;
  
  const tokens = await dbService.query(`
    SELECT * FROM tokens_unified 
    WHERE creator_address = $1 
    ORDER BY created_at DESC
  `, [creator]);
  
  res.json(tokens);
});
```

### 6.2 Dashboard Display Updates

```javascript
// Update dashboard to show new fields
function displayTokenInfo(token) {
  return `
    <div class="token-info">
      <h3>${token.symbol || 'Unknown'} - ${token.name || 'Unknown'}</h3>
      <p>Mint: ${token.mint_address}</p>
      <p>Creator: ${token.creator_address || 'Unknown'}</p>
      <p>Decimals: ${token.token_decimals || 6}</p>
      <p>Supply: ${formatNumber(token.total_supply / Math.pow(10, token.token_decimals))}</p>
      
      <div class="metrics">
        <div>Price: $${token.latest_price_usd || 0}</div>
        <div>24h Volume: $${formatNumber(token.volume_24h_usd || 0)}</div>
        <div>24h Trades: ${token.trade_count_24h || 0}</div>
        <div>24h Change: ${token.price_change_24h || 0}%</div>
      </div>
      
      ${token.graduated_to_amm ? '<span class="graduated">Graduated ✓</span>' : ''}
    </div>
  `;
}
```

### Deliverables
- ✅ API endpoints for complete data
- ✅ Dashboard showing all captured fields
- ✅ Creator portfolio view

---

## Testing & Validation Checklist

### Phase 1 Testing
- [ ] Verify creator address extraction
- [ ] Confirm real reserves are captured
- [ ] Check database fields are populated
- [ ] Ensure backward compatibility

### Phase 2 Testing  
- [ ] Validate compute units extraction
- [ ] Verify fee calculations
- [ ] Test balance change tracking
- [ ] Confirm holder counts update

### Phase 3 Testing
- [ ] Check 24h volume accuracy
- [ ] Verify aggregation performance
- [ ] Test Redis cache updates
- [ ] Validate metric calculations

### Phase 4 Testing
- [ ] Confirm complete account decoding
- [ ] Test graduation detection
- [ ] Verify progress calculations
- [ ] Check creator extraction from accounts

### Phase 5 Testing
- [ ] Run data validation on sample
- [ ] Test recovery mechanisms
- [ ] Verify data completeness
- [ ] Check for missing fields

### Phase 6 Testing
- [ ] Test new API endpoints
- [ ] Verify dashboard displays
- [ ] Check performance impact
- [ ] Validate data accuracy

## Migration Commands

```bash
# Phase 1 - Database migration
psql $DATABASE_URL -f migrations/phase1_add_fields.sql

# Phase 2 - Deploy enhanced parsers
npm run build
pm2 restart bc-monitor

# Phase 3 - Start aggregation service
pm2 start dist/services/aggregation-service.js --name aggregator

# Phase 4 - Update account monitors
pm2 restart bc-account-monitor

# Phase 5 - Run recovery
npm run recover:missing-data

# Phase 6 - Deploy API updates
pm2 restart api-server
```

## Success Metrics

### Data Completeness
- ✅ 100% of trade events have creator address
- ✅ Real reserves tracked for all trades
- ✅ Token decimals detected correctly
- ✅ 24h volumes calculated accurately

### Performance Targets
- ✅ No increase in processing latency
- ✅ Database writes remain under 100ms
- ✅ API responses under 200ms
- ✅ Dashboard loads in < 2 seconds

### Data Quality
- ✅ < 0.1% validation errors
- ✅ 99.9% data recovery success
- ✅ No missing required fields
- ✅ Accurate price calculations

## Next Steps After Basic Implementation

1. **Performance Optimization**
   - Implement TimescaleDB for time-series
   - Add Redis caching layer
   - Optimize database queries

2. **Advanced Analytics**
   - ML-based predictions
   - Anomaly detection
   - Trading signals

3. **Scale Infrastructure**
   - Kubernetes deployment
   - Multi-region setup
   - CDN integration

This basic implementation captures 100% of available data while maintaining system stability and can be enhanced incrementally based on needs.