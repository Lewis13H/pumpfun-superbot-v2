/**
 * AMM Pool Analytics Service
 * Provides comprehensive pool metrics and analytics
 */

import { db } from '../database';
import { AmmPoolStateService } from './amm-pool-state-service';
import { Logger } from '../core/logger';
import chalk from 'chalk';

interface PoolMetrics {
  tvl: {
    current: number;
    change24h: number;
    change7d: number;
  };
  volume: {
    volume24h: number;
    volume7d: number;
    change24h: number;
  };
  fees: {
    fees24h: number;
    fees7d: number;
    apy: number;
  };
  priceImpact: {
    avgBuy: number;
    avgSell: number;
  };
  liquidityDepth: LiquidityDepth;
  utilizationRate: number;
  volatility: number;
}

interface LiquidityDepth {
  buy2Percent: number;
  buy5Percent: number;
  buy10Percent: number;
  sell2Percent: number;
  sell5Percent: number;
  sell10Percent: number;
}

interface PoolReport {
  overview: PoolOverview;
  performance: PerformanceMetrics;
  liquidity: LiquidityAnalysis;
  users: UserAnalytics;
  comparison: MarketComparison;
}

interface PoolOverview {
  poolAddress: string;
  mintAddress: string;
  symbol?: string;
  name?: string;
  createdAt: Date;
  tvlUsd: number;
  liquidityProviders: number;
  totalTrades: number;
}

interface PerformanceMetrics {
  returnMetrics: {
    feeAPY7d: number;
    feeAPY30d: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
  volumeMetrics: {
    avgDailyVolume: number;
    peakVolume: number;
    peakVolumeDate: Date;
  };
  feeMetrics: {
    totalFeesGenerated: number;
    avgDailyFees: number;
    feePerTrade: number;
  };
}

interface LiquidityAnalysis {
  currentDepth: LiquidityDepth;
  historicalTVL: Array<{ timestamp: Date; tvl: number }>;
  netFlow7d: number;
  largestProviders: Array<{ address: string; share: number }>;
}

interface UserAnalytics {
  totalUsers: number;
  activeUsers24h: number;
  newUsers7d: number;
  avgTradeSize: number;
  topTraders: Array<{ address: string; volume: number }>;
}

interface MarketComparison {
  tvlRank: number;
  volumeRank: number;
  feeAPYRank: number;
  similarPools: Array<{ address: string; symbol: string; tvl: number }>;
}

export class AmmPoolAnalytics {
  private static instance: AmmPoolAnalytics | null = null;
  private logger: Logger;
  private poolStateService: AmmPoolStateService;
  
  private constructor() {
    this.logger = new Logger({ context: 'AmmPoolAnalytics', color: chalk.cyan });
    this.poolStateService = AmmPoolStateService.getInstance();
  }
  
  static getInstance(): AmmPoolAnalytics {
    if (!this.instance) {
      this.instance = new AmmPoolAnalytics();
    }
    return this.instance;
  }
  
  /**
   * Calculate comprehensive pool metrics
   */
  async calculatePoolMetrics(poolAddress: string): Promise<PoolMetrics | null> {
    try {
      const poolState = this.poolStateService.getPoolStateByAddress(poolAddress);
      if (!poolState) {
        this.logger.warn(`Pool state not found for ${poolAddress}`);
        return null;
      }
      
      const [trades, , historicalMetrics] = await Promise.all([
        this.getRecentTrades(poolAddress),
        this.getLiquidityEvents(poolAddress),
        this.getHistoricalMetrics(poolAddress)
      ]);
      
      return {
        tvl: await this.calculateTVL(poolState, historicalMetrics),
        volume: await this.calculate24hVolume(trades),
        fees: await this.calculateFees(trades, poolState),
        priceImpact: await this.calculateAveragePriceImpact(trades),
        liquidityDepth: await this.calculateLiquidityDepth(poolState),
        utilizationRate: await this.calculateUtilization(poolState, trades),
        volatility: await this.calculateVolatility(trades)
      };
    } catch (error) {
      this.logger.error('Error calculating pool metrics', error as Error);
      return null;
    }
  }
  
  /**
   * Calculate Total Value Locked (TVL)
   */
  private async calculateTVL(pool: any, historicalMetrics: any[]): Promise<any> {
    const currentTVL = pool.metrics.liquidityUsd || 0;
    
    // Get TVL from 24h and 7d ago
    const tvl24hAgo = historicalMetrics.find(m => 
      m.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)
    )?.tvl_usd || currentTVL;
    
    const tvl7dAgo = historicalMetrics.find(m => 
      m.timestamp > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    )?.tvl_usd || currentTVL;
    
    return {
      current: currentTVL,
      change24h: currentTVL && tvl24hAgo ? ((currentTVL - tvl24hAgo) / tvl24hAgo) * 100 : 0,
      change7d: currentTVL && tvl7dAgo ? ((currentTVL - tvl7dAgo) / tvl7dAgo) * 100 : 0
    };
  }
  
  /**
   * Calculate 24h and 7d volume
   */
  private async calculate24hVolume(trades: any[]): Promise<any> {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 48 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    
    const volume24h = trades
      .filter(t => new Date(t.block_time).getTime() > oneDayAgo)
      .reduce((sum, t) => sum + (t.volume_usd || 0), 0);
    
    const volumePrev24h = trades
      .filter(t => {
        const time = new Date(t.block_time).getTime();
        return time > twoDaysAgo && time <= oneDayAgo;
      })
      .reduce((sum, t) => sum + (t.volume_usd || 0), 0);
    
    const volume7d = trades
      .filter(t => new Date(t.block_time).getTime() > sevenDaysAgo)
      .reduce((sum, t) => sum + (t.volume_usd || 0), 0);
    
    return {
      volume24h,
      volume7d,
      change24h: volumePrev24h ? ((volume24h - volumePrev24h) / volumePrev24h) * 100 : 0
    };
  }
  
  /**
   * Calculate fees and APY
   */
  private async calculateFees(trades: any[], poolState: any): Promise<any> {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    
    // Assuming 0.3% fee rate (standard for AMMs)
    const FEE_RATE = 0.003;
    
    const fees24h = trades
      .filter(t => new Date(t.block_time).getTime() > oneDayAgo)
      .reduce((sum, t) => sum + ((t.volume_usd || 0) * FEE_RATE), 0);
    
    const fees7d = trades
      .filter(t => new Date(t.block_time).getTime() > sevenDaysAgo)
      .reduce((sum, t) => sum + ((t.volume_usd || 0) * FEE_RATE), 0);
    
    // Calculate APY based on fees and TVL
    const tvl = poolState.metrics.liquidityUsd || 1; // Avoid division by zero
    const dailyReturn = fees24h / tvl;
    const apy = dailyReturn * 365 * 100; // Annualized percentage yield
    
    return {
      fees24h,
      fees7d,
      apy
    };
  }
  
  /**
   * Calculate average price impact
   */
  private async calculateAveragePriceImpact(trades: any[]): Promise<any> {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    
    const recentTrades = trades.filter(t => new Date(t.block_time).getTime() > oneDayAgo);
    
    if (recentTrades.length === 0) {
      return { avgBuy: 0, avgSell: 0 };
    }
    
    const buyTrades = recentTrades.filter(t => t.trade_type === 'buy');
    const sellTrades = recentTrades.filter(t => t.trade_type === 'sell');
    
    // Calculate average price impact (simplified - in production, would calculate actual impact)
    const avgBuyImpact = buyTrades.length > 0
      ? buyTrades.reduce((sum, t) => sum + (t.price_impact || 0), 0) / buyTrades.length
      : 0;
    
    const avgSellImpact = sellTrades.length > 0
      ? sellTrades.reduce((sum, t) => sum + (t.price_impact || 0), 0) / sellTrades.length
      : 0;
    
    return {
      avgBuy: avgBuyImpact,
      avgSell: avgSellImpact
    };
  }
  
  /**
   * Calculate liquidity depth at various price impact levels
   */
  async calculateLiquidityDepth(poolState: any): Promise<LiquidityDepth> {
    const reserves = poolState.reserves;
    
    if (!reserves || !reserves.virtualSolReserves || !reserves.virtualTokenReserves) {
      return {
        buy2Percent: 0,
        buy5Percent: 0,
        buy10Percent: 0,
        sell2Percent: 0,
        sell5Percent: 0,
        sell10Percent: 0
      };
    }
    
    // Calculate how much can be traded for various price impacts
    const calculateDepthForImpact = async (
      impact: number,
      direction: 'buy' | 'sell'
    ): Promise<number> => {
      const k = reserves.virtualSolReserves * reserves.virtualTokenReserves;
      
      if (direction === 'buy') {
        // Buying tokens with SOL
        const targetPrice = (1 + impact) * (reserves.virtualSolReserves / reserves.virtualTokenReserves);
        const newTokenReserve = Math.sqrt(k / targetPrice);
        // const tokenAmount = reserves.virtualTokenReserves - newTokenReserve; // unused
        const solRequired = (k / newTokenReserve) - reserves.virtualSolReserves;
        
        // Convert to USD
        const { getSolPrice } = await import('../services/sol-price');
        const solPrice = await getSolPrice();
        return solRequired * solPrice;
      } else {
        // Selling tokens for SOL
        const targetPrice = (1 - impact) * (reserves.virtualSolReserves / reserves.virtualTokenReserves);
        const newTokenReserve = Math.sqrt(k / targetPrice);
        // const tokenAmount = newTokenReserve - reserves.virtualTokenReserves; // unused
        const solReceived = reserves.virtualSolReserves - (k / newTokenReserve);
        
        // Convert to USD
        const { getSolPrice } = await import('../services/sol-price');
        const solPrice = await getSolPrice();
        return solReceived * solPrice;
      }
    };
    
    return {
      buy2Percent: await calculateDepthForImpact(0.02, 'buy'),
      buy5Percent: await calculateDepthForImpact(0.05, 'buy'),
      buy10Percent: await calculateDepthForImpact(0.10, 'buy'),
      sell2Percent: await calculateDepthForImpact(0.02, 'sell'),
      sell5Percent: await calculateDepthForImpact(0.05, 'sell'),
      sell10Percent: await calculateDepthForImpact(0.10, 'sell')
    };
  }
  
  /**
   * Calculate pool utilization rate
   */
  private async calculateUtilization(poolState: any, trades: any[]): Promise<number> {
    const tvl = poolState.metrics.liquidityUsd || 1;
    
    // Calculate 24h volume
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const volume24h = trades
      .filter(t => new Date(t.block_time).getTime() > oneDayAgo)
      .reduce((sum, t) => sum + (t.volume_usd || 0), 0);
    
    // Utilization = 24h volume / TVL
    return volume24h / tvl;
  }
  
  /**
   * Calculate price volatility
   */
  private async calculateVolatility(trades: any[]): Promise<number> {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    
    const recentTrades = trades
      .filter(t => new Date(t.block_time).getTime() > oneDayAgo)
      .sort((a, b) => new Date(a.block_time).getTime() - new Date(b.block_time).getTime());
    
    if (recentTrades.length < 2) return 0;
    
    // Calculate hourly prices
    const hourlyPrices: number[] = [];
    const hourSize = 60 * 60 * 1000; // 1 hour in ms
    
    for (let hour = 0; hour < 24; hour++) {
      const hourStart = oneDayAgo + (hour * hourSize);
      const hourEnd = hourStart + hourSize;
      
      const hourTrades = recentTrades.filter(t => {
        const time = new Date(t.block_time).getTime();
        return time >= hourStart && time < hourEnd;
      });
      
      if (hourTrades.length > 0) {
        const avgPrice = hourTrades.reduce((sum, t) => sum + t.price_sol, 0) / hourTrades.length;
        hourlyPrices.push(avgPrice);
      }
    }
    
    if (hourlyPrices.length < 2) return 0;
    
    // Calculate standard deviation of returns
    const returns: number[] = [];
    for (let i = 1; i < hourlyPrices.length; i++) {
      const ret = (hourlyPrices[i] - hourlyPrices[i - 1]) / hourlyPrices[i - 1];
      returns.push(ret);
    }
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // Annualize volatility (hourly to yearly)
    return stdDev * Math.sqrt(24 * 365) * 100;
  }
  
  /**
   * Generate comprehensive pool report
   */
  async generatePoolReport(poolAddress: string): Promise<PoolReport | null> {
    try {
      const [overview, performance, liquidity, users, comparison] = await Promise.all([
        this.getPoolOverview(poolAddress),
        this.getPerformanceMetrics(poolAddress),
        this.getLiquidityAnalysis(poolAddress),
        this.getUserAnalytics(poolAddress),
        this.getMarketComparison(poolAddress)
      ]);
      
      return {
        overview,
        performance,
        liquidity,
        users,
        comparison
      };
    } catch (error) {
      this.logger.error('Error generating pool report', error as Error);
      return null;
    }
  }
  
  /**
   * Helper methods for data retrieval
   */
  private async getRecentTrades(poolAddress: string): Promise<any[]> {
    const result = await db.query(
      `SELECT * FROM trades_unified 
       WHERE mint_address IN (
         SELECT mint_address FROM amm_pools WHERE pool_address = $1
       )
       AND program = 'AMM'
       AND block_time > NOW() - INTERVAL '7 days'
       ORDER BY block_time DESC`,
      [poolAddress]
    );
    return result.rows;
  }
  
  private async getLiquidityEvents(poolAddress: string): Promise<any[]> {
    const result = await db.query(
      `SELECT * FROM amm_liquidity_events 
       WHERE pool_address = $1 
       AND block_time > NOW() - INTERVAL '7 days'
       ORDER BY block_time DESC`,
      [poolAddress]
    );
    return result.rows;
  }
  
  private async getHistoricalMetrics(poolAddress: string): Promise<any[]> {
    const result = await db.query(
      `SELECT * FROM amm_pool_metrics_hourly 
       WHERE pool_address = $1 
       AND timestamp > NOW() - INTERVAL '30 days'
       ORDER BY timestamp DESC`,
      [poolAddress]
    );
    return result.rows;
  }
  
  private async getPoolOverview(poolAddress: string): Promise<PoolOverview> {
    const result = await db.query(
      `SELECT 
         p.pool_address,
         p.mint_address,
         p.created_at,
         t.symbol,
         t.name,
         perf.current_tvl_usd,
         perf.unique_traders,
         perf.total_trades,
         COUNT(DISTINCT lp.user_address) as liquidity_providers
       FROM amm_pools p
       LEFT JOIN tokens_unified t ON p.mint_address = t.mint_address
       LEFT JOIN amm_pool_performance perf ON p.pool_address = perf.pool_address
       LEFT JOIN lp_positions lp ON p.pool_address = lp.pool_address AND lp.lp_balance > 0
       WHERE p.pool_address = $1
       GROUP BY p.pool_address, p.mint_address, p.created_at, t.symbol, t.name, 
                perf.current_tvl_usd, perf.unique_traders, perf.total_trades`,
      [poolAddress]
    );
    
    const row = result.rows[0];
    return {
      poolAddress: row.pool_address,
      mintAddress: row.mint_address,
      symbol: row.symbol,
      name: row.name,
      createdAt: row.created_at,
      tvlUsd: row.current_tvl_usd || 0,
      liquidityProviders: row.liquidity_providers || 0,
      totalTrades: row.total_trades || 0
    };
  }
  
  private async getPerformanceMetrics(poolAddress: string): Promise<PerformanceMetrics> {
    const result = await db.query(
      `SELECT * FROM amm_pool_performance WHERE pool_address = $1`,
      [poolAddress]
    );
    
    const perf = result.rows[0] || {};
    
    return {
      returnMetrics: {
        feeAPY7d: perf.fee_apy_7d || 0,
        feeAPY30d: perf.fee_apy_30d || 0,
        totalReturn: perf.total_fees_usd || 0,
        sharpeRatio: perf.sharpe_ratio || 0,
        maxDrawdown: perf.max_drawdown || 0
      },
      volumeMetrics: {
        avgDailyVolume: perf.avg_daily_volume || 0,
        peakVolume: perf.highest_tvl_usd || 0,
        peakVolumeDate: perf.highest_tvl_date || new Date()
      },
      feeMetrics: {
        totalFeesGenerated: perf.total_fees_usd || 0,
        avgDailyFees: perf.avg_daily_fees || 0,
        feePerTrade: perf.total_trades > 0 ? (perf.total_fees_usd / perf.total_trades) : 0
      }
    };
  }
  
  private async getLiquidityAnalysis(poolAddress: string): Promise<LiquidityAnalysis> {
    const poolState = this.poolStateService.getPoolStateByAddress(poolAddress);
    const currentDepth = poolState ? await this.calculateLiquidityDepth(poolState) : {
      buy2Percent: 0, buy5Percent: 0, buy10Percent: 0,
      sell2Percent: 0, sell5Percent: 0, sell10Percent: 0
    };
    
    // Get historical TVL
    const tvlHistory = await db.query(
      `SELECT timestamp, tvl_usd FROM amm_pool_metrics_hourly 
       WHERE pool_address = $1 
       AND timestamp > NOW() - INTERVAL '7 days'
       ORDER BY timestamp`,
      [poolAddress]
    );
    
    // Get net liquidity flow
    const flowResult = await db.query(
      `SELECT 
         SUM(CASE WHEN event_type = 'deposit' THEN total_value_usd ELSE 0 END) as deposits,
         SUM(CASE WHEN event_type = 'withdraw' THEN total_value_usd ELSE 0 END) as withdrawals
       FROM amm_liquidity_events 
       WHERE pool_address = $1 
       AND block_time > NOW() - INTERVAL '7 days'`,
      [poolAddress]
    );
    
    const flow = flowResult.rows[0] || {};
    const netFlow7d = (flow.deposits || 0) - (flow.withdrawals || 0);
    
    // Get largest providers
    const providersResult = await db.query(
      `SELECT 
         user_address,
         total_value_usd,
         share_percentage
       FROM lp_positions 
       WHERE pool_address = $1 
       AND lp_balance > 0
       ORDER BY total_value_usd DESC
       LIMIT 10`,
      [poolAddress]
    );
    
    return {
      currentDepth,
      historicalTVL: tvlHistory.rows.map((r: any) => ({
        timestamp: r.timestamp,
        tvl: r.tvl_usd
      })),
      netFlow7d,
      largestProviders: providersResult.rows.map((r: any) => ({
        address: r.user_address,
        share: r.share_percentage
      }))
    };
  }
  
  private async getUserAnalytics(poolAddress: string): Promise<UserAnalytics> {
    // Get user statistics
    const statsResult = await db.query(
      `SELECT 
         COUNT(DISTINCT user_address) as total_users,
         COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '24 hours' THEN user_address END) as active_24h,
         COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '7 days' 
                         AND block_time > (
                           SELECT MIN(block_time) FROM trades_unified 
                           WHERE mint_address IN (SELECT mint_address FROM amm_pools WHERE pool_address = $1)
                         ) + INTERVAL '7 days'
                         THEN user_address END) as new_7d,
         AVG(volume_usd) as avg_trade_size
       FROM trades_unified 
       WHERE mint_address IN (SELECT mint_address FROM amm_pools WHERE pool_address = $1)
       AND program = 'AMM'`,
      [poolAddress]
    );
    
    const stats = statsResult.rows[0] || {};
    
    // Get top traders
    const tradersResult = await db.query(
      `SELECT 
         user_address,
         SUM(volume_usd) as total_volume
       FROM trades_unified 
       WHERE mint_address IN (SELECT mint_address FROM amm_pools WHERE pool_address = $1)
       AND program = 'AMM'
       GROUP BY user_address
       ORDER BY total_volume DESC
       LIMIT 10`,
      [poolAddress]
    );
    
    return {
      totalUsers: stats.total_users || 0,
      activeUsers24h: stats.active_24h || 0,
      newUsers7d: stats.new_7d || 0,
      avgTradeSize: stats.avg_trade_size || 0,
      topTraders: tradersResult.rows.map((r: any) => ({
        address: r.user_address,
        volume: r.total_volume
      }))
    };
  }
  
  private async getMarketComparison(poolAddress: string): Promise<MarketComparison> {
    // Get pool's performance metrics
    const poolResult = await db.query(
      `SELECT 
         current_tvl_usd,
         total_volume_usd,
         fee_apy_7d
       FROM amm_pool_performance 
       WHERE pool_address = $1`,
      [poolAddress]
    );
    
    const pool = poolResult.rows[0] || {};
    
    // Get rankings
    const tvlRankResult = await db.query(
      `SELECT COUNT(*) + 1 as rank 
       FROM amm_pool_performance 
       WHERE current_tvl_usd > $1`,
      [pool.current_tvl_usd || 0]
    );
    
    const volumeRankResult = await db.query(
      `SELECT COUNT(*) + 1 as rank 
       FROM amm_pool_performance 
       WHERE total_volume_usd > $1`,
      [pool.total_volume_usd || 0]
    );
    
    const apyRankResult = await db.query(
      `SELECT COUNT(*) + 1 as rank 
       FROM amm_pool_performance 
       WHERE fee_apy_7d > $1`,
      [pool.fee_apy_7d || 0]
    );
    
    // Get similar pools by TVL
    const similarResult = await db.query(
      `SELECT 
         p.pool_address,
         p.current_tvl_usd,
         t.symbol
       FROM amm_pool_performance p
       JOIN amm_pools ap ON p.pool_address = ap.pool_address
       LEFT JOIN tokens_unified t ON ap.mint_address = t.mint_address
       WHERE p.pool_address != $1
       AND p.current_tvl_usd BETWEEN $2 * 0.5 AND $2 * 2
       ORDER BY ABS(p.current_tvl_usd - $2)
       LIMIT 5`,
      [poolAddress, pool.current_tvl_usd || 0]
    );
    
    return {
      tvlRank: tvlRankResult.rows[0]?.rank || 0,
      volumeRank: volumeRankResult.rows[0]?.rank || 0,
      feeAPYRank: apyRankResult.rows[0]?.rank || 0,
      similarPools: similarResult.rows.map((r: any) => ({
        address: r.pool_address,
        symbol: r.symbol || 'Unknown',
        tvl: r.current_tvl_usd
      }))
    };
  }
  
  /**
   * Store calculated metrics to database
   */
  async storePoolMetrics(poolAddress: string, metrics: PoolMetrics): Promise<void> {
    try {
      // Store hourly metrics
      await db.query(
        `INSERT INTO amm_pool_metrics_hourly (
          pool_address, timestamp, tvl_usd, volume_usd, fees_usd,
          trade_count, unique_traders, avg_trade_size_usd,
          price_base_quote, base_reserve, quote_reserve,
          lp_supply, utilization_rate, volatility_1h
        ) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          poolAddress,
          metrics.tvl.current,
          metrics.volume.volume24h,
          metrics.fees.fees24h,
          0, // trade_count - would need to calculate
          0, // unique_traders - would need to calculate
          0, // avg_trade_size - would need to calculate
          0, // price_base_quote - would need to calculate
          0, // base_reserve - would need to get from pool state
          0, // quote_reserve - would need to get from pool state
          0, // lp_supply - would need to get from pool state
          metrics.utilizationRate,
          metrics.volatility
        ]
      );
      
      // Store liquidity depth
      await db.query(
        `INSERT INTO amm_liquidity_depth (
          pool_address, timestamp,
          buy_2pct_usd, buy_5pct_usd, buy_10pct_usd,
          sell_2pct_usd, sell_5pct_usd, sell_10pct_usd,
          total_liquidity_usd
        ) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8)`,
        [
          poolAddress,
          metrics.liquidityDepth.buy2Percent,
          metrics.liquidityDepth.buy5Percent,
          metrics.liquidityDepth.buy10Percent,
          metrics.liquidityDepth.sell2Percent,
          metrics.liquidityDepth.sell5Percent,
          metrics.liquidityDepth.sell10Percent,
          metrics.tvl.current
        ]
      );
      
    } catch (error) {
      this.logger.error('Error storing pool metrics', error as Error);
    }
  }
}

// Export singleton instance
export const ammPoolAnalytics = AmmPoolAnalytics.getInstance();