/**
 * AMM Trade Enricher Service
 * Enriches AMM trades with pool reserve data from the AMM Pool State Service
 */

import { EventBus, EVENTS } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import { AmmPoolStateService } from './amm-pool-state-service';
import { PoolStateCoordinator } from './pool-state-coordinator';
import { TradeEvent, EventType, TradeType } from '../../utils/parsers/types';
import { VirtualReserveCalculator } from './virtual-reserve-calculator';
import { SolPriceService } from '../pricing/sol-price-service';

export class AmmTradeEnricher {
  private logger: Logger;
  private ammPoolStateService: AmmPoolStateService;
  private poolStateCoordinator: PoolStateCoordinator;
  private eventBus: EventBus;
  private virtualReserveCalculator: VirtualReserveCalculator;
  private solPriceService: SolPriceService;

  constructor(eventBus: EventBus, poolStateCoordinator?: PoolStateCoordinator) {
    this.logger = new Logger({ context: 'AmmTradeEnricher' });
    this.eventBus = eventBus;
    this.ammPoolStateService = AmmPoolStateService.getInstance();
    this.poolStateCoordinator = poolStateCoordinator || PoolStateCoordinator.getInstance(eventBus);
    this.virtualReserveCalculator = new VirtualReserveCalculator();
    this.solPriceService = SolPriceService.getInstance();
    
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
      // Skip if reserves already present and valid
      if (event.virtualSolReserves && event.virtualTokenReserves) {
        const reserves = {
          solReserves: event.virtualSolReserves,
          tokenReserves: event.virtualTokenReserves
        };
        if (this.virtualReserveCalculator.validateReserves(reserves)) {
          return;
        }
      }
      
      // First, try to get pool state from coordinator
      const poolState = this.poolStateCoordinator.getPoolStateForMint(event.mintAddress);
      if (poolState && poolState.virtualSolReserves > 0n && poolState.virtualTokenReserves > 0n) {
        event.virtualSolReserves = poolState.virtualSolReserves;
        event.virtualTokenReserves = poolState.virtualTokenReserves;
        
        this.logger.info('Enriched AMM trade from pool state coordinator', {
          mintAddress: event.mintAddress,
          solReserves: (Number(poolState.virtualSolReserves) / 1e9).toFixed(2),
          tokenReserves: poolState.virtualTokenReserves.toString(),
          source: 'pool_state_coordinator'
        });
        
        // Also emit enrichment event
        this.eventBus.emit('AMM_TRADE_ENRICHED', {
          mintAddress: event.mintAddress,
          signature: event.signature,
          hasReserves: true,
          source: 'pool_state_coordinator'
        });
        
        return;
      }

      // Update virtual reserves based on the trade
      const isBuy = event.tradeType === TradeType.BUY || event.tradeType === 'buy';
      const solAmount = event.solAmount || 0n;
      const tokenAmount = event.tokenAmount || 0n;
      
      if (solAmount > 0n && tokenAmount > 0n) {
        // Calculate virtual reserves
        const reserves = this.virtualReserveCalculator.updateReserves(
          event.mintAddress,
          solAmount,
          tokenAmount,
          isBuy
        );
        
        // Add reserves to the event
        event.virtualSolReserves = reserves.solReserves;
        event.virtualTokenReserves = reserves.tokenReserves;
        
        // Calculate market cap
        const solPrice = await this.solPriceService.getPrice();
        const marketCap = this.virtualReserveCalculator.calculateMarketCap(reserves, solPrice);
        
        // Add market cap to event (if supported)
        if ('marketCapUsd' in event) {
          (event as any).marketCapUsd = marketCap;
        }
        
        this.logger.info('Enriched AMM trade with virtual reserves', {
          mintAddress: event.mintAddress,
          solReserves: (Number(reserves.solReserves) / 1e9).toFixed(2),
          tokenReserves: (Number(reserves.tokenReserves) / 1e6).toLocaleString(),
          marketCap: marketCap.toFixed(2)
        });
        
        // Update pool state service
        await this.ammPoolStateService.updatePoolReserves(
          event.mintAddress,
          Number(reserves.solReserves) / 1e9,
          Number(reserves.tokenReserves),
          Number(event.slot)
        );
        
        this.eventBus.emit('AMM_TRADE_ENRICHED', {
          mintAddress: event.mintAddress,
          signature: event.signature,
          hasReserves: true,
          source: 'virtual_calculator',
          marketCap
        });
        return;
      }

      // If we can't calculate virtual reserves, try other methods
      this.logger.debug('Cannot calculate virtual reserves - missing trade amounts', {
        mintAddress: event.mintAddress,
        solAmount: solAmount.toString(),
        tokenAmount: tokenAmount.toString()
      });
      
      // Emit event to fetch pool data
      this.eventBus.emit('FETCH_POOL_DATA_NEEDED', {
        mintAddress: event.mintAddress,
        signature: event.signature,
        priority: 'high'
      });
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