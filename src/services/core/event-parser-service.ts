/**
 * Event Parser Service
 * Extracts and parses Anchor events from transaction logs
 */

import { SolanaEventParser } from '../../utils/parsers/event-parser';
import { Logger } from '../../core/logger';
import { VersionedTransactionResponse } from '@solana/web3.js';
import pumpFunIdl from '../../idls/pump_0.1.0.json';
import pumpAmmIdl from '../../idls/pump_amm_0.1.0.json';
import { PUMP_PROGRAM, PUMP_AMM_PROGRAM } from '../../utils/config/constants';

export interface ParsedEvent {
  name: string;
  data: any;
  programId: string;
}

export interface TradeEvent {
  mint: string;
  user: string;
  solAmount: string;
  tokenAmount: string;
  virtualSolReserves: string;
  virtualTokenReserves: string;
  isBuy: boolean;
  bondingCurveKey?: string;
}

export interface GraduationEvent {
  mint: string;
  bondingCurve: string;
  timestamp: number;
}

export interface PoolCreatedEvent {
  mint: string;
  pool: string;
  creator: string;
  baseReserves: string;
  quoteReserves: string;
}

// AMM-specific event types
export interface AmmDepositEvent {
  timestamp: number;
  pool: string;
  user: string;
  lpTokenAmountOut: string;
  baseAmountIn: string;
  quoteAmountIn: string;
  poolBaseReserves: string;
  poolQuoteReserves: string;
  lpMintSupply: string;
  userBaseTokenAccount: string;
  userQuoteTokenAccount: string;
  userPoolTokenAccount: string;
}

export interface AmmWithdrawEvent {
  timestamp: number;
  pool: string;
  user: string;
  lpTokenAmountIn: string;
  baseAmountOut: string;
  quoteAmountOut: string;
  poolBaseReserves: string;
  poolQuoteReserves: string;
  lpMintSupply: string;
  userBaseTokenAccount: string;
  userQuoteTokenAccount: string;
  userPoolTokenAccount: string;
}

export interface AmmBuyEvent {
  timestamp: number;
  pool: string;
  user: string;
  baseAmountOut: string;
  quoteAmountIn: string;
  poolBaseReserves: string;
  poolQuoteReserves: string;
  lpFee: string;
  protocolFee: string;
  userQuoteAmountIn: string;
}

export interface AmmSellEvent {
  timestamp: number;
  pool: string;
  user: string;
  baseAmountIn: string;
  quoteAmountOut: string;
  poolBaseReserves: string;
  poolQuoteReserves: string;
  lpFee: string;
  protocolFee: string;
  userBaseAmountIn: string;
}

// Fee event types
export interface CollectCoinCreatorFeeEvent {
  timestamp: number;
  pool: string;
  recipient: string;
  coinAmount: string;
  pcAmount: string;
  coinMint: string;
  pcMint: string;
}

export interface CollectProtocolFeeEvent {
  timestamp: number;
  pool: string;
  poolAddress: string;
  protocolCoinFee: string;
  protocolPcFee: string;
  coinMint: string;
  pcMint: string;
}

export interface FeeCollectedEvent {
  timestamp: number;
  pool: string;
  feeType: 'lp' | 'protocol' | 'creator';
  coinAmount: string;
  pcAmount: string;
  totalValueUsd?: number;
}

export class EventParserService {
  private static instance: EventParserService;
  private logger: Logger;
  private bcEventParser: SolanaEventParser;
  private ammEventParser: SolanaEventParser;
  private parsers: Map<string, SolanaEventParser>;

  private constructor() {
    this.logger = new Logger({ context: 'EventParserService' });
    this.parsers = new Map();
    
    // Create silent console for parsers
    const silentConsole = {
      ...console,
      warn: () => {},
      error: () => {},
    };
    
    // Initialize BC event parser
    this.bcEventParser = new SolanaEventParser([], silentConsole);
    this.bcEventParser.addParserFromIdl(PUMP_PROGRAM, pumpFunIdl as any);
    this.parsers.set(PUMP_PROGRAM, this.bcEventParser);
    
    // Initialize AMM event parser
    this.ammEventParser = new SolanaEventParser([], silentConsole);
    this.ammEventParser.addParserFromIdl(PUMP_AMM_PROGRAM, pumpAmmIdl as any);
    this.parsers.set(PUMP_AMM_PROGRAM, this.ammEventParser);
    
    this.logger.info('Event parsers initialized');
  }

  static getInstance(): EventParserService {
    if (!EventParserService.instance) {
      EventParserService.instance = new EventParserService();
    }
    return EventParserService.instance;
  }

  /**
   * Parse events from a transaction
   */
  parseTransaction(tx: VersionedTransactionResponse): ParsedEvent[] {
    const allEvents: ParsedEvent[] = [];
    
    if (!tx.meta || tx.meta.err) {
      return allEvents;
    }
    
    try {
      // Try parsing with each event parser
      for (const [programId, parser] of this.parsers) {
        try {
          const events = parser.parseEvent(tx);
          
          if (events && events.length > 0) {
            // Add program ID to each event
            const programEvents = events.map(event => ({
              ...event,
              programId
            }));
            allEvents.push(...programEvents);
          }
        } catch (err) {
          // Parser didn't match, continue
        }
      }
      
      return allEvents;
    } catch (error) {
      this.logger.debug('Failed to parse events', { error });
      return [];
    }
  }

  /**
   * Extract trade event from parsed events
   */
  extractTradeEvent(events: ParsedEvent[]): TradeEvent | null {
    for (const event of events) {
      // Pump.fun trade events
      if (event.name === 'TradeEvent' || event.name === 'SwapEvent') {
        const data = event.data;
        return {
          mint: data.mint,
          user: data.user,
          solAmount: data.solAmount || data.sol_amount,
          tokenAmount: data.tokenAmount || data.token_amount,
          virtualSolReserves: data.virtualSolReserves || data.virtual_sol_reserves,
          virtualTokenReserves: data.virtualTokenReserves || data.virtual_token_reserves,
          isBuy: data.isBuy !== undefined ? data.isBuy : data.is_buy,
          bondingCurveKey: data.bondingCurve || data.bonding_curve
        };
      }
      
      // AMM swap events
      if (event.name === 'SwapExecuted') {
        const data = event.data;
        return {
          mint: data.mint,
          user: data.user,
          solAmount: data.amountIn || data.amount_in,
          tokenAmount: data.amountOut || data.amount_out,
          virtualSolReserves: data.poolSolReserves || data.pool_sol_reserves,
          virtualTokenReserves: data.poolTokenReserves || data.pool_token_reserves,
          isBuy: data.swapType === 'buy' || data.swap_type === 'buy'
        };
      }
    }
    
    return null;
  }

  /**
   * Extract graduation event
   */
  extractGraduationEvent(events: ParsedEvent[]): GraduationEvent | null {
    for (const event of events) {
      if (event.name === 'GraduationEvent' || event.name === 'MigrationEvent') {
        const data = event.data;
        return {
          mint: data.mint,
          bondingCurve: data.bondingCurve || data.bonding_curve,
          timestamp: data.timestamp || Date.now()
        };
      }
    }
    return null;
  }

  /**
   * Extract pool creation event
   */
  extractPoolCreatedEvent(events: ParsedEvent[]): PoolCreatedEvent | null {
    for (const event of events) {
      if (event.name === 'PoolCreated' || event.name === 'CreatePool') {
        const data = event.data;
        return {
          mint: data.mint,
          pool: data.pool || data.poolAddress,
          creator: data.creator,
          baseReserves: data.baseReserves || data.base_reserves,
          quoteReserves: data.quoteReserves || data.quote_reserves
        };
      }
    }
    return null;
  }

  /**
   * Parse logs for events (fallback method)
   */
  parseLogsForEvents(logs: string[]): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    
    // Look for event signatures in logs
    for (const log of logs) {
      // Trade event pattern
      if (log.includes('Program data:') && log.includes('TradeEvent')) {
        // Extract base64 data and decode
        const match = log.match(/Program data: (.+)/);
        if (match) {
          try {
            // This would need proper decoding based on IDL
            this.logger.debug('Found trade event in logs');
          } catch (err) {
            // Continue
          }
        }
      }
    }
    
    return events;
  }

  /**
   * Check if transaction contains specific event type
   */
  hasEventType(tx: VersionedTransactionResponse, eventName: string): boolean {
    const events = this.parseTransaction(tx);
    return events.some(event => event.name === eventName);
  }

  /**
   * Get all trade events from transaction
   */
  getTradeEvents(tx: VersionedTransactionResponse): TradeEvent[] {
    const events = this.parseTransaction(tx);
    const tradeEvents: TradeEvent[] = [];
    
    for (const event of events) {
      const trade = this.extractTradeEvent([event]);
      if (trade) {
        tradeEvents.push(trade);
      }
    }
    
    return tradeEvents;
  }

  /**
   * Extract AMM deposit event
   */
  extractDepositEvent(events: ParsedEvent[]): AmmDepositEvent | null {
    for (const event of events) {
      if (event.name === 'DepositEvent') {
        const data = event.data;
        return {
          timestamp: Number(data.timestamp || Date.now()),
          pool: data.pool,
          user: data.user,
          lpTokenAmountOut: data.lp_token_amount_out || data.lpTokenAmountOut,
          baseAmountIn: data.base_amount_in || data.baseAmountIn,
          quoteAmountIn: data.quote_amount_in || data.quoteAmountIn,
          poolBaseReserves: data.pool_base_token_reserves || data.poolBaseTokenReserves,
          poolQuoteReserves: data.pool_quote_token_reserves || data.poolQuoteTokenReserves,
          lpMintSupply: data.lp_mint_supply || data.lpMintSupply,
          userBaseTokenAccount: data.user_base_token_account || data.userBaseTokenAccount,
          userQuoteTokenAccount: data.user_quote_token_account || data.userQuoteTokenAccount,
          userPoolTokenAccount: data.user_pool_token_account || data.userPoolTokenAccount
        };
      }
    }
    return null;
  }

  /**
   * Extract AMM withdraw event
   */
  extractWithdrawEvent(events: ParsedEvent[]): AmmWithdrawEvent | null {
    for (const event of events) {
      if (event.name === 'WithdrawEvent') {
        const data = event.data;
        return {
          timestamp: Number(data.timestamp || Date.now()),
          pool: data.pool,
          user: data.user,
          lpTokenAmountIn: data.lp_token_amount_in || data.lpTokenAmountIn,
          baseAmountOut: data.base_amount_out || data.baseAmountOut,
          quoteAmountOut: data.quote_amount_out || data.quoteAmountOut,
          poolBaseReserves: data.pool_base_token_reserves || data.poolBaseTokenReserves,
          poolQuoteReserves: data.pool_quote_token_reserves || data.poolQuoteTokenReserves,
          lpMintSupply: data.lp_mint_supply || data.lpMintSupply,
          userBaseTokenAccount: data.user_base_token_account || data.userBaseTokenAccount,
          userQuoteTokenAccount: data.user_quote_token_account || data.userQuoteTokenAccount,
          userPoolTokenAccount: data.user_pool_token_account || data.userPoolTokenAccount
        };
      }
    }
    return null;
  }

  /**
   * Extract AMM buy event
   */
  extractBuyEvent(events: ParsedEvent[]): AmmBuyEvent | null {
    for (const event of events) {
      if (event.name === 'BuyEvent') {
        const data = event.data;
        return {
          timestamp: Number(data.timestamp || Date.now()),
          pool: data.pool,
          user: data.user,
          baseAmountOut: data.base_amount_out || data.baseAmountOut,
          quoteAmountIn: data.quote_amount_in || data.quoteAmountIn,
          poolBaseReserves: data.pool_base_token_reserves || data.poolBaseTokenReserves,
          poolQuoteReserves: data.pool_quote_token_reserves || data.poolQuoteTokenReserves,
          lpFee: data.lp_fee || data.lpFee || '0',
          protocolFee: data.protocol_fee || data.protocolFee || '0',
          userQuoteAmountIn: data.user_quote_amount_in || data.userQuoteAmountIn
        };
      }
    }
    return null;
  }

  /**
   * Extract AMM sell event
   */
  extractSellEvent(events: ParsedEvent[]): AmmSellEvent | null {
    for (const event of events) {
      if (event.name === 'SellEvent') {
        const data = event.data;
        return {
          timestamp: Number(data.timestamp || Date.now()),
          pool: data.pool,
          user: data.user,
          baseAmountIn: data.base_amount_in || data.baseAmountIn,
          quoteAmountOut: data.quote_amount_out || data.quoteAmountOut,
          poolBaseReserves: data.pool_base_token_reserves || data.poolBaseTokenReserves,
          poolQuoteReserves: data.pool_quote_token_reserves || data.poolQuoteTokenReserves,
          lpFee: data.lp_fee || data.lpFee || '0',
          protocolFee: data.protocol_fee || data.protocolFee || '0',
          userBaseAmountIn: data.user_base_amount_in || data.userBaseAmountIn
        };
      }
    }
    return null;
  }

  /**
   * Get all liquidity events from transaction
   */
  getLiquidityEvents(tx: VersionedTransactionResponse): (AmmDepositEvent | AmmWithdrawEvent)[] {
    const events = this.parseTransaction(tx);
    const liquidityEvents: (AmmDepositEvent | AmmWithdrawEvent)[] = [];
    
    for (const event of events) {
      const deposit = this.extractDepositEvent([event]);
      if (deposit) {
        liquidityEvents.push(deposit);
        continue;
      }
      
      const withdraw = this.extractWithdrawEvent([event]);
      if (withdraw) {
        liquidityEvents.push(withdraw);
      }
    }
    
    return liquidityEvents;
  }

  /**
   * Extract coin creator fee event
   */
  extractCoinCreatorFeeEvent(events: ParsedEvent[]): CollectCoinCreatorFeeEvent | null {
    for (const event of events) {
      if (event.name === 'CollectCoinCreatorFeeEvent' || event.name === 'CreatorFeeCollected') {
        const data = event.data;
        return {
          timestamp: Number(data.timestamp || Date.now()),
          pool: data.pool,
          recipient: data.recipient || data.creator,
          coinAmount: data.coin_amount || data.coinAmount || '0',
          pcAmount: data.pc_amount || data.pcAmount || '0',
          coinMint: data.coin_mint || data.coinMint,
          pcMint: data.pc_mint || data.pcMint
        };
      }
    }
    return null;
  }

  /**
   * Extract protocol fee event
   */
  extractProtocolFeeEvent(events: ParsedEvent[]): CollectProtocolFeeEvent | null {
    for (const event of events) {
      if (event.name === 'CollectProtocolFeeEvent' || event.name === 'ProtocolFeeCollected') {
        const data = event.data;
        return {
          timestamp: Number(data.timestamp || Date.now()),
          pool: data.pool,
          poolAddress: data.pool_address || data.poolAddress || data.pool,
          protocolCoinFee: data.protocol_coin_fee || data.protocolCoinFee || '0',
          protocolPcFee: data.protocol_pc_fee || data.protocolPcFee || '0',
          coinMint: data.coin_mint || data.coinMint,
          pcMint: data.pc_mint || data.pcMint
        };
      }
    }
    return null;
  }

  /**
   * Get all fee events from transaction
   */
  getFeeEvents(tx: VersionedTransactionResponse): (CollectCoinCreatorFeeEvent | CollectProtocolFeeEvent)[] {
    const events = this.parseTransaction(tx);
    const feeEvents: (CollectCoinCreatorFeeEvent | CollectProtocolFeeEvent)[] = [];
    
    for (const event of events) {
      const creatorFee = this.extractCoinCreatorFeeEvent([event]);
      if (creatorFee) {
        feeEvents.push(creatorFee);
        continue;
      }
      
      const protocolFee = this.extractProtocolFeeEvent([event]);
      if (protocolFee) {
        feeEvents.push(protocolFee);
      }
    }
    
    return feeEvents;
  }

  /**
   * Extract fees from buy/sell events
   */
  extractFeesFromTrade(event: AmmBuyEvent | AmmSellEvent): FeeCollectedEvent | null {
    const lpFee = BigInt(event.lpFee || '0');
    const protocolFee = BigInt(event.protocolFee || '0');
    
    if (lpFee > 0n || protocolFee > 0n) {
      return {
        timestamp: event.timestamp,
        pool: event.pool,
        feeType: lpFee > protocolFee ? 'lp' : 'protocol',
        coinAmount: '0', // Will be calculated based on trade type
        pcAmount: (lpFee + protocolFee).toString(),
        totalValueUsd: undefined // Will be calculated by handler
      };
    }
    
    return null;
  }
}

// Export singleton instance
export const eventParserService = EventParserService.getInstance();