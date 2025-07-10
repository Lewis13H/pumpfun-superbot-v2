/**
 * Trading Activity Monitor - Unified trading across all venues
 * 
 * Consolidates:
 * - Bonding curve trades
 * - AMM trades (pump.swap)
 * - Raydium trades
 * 
 * Features:
 * - Cross-venue trade tracking
 * - MEV detection
 * - Slippage analysis
 * - Trade pattern recognition
 */

import { BaseMonitor } from '../../core/base-monitor';
import { Container } from '../../core/container';
import { EVENTS } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import chalk from 'chalk';
import bs58 from 'bs58';
import { UnifiedEventParser } from '../../utils/parsers/unified-event-parser';
import { TradeHandler } from '../../handlers/trade-handler';
import { MonitorGroup } from '../../services/core/subscription-builder';
import { MonitorStats } from '../../core/base-monitor';
import { TradeEvent, TradeType, EventType, ParseContext } from '../../utils/parsers/types';

interface TradingStats extends MonitorStats {
  totalTrades: number;
  bcTrades: number;
  ammTrades: number;
  raydiumTrades: number;
  totalVolumeUsd: number;
  largestTradeUsd: number;
  mevDetected: number;
  highSlippageTrades: number;
  uniqueTraders: Set<string>;
  tradePatternsDetected: {
    sandwiches: number;
    frontrunning: number;
    copyTrades: number;
  };
}

interface TradeWindow {
  trades: Array<{
    signature: string;
    mint: string;
    trader: string;
    side: 'buy' | 'sell';
    amountUsd: number;
    timestamp: number;
    venue: 'bc' | 'amm' | 'raydium';
    slippage?: number;
  }>;
  windowStart: number;
  windowEnd: number;
}

export class TradingActivityMonitor extends BaseMonitor {
  protected name = 'Trading Activity Monitor';
  protected subscriptionConfig = {
    isAccountMonitor: false,
    group: 'trading' as MonitorGroup,
    priority: 'high'
  };
  
  private parser!: UnifiedEventParser;
  private tradeHandler!: TradeHandler;
  protected stats: TradingStats = {
    startTime: new Date(),
    transactions: 0,
    errors: 0,
    reconnections: 0,
    totalTrades: 0,
    bcTrades: 0,
    ammTrades: 0,
    raydiumTrades: 0,
    totalVolumeUsd: 0,
    largestTradeUsd: 0,
    mevDetected: 0,
    highSlippageTrades: 0,
    uniqueTraders: new Set(),
    tradePatternsDetected: {
      sandwiches: 0,
      frontrunning: 0,
      copyTrades: 0
    }
  };
  
  // Trade windows for pattern detection (by mint)
  private tradeWindows: Map<string, TradeWindow> = new Map();
  private readonly WINDOW_SIZE_MS = 30000; // 30 second windows
  private readonly MEV_TIME_THRESHOLD_MS = 2000; // 2 seconds for MEV detection
  private readonly HIGH_SLIPPAGE_THRESHOLD = 0.05; // 5% slippage
  
  // Programs to monitor
  private readonly PROGRAMS = {
    BC: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    AMM: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    RAYDIUM: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'
  };

  constructor(container: Container) {
    super(
      {
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // BC program as primary
        monitorName: 'Trading Activity Monitor',
        monitorType: 'transaction',
        monitorGroup: 'bonding_curve', // Use existing group, will monitor all venues
        priority: 'high',
        commitment: 'confirmed',
        includeFailedTxs: false
      },
      container
    );
    this.logger = new Logger({ 
      context: `Monitor:${this.name}`, 
      color: chalk.magenta 
    });
  }

  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Get services
    this.parser = await this.container.resolve('EventParser') as UnifiedEventParser;
    this.tradeHandler = await this.container.resolve('TradeHandler') as TradeHandler;
    
    // Setup event listeners for cross-venue analysis
    this.setupCrossVenueListeners();
    
    // Cleanup old windows periodically
    setInterval(() => this.cleanupOldWindows(), 60000); // Every minute
  }

  private setupCrossVenueListeners(): void {
    // Listen to our own trade events for pattern analysis
    this.eventBus.on(EVENTS.BC_TRADE, (data) => this.analyzeTradePatterns(data, 'bc'));
    this.eventBus.on(EVENTS.AMM_TRADE, (data) => this.analyzeTradePatterns(data, 'amm'));
  }

  protected getProgramIds(): string[] {
    return Object.values(this.PROGRAMS);
  }

  /**
   * Build enhanced subscribe request to monitor ALL trading venues
   */
  protected buildEnhancedSubscribeRequest(): any {
    const builder = this.subscriptionBuilder;
    
    // Set commitment level
    builder.setCommitment('confirmed');
    
    // Subscribe to ALL trading programs (BC, AMM, Raydium)
    builder.addTransactionSubscription('trading_activity_all', {
      vote: false,
      failed: this.options.includeFailedTxs || false,
      accountInclude: this.getProgramIds(), // Use ALL programs!
      accountRequired: this.options.requiredAccounts || [],
      accountExclude: this.options.excludeAccounts || []
    });
    
    // Set group priority if available
    if ('setGroup' in builder) {
      (builder as any).setGroup('trading'); // Medium priority group
    }
    
    return builder.build();
  }

  protected isRelevantTransaction(data: any): boolean {
    // Don't call super - we need to check ALL programs, not just the primary one
    if (!data?.transaction) return false;
    
    const tx = data.transaction.transaction?.transaction || 
               data.transaction?.transaction || 
               data.transaction;
    
    if (!tx?.message) return false;
    
    const accounts = tx.message.accountKeys || [];
    
    // Convert accounts to strings for comparison
    const accountStrs = accounts.map((acc: any) => 
      typeof acc === 'string' ? acc : bs58.encode(acc)
    );
    
    // Check if ANY of our programs (BC, AMM, or Raydium) are in the account keys
    const programIds = Object.values(this.PROGRAMS);
    const hasProgram = programIds.some(programId => accountStrs.includes(programId));
    
    if (hasProgram) {
      // Also check logs for program invocation to be sure
      const logs = tx.meta?.logMessages || [];
      const hasInvocation = programIds.some(programId => 
        logs.some((log: string) => log.includes(programId))
      );
      
      return hasProgram || hasInvocation;
    }
    
    return false;
  }

  async processStreamData(data: any): Promise<void> {
    try {
      if (data.transaction) {
        await this.processTransaction(data);
      }
    } catch (error) {
      if (this.shouldLogError(error)) {
        this.logger.error('Error processing stream data', error as Error);
      }
      this.stats.errors++;
    }
  }

  private async processTransaction(data: any): Promise<void> {
    const tx = data.transaction?.transaction?.transaction;
    if (!tx?.message) return;

    // Determine which program this transaction is for
    const accountKeys = tx.message.accountKeys || [];
    let venue: 'bc' | 'amm' | 'raydium' | null = null;
    
    // Debug: log that we're processing a transaction
    this.stats.transactions++;
    
    // Convert account keys to strings for comparison
    const accountStrs = accountKeys.map((acc: any) => 
      typeof acc === 'string' ? acc : bs58.encode(acc)
    );
    
    if (accountStrs.includes(this.PROGRAMS.BC)) {
      venue = 'bc';
    } else if (accountStrs.includes(this.PROGRAMS.AMM)) {
      venue = 'amm';
    } else if (accountStrs.includes(this.PROGRAMS.RAYDIUM)) {
      venue = 'raydium';
    }
    
    if (!venue) return;

    // Create parse context using UnifiedEventParser helper
    const context = UnifiedEventParser.createContext(data);
    
    // Add program ID for the venue
    context.programId = venue === 'bc' ? this.PROGRAMS.BC : 
                       venue === 'amm' ? this.PROGRAMS.AMM : 
                       this.PROGRAMS.RAYDIUM;
    
    // Parse the event
    const event = this.parser.parse(context);
    
    if (event) {
      const eventType = event.type as string;
      if (eventType === EventType.BC_TRADE || eventType === EventType.AMM_TRADE || eventType === EventType.RAYDIUM_SWAP || eventType === 'raydium_swap') {
        await this.processTrade(event, venue, context);
      }
    }
  }

  private async processTrade(event: any, venue: 'bc' | 'amm' | 'raydium', context?: ParseContext): Promise<void> {
    // The event IS the trade data, not wrapped in a data property
    const trade = event as TradeEvent;
    
    // Add context to trade for enrichment
    if (context) {
      trade.context = context;
    }
    
    // Update stats
    this.stats.totalTrades++;
    this.stats[`${venue}Trades`]++;
    this.stats.totalVolumeUsd += trade.volumeUsd || 0;
    this.stats.uniqueTraders.add(trade.userAddress);
    
    if (trade.volumeUsd && trade.volumeUsd > this.stats.largestTradeUsd) {
      this.stats.largestTradeUsd = trade.volumeUsd;
    }
    
    // Calculate slippage if possible
    const slippage = this.calculateSlippage(trade);
    if (slippage && slippage > this.HIGH_SLIPPAGE_THRESHOLD) {
      this.stats.highSlippageTrades++;
    }
    
    // Add to trade window for pattern analysis
    this.addToTradeWindow(trade, venue, slippage);
    
    // Emit pre-process event for enrichment (especially for AMM trades)
    await this.eventBus.emit('PRE_PROCESS_TRADE', trade);
    
    // Process the trade normally
    // The trade handler will emit the appropriate events (BC_TRADE, AMM_TRADE)
    await this.tradeHandler.processTrade(trade, this.currentSolPrice);
    
    // Don't emit duplicate events - the trade handler already does this
    // Just emit additional pattern data if needed
    if (slippage || this.detectPatternsForTrade(trade, venue).length > 0) {
      this.eventBus.emit('TRADE_PATTERNS', {
        mintAddress: trade.mintAddress,
        venue,
        slippage,
        patterns: this.detectPatternsForTrade(trade, venue)
      });
    }
  }

  private calculateSlippage(_trade: TradeEvent): number | undefined {
    // Calculate slippage based on expected vs actual amounts
    // This is simplified - real implementation would need more data
    // For now, return undefined as TradeEvent doesn't have these fields
    // In a real implementation, we'd need to calculate based on reserves
    return undefined;
  }

  private addToTradeWindow(trade: TradeEvent, venue: string, slippage?: number): void {
    const mint = trade.mintAddress;
    const now = Date.now();
    
    // Get or create window for this mint
    let window = this.tradeWindows.get(mint);
    if (!window || now - window.windowStart > this.WINDOW_SIZE_MS) {
      window = {
        trades: [],
        windowStart: now,
        windowEnd: now + this.WINDOW_SIZE_MS
      };
      this.tradeWindows.set(mint, window);
    }
    
    // Add trade to window
    window.trades.push({
      signature: trade.signature,
      mint: trade.mintAddress,
      trader: trade.userAddress,
      side: trade.tradeType === TradeType.BUY || trade.tradeType === 'buy' ? 'buy' : 'sell',
      amountUsd: trade.volumeUsd || 0,
      timestamp: trade.blockTime ? trade.blockTime * 1000 : Date.now(),
      venue: venue as 'bc' | 'amm' | 'raydium',
      slippage
    });
    
    // Check for MEV patterns
    this.checkForMEV(window);
  }

  private checkForMEV(window: TradeWindow): void {
    const trades = window.trades;
    if (trades.length < 3) return;
    
    // Sort by timestamp
    trades.sort((a, b) => a.timestamp - b.timestamp);
    
    // Check for sandwich attacks
    for (let i = 0; i < trades.length - 2; i++) {
      const trade1 = trades[i];
      const trade2 = trades[i + 1];
      const trade3 = trades[i + 2];
      
      // Sandwich pattern: Buy -> Victim -> Sell (same trader, different middle)
      if (trade1.trader === trade3.trader && 
          trade1.trader !== trade2.trader &&
          trade1.side === 'buy' && 
          trade3.side === 'sell' &&
          trade3.timestamp - trade1.timestamp < this.MEV_TIME_THRESHOLD_MS) {
        this.stats.mevDetected++;
        this.stats.tradePatternsDetected.sandwiches++;
        
        this.logger.warn('🥪 Sandwich attack detected', {
          mint: window.trades[0].mint,
          attacker: trade1.trader,
          victim: trade2.trader,
          profit: trade3.amountUsd - trade1.amountUsd
        });
      }
    }
    
    // Check for frontrunning
    for (let i = 0; i < trades.length - 1; i++) {
      const trade1 = trades[i];
      const trade2 = trades[i + 1];
      
      // Frontrunning pattern: Same side trades very close together
      if (trade1.side === trade2.side &&
          trade1.trader !== trade2.trader &&
          trade2.timestamp - trade1.timestamp < 1000 && // Within 1 second
          trade1.amountUsd > 1000) { // Significant size
        this.stats.tradePatternsDetected.frontrunning++;
        
        this.logger.debug('🏃 Potential frontrunning detected', {
          mint: window.trades[0].mint,
          frontrunner: trade1.trader,
          victim: trade2.trader
        });
      }
    }
    
    // Check for copy trading
    const traderPatterns = new Map<string, number>();
    for (const trade of trades) {
      const count = traderPatterns.get(trade.trader) || 0;
      traderPatterns.set(trade.trader, count + 1);
    }
    
    // If multiple traders follow similar patterns
    const similarTrades = Array.from(traderPatterns.values()).filter(count => count > 2);
    if (similarTrades.length > 3) {
      this.stats.tradePatternsDetected.copyTrades++;
    }
  }

  private detectPatternsForTrade(trade: TradeEvent, _venue: string): string[] {
    const patterns: string[] = [];
    
    const window = this.tradeWindows.get(trade.mintAddress);
    if (!window) return patterns;
    
    // Check if this trade is part of detected patterns
    const recentSandwiches = this.stats.tradePatternsDetected.sandwiches;
    const recentFrontrunning = this.stats.tradePatternsDetected.frontrunning;
    
    if (recentSandwiches > 0) patterns.push('sandwich');
    if (recentFrontrunning > 0) patterns.push('frontrun');
    if (trade.volumeUsd && trade.volumeUsd > 10000) patterns.push('whale');
    
    return patterns;
  }

  private analyzeTradePatterns(_data: any, _venue: string): void {
    // Additional pattern analysis can be added here
    // This is called when trades are emitted by other monitors
  }

  private cleanupOldWindows(): void {
    const now = Date.now();
    const oldWindows: string[] = [];
    
    for (const [mint, window] of this.tradeWindows.entries()) {
      if (now - window.windowEnd > this.WINDOW_SIZE_MS) {
        oldWindows.push(mint);
      }
    }
    
    for (const mint of oldWindows) {
      this.tradeWindows.delete(mint);
    }
    
    this.logger.debug(`Cleaned up ${oldWindows.length} old trade windows`);
  }

  displayStats(): void {
    console.log(chalk.magenta('\n📊 Trading Activity Stats:'));
    console.log(chalk.gray('─'.repeat(50)));
    
    // Trade counts by venue
    console.log(chalk.cyan('Trade Distribution:'));
    console.log(`  BC Trades:      ${this.stats.bcTrades.toLocaleString()}`);
    console.log(`  AMM Trades:     ${this.stats.ammTrades.toLocaleString()}`);
    console.log(`  Raydium Trades: ${this.stats.raydiumTrades.toLocaleString()}`);
    console.log(`  Total:          ${this.stats.totalTrades.toLocaleString()}`);
    
    // Volume stats
    console.log(chalk.cyan('\nVolume Stats:'));
    console.log(`  Total Volume:   $${this.stats.totalVolumeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  Largest Trade:  $${this.stats.largestTradeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  Unique Traders: ${this.stats.uniqueTraders.size.toLocaleString()}`);
    
    // MEV and patterns
    console.log(chalk.cyan('\nMEV & Patterns:'));
    console.log(`  MEV Detected:      ${this.stats.mevDetected}`);
    console.log(`  Sandwich Attacks:  ${this.stats.tradePatternsDetected.sandwiches}`);
    console.log(`  Frontrunning:      ${this.stats.tradePatternsDetected.frontrunning}`);
    console.log(`  Copy Trading:      ${this.stats.tradePatternsDetected.copyTrades}`);
    console.log(`  High Slippage:     ${this.stats.highSlippageTrades}`);
    
    // Performance
    const avgTradesPerMin = this.stats.totalTrades / Math.max(1, (Date.now() - this.stats.startTime.getTime()) / 60000);
    console.log(chalk.cyan('\nPerformance:'));
    console.log(`  Trades/min:     ${avgTradesPerMin.toFixed(1)}`);
    console.log(`  Parse Rate:     ${((this.stats.totalTrades / Math.max(1, this.stats.transactions)) * 100).toFixed(1)}%`);
    
    console.log(chalk.gray('─'.repeat(50)));
  }

  shouldLogError(error: any): boolean {
    const message = error?.message || '';
    
    // Ignore common non-critical errors
    if (message.includes('No strategy found') ||
        message.includes('Unknown account owner') ||
        message.includes('Failed to parse')) {
      return false;
    }
    
    return true;
  }

  async onShutdown(): Promise<void> {
    // Clear windows
    this.tradeWindows.clear();
    
    // Final stats
    this.logger.info('Final Trading Activity Stats', {
      totalTrades: this.stats.totalTrades,
      totalVolume: this.stats.totalVolumeUsd,
      mevDetected: this.stats.mevDetected,
      patterns: this.stats.tradePatternsDetected
    });
  }
}