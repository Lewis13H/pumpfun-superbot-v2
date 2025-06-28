/**
 * Bonding Curve Database Handler - Phase 4
 * 
 * Bridges between bc-monitor and UnifiedDbServiceV2
 * Handles token discovery and trade storage with efficient batching
 */

import { UnifiedDbServiceV2, UnifiedTokenData, UnifiedTradeData } from '../database/unified-db-service-v2';
import { BondingCurveTradeEvent } from '../parsers/bc-event-parser';
import { calculateBondingCurveProgress } from '../services/bc-price-calculator';

export interface ProcessedTradeData {
  event: BondingCurveTradeEvent;
  tradeType: 'buy' | 'sell' | 'unknown';
  signature: string;
  priceInSol: number;
  priceInUsd: number;
  marketCapUsd: number;
  progress: number;
  slot?: bigint;
  blockTime?: Date;
}

export class BondingCurveDbHandler {
  private dbService: UnifiedDbServiceV2;
  private discoveredTokens: Set<string> = new Set();
  
  constructor() {
    this.dbService = UnifiedDbServiceV2.getInstance();
  }

  /**
   * Process a trade event with all calculated data
   */
  async processTrade(data: ProcessedTradeData): Promise<void> {
    const { event, tradeType, signature, priceInSol, priceInUsd, marketCapUsd, progress } = data;
    
    // Skip if below threshold
    if (marketCapUsd < 8888) {
      return;
    }
    
    // Check if this is a new token discovery
    if (!this.discoveredTokens.has(event.mint)) {
      await this.handleNewToken(data);
      this.discoveredTokens.add(event.mint);
    }
    
    // Prepare trade data
    const tradeData: UnifiedTradeData = {
      mintAddress: event.mint,
      signature: signature,
      program: 'bonding_curve',
      tradeType: tradeType === 'unknown' ? 'buy' : tradeType,
      userAddress: event.user || 'unknown',
      solAmount: event.solAmount || BigInt(0),
      tokenAmount: event.tokenAmount || BigInt(0),
      priceSol: priceInSol,
      priceUsd: priceInUsd,
      marketCapUsd: marketCapUsd,
      virtualSolReserves: event.virtualSolReserves,
      virtualTokenReserves: event.virtualTokenReserves,
      bondingCurveProgress: progress,
      slot: data.slot || BigInt(0),
      blockTime: data.blockTime || new Date()
    };
    
    // Process through database service
    await this.dbService.processTrade(tradeData);
  }

  /**
   * Handle new token discovery
   */
  private async handleNewToken(data: ProcessedTradeData): Promise<void> {
    const { event, priceInSol, priceInUsd, marketCapUsd } = data;
    
    // Prepare token data
    const tokenData: UnifiedTokenData = {
      mintAddress: event.mint,
      symbol: undefined, // Will be enriched later
      name: undefined,   // Will be enriched later
      uri: undefined,    // Will be enriched later
      firstProgram: 'bonding_curve',
      firstSeenSlot: data.slot || BigInt(0),
      firstPriceSol: priceInSol,
      firstPriceUsd: priceInUsd,
      firstMarketCapUsd: marketCapUsd,
      tokenCreatedAt: data.blockTime // Add actual creation time from blockchain
    };
    
    // Process through database service
    await this.dbService.processTokenDiscovery(tokenData);
    
    console.log(`🆕 New token discovered: ${event.mint} MC: $${marketCapUsd.toFixed(0)}`);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      discoveredTokens: this.discoveredTokens.size,
      dbStats: this.dbService.getStats()
    };
  }

  /**
   * Force flush any pending batches
   */
  async flush(): Promise<void> {
    // The db service will automatically flush on shutdown
    // but we can trigger it manually if needed
  }
}