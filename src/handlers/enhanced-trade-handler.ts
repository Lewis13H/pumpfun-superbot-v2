/**
 * Enhanced Trade Handler
 * Extends base trade handler with price impact and slippage calculations
 */

import { TradeHandler } from './trade-handler';
import { enhancedAmmPriceCalculator } from '../services/enhanced-amm-price-calculator';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
// import { EVENTS } from '../core/event-bus';
import { TradeEvent, EventType } from '../parsers/types';
import { Trade } from '../repositories/trade-repository';
import { Logger } from '../core/logger';
import { TOKENS } from '../core/container';
import chalk from 'chalk';

export interface EnhancedTrade extends Trade {
  priceImpact?: number;
  effectiveFee?: number;
  spotPrice?: number;
  executionPrice?: number;
  slippage?: number;
  minimumReceived?: bigint;
  maximumSent?: bigint;
  poolAddress?: string;
}

export class EnhancedTradeHandler extends TradeHandler {
  private poolStateService: AmmPoolStateService;
  private enhancedLogger: Logger;
  private container: any;
  private enhancedEventBus: any;
  
  constructor(options: any) {
    super(options);
    this.poolStateService = AmmPoolStateService.getInstance();
    this.enhancedLogger = new Logger({ context: 'EnhancedTradeHandler', color: chalk.yellow });
    this.container = options.container || options;
    this.enhancedEventBus = options.eventBus;
  }
  
  /**
   * Process trade with enhanced price impact calculations
   */
  async processTrade(
    event: TradeEvent,
    solPriceUsd: number
  ): Promise<{ saved: boolean; token?: any }> {
    try {
      // Process trade normally first
      const result = await super.processTrade(event, solPriceUsd);
      
      // For AMM trades, calculate and store price impact
      if (event.type === EventType.AMM_TRADE && 'poolAddress' in event && event.signature) {
        const enhancedData = await this.calculatePriceImpact(event);
        
        if (enhancedData && enhancedData.priceImpact) {
          // Update trade in database with enhanced fields
          await this.updateTradeWithEnhancedData(event.signature, enhancedData);
          
          // Log high impact trades
          if (Math.abs(enhancedData.priceImpact) > 0.05) {
            const volumeUsd = Number(event.solAmount) / 1e9 * solPriceUsd;
            this.enhancedLogger.warn('High price impact trade detected', {
              signature: event.signature.slice(0, 8) + '...',
              impact: `${(enhancedData.priceImpact * 100).toFixed(2)}%`,
              volume: `$${volumeUsd.toFixed(0)}`
            });
          }
        }
      }
      
      return result;
      
    } catch (error) {
      this.enhancedLogger.error('Error processing enhanced trade', error as Error);
      // Fallback to normal processing
      return super.processTrade(event, solPriceUsd);
    }
  }
  
  /**
   * Calculate price impact for AMM trades
   */
  private async calculatePriceImpact(
    event: TradeEvent
  ): Promise<Partial<EnhancedTrade> | null> {
    try {
      // Only for AMM trades with pool address
      if (!('poolAddress' in event)) return null;
      
      const poolAddress = (event as any).poolAddress;
      const poolState = this.poolStateService.getPoolStateByAddress(poolAddress);
      if (!poolState || !poolState.reserves.virtualSolReserves || !poolState.reserves.virtualTokenReserves) {
        return null;
      }
      
      // Determine direction and amounts
      const isBuy = event.tradeType === 'buy';
      const inputAmount = isBuy ? event.solAmount : event.tokenAmount;
      const inputReserve = isBuy 
        ? BigInt(poolState.reserves.virtualSolReserves)
        : BigInt(poolState.reserves.virtualTokenReserves);
      const outputReserve = isBuy
        ? BigInt(poolState.reserves.virtualTokenReserves)
        : BigInt(poolState.reserves.virtualSolReserves);
      
      // Calculate price impact
      const impact = await enhancedAmmPriceCalculator.calculateDetailedPriceImpact(
        inputAmount,
        inputReserve,
        outputReserve,
        isBuy ? 'buy' : 'sell'
      );
      
      // Emit price impact event for monitoring
      this.enhancedEventBus.emit('PRICE_IMPACT_CALCULATED', {
        signature: event.signature,
        poolAddress,
        mintAddress: event.mintAddress,
        priceImpact: impact.priceImpact,
        slippage: impact.slippage,
        volumeUsd: Number(event.solAmount) / 1e9 * 180, // Approximate for event
        impactCategory: enhancedAmmPriceCalculator.categorizePriceImpact(impact.priceImpact)
      });
      
      return {
        priceImpact: impact.priceImpact,
        effectiveFee: impact.effectiveFee,
        spotPrice: impact.spotPriceSol,
        executionPrice: impact.executionPriceSol,
        slippage: impact.slippage,
        minimumReceived: BigInt(Math.floor(impact.minimumReceived)),
        maximumSent: BigInt(Math.floor(impact.maximumSent))
      };
      
    } catch (error) {
      this.enhancedLogger.error('Error calculating price impact', error as Error);
      return null;
    }
  }
  
  /**
   * Update trade with enhanced data
   */
  private async updateTradeWithEnhancedData(
    signature: string,
    enhancedData: Partial<EnhancedTrade>
  ): Promise<void> {
    try {
      // Get access to protected tradeRepo through a public method
      const db = await this.getDatabase();
      
      await db.query(
        `UPDATE trades_unified SET
          price_impact = $2,
          effective_fee = $3,
          spot_price = $4,
          execution_price = $5,
          slippage = $6
        WHERE signature = $1`,
        [
          signature,
          enhancedData.priceImpact,
          enhancedData.effectiveFee,
          enhancedData.spotPrice,
          enhancedData.executionPrice,
          enhancedData.slippage
        ]
      );
      
    } catch (error) {
      this.enhancedLogger.error('Error updating trade with enhanced data', error as Error);
    }
  }
  
  /**
   * Get database connection
   */
  private async getDatabase(): Promise<any> {
    // Access database through container
    return this.container.resolve(TOKENS.DatabaseService);
  }
  
  // /**
  //  * Update slippage analysis for pool
  //  */
  // private async updateSlippageAnalysis(_poolAddress: string): Promise<void> {
  //   try {
  //     const poolState = this.poolStateService.getPoolStateByAddress(_poolAddress);
  //     if (!poolState) return;
  //     
  //     // Calculate slippage profile
  //     const profiles = await enhancedAmmPriceCalculator.calculateSlippageProfile(poolState);
  //     
  //     // Store analysis
  //     await enhancedAmmPriceCalculator.storeSlippageAnalysis(_poolAddress, profiles);
  //     
  //   } catch (error) {
  //     this.enhancedLogger.error('Error updating slippage analysis', error as Error);
  //   }
  // }
  
  /**
   * Monitor price impact trends
   */
  async monitorPriceImpactTrends(): Promise<void> {
    // Set up periodic analysis
    setInterval(async () => {
      try {
        const db = await this.getDatabase();
        const result = await db.query(`
          SELECT 
            mint_address,
            AVG(price_impact) as avg_impact,
            MAX(ABS(price_impact)) as max_impact,
            COUNT(*) as trade_count
          FROM trades_unified
          WHERE block_time > NOW() - INTERVAL '1 hour'
          AND program = 'amm_pool'
          AND price_impact IS NOT NULL
          GROUP BY mint_address
          HAVING COUNT(*) > 10
          ORDER BY AVG(ABS(price_impact)) DESC
          LIMIT 10
        `);
        
        if (result && result.rows && result.rows.length > 0) {
          this.enhancedLogger.info('High impact tokens (last hour):', {
            tokens: result.rows.map((r: any) => ({
              mint: r.mint_address.slice(0, 8) + '...',
              avgImpact: `${(r.avg_impact * 100).toFixed(2)}%`,
              maxImpact: `${(r.max_impact * 100).toFixed(2)}%`,
              trades: r.trade_count
            }))
          });
        }
      } catch (error) {
        this.enhancedLogger.error('Error monitoring price impact trends', error as Error);
      }
    }, 300000); // Every 5 minutes
  }
}