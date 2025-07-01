/**
 * Trade Simulation Service
 * Provides advanced trade simulation and optimization capabilities
 */

import { AmmPoolStateService } from './amm-pool-state-service';
import { enhancedAmmPriceCalculator, TradeSimulation } from './enhanced-amm-price-calculator';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { EventBus, EVENTS } from '../core/event-bus';

export interface TradeOptimization {
  poolAddress: string;
  mintAddress: string;
  direction: 'buy' | 'sell';
  totalAmountUsd: number;
  optimalStrategy: OptimalStrategy;
  simulations: SimulationComparison[];
  recommendation: string;
}

interface OptimalStrategy {
  numChunks: number;
  chunkSizeUsd: number;
  expectedPriceImpact: number;
  expectedSlippage: number;
  totalFeesUsd: number;
  executionTimeEstimate: number; // seconds
}

interface SimulationComparison {
  strategy: string;
  numChunks: number;
  totalPriceImpact: number;
  averageSlippage: number;
  totalCost: number; // Including fees and slippage
}

export class TradeSimulationService {
  private static instance: TradeSimulationService | null = null;
  private logger: Logger;
  private poolStateService: AmmPoolStateService;
  private eventBus: EventBus;
  
  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'TradeSimulationService', color: chalk.magenta });
    this.poolStateService = AmmPoolStateService.getInstance();
    this.eventBus = eventBus;
  }
  
  static getInstance(eventBus: EventBus): TradeSimulationService {
    if (!this.instance) {
      this.instance = new TradeSimulationService(eventBus);
    }
    return this.instance;
  }
  
  /**
   * Simulate and optimize a large trade
   */
  async optimizeTrade(
    poolAddress: string,
    amountUsd: number,
    direction: 'buy' | 'sell'
  ): Promise<TradeOptimization | null> {
    try {
      const poolState = this.poolStateService.getPoolStateByAddress(poolAddress);
      if (!poolState) {
        this.logger.warn(`Pool state not found for ${poolAddress}`);
        return null;
      }
      
      // Convert USD to token amounts
      const { getSolPrice } = await import('./sol-price');
      const solPrice = await getSolPrice();
      const solAmount = BigInt(Math.floor((amountUsd / solPrice) * 1e9));
      
      // Run multiple simulations with different strategies
      const simulations = await this.runSimulationStrategies(
        poolState,
        solAmount,
        direction
      );
      
      // Find optimal strategy
      const optimal = this.selectOptimalStrategy(simulations, amountUsd);
      
      // Generate recommendation
      const recommendation = this.generateRecommendation(
        optimal,
        simulations,
        poolState.metrics.liquidityUsd
      );
      
      // Store simulation results
      await this.storeSimulation(poolAddress, poolState.reserves.mintAddress, {
        direction,
        totalAmountUsd: amountUsd,
        optimalStrategy: optimal,
        simulations,
        recommendation
      });
      
      return {
        poolAddress,
        mintAddress: poolState.reserves.mintAddress,
        direction,
        totalAmountUsd: amountUsd,
        optimalStrategy: optimal,
        simulations,
        recommendation
      };
    } catch (error) {
      this.logger.error('Error optimizing trade', error as Error);
      return null;
    }
  }
  
  /**
   * Run multiple simulation strategies
   */
  private async runSimulationStrategies(
    poolState: any,
    amount: bigint,
    direction: 'buy' | 'sell'
  ): Promise<SimulationComparison[]> {
    const strategies = [
      { name: 'Single Trade', chunks: 1 },
      { name: 'Small Chunks', chunks: 10 },
      { name: 'Medium Chunks', chunks: 5 },
      { name: 'Large Chunks', chunks: 2 },
      { name: 'Optimal', chunks: 0 } // Will be calculated
    ];
    
    const comparisons: SimulationComparison[] = [];
    
    for (const strategy of strategies) {
      let simulation: TradeSimulation;
      
      if (strategy.chunks === 0) {
        // Let the calculator determine optimal chunks
        simulation = await enhancedAmmPriceCalculator.simulateLargeTrade(
          amount,
          poolState,
          direction
        );
      } else {
        // Use specified chunk count
        const chunkSize = amount / BigInt(strategy.chunks);
        simulation = await enhancedAmmPriceCalculator.simulateLargeTrade(
          amount,
          poolState,
          direction,
          chunkSize
        );
      }
      
      // Calculate total cost including impact and fees
      const avgSlippage = simulation.progressiveImpacts.reduce((a, b) => a + b, 0) / simulation.progressiveImpacts.length;
      const totalCost = simulation.totalInputAmount * (1 + Math.abs(simulation.totalPriceImpact) + 0.003); // Including 0.3% fee
      
      comparisons.push({
        strategy: strategy.name,
        numChunks: strategy.chunks || simulation.recommendedChunks,
        totalPriceImpact: simulation.totalPriceImpact,
        averageSlippage: avgSlippage,
        totalCost
      });
    }
    
    return comparisons;
  }
  
  /**
   * Select optimal strategy based on simulations
   */
  private selectOptimalStrategy(
    simulations: SimulationComparison[],
    amountUsd: number
  ): OptimalStrategy {
    // Find strategy with lowest total cost
    const optimal = simulations.reduce((best, current) => 
      current.totalCost < best.totalCost ? current : best
    );
    
    // Estimate execution time (30 seconds per chunk as rough estimate)
    const executionTime = optimal.numChunks * 30;
    
    return {
      numChunks: optimal.numChunks,
      chunkSizeUsd: amountUsd / optimal.numChunks,
      expectedPriceImpact: optimal.totalPriceImpact,
      expectedSlippage: optimal.averageSlippage,
      totalFeesUsd: amountUsd * 0.003, // 0.3% fee
      executionTimeEstimate: executionTime
    };
  }
  
  /**
   * Generate trade recommendation
   */
  private generateRecommendation(
    optimal: OptimalStrategy,
    simulations: SimulationComparison[],
    liquidityUsd: number
  ): string {
    const impactPercent = Math.abs(optimal.expectedPriceImpact * 100);
    const tradeToLiquidityRatio = optimal.chunkSizeUsd / liquidityUsd;
    
    let recommendation = '';
    
    // Impact-based recommendation
    if (impactPercent < 1) {
      recommendation = 'Low impact trade. Can execute as single transaction.';
    } else if (impactPercent < 5) {
      recommendation = `Moderate impact (${impactPercent.toFixed(2)}%). Consider splitting into ${optimal.numChunks} chunks.`;
    } else {
      recommendation = `High impact (${impactPercent.toFixed(2)}%). Strongly recommend ${optimal.numChunks} chunks over ${Math.round(optimal.executionTimeEstimate / 60)} minutes.`;
    }
    
    // Liquidity-based warning
    if (tradeToLiquidityRatio > 0.1) {
      recommendation += ' ⚠️ Large trade relative to pool liquidity. Consider smaller size or different pool.';
    }
    
    // Compare to single trade
    const singleTrade = simulations.find(s => s.numChunks === 1);
    if (singleTrade && optimal.numChunks > 1) {
      const savings = ((singleTrade.totalCost - simulations.find(s => s.strategy === optimal.numChunks.toString())!.totalCost) / singleTrade.totalCost * 100);
      if (savings > 0) {
        recommendation += ` Chunking saves ~${savings.toFixed(1)}% vs single trade.`;
      }
    }
    
    return recommendation;
  }
  
  /**
   * Store simulation results
   */
  private async storeSimulation(
    poolAddress: string,
    mintAddress: string,
    optimization: Omit<TradeOptimization, 'poolAddress' | 'mintAddress'>
  ): Promise<void> {
    try {
      await db.query(
        `INSERT INTO trade_simulations (
          pool_address, mint_address, direction,
          total_input_amount, chunk_size, num_chunks,
          average_price, total_price_impact,
          progressive_impacts, optimal_chunk_size,
          recommended_chunks
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          poolAddress,
          mintAddress,
          optimization.direction,
          optimization.totalAmountUsd,
          optimization.optimalStrategy.chunkSizeUsd,
          optimization.optimalStrategy.numChunks,
          0, // Average price would need to be calculated
          optimization.optimalStrategy.expectedPriceImpact,
          JSON.stringify(optimization.simulations),
          optimization.optimalStrategy.chunkSizeUsd,
          optimization.optimalStrategy.numChunks
        ]
      );
      
      // Emit event for real-time updates
      this.eventBus.emit('TRADE_SIMULATION_COMPLETED', {
        poolAddress,
        mintAddress,
        optimization,
        timestamp: new Date()
      });
      
    } catch (error) {
      this.logger.error('Error storing simulation', error as Error);
    }
  }
  
  /**
   * Analyze historical slippage for a pool
   */
  async analyzeHistoricalSlippage(poolAddress: string, days: number = 7): Promise<any> {
    try {
      const result = await db.query(
        `SELECT 
          AVG(price_impact) as avg_impact,
          MAX(ABS(price_impact)) as max_impact,
          AVG(slippage) as avg_slippage,
          MAX(slippage) as max_slippage,
          COUNT(*) as trade_count,
          AVG(CASE WHEN volume_usd > 10000 THEN price_impact END) as avg_large_trade_impact
        FROM trades_unified
        WHERE mint_address IN (
          SELECT mint_address FROM amm_pools WHERE pool_address = $1
        )
        AND block_time > NOW() - INTERVAL '${days} days'
        AND program = 'AMM'`,
        [poolAddress]
      );
      
      const stats = result.rows[0] || {};
      
      return {
        averageImpact: stats.avg_impact || 0,
        maxImpact: stats.max_impact || 0,
        averageSlippage: stats.avg_slippage || 0,
        maxSlippage: stats.max_slippage || 0,
        tradeCount: stats.trade_count || 0,
        largeTradePriceImpact: stats.avg_large_trade_impact || 0,
        recommendation: this.generateSlippageRecommendation(stats)
      };
    } catch (error) {
      this.logger.error('Error analyzing historical slippage', error as Error);
      return null;
    }
  }
  
  /**
   * Generate slippage recommendation based on historical data
   */
  private generateSlippageRecommendation(stats: any): string {
    // const avgSlippage = stats.avg_slippage || 0;
    const maxSlippage = stats.max_slippage || 0;
    
    if (maxSlippage < 0.01) {
      return 'Very stable pool. 1% slippage tolerance recommended.';
    } else if (maxSlippage < 0.03) {
      return 'Moderately stable pool. 3% slippage tolerance recommended.';
    } else if (maxSlippage < 0.05) {
      return 'Volatile pool. 5% slippage tolerance recommended.';
    } else {
      return `High volatility pool. ${Math.ceil(maxSlippage * 100 + 2)}% slippage tolerance recommended.`;
    }
  }
  
  /**
   * Monitor large trades and alert on high impact
   */
  async monitorLargeTrades(threshold: number = 10000): Promise<void> {
    this.eventBus.on(EVENTS.AMM_TRADE, async (data) => {
      if (data.volumeUsd >= threshold) {
        const poolState = this.poolStateService.getPoolStateByAddress(data.poolAddress);
        if (!poolState) return;
        
        // Calculate what the impact would have been with optimization
        const optimization = await this.optimizeTrade(
          data.poolAddress,
          data.volumeUsd,
          data.trade.tradeType
        );
        
        if (optimization && data.priceImpact) {
          const potentialSavings = Math.abs(data.priceImpact) - Math.abs(optimization.optimalStrategy.expectedPriceImpact);
          
          if (potentialSavings > 0.01) { // 1% or more savings
            this.logger.info('Large trade detected with optimization potential', {
              pool: data.poolAddress.slice(0, 8) + '...',
              volume: `$${data.volumeUsd.toFixed(0)}`,
              actualImpact: `${(data.priceImpact * 100).toFixed(2)}%`,
              optimalImpact: `${(optimization.optimalStrategy.expectedPriceImpact * 100).toFixed(2)}%`,
              potentialSavings: `${(potentialSavings * 100).toFixed(2)}%`
            });
            
            // Emit alert event
            this.eventBus.emit('HIGH_IMPACT_TRADE_ALERT', {
              ...data,
              optimization,
              potentialSavings
            });
          }
        }
      }
    });
  }
  
  /**
   * Get optimization statistics
   */
  async getOptimizationStats(poolAddress?: string): Promise<any> {
    try {
      let query = `
        SELECT 
          COUNT(*) as total_simulations,
          AVG(num_chunks) as avg_chunks,
          AVG(total_price_impact) as avg_impact,
          SUM(CASE WHEN num_chunks > 1 THEN 1 ELSE 0 END) as chunked_trades,
          AVG(CASE WHEN num_chunks > 1 THEN total_price_impact END) as avg_chunked_impact
        FROM trade_simulations
      `;
      
      const params: any[] = [];
      if (poolAddress) {
        query += ' WHERE pool_address = $1';
        params.push(poolAddress);
      }
      
      const result = await db.query(query, params);
      return result.rows[0] || {};
    } catch (error) {
      this.logger.error('Error getting optimization stats', error as Error);
      return {};
    }
  }
}