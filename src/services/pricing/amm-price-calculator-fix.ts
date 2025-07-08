/**
 * AMM Price Calculator Fix
 * Calculates accurate prices for AMM tokens using actual circulating supply
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Logger } from '../../core/logger';

export interface AMMPriceInfo {
  priceInSol: number;
  priceInUsd: number;
  marketCapUsd: number;
  circulatingSupply: number;
  totalSupply: number;
}

export class AMMPriceCalculator {
  private logger = new Logger({ context: 'AMMPriceCalculator' });
  
  // Pump.fun tokens typically have 10% circulating supply
  private readonly PUMP_FUN_CIRCULATING_RATIO = 0.1;
  private readonly TOKEN_DECIMALS = 6;
  
  /**
   * Calculate AMM price using reserves and circulating supply
   * For pump.fun tokens that graduated to AMM, we need to account for:
   * 1. The actual reserves in the AMM pool
   * 2. The circulating supply (typically 10% of total for pump.fun)
   */
  calculateAMMPrice(
    solReserves: bigint,
    tokenReserves: bigint,
    totalSupply: bigint,
    decimals: number,
    solPriceUsd: number,
    isPumpFunToken: boolean = true
  ): AMMPriceInfo {
    // Convert reserves to numbers with proper decimal handling
    const solReservesNum = Number(solReserves) / Number(LAMPORTS_PER_SOL);
    const tokenReservesNum = Number(tokenReserves) / Math.pow(10, decimals);
    const totalSupplyNum = Number(totalSupply) / Math.pow(10, decimals);
    
    // Calculate price per token in SOL using AMM formula
    const priceInSol = solReservesNum / tokenReservesNum;
    const priceInUsd = priceInSol * solPriceUsd;
    
    // Calculate circulating supply
    // For pump.fun tokens, only 10% is in circulation
    // The rest is locked in the bonding curve contract
    const circulatingSupply = isPumpFunToken 
      ? totalSupplyNum * this.PUMP_FUN_CIRCULATING_RATIO
      : totalSupplyNum;
    
    // Market cap should be based on circulating supply, not total supply
    const marketCapUsd = priceInUsd * circulatingSupply;
    
    this.logger.debug('AMM Price Calculation:', {
      solReserves: solReservesNum,
      tokenReserves: tokenReservesNum,
      totalSupply: totalSupplyNum,
      circulatingSupply,
      priceInSol,
      priceInUsd,
      marketCapUsd,
      isPumpFunToken
    });
    
    return {
      priceInSol,
      priceInUsd,
      marketCapUsd,
      circulatingSupply,
      totalSupply: totalSupplyNum
    };
  }
  
  /**
   * Calculate price from trade amounts (fallback when reserves not available)
   */
  calculateFromTradeAmounts(
    solAmount: bigint,
    tokenAmount: bigint,
    decimals: number,
    solPriceUsd: number,
    estimatedCirculatingSupply?: number
  ): AMMPriceInfo {
    // Convert amounts to proper units
    const solInSol = Number(solAmount) / Number(LAMPORTS_PER_SOL);
    const tokensWithDecimals = Number(tokenAmount) / Math.pow(10, decimals);
    
    // Calculate price per token
    const priceInSol = solInSol / tokensWithDecimals;
    const priceInUsd = priceInSol * solPriceUsd;
    
    // Use estimated circulating supply or default
    const circulatingSupply = estimatedCirculatingSupply || 100_000_000; // 100M default
    const marketCapUsd = priceInUsd * circulatingSupply;
    
    return {
      priceInSol,
      priceInUsd,
      marketCapUsd,
      circulatingSupply,
      totalSupply: circulatingSupply / this.PUMP_FUN_CIRCULATING_RATIO
    };
  }
}