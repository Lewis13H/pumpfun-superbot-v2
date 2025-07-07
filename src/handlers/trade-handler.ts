/**
 * Trade Handler
 * Processes trade events and manages token discovery
 */

import { TradeEvent, EventType, TradeType } from '../utils/parsers/types';
import { TokenRepository, Token } from '../repositories/token-repository';
import { TradeRepository, Trade } from '../repositories/trade-repository';
import { PriceCalculator, ReserveInfo } from '../services/pricing/price-calculator';
import { EventBus, EVENTS } from '../core/event-bus';
import { ConfigService } from '../core/config';
import { Logger } from '../core/logger';
import { sanitizeUtf8 } from '../utils/sanitizers/utf8-sanitizer';

export interface TradeHandlerOptions {
  tokenRepo: TokenRepository;
  tradeRepo: TradeRepository;
  priceCalculator: PriceCalculator;
  eventBus: EventBus;
  config: ConfigService;
}

export class TradeHandler {
  private tokenRepo: TokenRepository;
  private tradeRepo: TradeRepository;
  private priceCalculator: PriceCalculator;
  private eventBus: EventBus;
  private config: ConfigService;
  private logger: Logger;
  
  // Caches
  private tokenCache = new Map<string, Token>();
  private pendingSaves = new Map<string, Trade[]>();
  private saveInterval?: NodeJS.Timeout;

  constructor(options: TradeHandlerOptions) {
    this.tokenRepo = options.tokenRepo;
    this.tradeRepo = options.tradeRepo;
    this.priceCalculator = options.priceCalculator;
    this.eventBus = options.eventBus;
    this.config = options.config;
    this.logger = new Logger({ context: 'TradeHandler' });
    
    // Start batch save interval
    this.startBatchSaveInterval();
  }

  /**
   * Process a trade event
   */
  async processTrade(
    event: TradeEvent,
    solPriceUsd: number
  ): Promise<{ saved: boolean; token?: Token }> {
    try {
      // Calculate price info
      let priceInfo: any;
      
      // Use pre-calculated values from AMM monitor if available
      if (event.priceUsd !== undefined && event.marketCapUsd !== undefined) {
        priceInfo = {
          priceInUsd: event.priceUsd,
          marketCapUsd: event.marketCapUsd,
          priceInSol: event.priceUsd / solPriceUsd,
          priceInLamports: (event.priceUsd / solPriceUsd) * 1e9
        };
      } else {
        // Fallback to calculating from reserves
        const reserves: ReserveInfo = {
          solReserves: event.virtualSolReserves,
          tokenReserves: event.virtualTokenReserves,
          isVirtual: true
        };
        priceInfo = this.priceCalculator.calculatePrice(reserves, solPriceUsd);
      }
      
      // Create trade record with sanitized string fields
      const trade: Trade = {
        signature: sanitizeUtf8(event.signature),
        mintAddress: sanitizeUtf8(event.mintAddress),
        program: event.type === EventType.BC_TRADE ? 'bonding_curve' : 'amm_pool',
        tradeType: (typeof event.tradeType === 'string' ? 
          (event.tradeType.toLowerCase() === 'buy' ? TradeType.BUY : TradeType.SELL) : 
          event.tradeType) as TradeType,
        userAddress: sanitizeUtf8(event.userAddress),
        solAmount: event.solAmount,
        tokenAmount: event.tokenAmount,
        priceSol: priceInfo.priceInSol,
        priceUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd,
        volumeUsd: event.volumeUsd !== undefined ? event.volumeUsd : Number(event.solAmount) / 1e9 * solPriceUsd,
        virtualSolReserves: event.virtualSolReserves,
        virtualTokenReserves: event.virtualTokenReserves,
        slot: event.slot,
        blockTime: new Date((event.blockTime || Date.now() / 1000) * 1000)
      };
      
      // Add bonding curve specific fields if applicable
      if (event.type === EventType.BC_TRADE && 'bondingCurveKey' in event) {
        trade.bondingCurveKey = sanitizeUtf8((event as any).bondingCurveKey);
        // Don't calculate progress from virtualSolReserves - it's inaccurate
        // Progress should come from bonding curve account monitoring (lamports-based)
        // We'll keep the existing progress from the token record
        trade.bondingCurveProgress = undefined;
      }
      
      // Queue trade for batch save
      this.queueTradeForSave(trade);
      
      // Check if we need to discover/update token
      const token = await this.handleTokenDiscovery(event, priceInfo, solPriceUsd);
      
      // Emit trade events
      this.eventBus.emit(
        event.type === EventType.BC_TRADE ? EVENTS.BC_TRADE : EVENTS.AMM_TRADE,
        { trade, token }
      );
      
      // Emit TRADE_PROCESSED for graduation handler
      this.eventBus.emit(EVENTS.TRADE_PROCESSED, trade);
      
      return { saved: true, token };
    } catch (error) {
      this.logger.error('Failed to process trade', error as Error, {
        signature: event.signature,
        mintAddress: event.mintAddress
      });
      return { saved: false };
    }
  }

  /**
   * Handle token discovery and updates
   */
  private async handleTokenDiscovery(
    event: TradeEvent,
    priceInfo: any,
    solPriceUsd: number
  ): Promise<Token | undefined> {
    // Check cache first
    let token = this.tokenCache.get(event.mintAddress);
    
    if (!token) {
      // Check database
      token = await this.tokenRepo.findByMintAddress(event.mintAddress) || undefined;
      if (token) {
        this.tokenCache.set(event.mintAddress, token);
      }
    }
    
    // Determine thresholds based on program
    const monitorConfig = this.config.get('monitors');
    const threshold = event.type === EventType.AMM_TRADE 
      ? monitorConfig.ammSaveThreshold 
      : monitorConfig.bcSaveThreshold;
    
    const shouldSave = monitorConfig.saveAllTokens || priceInfo.marketCapUsd >= threshold;
    
    if (!token && shouldSave) {
      // New token discovery
      token = await this.createNewToken(event, priceInfo, solPriceUsd);
      this.logger.info('New token discovered', {
        mintAddress: event.mintAddress,
        marketCap: this.priceCalculator.formatMarketCap(priceInfo.marketCapUsd)
      });
    } else if (token) {
      // Update existing token
      await this.updateTokenPrice(token, priceInfo, event);
    }
    
    return token;
  }

  /**
   * Create new token
   */
  private async createNewToken(
    event: TradeEvent,
    priceInfo: any,
    _solPriceUsd: number
  ): Promise<Token> {
    const now = new Date();
    
    const token: Token = {
      mintAddress: sanitizeUtf8(event.mintAddress),
      firstPriceSol: priceInfo.priceInSol,
      firstPriceUsd: priceInfo.priceInUsd,
      firstMarketCapUsd: priceInfo.marketCapUsd,
      currentPriceSol: priceInfo.priceInSol,
      currentPriceUsd: priceInfo.priceInUsd,
      currentMarketCapUsd: priceInfo.marketCapUsd,
      graduatedToAmm: event.type === EventType.AMM_TRADE,
      priceSource: event.type === EventType.BC_TRADE ? 'bonding_curve' : 'amm',
      firstProgram: event.type === EventType.BC_TRADE ? 'bonding_curve' : 'amm_pool',
      currentProgram: event.type === EventType.BC_TRADE ? 'bonding_curve' : 'amm_pool',
      lastPriceUpdate: now,
      firstSeenSlot: Number(event.slot),
      createdAt: now
    };
    
    // Add reserves for AMM tokens (store as raw bigint values)
    if (event.type === EventType.AMM_TRADE && event.virtualSolReserves && event.virtualTokenReserves) {
      token.latestVirtualSolReserves = event.virtualSolReserves;
      token.latestVirtualTokenReserves = event.virtualTokenReserves;
    }

    // Add pump.fun specific fields if available (from BC trade)
    if (event.type === EventType.BC_TRADE && 'creator' in event) {
      token.creator = sanitizeUtf8((event as any).creator);
    }
    if (event.type === EventType.BC_TRADE && 'bondingCurveKey' in event) {
      token.bondingCurveKey = sanitizeUtf8((event as any).bondingCurveKey);
    }
    // Don't set progress from trade events - it should only come from account monitoring
    
    // Check if threshold crossed
    const threshold = this.config.get('monitors').bcSaveThreshold;
    if (priceInfo.marketCapUsd >= threshold) {
      token.thresholdCrossedAt = now;
      this.eventBus.emit(EVENTS.TOKEN_THRESHOLD_CROSSED, {
        mintAddress: event.mintAddress,
        marketCapUsd: priceInfo.marketCapUsd,
        threshold
      });
    }
    
    // Save to database
    const saved = await this.tokenRepo.save(token);
    this.tokenCache.set(event.mintAddress, saved);
    
    return saved;
  }

  /**
   * Update token price
   */
  private async updateTokenPrice(
    token: Token,
    priceInfo: any,
    event: TradeEvent
  ): Promise<void> {
    // Build update data
    const updateData: any = {
      currentPriceSol: priceInfo.priceInSol,
      currentPriceUsd: priceInfo.priceInUsd,
      currentMarketCapUsd: priceInfo.marketCapUsd,
      priceSource: event.type === EventType.BC_TRADE ? 'bonding_curve' : 'amm'
    };
    
    // Update current_program for AMM trades
    if (event.type === EventType.AMM_TRADE) {
      updateData.currentProgram = 'amm_pool';
      
      // Update reserves if available (store as raw bigint values)
      if (event.virtualSolReserves && event.virtualTokenReserves) {
        updateData.latestVirtualSolReserves = event.virtualSolReserves;
        updateData.latestVirtualTokenReserves = event.virtualTokenReserves;
      }
    } else if (event.type === EventType.BC_TRADE && 'bondingCurveProgress' in event) {
      // Update bonding curve progress for BC trades
      updateData.latestBondingCurveProgress = (event as any).bondingCurveProgress;
    }
    
    // Update price and program info
    await this.tokenRepo.update(event.mintAddress, updateData);
    
    // Update cache
    token.currentPriceSol = priceInfo.priceInSol;
    token.currentPriceUsd = priceInfo.priceInUsd;
    token.currentMarketCapUsd = priceInfo.marketCapUsd;
    token.lastPriceUpdate = new Date();
    if (event.type === EventType.AMM_TRADE) {
      token.currentProgram = 'amm_pool';
    }
    
    // Check threshold crossing
    const threshold = this.config.get('monitors').bcSaveThreshold;
    if (!token.thresholdCrossedAt && priceInfo.marketCapUsd >= threshold) {
      token.thresholdCrossedAt = new Date();
      this.eventBus.emit(EVENTS.TOKEN_THRESHOLD_CROSSED, {
        mintAddress: event.mintAddress,
        marketCapUsd: priceInfo.marketCapUsd,
        threshold
      });
    }
  }

  /**
   * Queue trade for batch save
   */
  private queueTradeForSave(trade: Trade): void {
    const batch = this.pendingSaves.get(trade.mintAddress) || [];
    batch.push(trade);
    this.pendingSaves.set(trade.mintAddress, batch);
  }

  /**
   * Start batch save interval
   */
  private startBatchSaveInterval(): void {
    this.saveInterval = setInterval(() => {
      this.savePendingTrades();
    }, 1000); // Save every second
  }

  /**
   * Save pending trades
   */
  private async savePendingTrades(): Promise<void> {
    if (this.pendingSaves.size === 0) return;
    
    const allTrades: Trade[] = [];
    for (const trades of this.pendingSaves.values()) {
      allTrades.push(...trades);
    }
    
    this.pendingSaves.clear();
    
    try {
      const saved = await this.tradeRepo.batchSave(allTrades);
      this.logger.debug(`Saved ${saved} trades`);
    } catch (error) {
      this.logger.error('Failed to save trades batch', error as Error);
      // Re-queue failed trades
      for (const trade of allTrades) {
        this.queueTradeForSave(trade);
      }
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      cachedTokens: this.tokenCache.size,
      pendingTrades: Array.from(this.pendingSaves.values())
        .reduce((sum, trades) => sum + trades.length, 0)
    };
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    
    // Save any pending trades
    await this.savePendingTrades();
    
    // Clear caches
    this.tokenCache.clear();
    this.pendingSaves.clear();
  }
}