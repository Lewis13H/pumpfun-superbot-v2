/**
 * Pool State Coordinator
 * Manages AMM pool state from account monitoring and provides enrichment for trades
 */

import { EventEmitter } from 'events';
import { Logger } from '../../core/logger';
import { EventBus, EVENTS } from '../../core/event-bus';

export interface PoolState {
  poolAddress: string;
  tokenMint: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  isInitialized: boolean;
  lastUpdate: number;
  slotNumber: number;
}

export interface PoolStateUpdate {
  poolAddress: string;
  tokenMint: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  timestamp: number;
}

export class PoolStateCoordinator extends EventEmitter {
  private static instance: PoolStateCoordinator;
  private poolStates = new Map<string, PoolState>();
  private poolByMint = new Map<string, string>(); // mint -> pool mapping
  private mintByPool = new Map<string, string>(); // pool -> mint mapping
  private logger = new Logger({ context: 'PoolStateCoordinator' });
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    super();
    this.eventBus = eventBus;
    
    // Listen for pool state updates
    this.eventBus.on(EVENTS.POOL_STATE_UPDATED, (data) => {
      if (data.poolState) {
        this.updatePoolState(data.poolAddress, data.poolState);
      }
    });
    
    // Listen for liquidity add events (pool creation)
    this.eventBus.on(EVENTS.LIQUIDITY_ADDED, (data) => {
      if (data.liquidityEvent?.eventType === 'add' && data.liquidityEvent.isInitialLiquidity) {
        this.registerNewPool(data.liquidityEvent.poolAddress, data.liquidityEvent.mintAddress);
      }
    });
  }

  static getInstance(eventBus?: EventBus): PoolStateCoordinator {
    if (!PoolStateCoordinator.instance) {
      if (!eventBus) {
        throw new Error('EventBus required for first initialization');
      }
      PoolStateCoordinator.instance = new PoolStateCoordinator(eventBus);
    }
    return PoolStateCoordinator.instance;
  }

  /**
   * Update pool state from account monitoring
   */
  updatePoolState(poolAddress: string, state: Partial<PoolState>): void {
    const existing = this.poolStates.get(poolAddress) || {} as PoolState;
    
    const updatedState: PoolState = {
      poolAddress,
      tokenMint: state.tokenMint || existing.tokenMint || '',
      virtualSolReserves: state.virtualSolReserves || existing.virtualSolReserves || 0n,
      virtualTokenReserves: state.virtualTokenReserves || existing.virtualTokenReserves || 0n,
      realSolReserves: state.realSolReserves || existing.realSolReserves || 0n,
      realTokenReserves: state.realTokenReserves || existing.realTokenReserves || 0n,
      isInitialized: state.isInitialized !== undefined ? state.isInitialized : existing.isInitialized,
      lastUpdate: Date.now(),
      slotNumber: state.slotNumber || existing.slotNumber || 0
    };
    
    this.poolStates.set(poolAddress, updatedState);
    
    // Update mappings
    if (updatedState.tokenMint) {
      this.poolByMint.set(updatedState.tokenMint, poolAddress);
      this.mintByPool.set(poolAddress, updatedState.tokenMint);
    }
    
    // Emit update event
    this.emit('poolStateUpdated', updatedState);
    
    // Also emit on event bus for other services
    this.eventBus.emit('POOL_STATE_UPDATED', {
      poolAddress,
      tokenMint: updatedState.tokenMint,
      virtualSolReserves: updatedState.virtualSolReserves,
      virtualTokenReserves: updatedState.virtualTokenReserves,
      realSolReserves: updatedState.realSolReserves,
      realTokenReserves: updatedState.realTokenReserves
    } as PoolStateUpdate);
    
    this.logger.debug('Pool state updated', {
      poolAddress,
      mint: updatedState.tokenMint?.substring(0, 8),
      vSol: (Number(updatedState.virtualSolReserves) / 1e9).toFixed(2),
      vToken: updatedState.virtualTokenReserves.toString()
    });
  }

  /**
   * Register a new pool
   */
  registerNewPool(poolAddress: string, mintAddress: string): void {
    this.poolByMint.set(mintAddress, poolAddress);
    this.mintByPool.set(poolAddress, mintAddress);
    
    // Initialize with empty state
    if (!this.poolStates.has(poolAddress)) {
      this.updatePoolState(poolAddress, {
        tokenMint: mintAddress,
        isInitialized: true
      });
    }
    
    this.logger.info('New pool registered', {
      poolAddress,
      mintAddress: mintAddress.substring(0, 8) + '...'
    });
  }

  /**
   * Get pool state for a specific mint
   */
  getPoolStateForMint(mintAddress: string): PoolState | null {
    const poolAddress = this.poolByMint.get(mintAddress);
    if (!poolAddress) return null;
    
    return this.poolStates.get(poolAddress) || null;
  }

  /**
   * Get pool state by pool address
   */
  getPoolState(poolAddress: string): PoolState | null {
    return this.poolStates.get(poolAddress) || null;
  }

  /**
   * Get pool address for a mint
   */
  getPoolAddressForMint(mintAddress: string): string | null {
    return this.poolByMint.get(mintAddress) || null;
  }

  /**
   * Get mint address for a pool
   */
  getMintAddressForPool(poolAddress: string): string | null {
    return this.mintByPool.get(poolAddress) || null;
  }

  /**
   * Enrich AMM trade with latest pool state
   */
  enrichTradeWithPoolState(trade: any): void {
    const poolState = this.getPoolStateForMint(trade.mintAddress);
    
    if (poolState) {
      // Only update if we have more recent data
      const needsUpdate = !trade.virtualSolReserves || 
                         !trade.virtualTokenReserves ||
                         trade.virtualSolReserves === 0n ||
                         trade.virtualTokenReserves === 0n;
      
      if (needsUpdate) {
        trade.virtualSolReserves = poolState.virtualSolReserves;
        trade.virtualTokenReserves = poolState.virtualTokenReserves;
        trade.realSolReserves = poolState.realSolReserves;
        trade.realTokenReserves = poolState.realTokenReserves;
        trade.enrichmentSource = 'pool_state_coordinator';
        
        this.logger.debug('Trade enriched with pool state', {
          signature: trade.signature?.substring(0, 8),
          mint: trade.mintAddress?.substring(0, 8),
          vSol: (Number(poolState.virtualSolReserves) / 1e9).toFixed(2)
        });
      }
    }
  }

  /**
   * Get all tracked pools
   */
  getAllPools(): Map<string, PoolState> {
    return new Map(this.poolStates);
  }

  /**
   * Get pool count
   */
  getPoolCount(): number {
    return this.poolStates.size;
  }

  /**
   * Get pools with recent updates
   */
  getRecentlyUpdatedPools(withinMs: number = 60000): PoolState[] {
    const cutoff = Date.now() - withinMs;
    return Array.from(this.poolStates.values())
      .filter(pool => pool.lastUpdate > cutoff)
      .sort((a, b) => b.lastUpdate - a.lastUpdate);
  }

  /**
   * Clear old pool states (cleanup)
   */
  clearOldPoolStates(olderThanMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let cleared = 0;
    
    for (const [poolAddress, state] of this.poolStates) {
      if (state.lastUpdate < cutoff) {
        this.poolStates.delete(poolAddress);
        if (state.tokenMint) {
          this.poolByMint.delete(state.tokenMint);
        }
        this.mintByPool.delete(poolAddress);
        cleared++;
      }
    }
    
    if (cleared > 0) {
      this.logger.info(`Cleared ${cleared} old pool states`);
    }
    
    return cleared;
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    const pools = Array.from(this.poolStates.values());
    const withReserves = pools.filter(p => p.virtualSolReserves > 0n);
    const recentlyUpdated = this.getRecentlyUpdatedPools(5 * 60 * 1000); // 5 min
    
    return {
      totalPools: pools.length,
      poolsWithReserves: withReserves.length,
      recentlyUpdated: recentlyUpdated.length,
      mintMappings: this.poolByMint.size,
      oldestUpdate: pools.length > 0 
        ? Math.min(...pools.map(p => p.lastUpdate))
        : null,
      newestUpdate: pools.length > 0
        ? Math.max(...pools.map(p => p.lastUpdate))
        : null
    };
  }
}