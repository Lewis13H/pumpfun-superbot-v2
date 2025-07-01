/**
 * Refactored Bonding Curve Monitor
 * Uses the new foundation layer with DI and event-driven architecture
 */

import chalk from 'chalk';
import { BaseMonitor } from '../core/base-monitor';
import { Container, TOKENS } from '../core/container';
import { EventType, TradeType } from '../parsers/types';
import { UnifiedEventParser } from '../parsers/unified-event-parser';
import { TradeHandler } from '../handlers/trade-handler';
import { PUMP_PROGRAM } from '../utils/constants';
import { EVENTS } from '../core/event-bus';
import { enableErrorSuppression } from '../utils/parser-error-suppressor';

interface BCMonitorStats {
  trades: number;
  buys: number;
  sells: number;
  parseErrors: number;
  savedTokens: number;
  graduations: number;
  volume: number;
  avgParseTime: number;
  parseRate: number;
  eventSizes: Map<number, number>;
}

export class BCMonitor extends BaseMonitor {
  private parser!: UnifiedEventParser;
  private tradeHandler!: TradeHandler;
  private bcStats: BCMonitorStats;
  private parseTimings: number[] = [];

  constructor(container: Container) {
    super(
      {
        programId: PUMP_PROGRAM,
        monitorName: 'Bonding Curve Monitor',
        color: chalk.yellow as any
      },
      container
    );

    // Initialize BC-specific stats
    this.bcStats = {
      trades: 0,
      buys: 0,
      sells: 0,
      parseErrors: 0,
      savedTokens: 0,
      graduations: 0,
      volume: 0,
      avgParseTime: 0,
      parseRate: 0,
      eventSizes: new Map()
    };
  }

  /**
   * Build subscribe request for BC transactions
   */
  protected buildSubscribeRequest(): any {
    return {
      commitment: 'confirmed' as const,
      accountsDataSlice: [],
      accounts: {},
      slots: {},
      transactions: {
        pumpfun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [this.options.programId],
          accountExclude: [],
          accountRequired: []
        }
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      ping: undefined
    };
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Enable error suppression for parsers
    enableErrorSuppression({
      suppressParserWarnings: true,
      suppressComputeBudget: true,
      suppressUnknownPrograms: true,
      logSuppressionStats: false
    });
    
    // Get parser with IDL support and trade handler
    this.parser = await this.container.resolve(TOKENS.EventParser);
    this.tradeHandler = await this.container.resolve(TOKENS.TradeHandler);
    
    // Subscribe to relevant events
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for token events
    this.eventBus.on(EVENTS.TOKEN_DISCOVERED, (token) => {
      this.bcStats.savedTokens++;
      this.logger.info('New token discovered', {
        mint: token.mintAddress,
        marketCap: token.currentMarketCapUsd
      });
    });

    this.eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
      this.bcStats.graduations++;
      this.logger.info('Token graduated!', {
        mint: data.mintAddress,
        slot: data.graduationSlot
      });
    });

    this.eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, (data) => {
      this.logger.info('Token crossed threshold!', {
        mint: data.mintAddress,
        marketCap: data.marketCapUsd,
        threshold: data.threshold
      });
    });
  }

  /**
   * Process stream data
   */
  async processStreamData(data: any): Promise<void> {
    const startTime = Date.now();
    
    try {
      
      // Skip non-transaction updates
      if (!data.transaction) {
        return;
      }
      
      // Create parse context
      const context = UnifiedEventParser.createContext(data);
      
      
      // Track event size if available
      if (context.data) {
        const size = context.data.length;
        this.bcStats.eventSizes.set(
          size, 
          (this.bcStats.eventSizes.get(size) || 0) + 1
        );
      }
      
      // Parse the event
      const event = this.parser.parse(context);
      
      if (!event) {
        this.bcStats.parseErrors++;
        
        return;
      }
      
      // Only process BC trades
      if (event.type !== EventType.BC_TRADE) {
        return;
      }
      
      // Update stats
      this.bcStats.trades++;
      if (event.tradeType === TradeType.BUY) {
        this.bcStats.buys++;
      } else {
        this.bcStats.sells++;
      }
      
      // Calculate volume
      const volumeUsd = Number(event.solAmount) / 1e9 * this.currentSolPrice;
      this.bcStats.volume += volumeUsd;
      
      // Process the trade
      await this.tradeHandler.processTrade(event, this.currentSolPrice);
      
      // Log high-value trades
      if (volumeUsd > 1000) {
        this.logger.info('High-value trade', {
          type: event.tradeType,
          volume: `$${volumeUsd.toFixed(2)}`,
          mint: event.mintAddress.substring(0, 8) + '...',
          user: event.userAddress.substring(0, 8) + '...'
        });
      }
      
      // Track bonding curve progress
      if ('bondingCurveKey' in event && event.vSolInBondingCurve) {
        const progress = this.calculateBondingCurveProgress(event.vSolInBondingCurve);
        if (progress > 90) {
          this.logger.warn(`Near graduation: ${progress.toFixed(1)}%`, {
            mint: event.mintAddress
          });
        }
      }
    } catch (error) {
      this.bcStats.parseErrors++;
      if (this.shouldLogError(error)) {
        this.logger.error('Failed to process transaction', error as Error);
      }
    } finally {
      // Track parse timing
      const parseTime = Date.now() - startTime;
      this.parseTimings.push(parseTime);
      if (this.parseTimings.length > 1000) {
        this.parseTimings.shift(); // Keep last 1000
      }
    }
  }

  /**
   * Calculate bonding curve progress
   */
  private calculateBondingCurveProgress(vSolReserves: bigint): number {
    const solInCurve = Number(vSolReserves) / 1e9;
    const GRADUATION_THRESHOLD = 85; // SOL
    return (solInCurve / GRADUATION_THRESHOLD) * 100;
  }

  /**
   * Display statistics
   */
  displayStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();
    const txRate = this.calculateRate(this.stats.transactions, this.stats.startTime);
    const tradeRate = this.calculateRate(this.bcStats.trades, this.stats.startTime);
    
    // Calculate metrics
    this.bcStats.parseRate = this.stats.transactions > 0 
      ? (this.bcStats.trades / this.stats.transactions) * 100 
      : 0;
    
    this.bcStats.avgParseTime = this.parseTimings.length > 0
      ? this.parseTimings.reduce((a, b) => a + b, 0) / this.parseTimings.length
      : 0;

    // Format event sizes
    const eventSizeStr = Array.from(this.bcStats.eventSizes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([size, count]) => `${size}B: ${count}`)
      .join(', ');

    this.logger.box('Bonding Curve Monitor Statistics', {
      'Runtime': this.formatDuration(runtime),
      'Transactions': `${this.formatNumber(this.stats.transactions)} (${txRate.toFixed(1)}/min)`,
      'Trades Parsed': `${this.formatNumber(this.bcStats.trades)} (${tradeRate.toFixed(1)}/min)`,
      'Parse Rate': `${this.bcStats.parseRate.toFixed(1)}%`,
      'Avg Parse Time': `${this.bcStats.avgParseTime.toFixed(1)}ms`,
      'Buy/Sell': `${this.bcStats.buys}/${this.bcStats.sells}`,
      'Volume': `$${this.formatNumber(Math.round(this.bcStats.volume))}`,
      'Parse Errors': this.formatNumber(this.bcStats.parseErrors),
      'Event Sizes': eventSizeStr || 'None',
      'Saved Tokens': this.formatNumber(this.bcStats.savedTokens),
      'Graduations': this.formatNumber(this.bcStats.graduations),
      'SOL Price': `$${this.currentSolPrice.toFixed(2)}`,
      'Errors': this.formatNumber(this.stats.errors),
      'Reconnects': this.stats.reconnections
    });

    // Show progress bar for overall health
    const totalAttempts = Math.max(this.stats.transactions + this.stats.errors, 1);
    const successRate = this.stats.transactions / totalAttempts;
    const health = successRate * 100;
    this.displayHealthBar(health);
  }

  /**
   * Display health bar
   */
  private displayHealthBar(_health: number): void {
    // Health bar display removed - stats are shown in main index.ts
    // Keeping method signature for potential future use
  }

  /**
   * Should log error
   */
  shouldLogError(error: any): boolean {
    // Don't log common/expected errors
    const message = error?.message || '';
    if (message.includes('rate limit') || message.includes('timeout')) {
      return false;
    }
    
    // Log every 100th parse error to avoid spam
    if (message.includes('parse') && this.bcStats.parseErrors % 100 !== 0) {
      return false;
    }
    
    return true;
  }

  /**
   * Shutdown handler
   */
  async onShutdown(): Promise<void> {
    this.logger.info('Saving final statistics...');
    
    // Get handler stats
    const handlerStats = this.tradeHandler.getStats();
    this.logger.info('Handler statistics', handlerStats);
    
    // Cleanup
    await this.tradeHandler.cleanup();
    
    // Final summary
    this.logger.info('Monitor shutdown complete', {
      totalTrades: this.bcStats.trades,
      totalVolume: `$${this.formatNumber(Math.round(this.bcStats.volume))}`,
      savedTokens: this.bcStats.savedTokens,
      graduations: this.bcStats.graduations
    });
  }
}