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
import { SolanaEventParser } from '../utils/parsers/event-parser';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';
import { TransactionFormatter } from '../utils/parsers/transaction-formatter';
import { bnLayoutFormatter } from '../utils/formatters/bn-layout-formatter';
import { enableErrorSuppression } from '../utils/parsers/error-suppressor';
import { parseSwapTransactionOutput } from '../utils/parsers/swap-transaction-parser';
import { AmmPoolStateService } from '../services/amm/amm-pool-state-service';
import { EnhancedAutoEnricher } from '../services/metadata/enhanced-auto-enricher';
import { eventParserService } from '../services/core/event-parser-service';
import { EnhancedTradeHandler } from '../handlers/enhanced-trade-handler';
import { TradeEvent, EventType, TradeType } from '../utils/parsers/types';
import { PriceCalculator } from '../services/pricing/price-calculator';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { extractAmmEventsFromLogs } from '../utils/amm/event-decoder';

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
        color: chalk.cyan as any
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
    
    // Create console for parser - show errors in debug mode
    const parserConsole = process.env.DEBUG_AMM === 'true' ? console : {
      ...console,
      warn: () => {},
      error: () => {},
    };
    this.pumpAmmEventParser = new SolanaEventParser([], parserConsole);
    this.pumpAmmEventParser.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as any);
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Suppress parser warnings
    enableErrorSuppression();
    
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
      
      // Debug: Check if logs exist
      if (process.env.DEBUG_AMM === 'true') {
        this.logger.debug('Transaction logs check', {
          hasLogs: !!tx.meta?.logMessages,
          logCount: tx.meta?.logMessages?.length || 0,
          firstFewLogs: tx.meta?.logMessages?.slice(0, 5) || [],
          signature: tx.transaction.signatures[0].slice(0, 8) + '...'
        });
      }
      
      let events = this.pumpAmmEventParser.parseEvent(tx);
      
      // If Anchor event parser fails (returns empty), try direct decoder
      if (events.length === 0 && tx.meta?.logMessages) {
        if (process.env.DEBUG_AMM === 'true') {
          this.logger.debug('Anchor event parser returned no events, trying direct decoder');
        }
        events = extractAmmEventsFromLogs(tx.meta.logMessages);
      }
      
      if (process.env.DEBUG_AMM === 'true') {
        this.logger.debug('Event parsing result', {
          eventsFound: events.length,
          eventNames: events.map((e: any) => e.name),
          firstEventData: events[0]?.data ? Object.keys(events[0].data) : null,
          signature: tx.transaction.signatures[0].slice(0, 8) + '...'
        });
      }
      
      const result = { instructions: { pumpAmmIxs, events }, inner_ixs: pump_amm_inner_ixs };
      
      if (process.env.DEBUG_AMM === 'true' && events.length > 0) {
        this.logger.debug('Before bnLayoutFormatter', {
          firstEventFields: events[0]?.data ? Object.keys(events[0].data) : null,
          pool_base_token_reserves: events[0]?.data?.pool_base_token_reserves,
          pool_quote_token_reserves: events[0]?.data?.pool_quote_token_reserves
        });
      }
      
      bnLayoutFormatter(result);
      
      if (process.env.DEBUG_AMM === 'true' && result.instructions.events.length > 0) {
        this.logger.debug('After bnLayoutFormatter', {
          firstEventFields: result.instructions.events[0]?.data ? Object.keys(result.instructions.events[0].data) : null,
          pool_base_token_reserves: result.instructions.events[0]?.data?.pool_base_token_reserves,
          pool_quote_token_reserves: result.instructions.events[0]?.data?.pool_quote_token_reserves
        });
      }
      
      return result;
    } catch (err) {
      if (process.env.DEBUG_AMM === 'true') {
        this.logger.error('Error decoding pump AMM transaction', err as Error);
      }
    }
  }

  /**
   * Process stream data
   */
  async processStreamData(data: any): Promise<void> {
    try {
      if (!data.transaction) return;
      
      // Format transaction using Shyft formatter
      // Use blockTime from transaction if available, otherwise use current time in seconds
      const blockTimeSeconds = data.transaction.blockTime || Math.floor(Date.now() / 1000);
      const txn = this.txnFormatter.formTransactionFromJson(
        data.transaction,
        blockTimeSeconds
      );
      
      const signature = txn.transaction.signatures[0];
      const slot = txn.slot || 0;
      const blockTime = new Date((txn.blockTime || Math.floor(Date.now() / 1000)) * 1000);
      const txnBlockTimeSeconds = txn.blockTime || Math.floor(Date.now() / 1000);
      
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
      const parsedFeeEvents = eventParserService.getFeeEvents(txn);
      
      // Process fee events
      for (const feeEvent of parsedFeeEvents) {
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
      
      // Debug: Log the structure to understand event location
      if (process.env.DEBUG_AMM === 'true') {
        this.logger.debug('Parsed transaction structure', {
          hasInstructions: !!parsedTxn.instructions,
          hasEvents: !!(parsedTxn.instructions?.events),
          eventCount: parsedTxn.instructions?.events?.length || 0,
          eventNames: parsedTxn.instructions?.events?.map((e: any) => e.name) || []
        });
      }
      
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
      
      // Try to get reserves from the parsed pump AMM events
      if (parsedTxn?.instructions?.events && parsedTxn.instructions.events.length > 0) {
        if (process.env.DEBUG_AMM === 'true') {
          this.logger.debug('Found events to process', {
            count: parsedTxn.instructions.events.length,
            names: parsedTxn.instructions.events.map((e: any) => e.name),
            signature: signature.slice(0, 8) + '...'
          });
        }
        
        for (const event of parsedTxn.instructions.events) {
          if (event.name === 'BuyEvent' || event.name === 'SellEvent') {
            // Extract reserves from the event data
            // For pump.fun AMM: base = token, quote = SOL
            try {
              // The event data contains the pool reserves after the trade
              const eventData = event.data;
              
              // Try different field names that might contain the reserves
              // Note: Shyft examples use snake_case field names
              const tokenReservesRaw = eventData?.pool_base_token_reserves || 
                                      eventData?.poolBaseTokenReserves || 
                                      eventData?.baseTokenReserves ||
                                      eventData?.token_reserves ||
                                      eventData?.tokenReserves;
                                      
              const solReservesRaw = eventData?.pool_quote_token_reserves || 
                                    eventData?.poolQuoteTokenReserves || 
                                    eventData?.quoteTokenReserves ||
                                    eventData?.sol_reserves ||
                                    eventData?.solReserves;
              
              if (tokenReservesRaw && solReservesRaw) {
                // Convert to BigInt - these are already in smallest units
                virtualTokenReserves = BigInt(tokenReservesRaw.toString());
                virtualSolReserves = BigInt(solReservesRaw.toString());
                eventFound = true;
                
                this.logger.info('✅ Extracted reserves from AMM event', {
                  eventName: event.name,
                  tokenReserves: virtualTokenReserves.toString(),
                  solReserves: virtualSolReserves.toString(),
                  tokenReservesFormatted: (Number(virtualTokenReserves) / Math.pow(10, TOKEN_DECIMALS)).toLocaleString(),
                  solReservesFormatted: (Number(virtualSolReserves) / LAMPORTS_PER_SOL).toFixed(9),
                  mint: swapEvent.mint.slice(0, 8) + '...'
                });
                
                // Update pool state service with new reserves
                if (virtualSolReserves > 0n && virtualTokenReserves > 0n) {
                  await this.poolStateService.updatePoolReserves(
                    swapEvent.mint,
                    Number(virtualSolReserves) / LAMPORTS_PER_SOL,
                    Number(virtualTokenReserves) / Math.pow(10, TOKEN_DECIMALS),
                    slot
                  );
                }
              } else {
                // Log the actual event structure to debug
                this.logger.warn('❌ No reserves found in event', {
                  eventName: event.name,
                  fields: Object.keys(eventData || {}),
                  tokenReservesRaw,
                  solReservesRaw,
                  eventData: JSON.stringify(eventData).slice(0, 200)
                });
              }
            } catch (error) {
              this.logger.warn('Failed to parse reserves from event', {
                eventName: event.name,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          
            
            break; // We found our event, no need to continue
          }
        }
      } else {
        if (process.env.DEBUG_AMM === 'true') {
          this.logger.warn('No events found in parsed transaction', {
            hasInstructions: !!parsedTxn?.instructions,
            hasEvents: !!parsedTxn?.instructions?.events,
            eventCount: parsedTxn?.instructions?.events?.length || 0,
            signature: signature.slice(0, 8) + '...'
          });
        }
      }
      if (swapEvent.type === 'Buy') {
        this.ammStats.buys++;
      } else {
        this.ammStats.sells++;
      }
      
      this.ammStats.uniqueTokens.add(swapEvent.mint);
      
      // Also check fees in the transaction
      const tradeFeeEvents = eventParserService.getFeeEvents(txn);
      for (const feeEvent of tradeFeeEvents) {
        this.ammStats.feesCollected++;
        const feeValueUsd = ('pcAmount' in feeEvent ? Number(feeEvent.pcAmount) : 0) / LAMPORTS_PER_SOL * this.currentSolPrice;
        this.ammStats.totalFeesUsd += feeValueUsd;
      }
      
      // If we didn't find reserves in events, try a simpler approach like Shyft example
      if (!eventFound && parsedTxn?.instructions?.events?.length > 0) {
        try {
          const firstEventData = parsedTxn.instructions.events[0]?.data;
          if (firstEventData?.pool_base_token_reserves && firstEventData?.pool_quote_token_reserves) {
            virtualTokenReserves = BigInt(firstEventData.pool_base_token_reserves.toString());
            virtualSolReserves = BigInt(firstEventData.pool_quote_token_reserves.toString());
            eventFound = true;
            
            this.logger.info('✅ Extracted reserves from first event (Shyft pattern)', {
              tokenReserves: virtualTokenReserves.toString(),
              solReserves: virtualSolReserves.toString(),
              mint: swapEvent.mint.slice(0, 8) + '...'
            });
          }
        } catch (error) {
          this.logger.debug('Failed to extract reserves using Shyft pattern', { error });
        }
      }
      
      // If we still didn't find reserves, try pool state service as fallback
      if (!eventFound || virtualSolReserves === 0n || virtualTokenReserves === 0n) {
        // Get pool reserves from pool state service
        let poolState = this.poolStateService.getPoolState(swapEvent.mint);
        
        // If we don't have pool state, try to get it by pool address
        if (!poolState && swapEvent.pool) {
          poolState = this.poolStateService.getPoolStateByAddress(swapEvent.pool);
        }
        
        if (poolState && poolState.reserves) {
          // Pool state stores reserves in SOL/token units, convert back to lamports/raw units
          virtualSolReserves = BigInt(Math.floor((poolState.reserves.virtualSolReserves || 0) * LAMPORTS_PER_SOL));
          virtualTokenReserves = BigInt(Math.floor((poolState.reserves.virtualTokenReserves || 0) * Math.pow(10, TOKEN_DECIMALS)));
          
          this.logger.debug('Using cached pool reserves (fallback)', {
            mint: swapEvent.mint.slice(0, 8) + '...',
            solReserves: virtualSolReserves.toString(),
            tokenReserves: virtualTokenReserves.toString(),
            solReservesSOL: (Number(virtualSolReserves) / LAMPORTS_PER_SOL).toFixed(9),
            tokenReservesFormatted: (Number(virtualTokenReserves) / Math.pow(10, TOKEN_DECIMALS)).toLocaleString()
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
      
      // Calculate price from trade amounts (more accurate for individual trades)
      const priceInSol = tokenAmount > 0 ? solAmount / tokenAmount : 0;
      let priceInfo = {
        priceInSol,
        priceInUsd: priceInSol * this.currentSolPrice,
        marketCapUsd: priceInSol * this.currentSolPrice * 1e9, // Assume 1B supply
        priceInLamports: priceInSol * Number(LAMPORTS_PER_SOL)
      };
      
      this.logger.debug('Calculated price from trade amounts', {
        mint: swapEvent.mint.slice(0, 8) + '...',
        solAmount,
        tokenAmount,
        priceInSol,
        priceInUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd
      });
      
      // Also log reserve-based price for comparison if reserves available
      if (virtualSolReserves > 0n && virtualTokenReserves > 0n) {
        const reservePriceInfo = this.priceCalculator.calculatePrice(
          {
            solReserves: virtualSolReserves,
            tokenReserves: virtualTokenReserves,
            isVirtual: false
          },
          this.currentSolPrice
        );
        
        this.logger.debug('Reserve-based price (for comparison)', {
          mint: swapEvent.mint.slice(0, 8) + '...',
          reservePriceUsd: reservePriceInfo.priceInUsd,
          tradePriceUsd: priceInfo.priceInUsd,
          priceDifference: Math.abs(reservePriceInfo.priceInUsd - priceInfo.priceInUsd) / priceInfo.priceInUsd * 100
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
        blockTime: txnBlockTimeSeconds, // Use actual block time from transaction
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
        poolAddress: undefined, // Pool address not available from parser
        // Add the calculated price and market cap
        priceUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd,
        volumeUsd: volumeUsd
      };
      
      // Process trade with enhanced handler (includes price impact calculations)
      await this.tradeHandler.processTrade(tradeEvent, this.currentSolPrice);
      
      // Update AMM stats
      this.ammStats.trades++;
      if (swapEvent.type === 'Buy') {
        this.ammStats.buys++;
      } else {
        this.ammStats.sells++;
      }
      this.ammStats.totalVolumeUsd += volumeUsd;
      this.ammStats.uniqueTokens.add(swapEvent.mint);
      
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