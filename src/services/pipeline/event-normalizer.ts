/**
 * Event Normalizer - Converts raw events from various sources into normalized format
 */

import { NormalizedEvent } from './data-pipeline';
import { v4 as uuidv4 } from 'uuid';
import bs58 from 'bs58';

export class EventNormalizer {
  /**
   * Normalize an event based on its type
   */
  normalize(type: string, rawEvent: any): NormalizedEvent {
    switch (type) {
      case 'token_lifecycle':
        return this.normalizeTokenLifecycleEvent(rawEvent);
      case 'trade':
        return this.normalizeTradeEvent(rawEvent);
      case 'liquidity':
        return this.normalizeLiquidityEvent(rawEvent);
      case 'pool_state':
        return this.normalizePoolStateEvent(rawEvent);
      default:
        return this.normalizeUnknownEvent(type, rawEvent);
    }
  }

  /**
   * Normalize token lifecycle event
   */
  private normalizeTokenLifecycleEvent(event: any): NormalizedEvent {
    const eventType = event.type || 'TOKEN_LIFECYCLE_UNKNOWN';
    const isGraduation = eventType.includes('GRADUATED');
    const isCreation = eventType.includes('CREATED');
    
    return {
      id: event.id || uuidv4(),
      type: 'token_lifecycle',
      source: this.inferSource(event),
      timestamp: event.timestamp || new Date(),
      data: {
        mint: event.mint || event.token?.mint,
        symbol: event.symbol || event.token?.symbol,
        name: event.name || event.token?.name,
        phase: isCreation ? 'created' : isGraduation ? 'graduated' : 'trading',
        marketCap: event.marketCap || event.marketCapUSD,
        price: event.price || event.priceUSD,
        bondingProgress: event.bondingProgress || event.progress,
        creatorAddress: event.creator || event.creatorAddress,
        poolAddress: event.poolAddress,
        graduatedAt: isGraduation ? new Date() : undefined
      },
      metadata: {
        programId: event.programId || this.extractProgramId(event),
        signature: event.signature,
        slot: BigInt(event.slot || 0),
        monitorId: event.monitorId || 'TokenLifecycleMonitor',
        priority: isGraduation ? 'high' : 'medium'
      }
    };
  }

  /**
   * Normalize trade event
   */
  private normalizeTradeEvent(event: any): NormalizedEvent {
    const isMEV = event.type?.includes('MEV') || event.isMEV;
    const isHighSlippage = event.slippage > 5 || event.type?.includes('HIGH_SLIPPAGE');
    
    return {
      id: event.id || event.signature || uuidv4(),
      type: 'trade',
      source: this.inferSource(event),
      timestamp: event.timestamp || new Date(),
      data: {
        signature: event.signature,
        mint: event.mint || event.tokenMint,
        user: event.user || event.userAddress,
        type: event.tradeType || (event.isBuy ? 'buy' : 'sell'),
        solAmount: event.solAmount,
        tokenAmount: event.tokenAmount,
        price: event.price,
        priceImpact: event.priceImpact,
        slippage: event.slippage,
        isMEV: isMEV,
        mevType: event.mevType,
        venue: event.venue || this.inferVenue(event),
        poolAddress: event.poolAddress
      },
      metadata: {
        programId: event.programId || this.extractProgramId(event),
        signature: event.signature,
        slot: BigInt(event.slot || 0),
        monitorId: event.monitorId || 'TradingActivityMonitor',
        priority: isMEV || isHighSlippage ? 'high' : 'medium'
      }
    };
  }

  /**
   * Normalize liquidity event
   */
  private normalizeLiquidityEvent(event: any): NormalizedEvent {
    const eventType = event.type || 'LIQUIDITY_UNKNOWN';
    const isAdd = eventType.includes('ADD');
    const isRemove = eventType.includes('REMOVE');
    const isFee = eventType.includes('FEE');
    
    return {
      id: event.id || uuidv4(),
      type: 'liquidity',
      source: this.inferSource(event),
      timestamp: event.timestamp || new Date(),
      data: {
        type: isAdd ? 'add' : isRemove ? 'remove' : isFee ? 'fee' : 'unknown',
        poolAddress: event.poolAddress,
        userAddress: event.userAddress || event.user,
        tokenMint: event.tokenMint || event.mint,
        solAmount: event.solAmount,
        tokenAmount: event.tokenAmount,
        lpAmount: event.lpAmount || event.lpTokens,
        feeAmount: event.feeAmount,
        share: event.share || event.lpShare
      },
      metadata: {
        programId: event.programId || this.extractProgramId(event),
        signature: event.signature,
        slot: BigInt(event.slot || 0),
        monitorId: event.monitorId || 'LiquidityMonitor',
        priority: 'medium'
      }
    };
  }

  /**
   * Normalize pool state event
   */
  private normalizePoolStateEvent(event: any): NormalizedEvent {
    return {
      id: event.id || event.poolAddress || uuidv4(),
      type: 'pool_state',
      source: this.inferSource(event),
      timestamp: event.timestamp || new Date(),
      data: {
        poolAddress: event.poolAddress || event.pool,
        tokenMint: event.tokenMint || event.mint,
        solReserves: event.solReserves || event.reserves?.sol,
        tokenReserves: event.tokenReserves || event.reserves?.token,
        lpSupply: event.lpSupply || event.lpTokenSupply,
        tvlSOL: event.tvlSOL || event.tvl,
        tvlUSD: event.tvlUSD || (event.tvl * event.solPrice),
        volume24h: event.volume24h,
        fees24h: event.fees24h,
        liquidityProviders: event.liquidityProviders || event.lpHolders
      },
      metadata: {
        programId: event.programId || this.extractProgramId(event),
        signature: event.signature,
        slot: BigInt(event.slot || 0),
        monitorId: event.monitorId || 'LiquidityMonitor',
        priority: 'low'
      }
    };
  }

  /**
   * Normalize unknown event
   */
  private normalizeUnknownEvent(_type: string, event: any): NormalizedEvent {
    return {
      id: event.id || uuidv4(),
      type: 'unknown',
      source: this.inferSource(event),
      timestamp: event.timestamp || new Date(),
      data: event,
      metadata: {
        programId: event.programId || 'unknown',
        signature: event.signature,
        slot: BigInt(event.slot || 0),
        monitorId: event.monitorId || 'unknown',
        priority: 'low'
      }
    };
  }

  /**
   * Infer event source from data
   */
  private inferSource(event: any): 'bonding_curve' | 'amm_pool' | 'external_amm' {
    const programId = event.programId || this.extractProgramId(event);
    
    // Known program IDs
    const BC_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    const PUMP_SWAP_PROGRAM = '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu';
    const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    const RAYDIUM_PROGRAM = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
    
    if (programId === BC_PROGRAM) return 'bonding_curve';
    if (programId === PUMP_SWAP_PROGRAM || programId === PUMP_AMM_PROGRAM) return 'amm_pool';
    if (programId === RAYDIUM_PROGRAM || programId.includes('raydium')) return 'external_amm';
    
    // Infer from event data
    if (event.venue === 'bonding_curve' || event.source === 'BC') return 'bonding_curve';
    if (event.venue === 'pump_amm' || event.source === 'AMM') return 'amm_pool';
    if (event.venue === 'raydium' || event.source === 'RAYDIUM') return 'external_amm';
    
    return 'amm_pool'; // Default
  }

  /**
   * Extract program ID from event data
   */
  private extractProgramId(event: any): string {
    if (event.programId) return event.programId;
    
    // Try to extract from accounts or instructions
    if (event.accounts && Array.isArray(event.accounts)) {
      // Look for known program accounts
      const programs = ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
                       '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu',
                       'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
                       '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'];
      
      for (const account of event.accounts) {
        const accountStr = typeof account === 'string' ? account : bs58.encode(account);
        if (programs.includes(accountStr)) {
          return accountStr;
        }
      }
    }
    
    return 'unknown';
  }

  /**
   * Infer trading venue from event data
   */
  private inferVenue(event: any): string {
    const programId = this.extractProgramId(event);
    
    const BC_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    const PUMP_PROGRAMS = ['61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'];
    const RAYDIUM_PROGRAM = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
    
    if (programId === BC_PROGRAM) return 'bonding_curve';
    if (PUMP_PROGRAMS.includes(programId)) return 'pump_amm';
    if (programId === RAYDIUM_PROGRAM) return 'raydium';
    
    return 'unknown';
  }
}