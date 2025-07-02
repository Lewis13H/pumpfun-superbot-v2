/**
 * AMM Monitor Wrapper
 * Wraps the legacy AMM monitor to work with the refactored architecture
 */

import { PublicKey, VersionedTransactionResponse } from '@solana/web3.js';
import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import { BaseMonitor } from '../core/base-monitor';
import { Container, TOKENS } from '../core/container';
import { EVENTS } from '../core/event-bus';
// Removed unused import Idl
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { SolanaEventParser } from '../utils/event-parser';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';
import { TransactionFormatter } from '../utils/transaction-formatter';
import { bnLayoutFormatter } from '../utils/bn-layout-formatter';
import { suppressParserWarnings } from '../utils/suppress-parser-warnings';
import { parseSwapTransactionOutput } from '../utils/swapTransactionParser';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { EnhancedAutoEnricher } from '../services/enhanced-auto-enricher';
import { eventParserService } from '../services/event-parser-service';
import { EnhancedTradeHandler } from '../handlers/enhanced-trade-handler';
import { TradeEvent, EventType, TradeType } from '../parsers/types';
import { PriceCalculator } from '../services/price-calculator';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// Constants
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const TOKEN_DECIMALS = 6;
const MAX_RECENT_TRADES = 20;

interface AMMMonitorStats {
  trades: number;
  buys: number;
  sells: number;
  totalVolumeUsd: number;
  uniqueTokens: Set<string>;
  lastSlot: number;
  feesCollected: number;
  totalFeesUsd: number;
}

export class AMMMonitor extends BaseMonitor {
  private ammStats: AMMMonitorStats;
  private poolStateService!: AmmPoolStateService;
  private enricher: EnhancedAutoEnricher | null = null;
  private tradeHandler!: EnhancedTradeHandler;
  private priceCalculator!: PriceCalculator;
  
  // Parsers from legacy code
  private txnFormatter = new TransactionFormatter();
  private pumpAmmIxParser: SolanaParser;
  private pumpAmmEventParser: SolanaEventParser;
  
  // Recent trades buffer
  private recentTrades: any[] = [];

  constructor(container: Container) {
    super(
      {
        programId: PUMP_AMM_PROGRAM_ID.toBase58(),
        monitorName: 'AMM Pool Monitor',
        color: chalk.cyan as any,
        subscriptionKey: 'pumpswap_amm'  // Add this critical configuration
      },
      container
    );

    // Initialize stats
    this.ammStats = {
      trades: 0,
      buys: 0,
      sells: 0,
      totalVolumeUsd: 0,
      uniqueTokens: new Set<string>(),
      lastSlot: 0,
      feesCollected: 0,
      totalFeesUsd: 0
    };

    // Initialize parsers
    this.pumpAmmIxParser = new SolanaParser([]);
    this.pumpAmmIxParser.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as any);
    
    // Create silent console for parser
    const silentConsole = {
      ...console,
      warn: () => {},
      error: () => {},
    };
    this.pumpAmmEventParser = new SolanaEventParser([], silentConsole);
    this.pumpAmmEventParser.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as any);
  }

  /**
   * Get subscription configuration for StreamManager
   */
  public getSubscriptionConfig() {
    return {
      programId: this.options.programId,
      subscriptionKey: 'pumpswap_amm',
      monitorName: this.options.monitorName
    };
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Suppress parser warnings
    suppressParserWarnings();
    
    // Get pool state service
    this.poolStateService = await this.container.resolve(TOKENS.PoolStateService);
    
    // Get enhanced trade handler
    this.tradeHandler = await this.container.resolve(TOKENS.EnhancedTradeHandler);
    
    // Get price calculator
    this.priceCalculator = await this.container.resolve(TOKENS.PriceCalculator);
    
    // Initialize auto-enricher if API key is available
    if (process.env.HELIUS_API_KEY || process.env.SHYFT_API_KEY) {
      this.enricher = EnhancedAutoEnricher.getInstance();
      await this.enricher.start();
    }
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Start monitoring price impact trends
    this.tradeHandler.monitorPriceImpactTrends();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for pool state updates from AMM account monitor
    this.eventBus.on(EVENTS.POOL_STATE_UPDATED, (data) => {
      this.logger.debug('Pool state updated', {
        pool: data.poolAddress,
        mint: data.mintAddress
      });
    });
  }

  /**
   * Get subscription key for AMM transactions
   */
  protected getSubscriptionKey(): string {
    return 'pumpswap_amm';
  }

  /**
   * Build enhanced subscribe request - override to use exact Shyft format
   */
  protected buildEnhancedSubscribeRequest(): any {
    return this.buildSubscribeRequest();
  }

  /**
   * Build subscribe request for AMM transactions
   */
  protected buildSubscribeRequest(): SubscribeRequest {
    // Use exact format from Shyft examples
    return {
      accounts: {},
      slots: {},
      transactions: {
        pumpswap_amm: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_AMM_PROGRAM_ID.toBase58()],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.CONFIRMED,
    };
  }

  /**
   * Decode pump AMM transaction (from legacy code)
   */
  private decodePumpAmmTxn(tx: VersionedTransactionResponse): any {
    if (!tx.meta || tx.meta.err) return;
    
    try {
      const parsedIxs = this.pumpAmmIxParser.parseTransactionData(
        tx.transaction.message,
        tx.meta.loadedAddresses,
      );

      const pumpAmmIxs = parsedIxs.filter((ix) =>
        ix.programId.equals(PUMP_AMM_PROGRAM_ID) || 
        ix.programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))
      );

      const parsedInnerIxs = this.pumpAmmIxParser.parseTransactionWithInnerInstructions(tx);

      const pump_amm_inner_ixs = parsedInnerIxs.filter((ix) =>
        ix.programId.equals(PUMP_AMM_PROGRAM_ID) || 
        ix.programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))
      );

      if (pumpAmmIxs.length === 0) return;
      
      const events = this.pumpAmmEventParser.parseEvent(tx);
      const result = { instructions: { pumpAmmIxs, events }, inner_ixs: pump_amm_inner_ixs };
      bnLayoutFormatter(result);
      
      return result;
    } catch (err) {
      // Silently ignore parse errors
    }
  }

  /**
   * Process stream data
   */
  async processStreamData(data: any): Promise<void> {
    try {
      if (!data.transaction) return;
      
      // Format transaction using Shyft formatter
      const txn = this.txnFormatter.formTransactionFromJson(
        data.transaction,
        Date.now()
      );
      
      const signature = txn.transaction.signatures[0];
      const slot = txn.slot || 0;
      const blockTime = new Date((txn.blockTime || Math.floor(Date.now() / 1000)) * 1000);
      
      if (slot > this.ammStats.lastSlot) {
        this.ammStats.lastSlot = slot;
      }
      
      // Check for liquidity events using enhanced event parser
      const liquidityEvents = eventParserService.getLiquidityEvents(txn);
      
      // Process liquidity events
      for (const liquidityEvent of liquidityEvents) {
        if ('lpTokenAmountOut' in liquidityEvent) {
          // Deposit event
          this.eventBus.emit(EVENTS.LIQUIDITY_ADDED, {
            event: liquidityEvent,
            signature,
            slot,
            blockTime
          });
          
          this.logger.info('Liquidity deposit detected', {
            pool: liquidityEvent.pool.slice(0, 8) + '...',
            user: liquidityEvent.user.slice(0, 8) + '...',
            lpTokens: liquidityEvent.lpTokenAmountOut,
            signature: signature.slice(0, 8) + '...'
          });
        } else {
          // Withdraw event
          this.eventBus.emit(EVENTS.LIQUIDITY_REMOVED, {
            event: liquidityEvent,
            signature,
            slot,
            blockTime
          });
          
          this.logger.info('Liquidity withdrawal detected', {
            pool: liquidityEvent.pool.slice(0, 8) + '...',
            user: liquidityEvent.user.slice(0, 8) + '...',
            lpTokens: liquidityEvent.lpTokenAmountIn,
            signature: signature.slice(0, 8) + '...'
          });
        }
      }
      
      // Check for fee collection events
      const feeEvents = eventParserService.getFeeEvents(txn);
      
      // Process fee events
      for (const feeEvent of feeEvents) {
        if ('recipient' in feeEvent) {
          // Creator fee event
          this.eventBus.emit(EVENTS.FEE_COLLECTED, {
            event: feeEvent,
            signature,
            slot,
            blockTime
          });
          
          this.logger.info('Creator fee collected', {
            pool: feeEvent.pool.slice(0, 8) + '...',
            recipient: feeEvent.recipient.slice(0, 8) + '...',
            coinAmount: feeEvent.coinAmount,
            pcAmount: feeEvent.pcAmount,
            signature: signature.slice(0, 8) + '...'
          });
        } else {
          // Protocol fee event
          this.eventBus.emit(EVENTS.PROTOCOL_FEE_COLLECTED, {
            event: feeEvent,
            signature,
            slot,
            blockTime
          });
          
          this.logger.info('Protocol fee collected', {
            pool: feeEvent.poolAddress.slice(0, 8) + '...',
            protocolCoinFee: feeEvent.protocolCoinFee,
            protocolPcFee: feeEvent.protocolPcFee,
            signature: signature.slice(0, 8) + '...'
          });
        }
      }
      
      // Decode pump AMM transaction for swap events
      const parsedTxn = this.decodePumpAmmTxn(txn);
      if (!parsedTxn) return;
      
      // Parse swap output
      const formattedSwapTxn = parseSwapTransactionOutput(parsedTxn, txn);
      if (!formattedSwapTxn) return;
      
      const swapEvent = formattedSwapTxn.transactionEvent;
      if (!swapEvent) return;
      
      this.ammStats.trades++;
      
      // Extract reserves from pump AMM events
      let virtualSolReserves = 0n;
      let virtualTokenReserves = 0n;
      let eventFound = false;
      
      // Parse events to get pool reserves
      const parsedEvents = eventParserService.parseTransaction(txn);
      
      for (const event of parsedEvents) {
        if (event.name === 'BuyEvent' || event.name === 'SellEvent') {
          // Extract reserves from the event
          const eventData = event.data;
          
          // The events contain pool_base_token_reserves and pool_quote_token_reserves
          // For pump.fun AMM, quote is always SOL, base is the token
          // These values are already in their smallest units (lamports for SOL, token units with decimals)
          try {
            virtualTokenReserves = BigInt(eventData.pool_base_token_reserves || eventData.poolBaseTokenReserves || '0');
            virtualSolReserves = BigInt(eventData.pool_quote_token_reserves || eventData.poolQuoteTokenReserves || '0');
            eventFound = true;
            
            this.logger.debug('Extracted reserves from AMM event', {
              eventName: event.name,
              tokenReserves: virtualTokenReserves.toString(),
              solReserves: virtualSolReserves.toString(),
              mint: swapEvent.mint.slice(0, 8) + '...'
            });
          } catch (error) {
            this.logger.warn('Failed to parse reserves from event', {
              eventName: event.name,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
          
          // Also check for fees
          const feeEvent = eventParserService.extractFeesFromTrade(event.data);
          if (feeEvent) {
            this.eventBus.emit(EVENTS.AMM_TRADE, {
              event: event.data,
              signature,
              slot,
              blockTime
            });
            
            // Track fee stats
            this.ammStats.feesCollected++;
            const feeValueUsd = Number(feeEvent.pcAmount) / 1e6 * this.currentSolPrice; // Simplified calculation
            this.ammStats.totalFeesUsd += feeValueUsd;
          }
          
          break; // We found our event, no need to continue
        }
      }
      if (swapEvent.type === 'Buy') {
        this.ammStats.buys++;
      } else {
        this.ammStats.sells++;
      }
      
      // If we didn't find reserves in events, try pool state service as fallback
      if (!eventFound || virtualSolReserves === 0n || virtualTokenReserves === 0n) {
        // Get pool reserves from pool state service
        let poolState = this.poolStateService.getPoolState(swapEvent.mint);
        
        // If we don't have pool state, try to get it by pool address
        if (!poolState && swapEvent.pool) {
          poolState = this.poolStateService.getPoolStateByAddress(swapEvent.pool);
        }
        
        if (poolState && poolState.reserves) {
          // Convert cached reserves to bigint
          virtualSolReserves = BigInt(poolState.reserves.virtualSolReserves || 0);
          virtualTokenReserves = BigInt(poolState.reserves.virtualTokenReserves || 0);
          
          this.logger.debug('Using cached pool reserves (fallback)', {
            mint: swapEvent.mint.slice(0, 8) + '...',
            solReserves: virtualSolReserves.toString(),
            tokenReserves: virtualTokenReserves.toString()
          });
        } else if (!eventFound) {
          // Only log warning if we didn't find event data
          this.logger.warn('No reserves found from events or pool state', {
            mint: swapEvent.mint.slice(0, 8) + '...',
            pool: swapEvent.pool ? swapEvent.pool.slice(0, 8) + '...' : 'unknown'
          });
        }
      }
      
      // Calculate amounts and price
      let solAmount: number;
      let tokenAmount: number;
      
      if (swapEvent.type === 'Buy') {
        solAmount = Number(swapEvent.in_amount) / LAMPORTS_PER_SOL;
        tokenAmount = Number(swapEvent.out_amount) / Math.pow(10, TOKEN_DECIMALS);
        
        this.logger.debug('Buy trade raw amounts', {
          in_amount_raw: swapEvent.in_amount,
          out_amount_raw: swapEvent.out_amount,
          solAmount_calculated: solAmount,
          tokenAmount_calculated: tokenAmount
        });
      } else {
        tokenAmount = Number(swapEvent.in_amount) / Math.pow(10, TOKEN_DECIMALS);
        solAmount = Number(swapEvent.out_amount) / LAMPORTS_PER_SOL;
        
        this.logger.debug('Sell trade raw amounts', {
          in_amount_raw: swapEvent.in_amount,
          out_amount_raw: swapEvent.out_amount,
          tokenAmount_calculated: tokenAmount,
          solAmount_calculated: solAmount
        });
      }
      
      // Calculate price using the price calculator with reserves
      let priceInfo = { priceInSol: 0, priceInUsd: 0, marketCapUsd: 0, priceInLamports: 0 };
      
      if (virtualSolReserves > 0n && virtualTokenReserves > 0n) {
        // Use price calculator to get accurate price and market cap
        priceInfo = this.priceCalculator.calculatePrice(
          {
            solReserves: virtualSolReserves,
            tokenReserves: virtualTokenReserves,
            isVirtual: false
          },
          this.currentSolPrice
        );
        
        this.logger.debug('Calculated price from reserves', {
          mint: swapEvent.mint.slice(0, 8) + '...',
          priceInSol: priceInfo.priceInSol,
          priceInUsd: priceInfo.priceInUsd,
          marketCapUsd: priceInfo.marketCapUsd
        });
      } else {
        // Fallback to simple price calculation from trade amounts
        const priceInSol = tokenAmount > 0 ? solAmount / tokenAmount : 0;
        priceInfo = {
          priceInSol,
          priceInUsd: priceInSol * this.currentSolPrice,
          marketCapUsd: priceInSol * this.currentSolPrice * 1e9, // Assume 1B supply
          priceInLamports: priceInSol * Number(LAMPORTS_PER_SOL)
        };
        
        this.logger.warn('Using fallback price calculation from trade amounts', {
          mint: swapEvent.mint.slice(0, 8) + '...',
          priceInUsd: priceInfo.priceInUsd
        });
      }
      
      const volumeUsd = solAmount * this.currentSolPrice;
      
      this.ammStats.totalVolumeUsd += volumeUsd;
      this.ammStats.uniqueTokens.add(swapEvent.mint);
      
      // Add to recent trades
      this.recentTrades.unshift({
        time: new Date(),
        type: swapEvent.type,
        mint: swapEvent.mint,
        symbol: undefined,
        solAmount,
        tokenAmount,
        priceUsd: priceInfo.priceInUsd,
        user: swapEvent.user,
        signature
      });
      
      if (this.recentTrades.length > MAX_RECENT_TRADES) {
        this.recentTrades.pop();
      }
      
      // Emit AMM trade event with calculated price and market cap
      this.eventBus.emit(EVENTS.AMM_TRADE, {
        trade: {
          signature,
          mintAddress: swapEvent.mint,
          tradeType: swapEvent.type.toLowerCase() as 'buy' | 'sell',
          userAddress: swapEvent.user,
          solAmount,
          tokenAmount,
          priceUsd: priceInfo.priceInUsd,
          volumeUsd,
          marketCapUsd: priceInfo.marketCapUsd,
          program: 'amm_pool' as const,
          slot,
          blockTime: new Date()
        }
      });
      
      // Create trade event for enhanced handler
      const tradeEvent: TradeEvent = {
        type: EventType.AMM_TRADE,
        signature,
        slot: BigInt(slot),
        blockTime: Date.now(),
        programId: PUMP_AMM_PROGRAM_ID.toBase58(),
        tradeType: swapEvent.type === 'Buy' ? TradeType.BUY : TradeType.SELL,
        mintAddress: swapEvent.mint,
        userAddress: swapEvent.user,
        solAmount: BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)),
        tokenAmount: BigInt(Math.floor(tokenAmount * Math.pow(10, TOKEN_DECIMALS))),
        virtualSolReserves: virtualSolReserves,  // Already in lamports as bigint
        virtualTokenReserves: virtualTokenReserves,  // Already in token units as bigint
        realSolReserves: virtualSolReserves,  // AMM uses same reserves for real and virtual
        realTokenReserves: virtualTokenReserves,
        poolAddress: swapEvent.pool,
        // Add the calculated price and market cap
        priceUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd,
        volumeUsd: volumeUsd
      };
      
      // Process trade with enhanced handler (includes price impact calculations)
      await this.tradeHandler.processTrade(tradeEvent, this.currentSolPrice);
      
      // Log trades with full signature (reduced threshold for testing)
      if (volumeUsd > 10) {
        // Only log if not in quiet mode
        if (process.env.DISABLE_MONITOR_STATS !== 'true') {
          this.logger.info('AMM trade', {
            type: swapEvent.type,
            mint: swapEvent.mint.slice(0, 8) + '...',
            solAmount: solAmount.toFixed(9), // Full precision like Solscan
            tokenAmount: tokenAmount.toFixed(6), // Full token precision
            priceUsd: priceInfo.priceInUsd.toFixed(12), // Full price precision
            volumeUsd: volumeUsd.toFixed(2), // Match Solscan format
            signature: signature,
            solscan: `https://solscan.io/tx/${signature}`
          });
        }
      }
      
    } catch (error) {
      this.stats.errors++;
      if (this.shouldLogError(error)) {
        this.logger.error('Error processing AMM transaction', error as Error);
      }
    }
  }

  /**
   * Display statistics
   */
  displayStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();
    const tps = this.ammStats.trades / (runtime / 1000);
    const buyRatio = this.ammStats.trades > 0 ? (this.ammStats.buys / this.ammStats.trades) * 100 : 0;

    this.logger.box('AMM Pool Monitor Statistics', {
      'Runtime': this.formatDuration(runtime),
      'Transactions': this.formatNumber(this.stats.transactions),
      'Trades': `${this.formatNumber(this.ammStats.trades)} (${tps.toFixed(2)} TPS)`,
      'Buys': this.formatNumber(this.ammStats.buys),
      'Sells': this.formatNumber(this.ammStats.sells),
      'Buy Ratio': `${buyRatio.toFixed(1)}%`,
      'Unique Tokens': this.ammStats.uniqueTokens.size,
      'Total Volume': `$${this.formatNumber(Math.round(this.ammStats.totalVolumeUsd))}`,
      'Fees Collected': this.formatNumber(this.ammStats.feesCollected),
      'Total Fees': `$${this.formatNumber(Math.round(this.ammStats.totalFeesUsd))}`,
      'Last Slot': this.ammStats.lastSlot,
      'SOL Price': `$${this.currentSolPrice.toFixed(2)}`,
      'Errors': this.formatNumber(this.stats.errors),
      'Reconnects': this.stats.reconnections
    });

    // Show recent trades
    if (this.recentTrades.length > 0) {
      console.log(chalk.white.bold('\n💹 Recent Trades:'));
      console.log(chalk.gray('─'.repeat(80)));
      
      for (const trade of this.recentTrades.slice(0, 5)) {
        const age = Math.floor((Date.now() - trade.time.getTime()) / 1000);
        const ageStr = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
        const typeColor = trade.type === 'Buy' ? chalk.green : chalk.red;
        
        console.log(
          chalk.gray(`${ageStr} ago`),
          typeColor(trade.type),
          chalk.white(trade.mint.slice(0, 8) + '...'),
          chalk.cyan(`${trade.solAmount.toFixed(4)} SOL`),
          chalk.green(`$${trade.priceUsd.toFixed(6)}`),
          chalk.yellow(`$${(trade.solAmount * this.currentSolPrice).toFixed(2)}`)
        );
      }
    }
  }

  /**
   * Should log error
   */
  shouldLogError(error: any): boolean {
    const message = error?.message || '';
    return !message.includes('ComputeBudget') && process.env.DEBUG_AMM === 'true';
  }

  /**
   * Shutdown handler
   */
  async onShutdown(): Promise<void> {
    if (this.enricher) {
      this.enricher.stop();
    }
    
    this.logger.info('AMM monitor shutdown complete', {
      totalTrades: this.ammStats.trades,
      totalVolume: `$${this.formatNumber(Math.round(this.ammStats.totalVolumeUsd))}`,
      uniqueTokens: this.ammStats.uniqueTokens.size
    });
  }
}