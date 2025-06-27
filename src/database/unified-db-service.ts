/**
 * Unified database service that uses mint addresses as primary keys
 * Compatible with both threshold and comprehensive monitoring
 */

import { db } from '../database';

export interface UnifiedTokenData {
  mintAddress: string;
  symbol?: string;
  name?: string;
  uri?: string;
  firstProgram: 'bonding_curve' | 'amm_pool';
  firstSeenSlot: bigint;
  firstMarketCapUsd: number;
  thresholdPriceSol: number;
  thresholdMarketCapUsd: number;
}

export class UnifiedDbService {
  private batchQueue: any[] = [];
  private batchTimer?: NodeJS.Timeout;
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_INTERVAL_MS = 1000;

  constructor() {
    this.startBatchProcessor();
  }

  /**
   * Save or update a token using mint address as key
   */
  async saveToken(data: UnifiedTokenData): Promise<void> {
    const query = `
      INSERT INTO tokens_unified_v2 (
        mint_address, symbol, name, uri,
        first_program, first_seen_slot, first_market_cap_usd,
        threshold_crossed_at, threshold_price_sol, threshold_market_cap_usd,
        current_program
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $5)
      ON CONFLICT (mint_address) DO UPDATE SET
        symbol = COALESCE(tokens_unified_v2.symbol, EXCLUDED.symbol),
        name = COALESCE(tokens_unified_v2.name, EXCLUDED.name),
        uri = COALESCE(tokens_unified_v2.uri, EXCLUDED.uri),
        updated_at = NOW(),
        total_trades = tokens_unified_v2.total_trades + 1
    `;

    await db.query(query, [
      data.mintAddress,
      data.symbol,
      data.name,
      data.uri,
      data.firstProgram,
      data.firstSeenSlot.toString(),
      data.firstMarketCapUsd,
      data.thresholdPriceSol,
      data.thresholdMarketCapUsd
    ]);
  }

  /**
   * Queue a trade (works for both bonding curve and AMM)
   */
  async queueTrade(trade: {
    mintAddress: string;
    program: 'bonding_curve' | 'amm_pool';
    signature: string;
    tradeType: 'buy' | 'sell';
    userAddress: string;
    solAmount: bigint;
    tokenAmount: bigint;
    priceSol: number;
    priceUsd: number;
    marketCapUsd: number;
    virtualSolReserves?: bigint;
    virtualTokenReserves?: bigint;
    slot: bigint;
    blockTime: Date;
  }): Promise<void> {
    // Only queue if market cap >= $8,888
    if (trade.marketCapUsd < 8888) return;

    this.batchQueue.push({
      type: 'trade',
      data: trade
    });
  }

  /**
   * Mark token as graduated to AMM
   */
  async markTokenGraduated(mintAddress: string, slot: bigint): Promise<void> {
    await db.query(`
      UPDATE tokens_unified_v2 
      SET graduated_to_amm = TRUE,
          graduation_at = NOW(),
          graduation_slot = $2,
          current_program = 'amm_pool'
      WHERE mint_address = $1
    `, [mintAddress, slot.toString()]);
  }

  /**
   * Update 24h volume stats
   */
  async updateVolumeStats(mintAddress: string): Promise<void> {
    await db.query(`
      UPDATE tokens_unified_v2 t
      SET volume_24h_sol = COALESCE((
        SELECT SUM(sol_amount) / 1e9
        FROM trades_unified
        WHERE mint_address = t.mint_address
        AND block_time > NOW() - INTERVAL '24 hours'
      ), 0),
      volume_24h_usd = COALESCE((
        SELECT SUM(sol_amount * price_usd / price_sol) / 1e9
        FROM trades_unified
        WHERE mint_address = t.mint_address
        AND block_time > NOW() - INTERVAL '24 hours'
      ), 0)
      WHERE mint_address = $1
    `, [mintAddress]);
  }

  /**
   * Check if token exists and has crossed threshold
   */
  async isTokenTracked(mintAddress: string): Promise<boolean> {
    const result = await db.query(
      'SELECT 1 FROM tokens_unified_v2 WHERE mint_address = $1 AND threshold_crossed_at IS NOT NULL',
      [mintAddress]
    );
    return result.rows.length > 0;
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
   * Process queued items
   */
  private async processBatch(): Promise<void> {
    const items = this.batchQueue.splice(0, this.BATCH_SIZE);
    if (items.length === 0) return;

    const trades = items.filter(i => i.type === 'trade').map(i => i.data);

    try {
      await db.query('BEGIN');

      // Batch insert trades
      if (trades.length > 0) {
        const values = trades.map((t, i) => {
          const offset = i * 13;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`;
        }).join(',');

        const params = trades.flatMap(t => [
          t.mintAddress,
          t.program,
          t.signature,
          t.tradeType,
          t.userAddress,
          t.solAmount.toString(),
          t.tokenAmount.toString(),
          t.priceSol,
          t.priceUsd,
          t.marketCapUsd,
          t.virtualSolReserves?.toString() || null,
          t.virtualTokenReserves?.toString() || null,
          t.slot.toString(),
          t.blockTime
        ]);

        await db.query(`
          INSERT INTO trades_unified (
            mint_address, program, signature, trade_type, user_address,
            sol_amount, token_amount, price_sol, price_usd, market_cap_usd,
            virtual_sol_reserves, virtual_token_reserves, slot, block_time
          ) VALUES ${values}
          ON CONFLICT (signature) DO NOTHING
        `, params);

        // Update volume stats for affected tokens
        const uniqueMints = [...new Set(trades.map(t => t.mintAddress))];
        for (const mint of uniqueMints) {
          await this.updateVolumeStats(mint);
        }
      }

      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Batch processing error:', error);
      this.batchQueue.unshift(...items);
    }
  }

  /**
   * Cleanup
   */
  async close(): Promise<void> {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    
    if (this.batchQueue.length > 0) {
      await this.processBatch();
    }
  }
}