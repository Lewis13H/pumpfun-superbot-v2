/**
 * Unified Database Service V2
 * High-performance service using mint addresses as primary keys
 * Supports both pump.fun and pump.swap programs with efficient batching
 */

import { db } from '../database';
import { EnhancedAutoEnricher } from '../services/metadata/enhanced-auto-enricher';

export interface UnifiedTokenData {
  mintAddress: string;
  symbol?: string;
  name?: string;
  uri?: string;
  firstProgram: 'bonding_curve' | 'amm_pool';
  firstSeenSlot: bigint;
  firstPriceSol: number;
  firstPriceUsd?: number;
  firstMarketCapUsd: number;
  tokenCreatedAt?: Date; // Actual blockchain creation time
  creator?: string; // Pump.fun creator address
  totalSupply?: string; // Token total supply
  bondingCurveKey?: string; // Bonding curve address for tracking
}

export interface UnifiedTradeData {
  mintAddress: string;
  signature: string;
  program: 'bonding_curve' | 'amm_pool';
  tradeType: 'buy' | 'sell';
  userAddress: string;
  solAmount: bigint;
  tokenAmount: bigint;
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  virtualSolReserves?: bigint;
  virtualTokenReserves?: bigint;
  bondingCurveProgress?: number;
  bondingCurveKey?: string; // Bonding curve address
  creator?: string; // Creator address (for first trade)
  slot: bigint;
  blockTime: Date;
}

export interface BatchItem {
  type: 'token' | 'trade' | 'price_snapshot' | 'account_state';
  data: any;
}

export class UnifiedDbServiceV2 {
  private static instance: UnifiedDbServiceV2;
  private autoEnricher: EnhancedAutoEnricher;
  
  // Batch processing
  private batchQueue: BatchItem[] = [];
  private batchTimer?: NodeJS.Timeout;
  private readonly BATCH_SIZE = 50; // Reduced for faster processing
  private readonly BATCH_INTERVAL_MS = 250; // 4x faster updates
  
  // In-memory cache for performance
  private tokenCache = new Map<string, {
    tracked: boolean;
    firstSeen: Date;
    thresholdCrossed: boolean;
  }>();
  
  // Statistics
  private stats = {
    tokensTracked: 0,
    tradesProcessed: 0,
    batchesProcessed: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  private constructor() {
    // Initialize auto-enricher
    this.autoEnricher = EnhancedAutoEnricher.getInstance();
    
    this.startBatchProcessor();
    // Refresh cache periodically
    setInterval(() => this.refreshCache(), 60000); // Every minute
  }

  static getInstance(): UnifiedDbServiceV2 {
    if (!UnifiedDbServiceV2.instance) {
      UnifiedDbServiceV2.instance = new UnifiedDbServiceV2();
    }
    return UnifiedDbServiceV2.instance;
  }

  /**
   * Process a new token discovery
   */
  async processTokenDiscovery(token: UnifiedTokenData): Promise<void> {
    // Check if already in cache
    const cached = this.tokenCache.get(token.mintAddress);
    if (cached && cached.tracked) {
      this.stats.cacheHits++;
      return;
    }
    
    this.stats.cacheMisses++;
    
    // Add to batch queue
    this.batchQueue.push({
      type: 'token',
      data: {
        ...token,
        thresholdCrossed: token.firstMarketCapUsd >= 8888
      }
    });
  }

  /**
   * Process a trade event
   */
  async processTrade(trade: UnifiedTradeData): Promise<void> {
    // Different thresholds for different programs
    const threshold = trade.program === 'amm_pool' 
      ? 1000  // Lower threshold for AMM tokens ($1,000)
      : 8888; // Standard threshold for bonding curves
    
    // Only process if market cap >= threshold
    if (trade.marketCapUsd < threshold) return;
    
    // Check cache first
    const cached = this.tokenCache.get(trade.mintAddress);
    
    // For AMM trades, create token if it doesn't exist
    if (trade.program === 'amm_pool' && !cached) {
      // Check if token exists in database
      const exists = await db.query(
        'SELECT 1 FROM tokens_unified WHERE mint_address = $1',
        [trade.mintAddress]
      );
      
      if (exists.rows.length === 0) {
        // Create new AMM token entry
        console.log(`📝 Creating new AMM token: ${trade.mintAddress}`);
        await this.processTokenDiscovery({
          mintAddress: trade.mintAddress,
          symbol: undefined, // Will be enriched later
          name: undefined,
          uri: undefined,
          firstProgram: 'amm_pool',
          firstSeenSlot: trade.slot,
          firstPriceSol: trade.priceSol,
          firstPriceUsd: trade.priceUsd,
          firstMarketCapUsd: trade.marketCapUsd,
          tokenCreatedAt: undefined
        });
        
        // Mark as graduated since it's already on AMM
        await this.markTokenGraduated(trade.mintAddress, trade.slot);
        
        // Trigger automatic enrichment for new AMM tokens
        await this.autoEnricher.enrichTokenOnThreshold(trade.mintAddress, trade.marketCapUsd);
      }
    }
    
    if (!cached || !cached.thresholdCrossed) {
      // Token might have just crossed threshold
      await this.checkAndUpdateThreshold(trade);
    }
    
    // Add trade to batch
    this.batchQueue.push({
      type: 'trade',
      data: trade
    });
    
    // Add price snapshot for significant changes
    if (this.shouldSnapshot(trade.mintAddress, trade.marketCapUsd)) {
      this.batchQueue.push({
        type: 'price_snapshot',
        data: {
          mintAddress: trade.mintAddress,
          priceSol: trade.priceSol,
          priceUsd: trade.priceUsd,
          marketCapUsd: trade.marketCapUsd,
          virtualSolReserves: trade.virtualSolReserves,
          virtualTokenReserves: trade.virtualTokenReserves,
          bondingCurveProgress: trade.bondingCurveProgress,
          program: trade.program,
          slot: trade.slot
        }
      });
    }
  }

  /**
   * Process account state update
   */
  async processAccountState(state: {
    mintAddress: string;
    program: 'bonding_curve' | 'amm_pool';
    accountType: string;
    virtualSolReserves?: bigint;
    virtualTokenReserves?: bigint;
    bondingCurveComplete?: boolean;
    slot: bigint;
  }): Promise<void> {
    this.batchQueue.push({
      type: 'account_state',
      data: state
    });
    
    // Check for graduation
    if (state.bondingCurveComplete && state.program === 'bonding_curve') {
      await this.markTokenGraduated(state.mintAddress, state.slot);
    }
  }

  /**
   * Mark token as graduated
   */
  private async markTokenGraduated(mintAddress: string, slot: bigint): Promise<void> {
    try {
      await db.query(`
        UPDATE tokens_unified 
        SET 
          graduated_to_amm = TRUE,
          graduation_at = NOW(),
          graduation_slot = $2,
          current_program = 'amm_pool',
          updated_at = NOW()
        WHERE mint_address = $1
      `, [mintAddress, slot.toString()]);
      
      console.log(`🎓 Token graduated: ${mintAddress}`);
    } catch (error) {
      console.error('Error marking graduation:', error);
    }
  }

  /**
   * Check if token crossed threshold
   */
  private async checkAndUpdateThreshold(trade: UnifiedTradeData): Promise<void> {
    if (trade.marketCapUsd < 8888) return;
    
    try {
      // Use single query to check and update atomically
      const result = await db.query(`
        UPDATE tokens_unified 
        SET 
          threshold_crossed_at = COALESCE(threshold_crossed_at, NOW()),
          threshold_price_sol = COALESCE(threshold_price_sol, $2),
          threshold_price_usd = COALESCE(threshold_price_usd, $3),
          threshold_market_cap_usd = COALESCE(threshold_market_cap_usd, $4),
          threshold_slot = COALESCE(threshold_slot, $5),
          updated_at = NOW()
        WHERE mint_address = $1
        AND threshold_crossed_at IS NULL
        RETURNING mint_address
      `, [
        trade.mintAddress,
        trade.priceSol,
        trade.priceUsd,
        trade.marketCapUsd,
        trade.slot.toString()
      ]);
      
      if (result.rows.length > 0) {
        console.log(`💰 Token crossed $8,888 threshold: ${trade.mintAddress}`);
        // Update cache
        const cached = this.tokenCache.get(trade.mintAddress) || { 
          tracked: true, 
          firstSeen: new Date(),
          thresholdCrossed: false 
        };
        cached.thresholdCrossed = true;
        this.tokenCache.set(trade.mintAddress, cached);
        
        // Trigger automatic enrichment for tokens crossing threshold
        await this.autoEnricher.enrichTokenOnThreshold(trade.mintAddress, trade.marketCapUsd);
      }
    } catch (error) {
      console.error('Error updating threshold:', error);
    }
  }

  /**
   * Determine if we should take a price snapshot
   */
  private shouldSnapshot(_mintAddress: string, marketCapUsd: number): boolean {
    // Always snapshot if over certain thresholds
    if (marketCapUsd > 100000) return true;
    if (marketCapUsd > 50000) return Math.random() < 0.5;
    if (marketCapUsd > 20000) return Math.random() < 0.2;
    return Math.random() < 0.1;
  }

  /**
   * Start batch processor
   */
  private startBatchProcessor(): void {
    this.batchTimer = setInterval(() => {
      if (this.batchQueue.length > 0) {
        this.processBatch();
      }
    }, this.BATCH_INTERVAL_MS);
  }

  /**
   * Process batch of items
   */
  private async processBatch(): Promise<void> {
    const items = this.batchQueue.splice(0, this.BATCH_SIZE);
    if (items.length === 0) return;
    
    this.stats.batchesProcessed++;
    
    // Group by type
    const tokenItems = items.filter(i => i.type === 'token').map(i => i.data);
    const trades = items.filter(i => i.type === 'trade').map(i => i.data);
    const snapshots = items.filter(i => i.type === 'price_snapshot').map(i => i.data);
    const accountStates = items.filter(i => i.type === 'account_state').map(i => i.data);
    
    // Deduplicate tokens by mint address (keep first occurrence)
    const tokenMap = new Map<string, any>();
    for (const token of tokenItems) {
      if (!tokenMap.has(token.mintAddress)) {
        tokenMap.set(token.mintAddress, token);
      }
    }
    const tokens = Array.from(tokenMap.values());
    
    try {
      await db.query('BEGIN');
      
      // Process tokens
      if (tokens.length > 0) {
        await this.batchInsertTokens(tokens);
      }
      
      // Process trades
      if (trades.length > 0) {
        await this.batchInsertTrades(trades);
      }
      
      // Process price snapshots
      if (snapshots.length > 0) {
        await this.batchInsertSnapshots(snapshots);
      }
      
      // Process account states
      if (accountStates.length > 0) {
        await this.batchInsertAccountStates(accountStates);
      }
      
      // Update token statistics for affected tokens
      const affectedMints = new Set([
        ...tokens.map(t => t.mintAddress),
        ...trades.map(t => t.mintAddress)
      ]);
      
      for (const mint of affectedMints) {
        await db.query('SELECT update_token_stats($1)', [mint]);
      }
      
      await db.query('COMMIT');
      
      // Update stats
      this.stats.tokensTracked += tokens.filter(t => t.thresholdCrossed).length;
      this.stats.tradesProcessed += trades.length;
      
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Batch processing error:', error);
      // Re-queue items
      this.batchQueue.unshift(...items);
    }
  }

  /**
   * Batch insert tokens
   */
  private async batchInsertTokens(tokens: any[]): Promise<void> {
    if (tokens.length === 0) return;
    
    const values = tokens.map((_, i) => {
      const offset = i * 18; // Updated for 18 fields (added latest_price_usd)
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18})`;
    }).join(',');
    
    const params = tokens.flatMap(t => [
      t.mintAddress,
      t.symbol,
      t.name,
      t.uri,
      t.firstProgram,
      t.firstSeenSlot.toString(),
      t.firstPriceSol,
      t.firstPriceUsd || (t.firstPriceSol * (t.firstMarketCapUsd / (t.firstPriceSol * 1_000_000_000))), // Calculate USD price if not provided
      t.firstPriceSol,
      t.firstPriceUsd || (t.firstPriceSol * (t.firstMarketCapUsd / (t.firstPriceSol * 1_000_000_000))), // latest_price_usd same as first
      t.firstMarketCapUsd,
      t.firstMarketCapUsd,
      t.firstProgram,
      t.tokenCreatedAt || null, // Add token creation time
      t.creator || null, // Creator address
      t.totalSupply || null, // Total supply
      t.bondingCurveKey || null, // Bonding curve key
      new Date() // last_trade_at - set to now for initial insert
    ]);
    
    await db.query(`
      INSERT INTO tokens_unified (
        mint_address, symbol, name, uri, first_program, first_seen_slot,
        first_price_sol, first_price_usd, latest_price_sol, latest_price_usd,
        first_market_cap_usd, latest_market_cap_usd, current_program, token_created_at,
        creator, total_supply, bonding_curve_key, last_trade_at
      ) VALUES ${values}
      ON CONFLICT (mint_address) DO UPDATE SET
        symbol = COALESCE(tokens_unified.symbol, EXCLUDED.symbol),
        name = COALESCE(tokens_unified.name, EXCLUDED.name),
        uri = COALESCE(tokens_unified.uri, EXCLUDED.uri),
        creator = COALESCE(tokens_unified.creator, EXCLUDED.creator),
        total_supply = COALESCE(tokens_unified.total_supply, EXCLUDED.total_supply),
        bonding_curve_key = COALESCE(tokens_unified.bonding_curve_key, EXCLUDED.bonding_curve_key),
        updated_at = NOW()
    `, params);
    
    // Update cache
    for (const token of tokens) {
      this.tokenCache.set(token.mintAddress, {
        tracked: true,
        firstSeen: new Date(),
        thresholdCrossed: token.thresholdCrossed
      });
    }
  }

  /**
   * Batch insert trades
   */
  private async batchInsertTrades(trades: UnifiedTradeData[]): Promise<void> {
    if (trades.length === 0) return;
    
    // Update latest token state first
    for (const trade of trades) {
      await db.query(`
        UPDATE tokens_unified
        SET
          latest_price_sol = $2,
          latest_price_usd = $3,
          latest_market_cap_usd = $4,
          latest_virtual_sol_reserves = $5,
          latest_virtual_token_reserves = $6,
          latest_bonding_curve_progress = $7,
          latest_update_slot = $8,
          current_program = $9,
          creator = COALESCE(creator, $10),
          bonding_curve_key = COALESCE(bonding_curve_key, $11),
          last_trade_at = $12,
          is_stale = FALSE,
          updated_at = NOW()
        WHERE mint_address = $1
      `, [
        trade.mintAddress,
        trade.priceSol,
        trade.priceUsd,
        trade.marketCapUsd,
        trade.virtualSolReserves?.toString() || null,
        trade.virtualTokenReserves?.toString() || null,
        trade.bondingCurveProgress || null,
        trade.slot.toString(),
        trade.program,
        trade.creator || null,
        trade.bondingCurveKey || null,
        trade.blockTime
      ]);
    }
    
    // Insert trades
    const values = trades.map((_, i) => {
      const offset = i * 16; // Updated for 16 fields
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16})`;
    }).join(',');
    
    const params = trades.flatMap(t => [
      t.mintAddress,
      t.signature,
      t.program,
      t.tradeType,
      t.userAddress,
      t.solAmount.toString(),
      t.tokenAmount.toString(),
      t.priceSol,
      t.priceUsd,
      t.marketCapUsd,
      t.virtualSolReserves?.toString() || null,
      t.virtualTokenReserves?.toString() || null,
      t.bondingCurveKey || null, // NEW: bonding curve key for graduation tracking
      t.bondingCurveProgress || null,
      t.slot.toString(),
      t.blockTime
    ]);
    
    await db.query(`
      INSERT INTO trades_unified (
        mint_address, signature, program, trade_type, user_address,
        sol_amount, token_amount, price_sol, price_usd, market_cap_usd,
        virtual_sol_reserves, virtual_token_reserves, bonding_curve_key,
        bonding_curve_progress, slot, block_time
      ) VALUES ${values}
      ON CONFLICT (signature) DO NOTHING
    `, params);
  }

  /**
   * Batch insert price snapshots
   */
  private async batchInsertSnapshots(snapshots: any[]): Promise<void> {
    if (snapshots.length === 0) return;
    
    const values = snapshots.map((_, i) => {
      const offset = i * 9;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
    }).join(',');
    
    const params = snapshots.flatMap(s => [
      s.mintAddress,
      s.priceSol,
      s.priceUsd,
      s.marketCapUsd,
      s.virtualSolReserves?.toString() || null,
      s.virtualTokenReserves?.toString() || null,
      s.bondingCurveProgress || null,
      s.program,
      s.slot.toString()
    ]);
    
    await db.query(`
      INSERT INTO price_snapshots_unified (
        mint_address, price_sol, price_usd, market_cap_usd,
        virtual_sol_reserves, virtual_token_reserves, bonding_curve_progress,
        program, slot
      ) VALUES ${values}
    `, params);
  }

  /**
   * Batch insert account states
   */
  private async batchInsertAccountStates(states: any[]): Promise<void> {
    if (states.length === 0) return;
    
    const values = states.map((_, i) => {
      const offset = i * 7;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
    }).join(',');
    
    const params = states.flatMap(s => [
      s.mintAddress,
      s.program,
      s.accountType,
      s.virtualSolReserves?.toString() || null,
      s.virtualTokenReserves?.toString() || null,
      s.bondingCurveComplete || false,
      s.slot.toString()
    ]);
    
    await db.query(`
      INSERT INTO account_states_unified (
        mint_address, program, account_type,
        virtual_sol_reserves, virtual_token_reserves,
        bonding_curve_complete, slot
      ) VALUES ${values}
    `, params);
  }

  /**
   * Refresh cache from database
   */
  private async refreshCache(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT mint_address, created_at, threshold_crossed_at IS NOT NULL as threshold_crossed
        FROM tokens_unified
        WHERE created_at > NOW() - INTERVAL '2 hours'
      `);
      
      // Clear old entries
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      for (const [mint, data] of this.tokenCache.entries()) {
        if (data.firstSeen < twoHoursAgo) {
          this.tokenCache.delete(mint);
        }
      }
      
      // Add fresh entries
      for (const row of result.rows) {
        this.tokenCache.set(row.mint_address, {
          tracked: true,
          firstSeen: row.created_at,
          thresholdCrossed: row.threshold_crossed
        });
      }
    } catch (error) {
      console.error('Error refreshing cache:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.tokenCache.size,
      queueSize: this.batchQueue.length,
      cacheHitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) || 0
    };
  }

  /**
   * Check if token is tracked (has crossed threshold)
   */
  async isTokenTracked(mintAddress: string): Promise<boolean> {
    // Check cache first
    const cached = this.tokenCache.get(mintAddress);
    if (cached) {
      this.stats.cacheHits++;
      return cached.thresholdCrossed;
    }
    
    this.stats.cacheMisses++;
    
    // Check database
    const result = await db.query(
      'SELECT 1 FROM tokens_unified WHERE mint_address = $1 AND threshold_crossed_at IS NOT NULL',
      [mintAddress]
    );
    
    const tracked = result.rows.length > 0;
    
    // Update cache
    if (tracked) {
      this.tokenCache.set(mintAddress, {
        tracked: true,
        firstSeen: new Date(),
        thresholdCrossed: true
      });
    }
    
    return tracked;
  }

  /**
   * Update token creator address
   */
  async updateTokenCreator(mintAddress: string, creator: string): Promise<void> {
    try {
      await db.query(
        `UPDATE tokens_unified 
         SET creator = $2,
             updated_at = NOW()
         WHERE mint_address = $1`,
        [mintAddress, creator]
      );
    } catch (error) {
      console.error('Error updating token creator:', error);
    }
  }

  /**
   * Cleanup and close
   */
  async close(): Promise<void> {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    
    // Process remaining items
    if (this.batchQueue.length > 0) {
      await this.processBatch();
    }
  }
}