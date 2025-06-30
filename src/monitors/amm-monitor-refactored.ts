/**
 * Refactored AMM Monitor
 * Uses the new foundation layer with DI and event-driven architecture
 */

import chalk from 'chalk';
import { BaseMonitor } from '../core/base-monitor';
import { Container, TOKENS } from '../core/container';
import { EventType, TradeType } from '../parsers/types';
import { UnifiedEventParser } from '../parsers/unified-event-parser';
import { TradeHandler } from '../handlers/trade-handler';
import { AMM_PROGRAM } from '../utils/constants';
import { EVENTS } from '../core/event-bus';

interface AMMMonitorStats {
  swaps: number;
  buys: number;
  sells: number;
  parseErrors: number;
  newTokens: number;
  volume: number;
  avgSwapSize: number;
  largestSwap: number;
  uniqueTokens: Set<string>;
  uniqueUsers: Set<string>;
}

export class AMMMonitorRefactored extends BaseMonitor {
  private parser!: UnifiedEventParser;
  private tradeHandler!: TradeHandler;
  private ammStats: AMMMonitorStats;

  constructor(container: Container) {
    super(
      {
        programId: AMM_PROGRAM,
        monitorName: 'AMM Pool Monitor',
        color: chalk.magenta as any
      },
      container
    );

    // Initialize AMM-specific stats
    this.ammStats = {
      swaps: 0,
      buys: 0,
      sells: 0,
      parseErrors: 0,
      newTokens: 0,
      volume: 0,
      avgSwapSize: 0,
      largestSwap: 0,
      uniqueTokens: new Set(),
      uniqueUsers: new Set()
    };
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Get parser and trade handler
    this.parser = await this.container.resolve(TOKENS.EventParser);
    this.tradeHandler = await this.container.resolve(TOKENS.TradeHandler);
    
    // Subscribe to relevant events
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for new AMM tokens
    this.eventBus.on(EVENTS.TOKEN_DISCOVERED, (token) => {
      if (token.graduatedToAmm) {
        this.ammStats.newTokens++;
        this.logger.info('New AMM token', {
          mint: token.mintAddress,
          marketCap: token.currentMarketCapUsd
        });
      }
    });

    // Listen for pool events
    this.eventBus.on(EVENTS.POOL_CREATED, (data) => {
      this.logger.info('New pool created!', {
        pool: data.poolAddress,
        mint: data.mintAddress
      });
    });

    this.eventBus.on(EVENTS.POOL_STATE_UPDATED, (data) => {
      this.logger.debug('Pool state updated', {
        pool: data.poolAddress,
        reserves: `${data.solReserves} SOL / ${data.tokenReserves} tokens`
      });
    });
  }

  /**
   * Process stream data
   */
  async processStreamData(data: any): Promise<void> {
    try {
      // Create parse context
      const context = UnifiedEventParser.createContext(data);
      
      // Parse the event
      const event = this.parser.parse(context);
      
      if (!event) {
        this.ammStats.parseErrors++;
        return;
      }
      
      // Only process AMM trades
      if (event.type !== EventType.AMM_TRADE) {
        return;
      }
      
      // Update stats
      this.ammStats.swaps++;
      this.ammStats.uniqueTokens.add(event.mintAddress);
      this.ammStats.uniqueUsers.add(event.userAddress);
      
      if (event.tradeType === TradeType.BUY) {
        this.ammStats.buys++;
      } else {
        this.ammStats.sells++;
      }
      
      // Calculate volume
      const volumeUsd = Number(event.solAmount) / 1e9 * this.currentSolPrice;
      this.ammStats.volume += volumeUsd;
      
      // Track largest swap
      if (volumeUsd > this.ammStats.largestSwap) {
        this.ammStats.largestSwap = volumeUsd;
      }
      
      // Process the trade
      await this.tradeHandler.processTrade(event, this.currentSolPrice);
      
      // Log significant swaps
      if (volumeUsd > 5000) {
        this.logger.warn('Large AMM swap detected!', {
          type: event.tradeType,
          volume: `$${volumeUsd.toFixed(2)}`,
          mint: event.mintAddress.substring(0, 8) + '...',
          user: event.userAddress.substring(0, 8) + '...',
          pool: event.poolAddress.substring(0, 8) + '...'
        });
      }
      
      // Check for potential opportunities
      this.checkArbitrageOpportunity(event, volumeUsd);
      
    } catch (error) {
      this.ammStats.parseErrors++;
      if (this.shouldLogError(error)) {
        this.logger.error('Failed to process AMM transaction', error as Error);
      }
    }
  }

  /**
   * Check for arbitrage opportunities
   */
  private checkArbitrageOpportunity(event: any, volumeUsd: number): void {
    // Check for rapid buy/sell patterns
    if (event.tradeType === TradeType.SELL && volumeUsd > 1000) {
      // Log potential dump
      this.logger.warn('Potential token dump', {
        mint: event.mintAddress,
        volume: `$${volumeUsd.toFixed(2)}`,
        priceImpact: 'Calculate based on reserves'
      });
    }
  }

  /**
   * Display statistics
   */
  displayStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();
    const txRate = this.calculateRate(this.stats.transactions, this.stats.startTime);
    const swapRate = this.calculateRate(this.ammStats.swaps, this.stats.startTime);
    
    // Calculate metrics
    const parseRate = this.stats.transactions > 0 
      ? (this.ammStats.swaps / this.stats.transactions) * 100 
      : 0;
    
    this.ammStats.avgSwapSize = this.ammStats.swaps > 0
      ? this.ammStats.volume / this.ammStats.swaps
      : 0;

    this.logger.box('AMM Pool Monitor Statistics', {
      'Runtime': this.formatDuration(runtime),
      'Transactions': `${this.formatNumber(this.stats.transactions)} (${txRate.toFixed(1)}/min)`,
      'Swaps Parsed': `${this.formatNumber(this.ammStats.swaps)} (${swapRate.toFixed(1)}/min)`,
      'Parse Rate': `${parseRate.toFixed(1)}%`,
      'Buy/Sell': `${this.ammStats.buys}/${this.ammStats.sells}`,
      'Total Volume': `$${this.formatNumber(Math.round(this.ammStats.volume))}`,
      'Avg Swap Size': `$${this.ammStats.avgSwapSize.toFixed(2)}`,
      'Largest Swap': `$${this.formatNumber(Math.round(this.ammStats.largestSwap))}`,
      'Unique Tokens': this.ammStats.uniqueTokens.size,
      'Unique Users': this.ammStats.uniqueUsers.size,
      'New AMM Tokens': this.ammStats.newTokens,
      'Parse Errors': this.formatNumber(this.ammStats.parseErrors),
      'SOL Price': `$${this.currentSolPrice.toFixed(2)}`,
      'Errors': this.formatNumber(this.stats.errors),
      'Reconnects': this.stats.reconnections
    });

    // Show top tokens by volume (would need additional tracking)
    this.displayTopTokens();
  }

  /**
   * Display top tokens
   */
  private displayTopTokens(): void {
    if (this.ammStats.uniqueTokens.size === 0) return;
    
    console.log(chalk.magenta('\n📊 Active AMM Tokens:'));
    let count = 0;
    for (const token of this.ammStats.uniqueTokens) {
      console.log(chalk.gray(`  • ${token.substring(0, 12)}...`));
      if (++count >= 5) break;
    }
    if (this.ammStats.uniqueTokens.size > 5) {
      console.log(chalk.gray(`  • and ${this.ammStats.uniqueTokens.size - 5} more...`));
    }
  }

  /**
   * Should log error
   */
  shouldLogError(error: any): boolean {
    const message = error?.message || '';
    
    // Don't log rate limits or timeouts
    if (message.includes('rate limit') || message.includes('timeout')) {
      return false;
    }
    
    // Log every 50th parse error
    if (message.includes('parse') && this.ammStats.parseErrors % 50 !== 0) {
      return false;
    }
    
    return true;
  }

  /**
   * Shutdown handler
   */
  async onShutdown(): Promise<void> {
    this.logger.info('Saving AMM statistics...');
    
    // Get handler stats
    const handlerStats = this.tradeHandler.getStats();
    this.logger.info('Handler statistics', handlerStats);
    
    // Cleanup
    await this.tradeHandler.cleanup();
    
    // Final summary
    this.logger.info('AMM Monitor shutdown complete', {
      totalSwaps: this.ammStats.swaps,
      totalVolume: `$${this.formatNumber(Math.round(this.ammStats.volume))}`,
      uniqueTokens: this.ammStats.uniqueTokens.size,
      uniqueUsers: this.ammStats.uniqueUsers.size,
      largestSwap: `$${this.formatNumber(Math.round(this.ammStats.largestSwap))}`
    });
  }
}