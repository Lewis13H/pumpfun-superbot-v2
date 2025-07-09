/**
 * AMM Trade Enricher Service
 * Enriches AMM trades with pool reserve data from the AMM Pool State Service
 */

import { EventBus, EVENTS } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import { AmmPoolStateService } from './amm-pool-state-service';
import { TradeEvent, EventType } from '../../utils/parsers/types';

export class AmmTradeEnricher {
  private logger: Logger;
  private ammPoolStateService: AmmPoolStateService;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'AmmTradeEnricher' });
    this.eventBus = eventBus;
    this.ammPoolStateService = AmmPoolStateService.getInstance();
    
    this.subscribeToEvents();
  }

  /**
   * Subscribe to trade events
   */
  private subscribeToEvents(): void {
    // Listen for AMM trades before they're processed
    this.eventBus.on('PRE_PROCESS_TRADE', async (event: TradeEvent) => {
      if (event.type === EventType.AMM_TRADE) {
        await this.enrichTradeWithReserves(event);
      }
    });

    this.logger.info('AMM Trade Enricher initialized');
  }

  /**
   * Enrich AMM trade with pool reserves
   */
  private async enrichTradeWithReserves(event: TradeEvent): Promise<void> {
    try {
      // Skip if reserves already present
      if (event.virtualSolReserves && event.virtualTokenReserves) {
        return;
      }

      // Get pool state from the service
      const poolState = this.ammPoolStateService.getPoolStateByMint(event.mintAddress);
      
      if (poolState && poolState.reserves) {
        // Add reserves to the event
        event.virtualSolReserves = BigInt(poolState.reserves.virtualSolReserves);
        event.virtualTokenReserves = BigInt(poolState.reserves.virtualTokenReserves);
        
        this.logger.debug('Enriched AMM trade with pool reserves', {
          mintAddress: event.mintAddress,
          solReserves: poolState.reserves.virtualSolReserves,
          tokenReserves: poolState.reserves.virtualTokenReserves
        });
        
        // Emit event that reserves were added
        this.eventBus.emit('AMM_TRADE_ENRICHED', {
          mintAddress: event.mintAddress,
          signature: event.signature,
          hasReserves: true
        });
      } else {
        this.logger.debug('No pool state found for AMM trade', {
          mintAddress: event.mintAddress
        });
        
        // Emit event to fetch pool data
        this.eventBus.emit('FETCH_POOL_DATA_NEEDED', {
          mintAddress: event.mintAddress,
          signature: event.signature,
          priority: 'high'
        });
      }
    } catch (error) {
      this.logger.error('Failed to enrich AMM trade with reserves', error as Error, {
        mintAddress: event.mintAddress,
        signature: event.signature
      });
    }
  }

  /**
   * Get pool state by mint address (public method for external use)
   */
  public getPoolReserves(mintAddress: string): { solReserves: bigint; tokenReserves: bigint } | null {
    const poolState = this.ammPoolStateService.getPoolStateByMint(mintAddress);
    
    if (poolState && poolState.reserves) {
      return {
        solReserves: BigInt(poolState.reserves.virtualSolReserves),
        tokenReserves: BigInt(poolState.reserves.virtualTokenReserves)
      };
    }
    
    return null;
  }
}