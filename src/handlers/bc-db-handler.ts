/**
 * Bonding Curve Database Handler V2 - Improved Version
 * 
 * Enhancements:
 * - Option to save all tokens regardless of threshold
 * - Better error handling and retry logic
 * - Tracks why tokens weren't saved
 * - More detailed statistics
 */

import { UnifiedDbServiceV2, UnifiedTokenData, UnifiedTradeData } from '../database/unified-db-service';
import { BCTradeEvent, EventType, TradeType } from '../utils/parsers/types';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';
// import { calculateBondingCurveProgress } from '../services/bc-price-calculator';  // Unused import

export interface ProcessedTradeDataV2 {
  event: BCTradeEvent;
  signature: string;
  priceInSol: number;
  priceInUsd: number;
  marketCapUsd: number;
  progress: number;
  slot: bigint;
  blockTime: Date;
}

export interface DbHandlerStats {
  tokensDiscovered: number;
  tokensSaved: number;
  tokensSkippedBelowThreshold: number;
  tokensFailedToSave: number;
  tradesProcessed: number;
  tradesSaved: number;
  tradesSkippedBelowThreshold: number;
  saveErrors: Map<string, number>;
}

export interface DbHandlerConfig {
  saveAllTokens: boolean;       // Save tokens regardless of threshold
  thresholdUsd: number;         // Market cap threshold (default 8888)
  retryFailedSaves: boolean;    // Retry failed saves
  maxRetries: number;           // Max retry attempts
  logVerbose: boolean;          // Detailed logging
}

export class BondingCurveDbHandlerV2 {
  private dbService: UnifiedDbServiceV2;
  private discoveredTokens: Map<string, { marketCap: number, attempts: number }> = new Map();
  private stats: DbHandlerStats;
  private config: DbHandlerConfig;
  private parser: UnifiedEventParser;
  
  constructor(config?: Partial<DbHandlerConfig>) {
    this.dbService = UnifiedDbServiceV2.getInstance();
    this.parser = new UnifiedEventParser({ useIDLParsing: true });
    this.stats = {
      tokensDiscovered: 0,
      tokensSaved: 0,
      tokensSkippedBelowThreshold: 0,
      tokensFailedToSave: 0,
      tradesProcessed: 0,
      tradesSaved: 0,
      tradesSkippedBelowThreshold: 0,
      saveErrors: new Map()
    };
    
    // Default configuration
    this.config = {
      saveAllTokens: false,
      thresholdUsd: 8888,
      retryFailedSaves: true,
      maxRetries: 3,
      logVerbose: false,
      ...config
    };
  }

  /**
   * Process a trade event with improved handling
   */
  async processTrade(data: ProcessedTradeDataV2): Promise<void> {
    const { event, signature, priceInSol, priceInUsd, marketCapUsd, progress } = data;
    this.stats.tradesProcessed++;
    
    // Check if we should save this trade
    const shouldSaveTrade = this.config.saveAllTokens || marketCapUsd >= this.config.thresholdUsd;
    
    if (!shouldSaveTrade) {
      this.stats.tradesSkippedBelowThreshold++;
      if (this.config.logVerbose) {
        console.log(`Skipping trade for ${event.mintAddress} - MC: $${marketCapUsd.toFixed(0)} below threshold`);
      }
      return;
    }
    
    // Check if this is a new token discovery
    const isNewToken = !this.discoveredTokens.has(event.mintAddress);
    if (isNewToken) {
      await this.handleNewTokenV2(data);
    }
    
    // Prepare trade data
    const tradeData: UnifiedTradeData = {
      mintAddress: event.mintAddress,
      signature: signature,
      program: 'bonding_curve',
      tradeType: event.tradeType as TradeType,
      userAddress: event.userAddress,
      solAmount: event.solAmount,
      tokenAmount: event.tokenAmount,
      priceSol: priceInSol,
      priceUsd: priceInUsd,
      marketCapUsd: marketCapUsd,
      virtualSolReserves: event.virtualSolReserves,
      virtualTokenReserves: event.virtualTokenReserves,
      bondingCurveProgress: progress,
      slot: data.slot,
      blockTime: data.blockTime
    };
    
    // Process through database service with retry logic
    try {
      await this.dbService.processTrade(tradeData);
      this.stats.tradesSaved++;
    } catch (error) {
      this.handleSaveError('trade', error);
      
      if (this.config.retryFailedSaves) {
        // Retry once after a short delay
        setTimeout(async () => {
          try {
            await this.dbService.processTrade(tradeData);
            this.stats.tradesSaved++;
          } catch (retryError: any) {
            console.error(`Failed to save trade after retry: ${signature}`, retryError.message);
          }
        }, 100);
      }
    }
  }

  /**
   * Handle new token discovery with improved tracking
   */
  private async handleNewTokenV2(data: ProcessedTradeDataV2): Promise<void> {
    const { event, priceInSol, priceInUsd, marketCapUsd } = data;
    
    this.stats.tokensDiscovered++;
    this.discoveredTokens.set(event.mintAddress, { marketCap: marketCapUsd, attempts: 0 });
    
    // Check if we should save this token
    const shouldSaveToken = this.config.saveAllTokens || marketCapUsd >= this.config.thresholdUsd;
    
    if (!shouldSaveToken) {
      this.stats.tokensSkippedBelowThreshold++;
      if (this.config.logVerbose) {
        console.log(`🔽 Token below threshold: ${event.mintAddress} MC: $${marketCapUsd.toFixed(0)}`);
      }
      return;
    }
    
    // Prepare token data
    const tokenData: UnifiedTokenData = {
      mintAddress: event.mintAddress,
      symbol: undefined, // Will be enriched later
      name: undefined,   // Will be enriched later
      uri: undefined,    // Will be enriched later
      firstProgram: 'bonding_curve',
      firstSeenSlot: data.slot,
      firstPriceSol: priceInSol,
      firstPriceUsd: priceInUsd,
      firstMarketCapUsd: marketCapUsd
    };
    
    // Process through database service with retry logic
    try {
      await this.dbService.processTokenDiscovery(tokenData);
      this.stats.tokensSaved++;
      console.log(`✅ New token saved: ${event.mintAddress} MC: $${marketCapUsd.toFixed(0)}`);
    } catch (error) {
      this.handleSaveError('token', error);
      this.stats.tokensFailedToSave++;
      
      // Update attempts counter
      const tokenInfo = this.discoveredTokens.get(event.mintAddress);
      if (tokenInfo) {
        tokenInfo.attempts++;
        
        // Retry if within limits
        if (this.config.retryFailedSaves && tokenInfo.attempts < this.config.maxRetries) {
          setTimeout(async () => {
            try {
              await this.dbService.processTokenDiscovery(tokenData);
              this.stats.tokensSaved++;
              this.stats.tokensFailedToSave--;
              console.log(`✅ Token saved on retry: ${event.mintAddress}`);
            } catch (retryError: any) {
              console.error(`Failed to save token after retry: ${event.mintAddress}`, retryError.message);
            }
          }, 500 * tokenInfo.attempts); // Exponential backoff
        }
      }
    }
  }

  /**
   * Track save errors by type
   */
  private handleSaveError(type: 'token' | 'trade', error: any): void {
    const errorMessage = error.message || 'Unknown error';
    const errorKey = `${type}:${errorMessage}`;
    
    const currentCount = this.stats.saveErrors.get(errorKey) || 0;
    this.stats.saveErrors.set(errorKey, currentCount + 1);
    
    if (this.config.logVerbose) {
      console.error(`Save error (${type}):`, errorMessage);
    }
  }

  /**
   * Get detailed statistics
   */
  getDetailedStats() {
    const saveRate = this.stats.tokensDiscovered > 0 
      ? (this.stats.tokensSaved / this.stats.tokensDiscovered * 100).toFixed(1)
      : '0.0';
    
    const effectiveSaveRate = this.stats.tokensDiscovered > this.stats.tokensSkippedBelowThreshold
      ? (this.stats.tokensSaved / (this.stats.tokensDiscovered - this.stats.tokensSkippedBelowThreshold) * 100).toFixed(1)
      : '0.0';
    
    return {
      summary: {
        tokensDiscovered: this.stats.tokensDiscovered,
        tokensSaved: this.stats.tokensSaved,
        tokensSaveRate: `${saveRate}%`,
        effectiveSaveRate: `${effectiveSaveRate}%`,
        tokensSkippedBelowThreshold: this.stats.tokensSkippedBelowThreshold,
        tokensFailedToSave: this.stats.tokensFailedToSave,
        tradesProcessed: this.stats.tradesProcessed,
        tradesSaved: this.stats.tradesSaved
      },
      errors: Array.from(this.stats.saveErrors.entries()).map(([key, count]) => ({
        type: key.split(':')[0],
        message: key.split(':')[1],
        count
      })).sort((a, b) => b.count - a.count),
      dbStats: this.dbService.getStats(),
      config: this.config
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      tokensDiscovered: 0,
      tokensSaved: 0,
      tokensSkippedBelowThreshold: 0,
      tokensFailedToSave: 0,
      tradesProcessed: 0,
      tradesSaved: 0,
      tradesSkippedBelowThreshold: 0,
      saveErrors: new Map()
    };
  }

  /**
   * Update configuration dynamically
   */
  updateConfig(config: Partial<DbHandlerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Force flush any pending batches
   */
  async flush(): Promise<void> {
    await this.dbService.close();
  }

  /**
   * Get list of tokens that failed to save
   */
  getFailedTokens(): Array<{ mint: string, marketCap: number, attempts: number }> {
    const failed: Array<{ mint: string, marketCap: number, attempts: number }> = [];
    
    for (const [mint, info] of this.discoveredTokens) {
      if (info.attempts >= this.config.maxRetries) {
        failed.push({ mint, ...info });
      }
    }
    
    return failed;
  }

  /**
   * Parse gRPC data into ProcessedTradeDataV2 using UnifiedEventParser
   */
  parseGrpcData(grpcData: any, priceInSol: number, priceInUsd: number, marketCapUsd: number, progress: number): ProcessedTradeDataV2 | null {
    // Create parse context from gRPC data
    const context = UnifiedEventParser.createContext(grpcData);
    
    // Parse the event
    const event = this.parser.parse(context);
    
    // Check if it's a BC trade event
    if (!event || event.type !== EventType.BC_TRADE) {
      return null;
    }
    
    const bcEvent = event as BCTradeEvent;
    
    return {
      event: bcEvent,
      signature: bcEvent.signature,
      priceInSol,
      priceInUsd,
      marketCapUsd,
      progress,
      slot: bcEvent.slot,
      blockTime: new Date((bcEvent.blockTime || Date.now() / 1000) * 1000)
    };
  }
}