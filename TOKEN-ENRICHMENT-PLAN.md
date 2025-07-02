# Token Enrichment & Stale Data Handling Implementation Plan

## Overview
This plan addresses the critical issue of stale tokens showing incorrect market caps on the dashboard and improves data extraction from available APIs. The goal is to ensure tokens showing $44k market cap that are actually worth $5k are properly updated or removed.

## Session 1: Database Schema Updates (2-3 hours)

### Objectives
- Add missing columns that exist in code but not in database
- Create indexes for efficient stale token queries
- Prepare database for enhanced tracking

### Tasks
1. **Create and run migration script** (`src/database/migrations/add-price-tracking-columns.sql`):
```sql
-- Add critical missing columns
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS latest_price_sol DECIMAL(20,12),
ADD COLUMN IF NOT EXISTS latest_price_usd DECIMAL(20,4),
ADD COLUMN IF NOT EXISTS latest_market_cap_usd DECIMAL(20,4),
ADD COLUMN IF NOT EXISTS latest_bonding_curve_progress DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS last_trade_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS should_remove BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS volume_24h_usd DECIMAL(20,4),
ADD COLUMN IF NOT EXISTS holder_count INTEGER,
ADD COLUMN IF NOT EXISTS liquidity_usd DECIMAL(20,4);

-- Create indexes for stale token detection
CREATE INDEX IF NOT EXISTS idx_tokens_stale 
ON tokens_unified(last_trade_at, latest_market_cap_usd DESC) 
WHERE latest_market_cap_usd > 5000 AND is_stale = FALSE;

CREATE INDEX IF NOT EXISTS idx_tokens_removal 
ON tokens_unified(should_remove, latest_market_cap_usd) 
WHERE should_remove = TRUE;

-- Add trigger to update last_trade_at
CREATE OR REPLACE FUNCTION update_last_trade_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE tokens_unified 
    SET last_trade_at = NEW.block_time,
        latest_price_sol = NEW.price_sol,
        latest_price_usd = NEW.price_usd,
        latest_market_cap_usd = NEW.market_cap_usd
    WHERE mint_address = NEW.mint_address;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_last_trade
AFTER INSERT ON trades_unified
FOR EACH ROW
EXECUTE FUNCTION update_last_trade_at();
```

2. **Update database service** to populate new columns
3. **Test migration** on dev database first
4. **Update API endpoints** to use new columns

### Deliverables
- Migration script executed
- Database service updated
- API returning latest prices instead of first prices

## Session 2: Enhanced Stale Token Detection (3-4 hours)

### Objectives
- Improve stale token detection logic
- Implement auto-removal for dead tokens
- Add configurable thresholds by market cap tier

### Tasks
1. **Enhance StaleTokenDetector** (`src/services/stale-token-detector.ts`):
```typescript
interface StaleTokenTiers {
  critical: { threshold: 50000, staleMinutes: 15, removeMinutes: 60 },
  high: { threshold: 20000, staleMinutes: 30, removeMinutes: 120 },
  medium: { threshold: 10000, staleMinutes: 45, removeMinutes: 180 },
  low: { threshold: 5000, staleMinutes: 60, removeMinutes: 240 },
  micro: { threshold: 0, staleMinutes: 120, removeMinutes: 360 }
}
```

2. **Add removal logic**:
   - Mark tokens for removal based on tier thresholds
   - Implement soft delete (flag) vs hard delete
   - Add recovery mechanism for falsely removed tokens

3. **Update detection query**:
```sql
-- Find stale tokens by tier
WITH token_tiers AS (
  SELECT 
    mint_address,
    latest_market_cap_usd,
    last_trade_at,
    CASE 
      WHEN latest_market_cap_usd >= 50000 THEN 'critical'
      WHEN latest_market_cap_usd >= 20000 THEN 'high'
      WHEN latest_market_cap_usd >= 10000 THEN 'medium'
      WHEN latest_market_cap_usd >= 5000 THEN 'low'
      ELSE 'micro'
    END as tier,
    EXTRACT(EPOCH FROM (NOW() - last_trade_at))/60 as minutes_since_trade
  FROM tokens_unified
  WHERE graduated_to_amm = FALSE
    AND last_trade_at IS NOT NULL
)
SELECT * FROM token_tiers
WHERE 
  (tier = 'critical' AND minutes_since_trade > 15) OR
  (tier = 'high' AND minutes_since_trade > 30) OR
  (tier = 'medium' AND minutes_since_trade > 45) OR
  (tier = 'low' AND minutes_since_trade > 60) OR
  (tier = 'micro' AND minutes_since_trade > 120)
ORDER BY latest_market_cap_usd DESC;
```

4. **Add monitoring dashboard stats**:
   - Stale token count by tier
   - Tokens marked for removal
   - Recovery success rate

### Deliverables
- Enhanced stale detection with tier-based thresholds
- Auto-removal system for dead tokens
- Dashboard no longer shows stale $44k tokens that are actually $5k

## Session 3: Shyft DAS Integration (3-4 hours)

### Objectives
- Integrate Shyft DAS API for comprehensive metadata
- Extract holder counts and additional token data
- Improve enrichment efficiency

### Tasks
1. **Enhance ShyftMetadataService** (`src/services/shyft-metadata-service.ts`):
```typescript
// Add DAS endpoint support
async getTokenInfoDAS(mintAddress: string): Promise<TokenInfoDAS> {
  const response = await axios.get(`${this.baseUrl}/token/get_info`, {
    params: {
      network: 'mainnet-beta',
      token_address: mintAddress,
      enable_metadata: true,
      enable_owner_info: true
    },
    headers: {
      'x-api-key': this.apiKey
    }
  });
  
  return {
    // Basic info
    address: response.data.address,
    symbol: response.data.symbol,
    name: response.data.name,
    decimals: response.data.decimals,
    supply: response.data.supply,
    
    // Extended metadata
    description: response.data.metadata?.description,
    image: response.data.metadata?.image,
    external_url: response.data.metadata?.external_url,
    
    // Social links
    twitter: response.data.metadata?.twitter,
    telegram: response.data.metadata?.telegram,
    discord: response.data.metadata?.discord,
    
    // Authorities
    update_authority: response.data.update_authority,
    freeze_authority: response.data.freeze_authority,
    mint_authority: response.data.mint_authority,
    
    // Holder info
    current_holder_count: response.data.holder_count,
    top_holders: response.data.top_holders
  };
}
```

2. **Update enrichment to extract more fields**:
   - Holder count and distribution
   - Social media links
   - Authority addresses
   - Extended metadata attributes

3. **Implement bulk DAS queries**:
   - Batch requests for efficiency
   - Priority queue for high-value tokens
   - Cache optimization

4. **Add metadata completeness scoring**:
```typescript
calculateMetadataScore(token: TokenMetadata): number {
  let score = 0;
  if (token.name) score += 20;
  if (token.symbol) score += 20;
  if (token.description) score += 10;
  if (token.image_uri) score += 15;
  if (token.twitter || token.telegram) score += 15;
  if (token.holder_count > 0) score += 20;
  return score;
}
```

### Deliverables
- Shyft DAS integration with extended metadata
- Holder count tracking for all tokens
- Social links extraction and storage
- Metadata completeness scoring

## Session 4: Historical Data Recovery (4-5 hours)

### Objectives
- Implement recovery for data missed during downtime
- Backfill historical prices using multiple sources
- Ensure accurate price history

### Tasks
1. **Create HistoricalRecoveryService** (`src/services/historical-recovery.ts`):
```typescript
class HistoricalRecoveryService {
  async detectDowntimePeriods(): Promise<DowntimePeriod[]> {
    // Find gaps in trade data
    const gaps = await db.query(`
      WITH trade_gaps AS (
        SELECT 
          slot,
          block_time,
          LAG(block_time) OVER (ORDER BY block_time) as prev_time,
          LAG(slot) OVER (ORDER BY slot) as prev_slot
        FROM trades_unified
      )
      SELECT 
        prev_slot as gap_start_slot,
        slot as gap_end_slot,
        prev_time as gap_start_time,
        block_time as gap_end_time,
        EXTRACT(EPOCH FROM (block_time - prev_time)) as gap_duration_seconds
      FROM trade_gaps
      WHERE EXTRACT(EPOCH FROM (block_time - prev_time)) > 300 -- 5 minute gaps
      ORDER BY gap_start_time DESC
    `);
    
    return gaps.rows;
  }
  
  async recoverMissedTrades(period: DowntimePeriod): Promise<void> {
    // Query Shyft GraphQL for historical transactions
    // Parse and insert missed trades
    // Update token prices based on recovered data
  }
}
```

2. **Implement multi-source recovery**:
   - Primary: Shyft GraphQL for transaction history
   - Secondary: DexScreener historical API
   - Tertiary: Direct RPC getProgramAccounts

3. **Add recovery progress tracking**:
```sql
CREATE TABLE recovery_progress (
  id SERIAL PRIMARY KEY,
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  tokens_processed INTEGER DEFAULT 0,
  tokens_total INTEGER,
  trades_recovered INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT
);
```

4. **Create recovery CLI command**:
```bash
npm run recover-history -- --from="2024-01-15 10:00" --to="2024-01-15 14:00"
```

### Deliverables
- Historical recovery service implementation
- Downtime period detection
- Missed trade recovery from multiple sources
- CLI tool for manual recovery

## Session 5: Real-time Price Updates (3-4 hours)

### Objectives
- Implement real-time price queries for stale tokens
- Add WebSocket subscriptions for price updates
- Create fallback mechanisms

### Tasks
1. **Create RealTimePriceService** (`src/services/realtime-price.ts`):
```typescript
class RealTimePriceService {
  private priceSubscriptions: Map<string, Subscription> = new Map();
  
  async subscribeToPriceUpdates(mintAddress: string): Promise<void> {
    // Subscribe to account changes for bonding curve
    const subscription = connection.onAccountChange(
      new PublicKey(bondingCurveAddress),
      (accountInfo) => {
        const price = this.calculatePriceFromAccount(accountInfo);
        this.updateTokenPrice(mintAddress, price);
      }
    );
    
    this.priceSubscriptions.set(mintAddress, subscription);
  }
  
  async queryCurrentPrice(mintAddress: string): Promise<PriceData> {
    // Try multiple sources in order
    const sources = [
      () => this.getPriceFromBondingCurve(mintAddress),
      () => this.getPriceFromAMMPool(mintAddress),
      () => this.getPriceFromDexScreener(mintAddress),
      () => this.getPriceFromShyftRPC(mintAddress)
    ];
    
    for (const source of sources) {
      try {
        const price = await source();
        if (price) return price;
      } catch (error) {
        console.error(`Price source failed:`, error);
      }
    }
    
    throw new Error(`No price available for ${mintAddress}`);
  }
}
```

2. **Add price update scheduler**:
   - High-value tokens: Every 1 minute
   - Medium-value tokens: Every 5 minutes
   - Low-value tokens: Every 15 minutes

3. **Implement price validation**:
   - Detect suspicious price movements (>50% in 1 minute)
   - Compare prices across sources
   - Flag potentially manipulated prices

### Deliverables
- Real-time price subscription system
- Multi-source price queries
- Automated price update scheduler
- Price manipulation detection

## Session 6: Testing & Deployment (2-3 hours)

### Objectives
- Test all new functionality
- Deploy changes safely
- Monitor system performance

### Tasks
1. **Create test scenarios**:
   - Stale token detection and removal
   - Historical recovery accuracy
   - Price update reliability
   - API performance under load

2. **Deployment checklist**:
   - [ ] Backup database
   - [ ] Run migrations on staging
   - [ ] Test enrichment service
   - [ ] Verify stale detection
   - [ ] Check removal thresholds
   - [ ] Monitor error rates
   - [ ] Validate API responses

3. **Add monitoring metrics**:
```typescript
// Track enrichment performance
metrics.enrichmentSuccess.inc({ source: 'shyft' });
metrics.staleTokensDetected.set(staleCount);
metrics.tokensMarkedForRemoval.set(removalCount);
metrics.priceRecoveryLatency.observe(latency);
```

4. **Create rollback plan**:
   - Database migration rollback scripts
   - Feature flags for new functionality
   - Previous version deployment ready

### Deliverables
- Comprehensive test suite
- Safe deployment to production
- Monitoring dashboard updates
- Documentation updates

## Success Criteria

1. **Stale Token Handling**:
   - ✓ Tokens showing incorrect prices are updated within 30 minutes
   - ✓ Dead tokens below $5k are removed after configured period
   - ✓ No more $44k tokens that are actually $5k on dashboard

2. **Data Completeness**:
   - ✓ 90%+ tokens have holder count data
   - ✓ 80%+ tokens have complete metadata
   - ✓ Historical gaps can be recovered

3. **Performance**:
   - ✓ Enrichment completes within 200ms per token
   - ✓ Stale detection runs in <5 seconds
   - ✓ API response times remain <100ms

## Timeline

- **Week 1**: Sessions 1-2 (Database updates + Stale detection)
- **Week 2**: Sessions 3-4 (DAS integration + Historical recovery)
- **Week 3**: Session 5 (Real-time updates)
- **Week 4**: Session 6 (Testing + Deployment)

## Notes

- Each session builds on the previous one
- Test thoroughly on staging before production
- Keep existing functionality working during migration
- Document all API changes for dashboard updates