/**
 * Pool Analytics Handler
 * Handles analytics events and coordinates metric calculations
 */

import { EventBus, EVENTS } from '../core/event-bus';
import { ammPoolAnalytics } from '../services/amm-pool-analytics';
import { AmmMetricsAggregator } from '../services/amm-metrics-aggregator';
import { liquidityDepthCalculator } from '../services/liquidity-depth-calculator';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { Logger } from '../core/logger';
import chalk from 'chalk';

interface AnalyticsConfig {
  enableRealTimeAnalytics: boolean;
  metricsUpdateInterval: number; // ms
  depthAnalysisThreshold: number; // Min TVL for depth analysis
}

export class PoolAnalyticsHandler {
  private logger: Logger;
  private eventBus: EventBus;
  private metricsAggregator: AmmMetricsAggregator;
  private poolStateService: AmmPoolStateService;
  private config: AnalyticsConfig;
  private updateTimers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'PoolAnalyticsHandler', color: chalk.magenta });
    this.eventBus = eventBus;
    this.metricsAggregator = AmmMetricsAggregator.getInstance(eventBus);
    this.poolStateService = AmmPoolStateService.getInstance();
    
    this.config = {
      enableRealTimeAnalytics: true,
      metricsUpdateInterval: 60000, // 1 minute
      depthAnalysisThreshold: 1000 // $1,000 TVL minimum
    };
    
    this.setupEventListeners();
  }
  
  /**
   * Initialize the handler
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing pool analytics handler');
    
    // Start metrics aggregator
    this.metricsAggregator.start();
    
    // Run initial analytics for all pools
    await this.analyzeAllPools();
    
    this.logger.info('Pool analytics handler initialized');
  }
  
  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Analyze pool when significant trade occurs
    this.eventBus.on(EVENTS.AMM_TRADE, async (data) => {
      if (data.volumeUsd > 100) { // Significant trade
        this.schedulePoolAnalysis(data.poolAddress);
      }
    });
    
    // Analyze pool on liquidity events
    this.eventBus.on(EVENTS.LIQUIDITY_PROCESSED, async (data) => {
      if (data.totalValueUsd > 1000) { // Significant liquidity event
        await this.analyzePool(data.poolAddress);
      }
    });
    
    // Update metrics when pool state changes
    this.eventBus.on(EVENTS.POOL_STATE_UPDATED, async (data) => {
      this.schedulePoolAnalysis(data.poolAddress);
    });
    
    // Handle new pool creation
    this.eventBus.on(EVENTS.POOL_CREATED, async (data) => {
      this.logger.info('New pool created, scheduling initial analysis', {
        poolAddress: data.poolAddress,
        mintAddress: data.mintAddress
      });
      
      // Wait a bit for initial trades before analyzing
      setTimeout(() => {
        this.analyzePool(data.poolAddress);
      }, 5000);
    });
  }
  
  /**
   * Schedule pool analysis with debouncing
   */
  private schedulePoolAnalysis(poolAddress: string): void {
    if (!this.config.enableRealTimeAnalytics) return;
    
    // Clear existing timer
    const existingTimer = this.updateTimers.get(poolAddress);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Schedule new analysis
    const timer = setTimeout(() => {
      this.analyzePool(poolAddress);
      this.updateTimers.delete(poolAddress);
    }, 5000); // 5 second debounce
    
    this.updateTimers.set(poolAddress, timer);
  }
  
  /**
   * Analyze a specific pool
   */
  async analyzePool(poolAddress: string): Promise<void> {
    try {
      const poolState = this.poolStateService.getPoolStateByAddress(poolAddress);
      if (!poolState) {
        this.logger.warn(`Pool state not found for ${poolAddress}`);
        return;
      }
      
      // Skip analysis for low liquidity pools
      if (poolState.metrics.liquidityUsd < this.config.depthAnalysisThreshold) {
        return;
      }
      
      // Calculate comprehensive metrics
      const metrics = await ammPoolAnalytics.calculatePoolMetrics(poolAddress);
      if (!metrics) return;
      
      // Store metrics
      await ammPoolAnalytics.storePoolMetrics(poolAddress, metrics);
      
      // Calculate liquidity depth
      const depthAnalysis = liquidityDepthCalculator.calculateLiquidityDepth(poolState.reserves);
      
      // Emit analytics update event
      this.eventBus.emit('POOL_ANALYTICS_UPDATED', {
        poolAddress,
        mintAddress: poolState.reserves.mintAddress,
        metrics,
        depthAnalysis,
        timestamp: new Date()
      });
      
      // Log significant findings
      if (metrics.fees.apy > 100) {
        this.logger.info('High APY pool detected', {
          poolAddress: poolAddress.slice(0, 8) + '...',
          apy: metrics.fees.apy.toFixed(2) + '%',
          tvl: '$' + metrics.tvl.current.toFixed(0)
        });
      }
      
      if (metrics.utilizationRate > 5) {
        this.logger.info('High utilization pool', {
          poolAddress: poolAddress.slice(0, 8) + '...',
          utilization: metrics.utilizationRate.toFixed(2),
          volume24h: '$' + metrics.volume.volume24h.toFixed(0)
        });
      }
      
    } catch (error) {
      this.logger.error(`Error analyzing pool ${poolAddress}`, error as Error);
    }
  }
  
  /**
   * Analyze all active pools
   */
  async analyzeAllPools(): Promise<void> {
    try {
      const pools = this.poolStateService.getAllPools();
      
      this.logger.info(`Analyzing ${pools.size} pools`);
      
      let analyzed = 0;
      for (const [, poolState] of pools) {
        if (poolState.isActive && poolState.metrics.liquidityUsd >= this.config.depthAnalysisThreshold) {
          await this.analyzePool(poolState.account.poolAddress);
          analyzed++;
          
          // Rate limit to avoid overload
          if (analyzed % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      this.logger.info(`Completed analysis of ${analyzed} pools`);
    } catch (error) {
      this.logger.error('Error analyzing all pools', error as Error);
    }
  }
  
  /**
   * Generate pool report
   */
  async generatePoolReport(poolAddress: string): Promise<any> {
    try {
      const report = await ammPoolAnalytics.generatePoolReport(poolAddress);
      
      if (report) {
        // Enhance report with real-time depth analysis
        const poolState = this.poolStateService.getPoolStateByAddress(poolAddress);
        if (poolState) {
          const depthAnalysis = liquidityDepthCalculator.calculateLiquidityDepth(poolState.reserves);
          const distribution = liquidityDepthCalculator.analyzeLiquidityDistribution(poolState.reserves);
          
          return {
            ...report,
            depthAnalysis,
            liquidityDistribution: distribution
          };
        }
      }
      
      return report;
    } catch (error) {
      this.logger.error('Error generating pool report', error as Error);
      return null;
    }
  }
  
  /**
   * Get top performing pools
   */
  async getTopPools(criteria: 'tvl' | 'volume' | 'apy' | 'utilization', limit: number = 10): Promise<any[]> {
    try {
      const pools = this.poolStateService.getAllPools();
      const poolMetrics: any[] = [];
      
      for (const [mintAddress, poolState] of pools) {
        if (!poolState.isActive) continue;
        
        const metrics = await ammPoolAnalytics.calculatePoolMetrics(poolState.account.poolAddress);
        if (!metrics) continue;
        
        poolMetrics.push({
          poolAddress: poolState.account.poolAddress,
          mintAddress,
          symbol: 'Unknown', // Symbol would need to come from token metadata
          tvl: metrics.tvl.current,
          volume24h: metrics.volume.volume24h,
          apy: metrics.fees.apy,
          utilization: metrics.utilizationRate,
          volatility: metrics.volatility
        });
      }
      
      // Sort by criteria
      poolMetrics.sort((a, b) => {
        switch (criteria) {
          case 'tvl':
            return b.tvl - a.tvl;
          case 'volume':
            return b.volume24h - a.volume24h;
          case 'apy':
            return b.apy - a.apy;
          case 'utilization':
            return b.utilization - a.utilization;
          default:
            return 0;
        }
      });
      
      return poolMetrics.slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting top pools', error as Error);
      return [];
    }
  }
  
  /**
   * Shutdown handler
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down pool analytics handler');
    
    // Clear all timers
    for (const timer of this.updateTimers.values()) {
      clearTimeout(timer);
    }
    this.updateTimers.clear();
    
    // Stop metrics aggregator
    this.metricsAggregator.stop();
    
    this.logger.info('Pool analytics handler shutdown complete');
  }
  
  /**
   * Get handler statistics
   */
  getStats() {
    return {
      pendingAnalysis: this.updateTimers.size,
      aggregatorStats: this.metricsAggregator.getStats(),
      config: this.config
    };
  }
}