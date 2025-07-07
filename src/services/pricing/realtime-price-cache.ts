/**
 * Real-time Price Cache Service
 * Maintains in-memory cache of latest token prices for instant access
 */

import { EventEmitter } from 'events';
import { EventBus, EVENTS } from '../../core/event-bus';
import chalk from 'chalk';

interface TokenPrice {
  mintAddress: string;
  symbol?: string;
  name?: string;
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  lastUpdate: Date;
  program: 'bonding_curve' | 'amm_pool';
  bondingCurveProgress?: number;
  virtualSolReserves?: bigint;
  virtualTokenReserves?: bigint;
}

export class RealtimePriceCache extends EventEmitter {
  private static instance: RealtimePriceCache;
  private priceCache = new Map<string, TokenPrice>();
  private eventBus?: EventBus;
  private updateCount = 0;
  
  private constructor() {
    super();
    // Log stats every 30 seconds
    setInterval(() => this.logStats(), 30000);
  }
  
  static getInstance(): RealtimePriceCache {
    if (!RealtimePriceCache.instance) {
      RealtimePriceCache.instance = new RealtimePriceCache();
    }
    return RealtimePriceCache.instance;
  }
  
  /**
   * Initialize with EventBus
   */
  initialize(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.setupEventListeners();
  }
  
  private setupEventListeners() {
    if (!this.eventBus) {
      console.error(chalk.red('EventBus not initialized in RealtimePriceCache'));
      return;
    }
    
    // Listen to BC trades
    this.eventBus.on(EVENTS.BC_TRADE, (data) => {
      this.updatePrice({
        mintAddress: data.mintAddress,
        symbol: data.symbol,
        name: data.name,
        priceSol: data.priceSol,
        priceUsd: data.priceUsd,
        marketCapUsd: data.marketCapUsd,
        program: 'bonding_curve',
        bondingCurveProgress: data.bondingCurveProgress,
        virtualSolReserves: data.virtualSolReserves,
        virtualTokenReserves: data.virtualTokenReserves
      });
    });
    
    // Listen to AMM trades
    this.eventBus.on(EVENTS.AMM_TRADE, (data) => {
      this.updatePrice({
        mintAddress: data.mintAddress,
        symbol: data.symbol,
        name: data.name,
        priceSol: data.priceSol,
        priceUsd: data.priceUsd,
        marketCapUsd: data.marketCapUsd,
        program: 'amm_pool',
        virtualSolReserves: data.virtualSolReserves,
        virtualTokenReserves: data.virtualTokenReserves
      });
    });
    
    console.log(chalk.cyan('🚀 Realtime price cache initialized'));
  }
  
  private updatePrice(data: Omit<TokenPrice, 'lastUpdate'>) {
    const price: TokenPrice = {
      ...data,
      lastUpdate: new Date()
    };
    
    this.priceCache.set(data.mintAddress, price);
    this.updateCount++;
    
    // Emit update event for real-time subscribers
    this.emit('priceUpdate', price);
  }
  
  /**
   * Get latest price for a token
   */
  getPrice(mintAddress: string): TokenPrice | null {
    return this.priceCache.get(mintAddress) || null;
  }
  
  /**
   * Get all cached prices
   */
  getAllPrices(): TokenPrice[] {
    return Array.from(this.priceCache.values());
  }
  
  /**
   * Get prices updated within the last N seconds
   */
  getRecentPrices(seconds: number = 60): TokenPrice[] {
    const cutoff = new Date(Date.now() - seconds * 1000);
    return Array.from(this.priceCache.values())
      .filter(p => p.lastUpdate > cutoff);
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      totalTokens: this.priceCache.size,
      updateCount: this.updateCount,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
    };
  }
  
  private logStats() {
    // Stats logging disabled to reduce console noise
    // const stats = this.getStats();
    // console.log(chalk.gray(`💾 Price cache: ${stats.totalTokens} tokens, ${stats.updateCount} updates`));
  }
  
  /**
   * Clear old entries to prevent memory bloat
   */
  cleanup(maxAge: number = 3600000) { // 1 hour default
    const cutoff = new Date(Date.now() - maxAge);
    let removed = 0;
    
    for (const [mintAddress, price] of this.priceCache.entries()) {
      if (price.lastUpdate < cutoff) {
        this.priceCache.delete(mintAddress);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(chalk.yellow(`🧹 Cleaned up ${removed} stale price entries`));
    }
    
    return removed;
  }
}