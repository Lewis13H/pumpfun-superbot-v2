/**
 * Historical Data Recovery Service
 * Detects downtime periods and recovers missed trades
 * Uses multiple data sources for comprehensive recovery
 */

import { db } from '../../database';
import { UnifiedGraphQLPriceRecovery } from './unified-graphql-price-recovery';
import { DexScreenerPriceService } from '../pricing/dexscreener-price-service';
import chalk from 'chalk';
import { format } from 'date-fns';

export interface DowntimePeriod {
  gap_start_slot: number;
  gap_end_slot: number;
  gap_start_time: Date;
  gap_end_time: Date;
  gap_duration_seconds: number;
  affected_programs: string[];
  estimated_missed_trades?: number;
}

export interface RecoveryProgress {
  id?: number;
  period_start: Date;
  period_end: Date;
  tokens_processed: number;
  tokens_total: number;
  trades_recovered: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  started_at?: Date;
  completed_at?: Date;
  error_message?: string;
  recovery_source?: string;
}

export interface RecoveryResult {
  totalTradesRecovered: number;
  tokensProcessed: number;
  errors: Array<{ token: string; error: string }>;
  duration: number;
}

export class HistoricalRecoveryService {
  private static instance: HistoricalRecoveryService;
  private graphqlRecovery: UnifiedGraphQLPriceRecovery;
  private dexScreenerService: DexScreenerPriceService;
  
  // Recovery configuration
  private readonly MIN_GAP_DURATION = 300; // 5 minutes minimum gap to consider
  
  private constructor() {
    this.graphqlRecovery = UnifiedGraphQLPriceRecovery.getInstance();
    this.dexScreenerService = DexScreenerPriceService.getInstance();
  }
  
  static getInstance(): HistoricalRecoveryService {
    if (!this.instance) {
      this.instance = new HistoricalRecoveryService();
    }
    return this.instance;
  }
  
  /**
   * Detect downtime periods by finding gaps in trade data
   */
  async detectDowntimePeriods(
    lookbackHours: number = 24,
    minGapSeconds: number = this.MIN_GAP_DURATION
  ): Promise<DowntimePeriod[]> {
    try {
      console.log(chalk.blue('🔍 Detecting downtime periods...'));
      
      const result = await db.query(`
        WITH trade_gaps AS (
          SELECT 
            slot,
            block_time,
            program,
            LAG(block_time) OVER (ORDER BY block_time) as prev_time,
            LAG(slot) OVER (ORDER BY slot) as prev_slot,
            LAG(program) OVER (ORDER BY block_time) as prev_program
          FROM trades_unified
          WHERE block_time > NOW() - INTERVAL '${lookbackHours} hours'
          ORDER BY block_time
        ),
        significant_gaps AS (
          SELECT 
            prev_slot as gap_start_slot,
            slot as gap_end_slot,
            prev_time as gap_start_time,
            block_time as gap_end_time,
            EXTRACT(EPOCH FROM (block_time - prev_time)) as gap_duration_seconds,
            array_agg(DISTINCT program) as affected_programs
          FROM trade_gaps
          WHERE EXTRACT(EPOCH FROM (block_time - prev_time)) > $1
          GROUP BY prev_slot, slot, prev_time, block_time
        )
        SELECT *,
          -- Estimate missed trades based on average trade frequency
          ROUND(
            gap_duration_seconds / 60.0 * (
              SELECT COUNT(*) / (EXTRACT(EPOCH FROM (MAX(block_time) - MIN(block_time))) / 60)
              FROM trades_unified
              WHERE block_time > NOW() - INTERVAL '1 hour'
            )
          ) as estimated_missed_trades
        FROM significant_gaps
        ORDER BY gap_start_time DESC
      `, [minGapSeconds]);
      
      const gaps = result.rows.map((row: any) => ({
        gap_start_slot: parseInt(row.gap_start_slot),
        gap_end_slot: parseInt(row.gap_end_slot),
        gap_start_time: row.gap_start_time,
        gap_end_time: row.gap_end_time,
        gap_duration_seconds: parseFloat(row.gap_duration_seconds),
        affected_programs: row.affected_programs,
        estimated_missed_trades: parseInt(row.estimated_missed_trades || '0')
      }));
      
      if (gaps.length === 0) {
        console.log(chalk.green('✅ No significant downtime periods detected'));
      } else {
        console.log(chalk.yellow(`⚠️ Found ${gaps.length} downtime periods:`));
        gaps.forEach((gap: DowntimePeriod) => {
          const duration = Math.round(gap.gap_duration_seconds / 60);
          console.log(chalk.gray(
            `   ${format(gap.gap_start_time, 'yyyy-MM-dd HH:mm')} - ${format(gap.gap_end_time, 'HH:mm')} ` +
            `(${duration} min, ~${gap.estimated_missed_trades} trades)`
          ));
        });
      }
      
      return gaps;
      
    } catch (error) {
      console.error(chalk.red('❌ Error detecting downtime periods:'), error);
      throw error;
    }
  }
  
  /**
   * Recover missed trades for a specific downtime period
   */
  async recoverMissedTrades(period: DowntimePeriod): Promise<RecoveryResult> {
    const startTime = Date.now();
    const progressId = await this.initializeProgress(period);
    
    try {
      console.log(chalk.cyan.bold('\n🔄 Starting Historical Recovery'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.white(`Period: ${format(period.gap_start_time, 'yyyy-MM-dd HH:mm')} - ${format(period.gap_end_time, 'HH:mm')}`));
      console.log(chalk.white(`Duration: ${Math.round(period.gap_duration_seconds / 60)} minutes`));
      console.log(chalk.white(`Slots: ${period.gap_start_slot} - ${period.gap_end_slot}`));
      
      // Update progress to in_progress
      await this.updateProgress(progressId, { status: 'in_progress', started_at: new Date() });
      
      // Try recovery sources in order
      let result: RecoveryResult = {
        totalTradesRecovered: 0,
        tokensProcessed: 0,
        errors: [],
        duration: 0
      };
      
      // 1. Try GraphQL recovery first (most comprehensive)
      try {
        console.log(chalk.blue('\n📊 Attempting GraphQL recovery...'));
        const graphqlResult = await this.recoverFromGraphQL(period, progressId);
        result.totalTradesRecovered += graphqlResult.tradesRecovered;
        result.tokensProcessed += graphqlResult.tokensProcessed;
        result.errors.push(...graphqlResult.errors);
      } catch (error) {
        console.error(chalk.yellow('⚠️ GraphQL recovery failed:'), error);
        result.errors.push({ token: 'graphql', error: String(error) });
      }
      
      // 2. Try DexScreener for graduated tokens
      try {
        console.log(chalk.blue('\n📈 Attempting DexScreener recovery for graduated tokens...'));
        const dexResult = await this.recoverFromDexScreener(period, progressId);
        result.totalTradesRecovered += dexResult.tradesRecovered;
        result.tokensProcessed += dexResult.tokensProcessed;
        result.errors.push(...dexResult.errors);
      } catch (error) {
        console.error(chalk.yellow('⚠️ DexScreener recovery failed:'), error);
        result.errors.push({ token: 'dexscreener', error: String(error) });
      }
      
      // 3. Try direct RPC recovery as last resort
      if (result.totalTradesRecovered === 0) {
        console.log(chalk.blue('\n🔗 Attempting direct RPC recovery...'));
        const rpcResult = await this.recoverFromRPC(period, progressId);
        result.totalTradesRecovered += rpcResult.tradesRecovered;
        result.tokensProcessed += rpcResult.tokensProcessed;
        result.errors.push(...rpcResult.errors);
      }
      
      result.duration = Date.now() - startTime;
      
      // Update final progress
      await this.updateProgress(progressId, {
        status: 'completed',
        completed_at: new Date(),
        tokens_processed: result.tokensProcessed,
        trades_recovered: result.totalTradesRecovered
      });
      
      // Log summary
      console.log(chalk.gray('\n' + '─'.repeat(50)));
      console.log(chalk.green.bold('✅ Recovery Complete'));
      console.log(chalk.white(`Trades Recovered: ${result.totalTradesRecovered}`));
      console.log(chalk.white(`Tokens Processed: ${result.tokensProcessed}`));
      console.log(chalk.white(`Duration: ${(result.duration / 1000).toFixed(1)}s`));
      
      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\n⚠️ Errors: ${result.errors.length}`));
        result.errors.slice(0, 5).forEach(err => {
          console.log(chalk.gray(`   ${err.token}: ${err.error}`));
        });
      }
      
      return result;
      
    } catch (error) {
      await this.updateProgress(progressId, {
        status: 'failed',
        error_message: String(error)
      });
      throw error;
    }
  }
  
  /**
   * Recover from GraphQL (primary source)
   */
  private async recoverFromGraphQL(
    period: DowntimePeriod, 
    progressId: number
  ): Promise<{ tradesRecovered: number; tokensProcessed: number; errors: any[] }> {
    // Get affected tokens during the period
    const affectedTokens = await this.getAffectedTokens(period);
    
    if (affectedTokens.length === 0) {
      console.log(chalk.yellow('No tokens to recover'));
      return { tradesRecovered: 0, tokensProcessed: 0, errors: [] };
    }
    
    console.log(chalk.blue(`Found ${affectedTokens.length} tokens to check`));
    
    // Use GraphQL recovery service
    const mintAddresses = affectedTokens.map(t => t.mint_address);
    const result = await this.graphqlRecovery.recoverPrices(mintAddresses);
    
    // Update progress
    await this.updateProgress(progressId, {
      tokens_processed: result.successful.length,
      recovery_source: 'graphql'
    });
    
    return {
      tradesRecovered: result.successful.reduce((sum: number, r: any) => sum + (r.tradesRecovered || 0), 0),
      tokensProcessed: result.successful.length,
      errors: result.failed.map((f: any) => ({ token: f.mintAddress, error: f.error }))
    };
  }
  
  /**
   * Recover from DexScreener (for graduated tokens)
   */
  private async recoverFromDexScreener(
    period: DowntimePeriod,
    progressId: number
  ): Promise<{ tradesRecovered: number; tokensProcessed: number; errors: any[] }> {
    // Get graduated tokens
    const graduatedTokens = await db.query(`
      SELECT DISTINCT mint_address, symbol
      FROM tokens_unified
      WHERE graduated_to_amm = true
        AND threshold_crossed_at < $1
      LIMIT 50
    `, [period.gap_end_time]);
    
    if (graduatedTokens.rows.length === 0) {
      return { tradesRecovered: 0, tokensProcessed: 0, errors: [] };
    }
    
    console.log(chalk.blue(`Checking ${graduatedTokens.rows.length} graduated tokens...`));
    
    let tradesRecovered = 0;
    const errors: any[] = [];
    
    for (const token of graduatedTokens.rows) {
      try {
        const priceData = await this.dexScreenerService.getTokenPrice(token.mint_address);
        if (priceData) {
          // Update token with latest price
          await db.query(`
            UPDATE tokens_unified
            SET 
              latest_price_usd = $2,
              latest_market_cap_usd = $3,
              volume_24h_usd = $4,
              last_dexscreener_update = NOW()
            WHERE mint_address = $1
          `, [
            token.mint_address,
            priceData.priceUsd,
            priceData.marketCap,
            priceData.volume24h
          ]);
          tradesRecovered++;
        }
      } catch (error) {
        errors.push({ token: token.symbol || token.mint_address, error: String(error) });
      }
    }
    
    await this.updateProgress(progressId, {
      recovery_source: 'dexscreener'
    });
    
    return {
      tradesRecovered,
      tokensProcessed: graduatedTokens.rows.length,
      errors
    };
  }
  
  /**
   * Recover from direct RPC calls (last resort)
   */
  private async recoverFromRPC(
    _period: DowntimePeriod,
    _progressId: number
  ): Promise<{ tradesRecovered: number; tokensProcessed: number; errors: any[] }> {
    console.log(chalk.yellow('RPC recovery not yet implemented'));
    
    // TODO: Implement direct RPC recovery
    // This would involve:
    // 1. getSignaturesForAddress for each program
    // 2. getTransaction for each signature
    // 3. Parse and store trades
    
    return { tradesRecovered: 0, tokensProcessed: 0, errors: [] };
  }
  
  /**
   * Get tokens that were active around the downtime period
   */
  private async getAffectedTokens(period: DowntimePeriod): Promise<any[]> {
    const result = await db.query(`
      SELECT DISTINCT mint_address, symbol, name
      FROM tokens_unified
      WHERE created_at < $2
        AND (
          -- Had trades before the gap
          EXISTS (
            SELECT 1 FROM trades_unified t
            WHERE t.mint_address = tokens_unified.mint_address
              AND t.block_time < $1
              AND t.block_time > $1 - INTERVAL '1 hour'
          )
          OR
          -- High value tokens
          latest_market_cap_usd > 10000
        )
      ORDER BY latest_market_cap_usd DESC
      LIMIT 100
    `, [period.gap_start_time, period.gap_end_time]);
    
    return result.rows;
  }
  
  /**
   * Initialize recovery progress tracking
   */
  private async initializeProgress(period: DowntimePeriod): Promise<number> {
    const result = await db.query(`
      INSERT INTO recovery_progress (
        period_start,
        period_end,
        status,
        tokens_total,
        tokens_processed,
        trades_recovered
      ) VALUES ($1, $2, 'pending', 0, 0, 0)
      RETURNING id
    `, [period.gap_start_time, period.gap_end_time]);
    
    return result.rows[0].id;
  }
  
  /**
   * Update recovery progress
   */
  private async updateProgress(id: number, updates: Partial<RecoveryProgress>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;
    
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    });
    
    if (fields.length > 0) {
      values.push(id);
      await db.query(`
        UPDATE recovery_progress
        SET ${fields.join(', ')}
        WHERE id = $${paramCount}
      `, values);
    }
  }
  
  /**
   * Get recovery history
   */
  async getRecoveryHistory(limit: number = 10): Promise<RecoveryProgress[]> {
    const result = await db.query(`
      SELECT *
      FROM recovery_progress
      ORDER BY period_start DESC
      LIMIT $1
    `, [limit]);
    
    return result.rows;
  }
  
  /**
   * Get recovery statistics
   */
  async getRecoveryStats(): Promise<{
    totalRecoveries: number;
    successfulRecoveries: number;
    totalTradesRecovered: number;
    averageRecoveryTime: number;
  }> {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_recoveries,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_recoveries,
        SUM(trades_recovered) as total_trades_recovered,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_recovery_time
      FROM recovery_progress
      WHERE started_at IS NOT NULL
    `);
    
    const row = result.rows[0];
    return {
      totalRecoveries: parseInt(row.total_recoveries || '0'),
      successfulRecoveries: parseInt(row.successful_recoveries || '0'),
      totalTradesRecovered: parseInt(row.total_trades_recovered || '0'),
      averageRecoveryTime: parseFloat(row.avg_recovery_time || '0')
    };
  }
}