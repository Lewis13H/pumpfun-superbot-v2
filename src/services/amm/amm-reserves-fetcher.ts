/**
 * AMM Reserves Fetcher Service
 * Fetches AMM pool reserves when AMM trades are detected and updates token data
 */

import { EventBus } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import { ShyftGraphQLClient } from '../core/graphql-client';
import { UnifiedDbServiceV2 } from '../../database/unified-db-service';
import { PriceCalculator } from '../pricing/price-calculator';
import { SolPriceService } from '../pricing/sol-price-service';
import { AMMTradeEvent } from '../../utils/parsers/types';
import { 
  GET_AMM_POOLS_AND_ACCOUNTS,
  FIND_AMM_POOLS_BY_MINT 
} from '../../graphql/queries/amm-pool.queries';
import chalk from 'chalk';

interface PoolData {
  pubkey: string;
  base_mint: string;
  quote_mint: string;
  pool_base_token_account: string;
  pool_quote_token_account: string;
  lp_supply: string;
  _updatedAt: string;
}

interface AccountData {
  pubkey: string;
  amount: string;
  mint: string;
  owner: string;
}

interface ReservesResult {
  pools: PoolData[];
  reserves: AccountData[];
}

export class AmmReservesFetcher {
  private static instance: AmmReservesFetcher;
  private logger: Logger;
  private eventBus: EventBus;
  private graphqlClient: ShyftGraphQLClient;
  private dbService: UnifiedDbServiceV2;
  private priceCalculator: PriceCalculator;
  private solPriceService: SolPriceService;
  
  // Cache to prevent duplicate fetches
  private recentlyFetched: Map<string, number> = new Map();
  private readonly CACHE_DURATION = 60_000; // 1 minute
  
  // Save threshold
  private readonly AMM_SAVE_THRESHOLD = Number(process.env.AMM_SAVE_THRESHOLD) || 1000;

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'AmmReservesFetcher' });
    this.eventBus = eventBus;
    this.graphqlClient = ShyftGraphQLClient.getInstance();
    this.dbService = UnifiedDbServiceV2.getInstance();
    this.priceCalculator = new PriceCalculator();
    this.solPriceService = SolPriceService.getInstance();
    
    this.subscribeToEvents();
  }

  static getInstance(eventBus?: EventBus): AmmReservesFetcher {
    if (!this.instance) {
      if (!eventBus) {
        throw new Error('EventBus must be provided when creating AmmReservesFetcher instance');
      }
      this.instance = new AmmReservesFetcher(eventBus);
    }
    return this.instance;
  }

  /**
   * Subscribe to AMM_TRADE events
   */
  private subscribeToEvents(): void {
    this.eventBus.on('AMM_TRADE', async (event: AMMTradeEvent) => {
      await this.handleAmmTrade(event);
    });
    
    this.logger.info('AMM Reserves Fetcher initialized and listening for AMM trades');
  }

  /**
   * Handle AMM trade event
   */
  private async handleAmmTrade(event: AMMTradeEvent): Promise<void> {
    try {
      const mintAddress = event.mintAddress;
      
      // Check if we've recently fetched this token's reserves
      const lastFetched = this.recentlyFetched.get(mintAddress);
      if (lastFetched && Date.now() - lastFetched < this.CACHE_DURATION) {
        return; // Skip if recently fetched
      }
      
      // Check if token already has reserves
      const hasReserves = await this.checkTokenHasReserves(mintAddress);
      if (hasReserves) {
        return; // Skip if reserves already exist
      }
      
      this.logger.info(`Fetching AMM reserves for token: ${mintAddress}`);
      
      // Fetch pool data and reserves
      const poolData = await this.fetchPoolData(mintAddress);
      if (!poolData) {
        this.logger.warn(`No pool data found for token: ${mintAddress}`);
        return;
      }
      
      // Calculate price and market cap
      const priceInfo = await this.calculatePriceFromPoolData(poolData);
      if (!priceInfo) {
        this.logger.warn(`Could not calculate price for token: ${mintAddress}`);
        return;
      }
      
      // Update token if it meets threshold
      if (priceInfo.marketCapUsd >= this.AMM_SAVE_THRESHOLD) {
        await this.updateTokenWithReserves(mintAddress, poolData, priceInfo);
        
        // Update cache
        this.recentlyFetched.set(mintAddress, Date.now());
        
        this.logger.info(chalk.green(
          `✅ Updated token ${mintAddress} with AMM reserves. ` +
          `Market cap: $${priceInfo.marketCapUsd.toFixed(2)}`
        ));
      } else {
        this.logger.debug(
          `Token ${mintAddress} market cap ($${priceInfo.marketCapUsd.toFixed(2)}) ` +
          `below threshold ($${this.AMM_SAVE_THRESHOLD})`
        );
      }
      
    } catch (error) {
      this.logger.error(`Error handling AMM trade:`, error);
    }
  }

  /**
   * Check if token already has reserves in database
   */
  private async checkTokenHasReserves(mintAddress: string): Promise<boolean> {
    try {
      const token = await this.dbService.getTokenByMint(mintAddress);
      return token?.latest_virtual_sol_reserves !== null && 
             token?.latest_virtual_token_reserves !== null;
    } catch (error) {
      this.logger.error(`Error checking token reserves:`, error);
      return false;
    }
  }

  /**
   * Fetch pool data from GraphQL
   */
  private async fetchPoolData(mintAddress: string): Promise<{
    pool: PoolData;
    solReserves: bigint;
    tokenReserves: bigint;
  } | null> {
    try {
      // First, find the pool for this mint
      const poolsResult = await this.graphqlClient.query<{ pump_fun_amm_Pool: PoolData[] }>(
        FIND_AMM_POOLS_BY_MINT,
        { mints: [mintAddress] }
      );
      
      if (!poolsResult.pump_fun_amm_Pool || poolsResult.pump_fun_amm_Pool.length === 0) {
        return null;
      }
      
      const pool = poolsResult.pump_fun_amm_Pool[0];
      
      // Now fetch the reserves from token accounts
      const accountAddresses = [
        pool.pool_base_token_account,
        pool.pool_quote_token_account
      ];
      
      const reservesResult = await this.graphqlClient.query<ReservesResult>(
        GET_AMM_POOLS_AND_ACCOUNTS,
        {
          mints: [mintAddress],
          accounts: accountAddresses
        }
      );
      
      if (!reservesResult.reserves || reservesResult.reserves.length < 2) {
        this.logger.warn(`Incomplete reserve data for pool ${pool.pubkey}`);
        return null;
      }
      
      // Find the SOL and token reserves
      let solReserves: bigint = 0n;
      let tokenReserves: bigint = 0n;
      
      for (const account of reservesResult.reserves) {
        if (account.pubkey === pool.pool_quote_token_account) {
          // Quote is SOL in pump.fun AMM
          solReserves = BigInt(account.amount);
        } else if (account.pubkey === pool.pool_base_token_account) {
          // Base is the token
          tokenReserves = BigInt(account.amount);
        }
      }
      
      if (solReserves === 0n || tokenReserves === 0n) {
        this.logger.warn(`Invalid reserves for pool ${pool.pubkey}: SOL=${solReserves}, Token=${tokenReserves}`);
        return null;
      }
      
      return {
        pool,
        solReserves,
        tokenReserves
      };
      
    } catch (error) {
      this.logger.error(`Error fetching pool data:`, error);
      return null;
    }
  }

  /**
   * Calculate price from pool data
   */
  private async calculatePriceFromPoolData(poolData: {
    pool: PoolData;
    solReserves: bigint;
    tokenReserves: bigint;
  }): Promise<{
    priceInSol: number;
    priceInUsd: number;
    marketCapUsd: number;
  } | null> {
    try {
      const solPrice = await this.solPriceService.getPrice();
      
      const priceInfo = this.priceCalculator.calculatePrice(
        {
          solReserves: poolData.solReserves,
          tokenReserves: poolData.tokenReserves,
          isVirtual: true // AMM uses virtual reserves
        },
        solPrice,
        true // isAmmToken = true
      );
      
      return {
        priceInSol: priceInfo.priceInSol,
        priceInUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd
      };
      
    } catch (error) {
      this.logger.error(`Error calculating price:`, error);
      return null;
    }
  }

  /**
   * Update token with reserves and recalculated price
   */
  private async updateTokenWithReserves(
    mintAddress: string,
    poolData: {
      pool: PoolData;
      solReserves: bigint;
      tokenReserves: bigint;
    },
    priceInfo: {
      priceInSol: number;
      priceInUsd: number;
      marketCapUsd: number;
    }
  ): Promise<void> {
    try {
      await this.dbService.updateTokenReserves({
        mintAddress,
        virtualSolReserves: poolData.solReserves,
        virtualTokenReserves: poolData.tokenReserves,
        priceInSol: priceInfo.priceInSol,
        priceInUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd,
        poolAddress: poolData.pool.pubkey,
        lpMint: poolData.pool.lp_supply
      });
      
      // Emit event for other services
      this.eventBus.emit('AMM_RESERVES_FETCHED', {
        mintAddress,
        poolAddress: poolData.pool.pubkey,
        solReserves: poolData.solReserves,
        tokenReserves: poolData.tokenReserves,
        priceInUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd
      });
      
    } catch (error) {
      this.logger.error(`Error updating token with reserves:`, error);
    }
  }

  /**
   * Manually fetch reserves for a specific token
   */
  async fetchReservesForToken(mintAddress: string): Promise<{
    solReserves: string;
    tokenReserves: string;
    priceInUsd: number;
    marketCapUsd: number;
  } | null> {
    try {
      // Clear cache to force fetch
      this.recentlyFetched.delete(mintAddress);
      
      const poolData = await this.fetchPoolData(mintAddress);
      if (!poolData) {
        return null;
      }
      
      const priceInfo = await this.calculatePriceFromPoolData(poolData);
      if (!priceInfo) {
        return null;
      }
      
      await this.updateTokenWithReserves(mintAddress, poolData, priceInfo);
      
      return {
        solReserves: poolData.solReserves.toString(),
        tokenReserves: poolData.tokenReserves.toString(),
        priceInUsd: priceInfo.priceInUsd,
        marketCapUsd: priceInfo.marketCapUsd
      };
      
    } catch (error) {
      this.logger.error(`Error manually fetching reserves:`, error);
      return null;
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      cachedTokens: this.recentlyFetched.size,
      cacheEntries: Array.from(this.recentlyFetched.entries()).map(([mint, timestamp]) => ({
        mint,
        lastFetched: new Date(timestamp).toISOString()
      }))
    };
  }
}