/**
 * Raydium AMM Monitor
 * Monitors Raydium AMM pools for graduated pump.fun tokens
 */

import { PublicKey } from '@solana/web3.js';
import { BaseMonitor } from '../core/base-monitor';
import { Container, TOKENS } from '../core/container';
import { EventType } from '../utils/parsers/types';
import { SimpleRaydiumTradeStrategy } from '../utils/parsers/strategies/raydium-trade-strategy-simple';
import { EnhancedTradeHandler } from '../handlers/enhanced-trade-handler';
import { EnhancedAutoEnricher } from '../services/metadata/enhanced-auto-enricher';
import { EVENTS } from '../core/event-bus';
import chalk from 'chalk';

export class RaydiumMonitor extends BaseMonitor {
  private readonly RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
  private raydiumParser: SimpleRaydiumTradeStrategy;
  private tradeHandler!: EnhancedTradeHandler;
  private metadataEnricher!: EnhancedAutoEnricher;
  
  // Statistics
  private raydiumStats = {
    swaps: 0,
    liquidityEvents: 0,
    parseFailures: 0,
    successfulParses: 0,
    lastProcessedSlot: 0,
    tradesPerSecond: 0,
    highValueTrades: 0,
    totalVolumeUsd: 0,
    averageTradeSize: 0
  };

  private tradeTimestamps: number[] = [];
  private volumeTracker: number[] = [];

  constructor(container: Container) {
    super(
      {
        programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        monitorName: 'Raydium AMM Monitor',
        color: chalk.blue as any,
        subscriptionKey: 'raydium-transactions'
      },
      container
    );
    
    // Initialize parser
    this.raydiumParser = new SimpleRaydiumTradeStrategy();
  }

  /**
   * Initialize services from container
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Resolve services from container
    this.tradeHandler = await this.container.resolve(TOKENS.TradeHandler) as EnhancedTradeHandler;
    this.metadataEnricher = await this.container.resolve(TOKENS.MetadataEnricher) as EnhancedAutoEnricher;
    
    this.logger.info('Raydium monitor initialized', {
      programId: this.RAYDIUM_PROGRAM_ID,
      subscriptionKey: this.getSubscriptionKey()
    });
  }

  protected getSubscriptionKey(): string {
    return 'raydium-transactions';
  }
  
  /**
   * Override to check for Raydium transactions
   */
  protected shouldProcessData(data: any): boolean {
    // Check if this is transaction data
    if (!data?.transaction) return false;
    
    // Access the correct path: data.transaction.transaction
    const tx = data.transaction.transaction;
    if (!tx) return false;
    
    // Check if transaction involves Raydium
    const message = tx.transaction?.message;
    if (!message) return false;
    
    // Sample logging every 100 transactions
    if (this.stats.transactions % 100 === 0) {
      const accountKeys = message.accountKeys || [];
      this.logger.debug('Sample transaction accounts:', {
        count: accountKeys.length,
        first5: accountKeys.slice(0, 5).map((k: any) => {
          if (typeof k === 'string') return k.slice(0, 8) + '...';
          if (k?.pubkey) return k.pubkey.slice(0, 8) + '...'; // Handle object format
          if (Buffer.isBuffer(k)) return new PublicKey(k).toString().slice(0, 8) + '...';
          return 'unknown';
        })
      });
    }
    
    // Check account keys for Raydium program
    const accountKeys = message.accountKeys || [];
    const hasRaydium = accountKeys.some((key: any) => {
      // Handle different key formats
      let keyStr: string;
      if (typeof key === 'string') {
        keyStr = key;
      } else if (key?.pubkey) {
        keyStr = key.pubkey;
      } else if (key?.toString) {
        keyStr = key.toString();
      } else if (Buffer.isBuffer(key)) {
        try {
          keyStr = new PublicKey(key).toString();
        } catch {
          return false;
        }
      } else {
        return false;
      }
      return keyStr === this.RAYDIUM_PROGRAM_ID;
    });
    
    if (hasRaydium) {
      this.logger.info('Found Raydium in account keys!');
      return true;
    }
    
    // Also check logs
    const logs = tx.meta?.logMessages || [];
    const hasRaydiumLog = logs.some((log: string) => 
      log.includes(this.RAYDIUM_PROGRAM_ID) || log.includes('ray_log')
    );
    
    if (hasRaydiumLog) {
      // Log only once per 50 transactions to reduce noise
      if (this.stats.transactions % 50 === 0) {
        this.logger.debug('Found Raydium in logs but not in account keys', {
          signature: tx.signature?.slice(0, 8) + '...',
          logSample: logs.find((log: string) => log.includes(this.RAYDIUM_PROGRAM_ID))?.slice(0, 100) + '...'
        });
      }
      return true;
    }
    
    return false;
  }
  
  /**
   * Build enhanced subscription for Raydium
   */
  protected buildEnhancedSubscribeRequest(): any {
    return {
      commitment: 'confirmed',
      accountsDataSlice: [],
      ping: undefined,
      // Subscribe to transactions that mention Raydium program
      transactions: {
        client: {
          vote: false,
          failed: false,
          accountInclude: [this.RAYDIUM_PROGRAM_ID],
          accountExclude: [],
          accountRequired: []
        }
      },
      // Also monitor Raydium accounts
      accounts: {
        client: {
          account: [],
          owner: [this.RAYDIUM_PROGRAM_ID],
          filters: []
        }
      },
      slots: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {}
    };
  }

  /**
   * Setup stream listener to handle Raydium data
   */
  protected setupStreamListener(): void {
    // Listen for stream data
    this.eventBus.on(EVENTS.STREAM_DATA, async (data: any) => {
      if (!this.isShuttingDown && this.shouldProcessData(data)) {
        await this.processStreamData(data);
      }
    });
    
    this.logger.info('Raydium stream listener setup complete');
  }
  
  /**
   * Process incoming stream data
   */
  async processStreamData(data: any): Promise<void> {
    try {
      this.stats.transactions++;
      
      // Access the correct path: data.transaction.transaction
      const fullTransaction = data?.transaction?.transaction;
      if (!fullTransaction) {
        this.logger.debug('No transaction data in stream');
        return;
      }
      
      // Log transaction structure for debugging
      if (this.stats.transactions % 100 === 0) {
        const message = fullTransaction.transaction?.message;
        this.logger.debug('Transaction structure sample:', {
          hasTransaction: !!fullTransaction.transaction,
          hasMessage: !!message,
          instructionCount: message?.instructions?.length || 0,
          accountKeysCount: message?.accountKeys?.length || 0,
          signature: fullTransaction.signature?.slice(0, 8) + '...',
          // Log full structure every 1000 transactions for deep debugging
          fullStructure: this.stats.transactions % 1000 === 0 ? {
            keys: Object.keys(fullTransaction),
            txKeys: fullTransaction.transaction ? Object.keys(fullTransaction.transaction) : [],
            messageKeys: message ? Object.keys(message) : []
          } : undefined
        });
      }
      
      // Check if transaction involves Raydium program
      const canParse = this.raydiumParser.canParse(fullTransaction);
      if (!canParse) {
        // Debug why parser can't parse this transaction
        if (this.stats.transactions % 100 === 0) {
          this.logger.debug('Parser cannot parse transaction', {
            hasMessage: !!fullTransaction.transaction?.message,
            accountKeysCount: fullTransaction.transaction?.message?.accountKeys?.length || 0
          });
        }
        return;
      }
      
      this.logger.info('Found Raydium transaction in account keys!', {
        signature: fullTransaction.signature?.slice(0, 8) + '...'
      });

      // Update slot tracking
      const slot = Number(fullTransaction.slot || 0);
      if (slot > this.raydiumStats.lastProcessedSlot) {
        this.raydiumStats.lastProcessedSlot = slot;
      }

      // Parse the transaction using Raydium parser
      const events = this.raydiumParser.parse(fullTransaction, fullTransaction);
      
      if (!events || events.length === 0) {
        this.raydiumStats.parseFailures++;
        
        // Log detailed failure info every 10 failures
        if (this.raydiumStats.parseFailures % 10 === 0) {
          const message = fullTransaction.transaction?.message;
          this.logger.debug('Parse failure details:', {
            signature: fullTransaction.signature?.slice(0, 8) + '...',
            hasMessage: !!message,
            instructionCount: message?.instructions?.length || 0,
            hasMeta: !!fullTransaction.meta,
            hasLogs: !!(fullTransaction.meta?.logMessages?.length)
          });
        }
        return;
      }

      this.raydiumStats.successfulParses++;

      // Process each event
      for (const event of events) {
        if (event.type === EventType.RAYDIUM_SWAP) {
          await this.processSwapEvent(event);
          this.raydiumStats.swaps++;
        } else if (event.type === EventType.RAYDIUM_LIQUIDITY) {
          await this.processLiquidityEvent(event);
          this.raydiumStats.liquidityEvents++;
        }
      }

      // Update TPS tracking
      this.updateTpsTracking();

    } catch (error) {
      this.stats.errors++;
      if (this.shouldLogError(error)) {
        this.logger.error('Error processing Raydium stream data', error as Error);
      }
    }
  }

  /**
   * Process Raydium swap events
   */
  private async processSwapEvent(event: any): Promise<void> {
    try {
      const solPrice = await this.solPriceService.getPrice();
      
      // Process the trade
      const result = await this.tradeHandler.processTrade(event, solPrice);
      
      if (result.saved) {
        // Track volume
        const volumeUsd = event.volumeUsd || (Number(event.solAmount) / 1e9 * solPrice);
        this.volumeTracker.push(volumeUsd);
        this.raydiumStats.totalVolumeUsd += volumeUsd;
        
        // Track high value trades
        if (volumeUsd > 10000) {
          this.raydiumStats.highValueTrades++;
          this.logger.info('High value Raydium trade detected', {
            signature: event.signature.slice(0, 8) + '...',
            volume: `$${volumeUsd.toFixed(0)}`,
            mintAddress: event.mintAddress.slice(0, 8) + '...'
          });
        }
      }
    } catch (error) {
      this.logger.error('Error processing Raydium swap', error as Error);
    }
  }

  /**
   * Process liquidity events
   */
  private async processLiquidityEvent(event: any): Promise<void> {
    try {
      // The LiquidityEventHandler expects deposit/withdraw events to be emitted via EventBus
      // For Raydium liquidity events, we'll need to determine the event type and emit accordingly
      if (event.eventType === 'deposit') {
        this.eventBus.emit(EVENTS.LIQUIDITY_ADDED, {
          event: event,
          signature: event.signature,
          slot: event.slot,
          blockTime: new Date(event.blockTime * 1000)
        });
      } else if (event.eventType === 'withdraw') {
        this.eventBus.emit(EVENTS.LIQUIDITY_REMOVED, {
          event: event,
          signature: event.signature,
          slot: event.slot,
          blockTime: new Date(event.blockTime * 1000)
        });
      }
    } catch (error) {
      this.logger.error('Error processing Raydium liquidity event', error as Error);
    }
  }

  /**
   * Update TPS tracking
   */
  private updateTpsTracking(): void {
    const now = Date.now();
    this.tradeTimestamps.push(now);
    
    // Keep only last minute of timestamps
    const oneMinuteAgo = now - 60000;
    this.tradeTimestamps = this.tradeTimestamps.filter(ts => ts > oneMinuteAgo);
    
    // Calculate TPS
    this.raydiumStats.tradesPerSecond = this.tradeTimestamps.length / 60;
    
    // Calculate average trade size
    if (this.volumeTracker.length > 100) {
      this.volumeTracker = this.volumeTracker.slice(-100); // Keep last 100
    }
    
    if (this.volumeTracker.length > 0) {
      const sum = this.volumeTracker.reduce((a, b) => a + b, 0);
      this.raydiumStats.averageTradeSize = sum / this.volumeTracker.length;
    }
  }

  /**
   * Display statistics
   */
  displayStats(): void {
    const parseRate = this.stats.transactions > 0 
      ? ((this.raydiumStats.successfulParses / this.stats.transactions) * 100).toFixed(1)
      : '0.0';
    
    const volumeFormatted = this.raydiumStats.totalVolumeUsd > 1000000
      ? `$${(this.raydiumStats.totalVolumeUsd / 1000000).toFixed(1)}M`
      : `$${(this.raydiumStats.totalVolumeUsd / 1000).toFixed(1)}K`;

    console.log(chalk.blue('\n📊 Raydium Monitor Statistics:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`${chalk.blue('Transactions:')} ${this.stats.transactions.toLocaleString()}`);
    console.log(`${chalk.blue('Swaps:')} ${this.raydiumStats.swaps.toLocaleString()}`);
    console.log(`${chalk.blue('Liquidity Events:')} ${this.raydiumStats.liquidityEvents.toLocaleString()}`);
    console.log(`${chalk.blue('Parse Rate:')} ${parseRate}%`);
    console.log(`${chalk.blue('TPS:')} ${this.raydiumStats.tradesPerSecond.toFixed(2)}`);
    console.log(`${chalk.blue('High Value Trades:')} ${this.raydiumStats.highValueTrades}`);
    console.log(`${chalk.blue('Total Volume:')} ${volumeFormatted}`);
    console.log(`${chalk.blue('Avg Trade Size:')} $${this.raydiumStats.averageTradeSize.toFixed(0)}`);
    console.log(`${chalk.blue('Errors:')} ${this.stats.errors}`);
    console.log(`${chalk.blue('Last Slot:')} ${this.raydiumStats.lastProcessedSlot.toLocaleString()}`);
    
    // Display service stats
    const handlerStats = this.tradeHandler.getStats();
    const enricherStats = this.metadataEnricher.getStats();
    
    console.log(chalk.gray('\n─ Services ─'));
    console.log(`${chalk.blue('Cached Tokens:')} ${handlerStats.cachedTokens}`);
    console.log(`${chalk.blue('Pending Trades:')} ${handlerStats.pendingTrades}`);
    console.log(`${chalk.blue('Enrichment Queue:')} ${enricherStats.queueSize}`);
    console.log(`${chalk.blue('Enriched Tokens:')} ${enricherStats.totalEnriched}`);
  }

  /**
   * Determine if error should be logged
   */
  shouldLogError(error: any): boolean {
    const message = error?.message || '';
    
    // Suppress common non-critical errors
    if (message.includes('Account not found')) return false;
    if (message.includes('Invalid account data')) return false;
    if (message.includes('Failed to parse')) return false;
    
    return true;
  }

  /**
   * Shutdown cleanup
   */
  async onShutdown(): Promise<void> {
    this.logger.info('Shutting down Raydium monitor...');
    
    // Display final stats
    this.displayStats();
    
    // Clear intervals and timers
    this.tradeTimestamps = [];
    this.volumeTracker = [];
  }
}