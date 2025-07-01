/**
 * AMM Metrics Aggregator
 * Aggregates and stores historical metrics for AMM pools
 */

import { db } from '../database';
import { EventBus, EVENTS } from '../core/event-bus';
import { AmmPoolStateService } from './amm-pool-state-service';
import { ammPoolAnalytics } from './amm-pool-analytics';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import cron from 'node-cron';

// Interfaces commented out - unused
// interface HourlyAggregation {
//   poolAddress: string;
//   tvlUsd: number;
//   volumeUsd: number;
//   feesUsd: number;
//   tradeCount: number;
//   uniqueTraders: number;
//   avgTradeSize: number;
//   priceBaseQuote: number;
//   baseReserve: bigint;
//   quoteReserve: bigint;
//   lpSupply: bigint;
//   utilizationRate: number;
//   volatility1h: number;
// }

// interface DailyAggregation {
//   poolAddress: string;
//   date: Date;
//   openPrice: number;
//   highPrice: number;
//   lowPrice: number;
//   closePrice: number;
//   volumeUsd: number;
//   feesUsd: number;
//   tradeCount: number;
//   uniqueTraders: number;
//   tvlOpen: number;
//   tvlClose: number;
//   liquidityAddedUsd: number;
//   liquidityRemovedUsd: number;
//   netLiquidityChange: number;
// }

export class AmmMetricsAggregator {
  private static instance: AmmMetricsAggregator | null = null;
  private logger: Logger;
  private eventBus: EventBus;
  private poolStateService: AmmPoolStateService;
  private isRunning: boolean = false;
  private aggregationJob: any = null;
  private lastAggregationTime: Map<string, Date> = new Map();
  
  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'AmmMetricsAggregator', color: chalk.yellow });
    this.eventBus = eventBus;
    this.poolStateService = AmmPoolStateService.getInstance();
    
    // Listen for trade events to trigger aggregation
    this.setupEventListeners();
  }
  
  static getInstance(eventBus: EventBus): AmmMetricsAggregator {
    if (!this.instance) {
      this.instance = new AmmMetricsAggregator(eventBus);
    }
    return this.instance;
  }
  
  /**
   * Start the aggregator with scheduled jobs
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Metrics aggregator already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Starting AMM metrics aggregator');
    
    // Run initial aggregation
    this.aggregateAllPools().catch(err => 
      this.logger.error('Initial aggregation failed', err)
    );
    
    // Schedule hourly aggregation (at minute 5 of each hour)
    this.aggregationJob = cron.schedule('5 * * * *', async () => {
      await this.aggregateHourlyMetrics();
    });
    
    // Schedule daily aggregation (at 00:05 UTC)
    cron.schedule('5 0 * * *', async () => {
      await this.aggregateDailyMetrics();
    });
    
    // Schedule performance calculation (every 6 hours)
    cron.schedule('0 */6 * * *', async () => {
      await this.updatePoolPerformance();
    });
    
    this.logger.info('Metrics aggregator started with scheduled jobs');
  }
  
  /**
   * Stop the aggregator
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.aggregationJob) {
      this.aggregationJob.stop();
      this.aggregationJob = null;
    }
    
    this.logger.info('Metrics aggregator stopped');
  }
  
  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Aggregate metrics when significant events occur
    this.eventBus.on(EVENTS.AMM_TRADE, async (data) => {
      // Check if enough time has passed since last aggregation
      const poolAddress = data.poolAddress;
      const lastTime = this.lastAggregationTime.get(poolAddress);
      const now = new Date();
      
      if (!lastTime || now.getTime() - lastTime.getTime() > 5 * 60 * 1000) { // 5 minutes
        await this.aggregatePoolMetrics(poolAddress);
        this.lastAggregationTime.set(poolAddress, now);
      }
    });
    
    // Also aggregate on liquidity events
    this.eventBus.on(EVENTS.LIQUIDITY_PROCESSED, async (data) => {
      if (data.totalValueUsd > 10000) { // Significant liquidity event
        await this.aggregatePoolMetrics(data.poolAddress);
      }
    });
  }
  
  /**
   * Aggregate metrics for all active pools
   */
  async aggregateAllPools(): Promise<void> {
    try {
      const pools = this.poolStateService.getAllPools();
      
      this.logger.info(`Aggregating metrics for ${pools.size} pools`);
      
      for (const [, poolState] of pools) {
        if (poolState.isActive) {
          await this.aggregatePoolMetrics(poolState.account.poolAddress);
        }
      }
      
      this.logger.info('Completed aggregation for all pools');
    } catch (error) {
      this.logger.error('Error aggregating all pools', error as Error);
    }
  }
  
  /**
   * Aggregate metrics for a specific pool
   */
  async aggregatePoolMetrics(poolAddress: string): Promise<void> {
    try {
      // Get pool metrics from analytics service
      const metrics = await ammPoolAnalytics.calculatePoolMetrics(poolAddress);
      if (!metrics) {
        this.logger.warn(`No metrics calculated for pool ${poolAddress}`);
        return;
      }
      
      // Store the metrics
      await ammPoolAnalytics.storePoolMetrics(poolAddress, metrics);
      
      // Emit event for real-time updates
      this.eventBus.emit('POOL_METRICS_UPDATED', {
        poolAddress,
        metrics,
        timestamp: new Date()
      });
      
    } catch (error) {
      this.logger.error(`Error aggregating metrics for pool ${poolAddress}`, error as Error);
    }
  }
  
  /**
   * Aggregate hourly metrics for all pools
   */
  async aggregateHourlyMetrics(): Promise<void> {
    try {
      this.logger.info('Starting hourly metrics aggregation');
      
      const startTime = new Date();
      startTime.setMinutes(0, 0, 0); // Start of current hour
      
      const endTime = new Date();
      
      // Get all active pools
      const poolsResult = await db.query(
        `SELECT DISTINCT pool_address FROM amm_pools`
      );
      
      for (const row of poolsResult.rows) {
        await this.aggregateHourlyForPool(row.pool_address, startTime, endTime);
      }
      
      this.logger.info('Completed hourly metrics aggregation');
    } catch (error) {
      this.logger.error('Error in hourly aggregation', error as Error);
    }
  }
  
  /**
   * Aggregate hourly metrics for a specific pool
   */
  private async aggregateHourlyForPool(
    poolAddress: string, 
    startTime: Date, 
    endTime: Date
  ): Promise<void> {
    try {
      // Get pool state
      const poolState = this.poolStateService.getPoolStateByAddress(poolAddress);
      if (!poolState) return;
      
      // Get trades in the hour
      const tradesResult = await db.query(
        `SELECT 
          COUNT(*) as trade_count,
          COUNT(DISTINCT user_address) as unique_traders,
          SUM(volume_usd) as volume_usd,
          AVG(volume_usd) as avg_trade_size,
          SUM(volume_usd * 0.003) as fees_usd,
          MAX(price_sol) as high_price,
          MIN(price_sol) as low_price,
          STDDEV(price_sol) as price_stddev
        FROM trades_unified
        WHERE mint_address = $1
        AND program = 'AMM'
        AND block_time >= $2 AND block_time < $3`,
        [poolState.reserves.mintAddress, startTime, endTime]
      );
      
      const trades = tradesResult.rows[0] || {};
      
      // Calculate volatility (1-hour)
      const volatility = trades.price_stddev ? 
        (trades.price_stddev / poolState.metrics.pricePerTokenSol) * 100 : 0;
      
      // Get current metrics
      const currentMetrics = await ammPoolAnalytics.calculatePoolMetrics(poolAddress);
      if (!currentMetrics) return;
      
      // Store hourly aggregation
      await db.query(
        `INSERT INTO amm_pool_metrics_hourly (
          pool_address, timestamp, tvl_usd, volume_usd, fees_usd,
          trade_count, unique_traders, avg_trade_size_usd,
          price_base_quote, base_reserve, quote_reserve,
          lp_supply, utilization_rate, volatility_1h
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (pool_address, timestamp) DO UPDATE SET
          tvl_usd = EXCLUDED.tvl_usd,
          volume_usd = EXCLUDED.volume_usd,
          fees_usd = EXCLUDED.fees_usd,
          trade_count = EXCLUDED.trade_count,
          unique_traders = EXCLUDED.unique_traders,
          avg_trade_size_usd = EXCLUDED.avg_trade_size_usd,
          utilization_rate = EXCLUDED.utilization_rate,
          volatility_1h = EXCLUDED.volatility_1h`,
        [
          poolAddress,
          startTime,
          currentMetrics.tvl.current,
          trades.volume_usd || 0,
          trades.fees_usd || 0,
          trades.trade_count || 0,
          trades.unique_traders || 0,
          trades.avg_trade_size || 0,
          poolState.metrics.pricePerTokenSol,
          poolState.reserves.virtualSolReserves,
          poolState.reserves.virtualTokenReserves,
          poolState.reserves.lpSupply || 0,
          currentMetrics.utilizationRate,
          volatility
        ]
      );
      
    } catch (error) {
      this.logger.error(`Error aggregating hourly for pool ${poolAddress}`, error as Error);
    }
  }
  
  /**
   * Aggregate daily metrics
   */
  async aggregateDailyMetrics(): Promise<void> {
    try {
      this.logger.info('Starting daily metrics aggregation');
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Get all pools with activity yesterday
      const poolsResult = await db.query(
        `SELECT DISTINCT pool_address 
         FROM amm_pool_metrics_hourly 
         WHERE timestamp >= $1 AND timestamp < $2`,
        [yesterday, today]
      );
      
      for (const row of poolsResult.rows) {
        await this.aggregateDailyForPool(row.pool_address, yesterday);
      }
      
      this.logger.info('Completed daily metrics aggregation');
    } catch (error) {
      this.logger.error('Error in daily aggregation', error as Error);
    }
  }
  
  /**
   * Aggregate daily metrics for a specific pool
   */
  private async aggregateDailyForPool(poolAddress: string, date: Date): Promise<void> {
    try {
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      
      // Get OHLC prices
      const pricesResult = await db.query(
        `SELECT 
          (SELECT price_base_quote FROM amm_pool_metrics_hourly 
           WHERE pool_address = $1 AND timestamp >= $2 AND timestamp < $3
           ORDER BY timestamp ASC LIMIT 1) as open_price,
          MAX(price_base_quote) as high_price,
          MIN(price_base_quote) as low_price,
          (SELECT price_base_quote FROM amm_pool_metrics_hourly 
           WHERE pool_address = $1 AND timestamp >= $2 AND timestamp < $3
           ORDER BY timestamp DESC LIMIT 1) as close_price
        FROM amm_pool_metrics_hourly
        WHERE pool_address = $1 AND timestamp >= $2 AND timestamp < $3`,
        [poolAddress, date, nextDay]
      );
      
      // Get volume and fees
      const volumeResult = await db.query(
        `SELECT 
          SUM(volume_usd) as volume_usd,
          SUM(fees_usd) as fees_usd,
          SUM(trade_count) as trade_count,
          COUNT(DISTINCT unique_traders) as unique_traders
        FROM amm_pool_metrics_hourly
        WHERE pool_address = $1 AND timestamp >= $2 AND timestamp < $3`,
        [poolAddress, date, nextDay]
      );
      
      // Get TVL open/close
      const tvlResult = await db.query(
        `SELECT 
          (SELECT tvl_usd FROM amm_pool_metrics_hourly 
           WHERE pool_address = $1 AND timestamp >= $2 AND timestamp < $3
           ORDER BY timestamp ASC LIMIT 1) as tvl_open,
          (SELECT tvl_usd FROM amm_pool_metrics_hourly 
           WHERE pool_address = $1 AND timestamp >= $2 AND timestamp < $3
           ORDER BY timestamp DESC LIMIT 1) as tvl_close
        FROM amm_pool_metrics_hourly
        WHERE pool_address = $1 AND timestamp >= $2 AND timestamp < $3
        LIMIT 1`,
        [poolAddress, date, nextDay]
      );
      
      // Get liquidity changes
      const liquidityResult = await db.query(
        `SELECT 
          SUM(CASE WHEN event_type = 'deposit' THEN total_value_usd ELSE 0 END) as added,
          SUM(CASE WHEN event_type = 'withdraw' THEN total_value_usd ELSE 0 END) as removed
        FROM amm_liquidity_events
        WHERE pool_address = $1 AND block_time >= $2 AND block_time < $3`,
        [poolAddress, date, nextDay]
      );
      
      const prices = pricesResult.rows[0] || {};
      const volume = volumeResult.rows[0] || {};
      const tvl = tvlResult.rows[0] || {};
      const liquidity = liquidityResult.rows[0] || {};
      
      // Store daily aggregation
      await db.query(
        `INSERT INTO amm_pool_metrics_daily (
          pool_address, date, open_price, high_price, low_price, close_price,
          volume_usd, fees_usd, trade_count, unique_traders,
          tvl_open, tvl_close, liquidity_added_usd, liquidity_removed_usd,
          net_liquidity_change
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (pool_address, date) DO UPDATE SET
          open_price = EXCLUDED.open_price,
          high_price = EXCLUDED.high_price,
          low_price = EXCLUDED.low_price,
          close_price = EXCLUDED.close_price,
          volume_usd = EXCLUDED.volume_usd,
          fees_usd = EXCLUDED.fees_usd,
          trade_count = EXCLUDED.trade_count,
          unique_traders = EXCLUDED.unique_traders,
          tvl_open = EXCLUDED.tvl_open,
          tvl_close = EXCLUDED.tvl_close,
          liquidity_added_usd = EXCLUDED.liquidity_added_usd,
          liquidity_removed_usd = EXCLUDED.liquidity_removed_usd,
          net_liquidity_change = EXCLUDED.net_liquidity_change`,
        [
          poolAddress,
          date,
          prices.open_price || 0,
          prices.high_price || 0,
          prices.low_price || 0,
          prices.close_price || 0,
          volume.volume_usd || 0,
          volume.fees_usd || 0,
          volume.trade_count || 0,
          volume.unique_traders || 0,
          tvl.tvl_open || 0,
          tvl.tvl_close || 0,
          liquidity.added || 0,
          liquidity.removed || 0,
          (liquidity.added || 0) - (liquidity.removed || 0)
        ]
      );
      
    } catch (error) {
      this.logger.error(`Error aggregating daily for pool ${poolAddress}`, error as Error);
    }
  }
  
  /**
   * Update pool performance metrics
   */
  async updatePoolPerformance(): Promise<void> {
    try {
      this.logger.info('Updating pool performance metrics');
      
      const poolsResult = await db.query(
        `SELECT DISTINCT pool_address, mint_address FROM amm_pools`
      );
      
      for (const row of poolsResult.rows) {
        await this.updatePoolPerformanceMetrics(row.pool_address, row.mint_address);
      }
      
      this.logger.info('Completed pool performance update');
    } catch (error) {
      this.logger.error('Error updating pool performance', error as Error);
    }
  }
  
  /**
   * Update performance metrics for a specific pool
   */
  private async updatePoolPerformanceMetrics(poolAddress: string, mintAddress: string): Promise<void> {
    try {
      // Get aggregated stats
      const statsResult = await db.query(
        `SELECT 
          SUM(volume_usd) as total_volume_usd,
          SUM(fees_usd) as total_fees_usd,
          SUM(trade_count) as total_trades,
          COUNT(DISTINCT date) as days_active,
          MAX(tvl_usd) as highest_tvl,
          MAX(CASE WHEN tvl_usd = (SELECT MAX(tvl_usd) FROM amm_pool_metrics_daily WHERE pool_address = $1) 
              THEN date END) as highest_tvl_date
        FROM amm_pool_metrics_daily
        WHERE pool_address = $1`,
        [poolAddress]
      );
      
      // Get current TVL
      const currentTvlResult = await db.query(
        `SELECT tvl_usd FROM amm_pool_metrics_hourly 
         WHERE pool_address = $1 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [poolAddress]
      );
      
      // Get unique traders
      const tradersResult = await db.query(
        `SELECT COUNT(DISTINCT user_address) as unique_traders
         FROM trades_unified
         WHERE mint_address = $1 AND program = 'AMM'`,
        [mintAddress]
      );
      
      // Calculate 7d and 30d APY
      const apy7dResult = await db.query(
        `SELECT 
          SUM(fees_usd) as fees_7d,
          AVG(tvl_usd) as avg_tvl_7d
        FROM amm_pool_metrics_daily
        WHERE pool_address = $1 AND date > NOW() - INTERVAL '7 days'`,
        [poolAddress]
      );
      
      const apy30dResult = await db.query(
        `SELECT 
          SUM(fees_usd) as fees_30d,
          AVG(tvl_usd) as avg_tvl_30d
        FROM amm_pool_metrics_daily
        WHERE pool_address = $1 AND date > NOW() - INTERVAL '30 days'`,
        [poolAddress]
      );
      
      // Calculate volatility
      const volatilityResult = await db.query(
        `SELECT 
          STDDEV(close_price) / AVG(close_price) * 100 as volatility_7d
        FROM amm_pool_metrics_daily
        WHERE pool_address = $1 AND date > NOW() - INTERVAL '7 days'`,
        [poolAddress]
      );
      
      const stats = statsResult.rows[0] || {};
      const currentTvl = currentTvlResult.rows[0]?.tvl_usd || 0;
      const uniqueTraders = tradersResult.rows[0]?.unique_traders || 0;
      const apy7d = apy7dResult.rows[0] || {};
      const apy30d = apy30dResult.rows[0] || {};
      const volatility = volatilityResult.rows[0]?.volatility_7d || 0;
      
      // Calculate APYs
      const feeApy7d = apy7d.avg_tvl_7d > 0 ? 
        (apy7d.fees_7d / apy7d.avg_tvl_7d) * (365 / 7) * 100 : 0;
      const feeApy30d = apy30d.avg_tvl_30d > 0 ? 
        (apy30d.fees_30d / apy30d.avg_tvl_30d) * (365 / 30) * 100 : 0;
      
      // Store/update performance metrics
      await db.query(
        `INSERT INTO amm_pool_performance (
          pool_address, mint_address, total_volume_usd, total_fees_usd,
          total_trades, unique_traders, highest_tvl_usd, highest_tvl_date,
          current_tvl_usd, avg_daily_volume, avg_daily_fees,
          fee_apy_7d, fee_apy_30d, volatility_7d
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (pool_address) DO UPDATE SET
          total_volume_usd = EXCLUDED.total_volume_usd,
          total_fees_usd = EXCLUDED.total_fees_usd,
          total_trades = EXCLUDED.total_trades,
          unique_traders = EXCLUDED.unique_traders,
          highest_tvl_usd = EXCLUDED.highest_tvl_usd,
          highest_tvl_date = EXCLUDED.highest_tvl_date,
          current_tvl_usd = EXCLUDED.current_tvl_usd,
          avg_daily_volume = EXCLUDED.avg_daily_volume,
          avg_daily_fees = EXCLUDED.avg_daily_fees,
          fee_apy_7d = EXCLUDED.fee_apy_7d,
          fee_apy_30d = EXCLUDED.fee_apy_30d,
          volatility_7d = EXCLUDED.volatility_7d,
          updated_at = NOW()`,
        [
          poolAddress,
          mintAddress,
          stats.total_volume_usd || 0,
          stats.total_fees_usd || 0,
          stats.total_trades || 0,
          uniqueTraders,
          stats.highest_tvl || 0,
          stats.highest_tvl_date,
          currentTvl,
          stats.days_active > 0 ? (stats.total_volume_usd / stats.days_active) : 0,
          stats.days_active > 0 ? (stats.total_fees_usd / stats.days_active) : 0,
          feeApy7d,
          feeApy30d,
          volatility
        ]
      );
      
    } catch (error) {
      this.logger.error(`Error updating performance for pool ${poolAddress}`, error as Error);
    }
  }
  
  /**
   * Get aggregation statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      lastAggregations: Array.from(this.lastAggregationTime.entries()).map(([pool, time]) => ({
        pool,
        lastAggregation: time
      }))
    };
  }
}

// Note: Instance creation handled by container