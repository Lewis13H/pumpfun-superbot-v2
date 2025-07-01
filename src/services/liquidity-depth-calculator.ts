/**
 * Liquidity Depth Calculator
 * Calculates liquidity depth at various price impact levels for AMM pools
 */

import { AmmPoolReserves } from '../types/amm-pool-state';
import { getSolPrice } from '../services/sol-price';

interface DepthLevel {
  priceImpact: number; // e.g., 0.02 for 2%
  buyDepthUsd: number;
  sellDepthUsd: number;
  buyAmount: number; // Amount of tokens that can be bought
  sellAmount: number; // Amount of tokens that can be sold
}

interface LiquidityDepthAnalysis {
  levels: DepthLevel[];
  totalLiquidityUsd: number;
  bidLiquidityUsd: number; // Total liquidity on buy side
  askLiquidityUsd: number; // Total liquidity on sell side
  spreadPercent: number;
  slippageProfile: SlippageProfile;
}

interface SlippageProfile {
  small: number; // Slippage for $100 trade
  medium: number; // Slippage for $1,000 trade
  large: number; // Slippage for $10,000 trade
}

interface TradeSimulation {
  inputAmount: number;
  outputAmount: number;
  executionPrice: number;
  priceImpact: number;
  slippage: number;
  effectiveFee: number;
}

export class LiquidityDepthCalculator {
  private static instance: LiquidityDepthCalculator | null = null;
  private readonly FEE_RATE = 0.003; // 0.3% standard AMM fee
  private readonly DEPTH_LEVELS = [0.01, 0.02, 0.05, 0.10, 0.20]; // 1%, 2%, 5%, 10%, 20%
  
  private constructor() {
    // Logger removed - not used
  }
  
  static getInstance(): LiquidityDepthCalculator {
    if (!this.instance) {
      this.instance = new LiquidityDepthCalculator();
    }
    return this.instance;
  }
  
  /**
   * Calculate comprehensive liquidity depth analysis
   */
  async calculateLiquidityDepth(reserves: AmmPoolReserves): Promise<LiquidityDepthAnalysis> {
    if (!reserves.virtualSolReserves || !reserves.virtualTokenReserves) {
      return this.getEmptyAnalysis();
    }
    
    const levels = await Promise.all(
      this.DEPTH_LEVELS.map(impact => 
        this.calculateDepthAtImpact(reserves, impact)
      )
    );
    
    const solPrice = await getSolPrice();
    const tokenPrice = await this.getTokenPrice(reserves, solPrice);
    
    // Calculate total liquidity
    const solLiquidity = (reserves.virtualSolReserves / 1e9) * solPrice;
    const tokenLiquidity = (reserves.virtualTokenReserves / 1e6) * tokenPrice;
    const totalLiquidityUsd = solLiquidity + tokenLiquidity;
    
    // Calculate slippage profile
    const slippageProfile = await this.calculateSlippageProfile(reserves, solPrice);
    
    // Calculate spread (difference between buy and sell price for minimal amount)
    const spread = await this.calculateSpread(reserves);
    
    return {
      levels,
      totalLiquidityUsd,
      bidLiquidityUsd: solLiquidity, // SOL side represents buy liquidity
      askLiquidityUsd: tokenLiquidity, // Token side represents sell liquidity
      spreadPercent: spread * 100,
      slippageProfile
    };
  }
  
  /**
   * Calculate depth at specific price impact level
   */
  private async calculateDepthAtImpact(reserves: AmmPoolReserves, targetImpact: number): Promise<DepthLevel> {
    const k = reserves.virtualSolReserves * reserves.virtualTokenReserves;
    const currentPrice = reserves.virtualSolReserves / reserves.virtualTokenReserves;
    const solPrice = await getSolPrice();
    
    // Calculate buy depth (buying tokens with SOL)
    const buyTargetPrice = currentPrice * (1 + targetImpact);
    const newTokenReserveBuy = Math.sqrt(k / buyTargetPrice);
    const tokensToBuy = reserves.virtualTokenReserves - newTokenReserveBuy;
    const solRequiredBuy = (k / newTokenReserveBuy) - reserves.virtualSolReserves;
    const buyDepthUsd = (solRequiredBuy / 1e9) * solPrice;
    
    // Calculate sell depth (selling tokens for SOL)
    const sellTargetPrice = currentPrice * (1 - targetImpact);
    const newTokenReserveSell = Math.sqrt(k / sellTargetPrice);
    const tokensToSell = newTokenReserveSell - reserves.virtualTokenReserves;
    const solReceivedSell = reserves.virtualSolReserves - (k / newTokenReserveSell);
    const sellDepthUsd = (solReceivedSell / 1e9) * solPrice;
    
    return {
      priceImpact: targetImpact,
      buyDepthUsd,
      sellDepthUsd,
      buyAmount: tokensToBuy / 1e6, // Convert to token units
      sellAmount: tokensToSell / 1e6
    };
  }
  
  /**
   * Calculate slippage for different trade sizes
   */
  private async calculateSlippageProfile(reserves: AmmPoolReserves, solPrice: number): Promise<SlippageProfile> {
    const tradeSizes = [100, 1000, 10000]; // USD values
    const slippages: number[] = [];
    
    for (const sizeUsd of tradeSizes) {
      // Convert USD to SOL amount
      const solAmount = (sizeUsd / solPrice) * 1e9; // Convert to lamports
      
      // Simulate buy trade
      const simulation = this.simulateTrade(
        solAmount,
        reserves.virtualSolReserves,
        reserves.virtualTokenReserves,
        'buy'
      );
      
      slippages.push(simulation.priceImpact);
    }
    
    return {
      small: slippages[0],
      medium: slippages[1],
      large: slippages[2]
    };
  }
  
  /**
   * Simulate a trade and calculate impact
   */
  simulateTrade(
    inputAmount: number,
    inputReserve: number,
    outputReserve: number,
    _direction: 'buy' | 'sell'
  ): TradeSimulation {
    const k = inputReserve * outputReserve;
    
    // Apply fee to input
    const inputAfterFee = inputAmount * (1 - this.FEE_RATE);
    
    // Calculate output using constant product formula
    const newInputReserve = inputReserve + inputAfterFee;
    const newOutputReserve = k / newInputReserve;
    const outputAmount = outputReserve - newOutputReserve;
    
    // Calculate prices
    const spotPrice = inputReserve / outputReserve;
    const executionPrice = inputAmount / outputAmount;
    const priceImpact = Math.abs(executionPrice - spotPrice) / spotPrice;
    
    // Calculate slippage (difference from expected output)
    const expectedOutput = inputAmount / spotPrice;
    const slippage = Math.abs(outputAmount - expectedOutput) / expectedOutput;
    
    // Calculate effective fee (includes price impact)
    const effectiveFee = 1 - (outputAmount * spotPrice / inputAmount);
    
    return {
      inputAmount,
      outputAmount,
      executionPrice,
      priceImpact,
      slippage,
      effectiveFee
    };
  }
  
  /**
   * Calculate spread between buy and sell prices
   */
  private async calculateSpread(reserves: AmmPoolReserves): Promise<number> {
    // const k = reserves.virtualSolReserves * reserves.virtualTokenReserves; // unused
    const spotPrice = reserves.virtualSolReserves / reserves.virtualTokenReserves;
    
    // Simulate minimal buy and sell trades
    const minimalAmount = 1e6; // 1 SOL in lamports
    
    // Buy price (slightly higher due to moving along curve)
    const buySimulation = this.simulateTrade(
      minimalAmount,
      reserves.virtualSolReserves,
      reserves.virtualTokenReserves,
      'buy'
    );
    
    // Sell price (slightly lower)
    const sellSimulation = this.simulateTrade(
      minimalAmount / spotPrice, // Equivalent token amount
      reserves.virtualTokenReserves,
      reserves.virtualSolReserves,
      'sell'
    );
    
    // Calculate spread as percentage
    const buyPrice = buySimulation.executionPrice;
    const sellPrice = 1 / sellSimulation.executionPrice; // Invert for sell
    const spread = (buyPrice - sellPrice) / spotPrice;
    
    return Math.abs(spread);
  }
  
  /**
   * Get token price in USD
   */
  private async getTokenPrice(reserves: AmmPoolReserves, solPrice: number): Promise<number> {
    const priceInSol = reserves.virtualSolReserves / reserves.virtualTokenReserves;
    return (priceInSol / 1e9) * solPrice * 1e6; // Adjust for decimals
  }
  
  /**
   * Get empty analysis for inactive pools
   */
  private getEmptyAnalysis(): LiquidityDepthAnalysis {
    return {
      levels: this.DEPTH_LEVELS.map(impact => ({
        priceImpact: impact,
        buyDepthUsd: 0,
        sellDepthUsd: 0,
        buyAmount: 0,
        sellAmount: 0
      })),
      totalLiquidityUsd: 0,
      bidLiquidityUsd: 0,
      askLiquidityUsd: 0,
      spreadPercent: 0,
      slippageProfile: {
        small: 0,
        medium: 0,
        large: 0
      }
    };
  }
  
  /**
   * Calculate optimal trade size for target slippage
   */
  async calculateOptimalTradeSize(
    reserves: AmmPoolReserves,
    maxSlippage: number,
    direction: 'buy' | 'sell'
  ): Promise<{ sizeUsd: number; expectedSlippage: number }> {
    const solPrice = await getSolPrice();
    
    // Binary search for optimal trade size
    let low = 10; // $10 minimum
    let high = 1000000; // $1M maximum
    let optimal = 0;
    let expectedSlippage = 0;
    
    while (high - low > 1) {
      const mid = (low + high) / 2;
      const solAmount = (mid / solPrice) * 1e9;
      
      const simulation = this.simulateTrade(
        solAmount,
        direction === 'buy' ? reserves.virtualSolReserves : reserves.virtualTokenReserves,
        direction === 'buy' ? reserves.virtualTokenReserves : reserves.virtualSolReserves,
        direction
      );
      
      if (simulation.priceImpact <= maxSlippage) {
        optimal = mid;
        expectedSlippage = simulation.priceImpact;
        low = mid;
      } else {
        high = mid;
      }
    }
    
    return {
      sizeUsd: optimal,
      expectedSlippage
    };
  }
  
  /**
   * Analyze liquidity distribution
   */
  async analyzeLiquidityDistribution(reserves: AmmPoolReserves): Promise<{
    balanced: boolean;
    skew: number;
    recommendation: string;
  }> {
    const solPrice = await getSolPrice();
    const tokenPrice = await this.getTokenPrice(reserves, solPrice);
    
    const solValue = (reserves.virtualSolReserves / 1e9) * solPrice;
    const tokenValue = (reserves.virtualTokenReserves / 1e6) * tokenPrice;
    const totalValue = solValue + tokenValue;
    
    const solRatio = solValue / totalValue;
    const idealRatio = 0.5;
    const skew = Math.abs(solRatio - idealRatio);
    
    const balanced = skew < 0.1; // Within 10% of ideal
    
    let recommendation = '';
    if (skew > 0.2) {
      if (solRatio > 0.5) {
        recommendation = 'Pool is SOL-heavy. Consider adding more tokens.';
      } else {
        recommendation = 'Pool is token-heavy. Consider adding more SOL.';
      }
    } else {
      recommendation = 'Pool liquidity is well-balanced.';
    }
    
    return {
      balanced,
      skew,
      recommendation
    };
  }
}

// Export singleton instance
export const liquidityDepthCalculator = LiquidityDepthCalculator.getInstance();