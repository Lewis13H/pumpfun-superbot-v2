/**
 * Trade Handler
 * Processes trade events and manages token discovery
 */

import { TradeEvent, EventType } from '../parsers/types';
import { TokenRepository, Token } from '../repositories/token-repository';
import { TradeRepository, Trade } from '../repositories/trade-repository';
import { PriceCalculator, ReserveInfo } from '../services/price-calculator';
import { EventBus, EVENTS } from '../core/event-bus';
import { ConfigService } from '../core/config';
import { Logger } from '../core/logger';

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
      const reserves: ReserveInfo = {
        solReserves: event.virtualSolReserves,
        tokenReserves: event.virtualTokenReserves,
        isVirtual: true
      };
      
      const priceInfo = this.priceCalculator.calculatePrice(reserves, solPriceUsd);
      
      // Create trade record
      const trade: Trade = {
        signature: event.signature,
        mintAddress: event.mintAddress,
        program: event.type === EventType.BC_TRADE ? 'bonding_curve' : 'amm_pool',
        tradeType: event.tradeType,
        userAddress: event.userAddress,
        solAmount: event.solAmount,
        tokenAmount: event.tokenAmount,
        priceSol: priceInfo.priceInSol,
        priceUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd,
        volumeUsd: Number(event.solAmount) / 1e9 * solPriceUsd,
        virtualSolReserves: event.virtualSolReserves,
        virtualTokenReserves: event.virtualTokenReserves,
        slot: event.slot,
        blockTime: new Date(event.blockTime || Date.now())
      };
      
      // Add bonding curve progress if applicable
      if (event.type === EventType.BC_TRADE) {
        trade.bondingCurveProgress = this.priceCalculator.calculateBondingCurveProgress(
          event.virtualSolReserves
        );
      }
      
      // Queue trade for batch save
      this.queueTradeForSave(trade);
      
      // Check if we need to discover/update token
      const token = await this.handleTokenDiscovery(event, priceInfo, solPriceUsd);
      
      // Emit trade event
      this.eventBus.emit(
        event.type === EventType.BC_TRADE ? EVENTS.BC_TRADE : EVENTS.AMM_TRADE,
        { trade, token }
      );
      
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
    solPriceUsd: number
  ): Promise<Token> {
    const now = new Date();
    
    const token: Token = {
      mintAddress: event.mintAddress,
      firstPriceSol: priceInfo.priceInSol,
      firstPriceUsd: priceInfo.priceInUsd,
      firstMarketCapUsd: priceInfo.marketCapUsd,
      currentPriceSol: priceInfo.priceInSol,
      currentPriceUsd: priceInfo.priceInUsd,
      currentMarketCapUsd: priceInfo.marketCapUsd,
      graduatedToAmm: event.type === EventType.AMM_TRADE,
      priceSource: event.type === EventType.BC_TRADE ? 'bonding_curve' : 'amm',
      lastPriceUpdate: now,
      createdAt: now
    };
    
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
    // Update price if newer
    await this.tokenRepo.updatePrice(event.mintAddress, {
      priceSol: priceInfo.priceInSol,
      priceUsd: priceInfo.priceInUsd,
      marketCapUsd: priceInfo.marketCapUsd,
      priceSource: event.type === EventType.BC_TRADE ? 'bonding_curve' : 'amm'
    });
    
    // Update cache
    token.currentPriceSol = priceInfo.priceInSol;
    token.currentPriceUsd = priceInfo.priceInUsd;
    token.currentMarketCapUsd = priceInfo.marketCapUsd;
    token.lastPriceUpdate = new Date();
    
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