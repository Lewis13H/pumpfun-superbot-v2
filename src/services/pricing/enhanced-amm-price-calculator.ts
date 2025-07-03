/**
 * Enhanced AMM Price Calculator
 * Extends the base price calculator with detailed price impact and slippage analysis
 */

import { AmmPriceCalculator, PriceImpact } from '../../utils/amm/price-calculator';
import { AmmPoolState } from '../../types/amm-pool-state';
import { getSolPrice } from './sol-price-service';
import { db } from '../../database';
import { Logger } from '../../core/logger';
import chalk from 'chalk';

export interface PriceImpactDetails extends PriceImpact {
  priceImpactPercent: number;
  minimumReceived: number;
  maximumSent: number;
  effectiveFee: number;
  slippage: number;
  spotPriceSol: number;
  executionPriceSol: number;
  spotPriceUsd: number;
  executionPriceUsd: number;
}

export interface TradeSimulation {
  totalInputAmount: number;
  totalOutputAmount: number;
  averageExecutionPrice: number;
  totalPriceImpact: number;
  chunks: ChunkResult[];
  optimalChunkSize: number;
  recommendedChunks: number;
  progressiveImpacts: number[];
}

interface ChunkResult {
  chunkNumber: number;
  inputAmount: number;
  outputAmount: number;
  executionPrice: number;
  priceImpact: number;
  newReserves: {
    input: number;
    output: number;
  };
}

export interface SlippageProfile {
  tradeSizeUsd: number;
  expectedSlippage: number;
  maxSlippage: number;
  recommendedSlippageTolerance: number;
}

export class EnhancedAmmPriceCalculator extends AmmPriceCalculator {
  private static instance: EnhancedAmmPriceCalculator | null = null;
  private logger: Logger;
  private readonly DEFAULT_FEE = 0.003; // 0.3%
  private readonly DEFAULT_SLIPPAGE_TOLERANCE = 0.01; // 1%
  
  constructor() {
    super();
    this.logger = new Logger({ context: 'EnhancedPriceCalculator', color: chalk.cyan });
  }
  
  static getInstance(): EnhancedAmmPriceCalculator {
    if (!this.instance) {
      this.instance = new EnhancedAmmPriceCalculator();
    }
    return this.instance;
  }
  
  /**
   * Calculate detailed price impact for a trade
   */
  async calculateDetailedPriceImpact(
    inputAmount: bigint,
    inputReserve: bigint,
    outputReserve: bigint,
    direction: 'buy' | 'sell',
    fee: number = this.DEFAULT_FEE,
    slippageTolerance: number = this.DEFAULT_SLIPPAGE_TOLERANCE
  ): Promise<PriceImpactDetails> {
    // Get spot price before trade
    const spotPrice = this.getSpotPrice(inputReserve, outputReserve);
    
    // Calculate output amount with fee
    const inputWithFee = Number(inputAmount) * (1 - fee);
    const k = Number(inputReserve) * Number(outputReserve);
    const newInputReserve = Number(inputReserve) + inputWithFee;
    const newOutputReserve = k / newInputReserve;
    const outputAmount = Number(outputReserve) - newOutputReserve;
    
    // Calculate execution price
    const executionPrice = Number(inputAmount) / outputAmount;
    
    // Calculate price impact
    const priceImpact = (executionPrice - spotPrice) / spotPrice;
    
    // Calculate new spot price after trade
    const newSpotPrice = newInputReserve / newOutputReserve;
    
    // Apply slippage for minimum received / maximum sent
    const minimumReceived = outputAmount * (1 - slippageTolerance);
    const maximumSent = Number(inputAmount) * (1 + slippageTolerance);
    
    // Calculate effective fee (including price impact)
    const expectedOutput = Number(inputAmount) / spotPrice;
    const actualOutput = outputAmount;
    const effectiveFee = 1 - (actualOutput / expectedOutput);
    
    // Calculate slippage (difference between expected and actual)
    const slippage = Math.abs((actualOutput - expectedOutput) / expectedOutput);
    
    // Get current SOL price for USD calculations
    const solPrice = await getSolPrice();
    
    // Convert prices to USD if this is a SOL trade
    let spotPriceUsd = 0;
    let executionPriceUsd = 0;
    
    if (direction === 'buy') {
      // Buying tokens with SOL
      spotPriceUsd = (spotPrice / 1e9) * solPrice * 1e6; // SOL per token to USD
      executionPriceUsd = (executionPrice / 1e9) * solPrice * 1e6;
    } else {
      // Selling tokens for SOL
      const solPerToken = 1 / spotPrice;
      spotPriceUsd = (solPerToken / 1e9) * solPrice * 1e6;
      executionPriceUsd = ((1 / executionPrice) / 1e9) * solPrice * 1e6;
    }
    
    return {
      amountIn: Number(inputAmount),
      amountOut: outputAmount,
      priceImpact,
      priceImpactPercent: priceImpact * 100,
      executionPrice,
      spotPrice,
      newSpotPrice,
      minimumReceived,
      maximumSent,
      effectiveFee,
      slippage,
      spotPriceSol: spotPrice,
      executionPriceSol: executionPrice,
      spotPriceUsd,
      executionPriceUsd
    };
  }
  
  /**
   * Get spot price (no fee, no slippage)
   */
  private getSpotPrice(inputReserve: bigint, outputReserve: bigint): number {
    return Number(inputReserve) / Number(outputReserve);
  }
  
  /**
   * Simulate a large trade executed in chunks
   */
  async simulateLargeTrade(
    totalTradeSize: bigint,
    pool: AmmPoolState,
    direction: 'buy' | 'sell',
    chunkSize?: bigint
  ): Promise<TradeSimulation> {
    const reserves = pool.reserves;
    
    // Determine input and output reserves based on direction
    let inputReserve = direction === 'buy' 
      ? reserves.virtualSolReserves 
      : reserves.virtualTokenReserves;
    let outputReserve = direction === 'buy'
      ? reserves.virtualTokenReserves
      : reserves.virtualSolReserves;
    
    // Calculate optimal chunk size if not provided
    if (!chunkSize) {
      chunkSize = this.calculateOptimalChunkSize(totalTradeSize, BigInt(inputReserve), BigInt(outputReserve));
    }
    
    const numChunks = Math.ceil(Number(totalTradeSize) / Number(chunkSize));
    const chunks: ChunkResult[] = [];
    const progressiveImpacts: number[] = [];
    
    let remainingAmount = totalTradeSize;
    let totalOutput = 0;
    let currentInputReserve = inputReserve;
    let currentOutputReserve = outputReserve;
    
    // Simulate each chunk
    for (let i = 0; i < numChunks; i++) {
      const chunkAmount = remainingAmount > chunkSize ? chunkSize : remainingAmount;
      
      // Calculate impact for this chunk
      const impact = await this.calculateDetailedPriceImpact(
        chunkAmount,
        BigInt(currentInputReserve),
        BigInt(currentOutputReserve),
        direction
      );
      
      chunks.push({
        chunkNumber: i + 1,
        inputAmount: Number(chunkAmount),
        outputAmount: impact.amountOut,
        executionPrice: impact.executionPrice,
        priceImpact: impact.priceImpact,
        newReserves: {
          input: Number(currentInputReserve) + Number(chunkAmount),
          output: Number(currentOutputReserve) - impact.amountOut
        }
      });
      
      progressiveImpacts.push(impact.priceImpact);
      totalOutput += impact.amountOut;
      
      // Update reserves for next chunk
      currentInputReserve = chunks[i].newReserves.input;
      currentOutputReserve = chunks[i].newReserves.output;
      
      remainingAmount = remainingAmount - chunkAmount;
    }
    
    // Calculate average execution price
    const averageExecutionPrice = Number(totalTradeSize) / totalOutput;
    
    // Calculate total price impact
    const initialSpotPrice = this.getSpotPrice(BigInt(inputReserve), BigInt(outputReserve));
    const finalSpotPrice = this.getSpotPrice(
      typeof currentInputReserve === 'bigint' ? currentInputReserve : BigInt(currentInputReserve),
      typeof currentOutputReserve === 'bigint' ? currentOutputReserve : BigInt(currentOutputReserve)
    );
    const totalPriceImpact = (finalSpotPrice - initialSpotPrice) / initialSpotPrice;
    
    // Find optimal chunk size by testing different sizes
    const optimalChunkAnalysis = await this.findOptimalChunkSize(
      totalTradeSize,
      BigInt(inputReserve),
      BigInt(outputReserve),
      direction
    );
    
    return {
      totalInputAmount: Number(totalTradeSize),
      totalOutputAmount: totalOutput,
      averageExecutionPrice,
      totalPriceImpact,
      chunks,
      optimalChunkSize: optimalChunkAnalysis.optimalSize,
      recommendedChunks: optimalChunkAnalysis.recommendedChunks,
      progressiveImpacts
    };
  }
  
  /**
   * Calculate optimal chunk size for minimal price impact
   */
  private calculateOptimalChunkSize(
    totalAmount: bigint,
    inputReserve: bigint,
    _outputReserve: bigint
  ): bigint {
    // Start with 1% of reserves as chunk size
    const reservePercent = 0.01;
    const initialChunkSize = BigInt(Math.floor(Number(inputReserve) * reservePercent));
    
    // Don't make chunks too small (at least 0.1% of total trade)
    const minChunkSize = totalAmount / 1000n;
    
    // Don't make chunks too large (at most 10% of total trade)
    const maxChunkSize = totalAmount / 10n;
    
    let optimalSize = initialChunkSize;
    if (optimalSize < minChunkSize) optimalSize = minChunkSize;
    if (optimalSize > maxChunkSize) optimalSize = maxChunkSize;
    
    return optimalSize;
  }
  
  /**
   * Find optimal chunk size by testing different configurations
   */
  private async findOptimalChunkSize(
    totalAmount: bigint,
    inputReserve: bigint,
    outputReserve: bigint,
    direction: 'buy' | 'sell'
  ): Promise<{ optimalSize: number; recommendedChunks: number }> {
    const testSizes = [1, 2, 5, 10, 20, 50, 100]; // Number of chunks to test
    let bestConfig = { chunks: 1, impactScore: Infinity };
    
    for (const numChunks of testSizes) {
      const chunkSize = totalAmount / BigInt(numChunks);
      if (chunkSize === 0n) continue;
      
      // Simulate with this chunk size
      const simulation = await this.simulateLargeTrade(
        totalAmount,
        {
          reserves: {
            virtualSolReserves: Number(inputReserve),
            virtualTokenReserves: Number(outputReserve)
          }
        } as AmmPoolState,
        direction,
        chunkSize
      );
      
      // Score based on total impact and execution complexity
      const impactScore = Math.abs(simulation.totalPriceImpact) + (numChunks * 0.001); // Small penalty for more chunks
      
      if (impactScore < bestConfig.impactScore) {
        bestConfig = { chunks: numChunks, impactScore };
      }
    }
    
    return {
      optimalSize: Number(totalAmount / BigInt(bestConfig.chunks)),
      recommendedChunks: bestConfig.chunks
    };
  }
  
  /**
   * Calculate slippage profile for a pool
   */
  async calculateSlippageProfile(
    pool: AmmPoolState,
    testSizesUsd: number[] = [100, 1000, 10000, 100000]
  ): Promise<SlippageProfile[]> {
    const profiles: SlippageProfile[] = [];
    const solPrice = await getSolPrice();
    
    for (const sizeUsd of testSizesUsd) {
      // Convert USD to SOL amount
      const solAmount = BigInt(Math.floor((sizeUsd / solPrice) * 1e9));
      
      // Calculate impact for buy direction
      const buyImpact = await this.calculateDetailedPriceImpact(
        solAmount,
        BigInt(pool.reserves.virtualSolReserves),
        BigInt(pool.reserves.virtualTokenReserves),
        'buy'
      );
      
      profiles.push({
        tradeSizeUsd: sizeUsd,
        expectedSlippage: buyImpact.slippage,
        maxSlippage: buyImpact.priceImpact,
        recommendedSlippageTolerance: Math.max(buyImpact.slippage * 1.5, 0.01) // 50% buffer or 1% minimum
      });
    }
    
    return profiles;
  }
  
  /**
   * Apply slippage tolerance to an amount
   */
  applySlippage(amount: number, slippageTolerance: number): number {
    return amount * (1 - slippageTolerance);
  }
  
  /**
   * Calculate effective fee including price impact
   */
  calculateEffectiveFee(_inputAmount: number, nominalFee: number, priceImpact: number): number {
    // Effective fee = nominal fee + price impact
    return nominalFee + Math.abs(priceImpact);
  }
  
  /**
   * Store slippage analysis for a pool
   */
  async storeSlippageAnalysis(poolAddress: string, profiles: SlippageProfile[]): Promise<void> {
    try {
      // Extract slippage values for standard trade sizes
      const slippage100 = profiles.find(p => p.tradeSizeUsd === 100)?.expectedSlippage || 0;
      const slippage1k = profiles.find(p => p.tradeSizeUsd === 1000)?.expectedSlippage || 0;
      const slippage10k = profiles.find(p => p.tradeSizeUsd === 10000)?.expectedSlippage || 0;
      const slippage100k = profiles.find(p => p.tradeSizeUsd === 100000)?.expectedSlippage || 0;
      
      // Calculate average and max
      const avgSlippage = profiles.reduce((sum, p) => sum + p.expectedSlippage, 0) / profiles.length;
      const maxSlippage = Math.max(...profiles.map(p => p.expectedSlippage));
      
      await db.query(
        `INSERT INTO slippage_analysis (
          pool_address, timestamp,
          trade_size_100_usd, trade_size_1k_usd,
          trade_size_10k_usd, trade_size_100k_usd,
          avg_daily_slippage, max_daily_slippage
        ) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7)`,
        [poolAddress, slippage100, slippage1k, slippage10k, slippage100k, avgSlippage, maxSlippage]
      );
    } catch (error) {
      this.logger.error('Error storing slippage analysis', error as Error);
    }
  }
  
  /**
   * Categorize price impact severity
   */
  categorizePriceImpact(impact: number): string {
    const absImpact = Math.abs(impact);
    
    if (absImpact < 0.001) return 'negligible';
    if (absImpact < 0.005) return 'low';
    if (absImpact < 0.02) return 'medium';
    if (absImpact < 0.05) return 'high';
    return 'severe';
  }
}

// Export singleton instance
export const enhancedAmmPriceCalculator = EnhancedAmmPriceCalculator.getInstance();