/**
 * Unified GraphQL Price Recovery Service
 * Handles both bonding curve and AMM pool price recovery for all tokens
 */

import { ShyftGraphQLClient } from '../core/graphql-client';
import { SolPriceService } from '../pricing/sol-price-service';
import { db } from '../../database';
import {
  BondingCurveData,
  GetBondingCurvesResponse,
  PriceUpdate,
  BulkPriceRecoveryResult,
  FailedUpdate,
  AmmPoolData,
  GetAmmPoolsResponse,
  GetTokenAccountsResponse,
  AmmPriceUpdate,
} from '../../types/graphql.types';
import {
  GET_BONDING_CURVES,
} from '../../graphql/queries/bonding-curve.queries';
import {
  GET_AMM_POOLS,
  GET_AMM_POOL_RESERVES,
} from '../../graphql/queries/amm-pool.queries';
import { PriceCalculator } from '../pricing/price-calculator';
import { EnhancedAmmPriceCalculator } from '../pricing/enhanced-amm-price-calculator';
import { GRAPHQL_CONFIG } from '../../config/graphql.config';
import { deriveBondingCurveAddresses } from '../../utils/config/pump-addresses';
import chalk from 'chalk';

interface TokenInfo {
  mintAddress: string;
  graduated: boolean;
}

export class UnifiedGraphQLPriceRecovery {
  private static instance: UnifiedGraphQLPriceRecovery;
  private client: ShyftGraphQLClient;
  private solPriceService: SolPriceService;
  private priceCalculator: PriceCalculator;
  private ammPriceCalculator: EnhancedAmmPriceCalculator;
  private cache: Map<string, { data: PriceUpdate; timestamp: number }> = new Map();

  private constructor() {
    this.client = ShyftGraphQLClient.getInstance();
    this.solPriceService = SolPriceService.getInstance();
    this.priceCalculator = new PriceCalculator();
    this.ammPriceCalculator = EnhancedAmmPriceCalculator.getInstance();
  }

  static getInstance(): UnifiedGraphQLPriceRecovery {
    if (!UnifiedGraphQLPriceRecovery.instance) {
      UnifiedGraphQLPriceRecovery.instance = new UnifiedGraphQLPriceRecovery();
    }
    return UnifiedGraphQLPriceRecovery.instance;
  }

  /**
   * Recover prices for multiple tokens (both BC and AMM)
   */
  async recoverPrices(tokenMints: string[]): Promise<BulkPriceRecoveryResult> {
    const startTime = Date.now();
    const successful: PriceUpdate[] = [];
    const failed: FailedUpdate[] = [];
    let graphqlQueries = 0;

    console.log(chalk.blue(`📊 Recovering prices for ${tokenMints.length} tokens...`));

    // Remove duplicates
    const uniqueMints = [...new Set(tokenMints)];

    // Check cache first
    const uncachedMints: string[] = [];
    for (const mint of uniqueMints) {
      const cached = this.getCachedPrice(mint);
      if (cached) {
        successful.push(cached);
      } else {
        uncachedMints.push(mint);
      }
    }

    if (uncachedMints.length === 0) {
      console.log(chalk.green(`✅ All ${successful.length} prices from cache`));
      return {
        successful,
        failed,
        totalQueried: uniqueMints.length,
        queryTime: Date.now() - startTime,
        graphqlQueries: 0,
      };
    }

    // Get token graduation status from database
    const tokenInfoMap = await this.getTokenInfo(uncachedMints);

    // Separate graduated and non-graduated tokens
    const graduatedMints: string[] = [];
    const nonGraduatedMints: string[] = [];

    uncachedMints.forEach(mint => {
      const info = tokenInfoMap.get(mint);
      if (info?.graduated) {
        graduatedMints.push(mint);
      } else {
        nonGraduatedMints.push(mint);
      }
    });

    console.log(chalk.gray(`📈 Non-graduated: ${nonGraduatedMints.length}, Graduated: ${graduatedMints.length}`));

    // Get current SOL price
    const currentSolPrice = await this.solPriceService.getPrice();

    // Process non-graduated tokens (bonding curves)
    if (nonGraduatedMints.length > 0) {
      const bcResult = await this.recoverBondingCurvePrices(nonGraduatedMints, currentSolPrice);
      successful.push(...bcResult.successful);
      failed.push(...bcResult.failed);
      graphqlQueries += bcResult.graphqlQueries;
    }

    // Process graduated tokens (AMM pools)
    if (graduatedMints.length > 0) {
      const ammResult = await this.recoverAmmPoolPrices(graduatedMints, currentSolPrice);
      successful.push(...ammResult.successful);
      failed.push(...ammResult.failed);
      graphqlQueries += ammResult.graphqlQueries;
    }

    const queryTime = Date.now() - startTime;
    console.log(chalk.green(
      `✅ Price recovery complete: ${successful.length} successful, ${failed.length} failed in ${queryTime}ms`
    ));

    // Update database with recovered prices
    if (successful.length > 0) {
      await this.updateDatabasePrices(successful);
    }

    return {
      successful,
      failed,
      totalQueried: uniqueMints.length,
      queryTime,
      graphqlQueries,
    };
  }

  /**
   * Get token graduation status from database
   */
  private async getTokenInfo(mints: string[]): Promise<Map<string, TokenInfo>> {
    const result = await db.query(`
      SELECT 
        mint_address,
        graduated_to_amm
      FROM tokens_unified
      WHERE mint_address = ANY($1)
    `, [mints]);

    const map = new Map<string, TokenInfo>();
    result.rows.forEach((row: any) => {
      map.set(row.mint_address, {
        mintAddress: row.mint_address,
        graduated: row.graduated_to_amm,
      });
    });

    return map;
  }

  /**
   * Recover prices from bonding curves
   */
  private async recoverBondingCurvePrices(
    tokenMints: string[],
    solPriceUsd: number
  ): Promise<BulkPriceRecoveryResult> {
    const successful: PriceUpdate[] = [];
    const failed: FailedUpdate[] = [];
    let graphqlQueries = 0;

    // Process in batches
    const batches = this.createBatches(tokenMints, GRAPHQL_CONFIG.maxBatchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(chalk.gray(`Processing BC batch ${i + 1}/${batches.length} (${batch.length} tokens)`));

      try {
        // Derive bonding curve addresses
        const addressMap = deriveBondingCurveAddresses(batch);
        const bondingCurveAddresses = Array.from(addressMap.values());

        // Create reverse map
        const bondingCurveToMint = new Map<string, string>();
        addressMap.forEach((bcAddress, mint) => {
          bondingCurveToMint.set(bcAddress, mint);
        });

        // Query bonding curves
        const response = await this.client.query<GetBondingCurvesResponse>(
          GET_BONDING_CURVES,
          { pubkeys: bondingCurveAddresses }
        );
        graphqlQueries++;

        const bondingCurves = response.pump_BondingCurve || [];

        // Process results
        bondingCurves.forEach(bc => {
          const mintAddress = bondingCurveToMint.get(bc.pubkey);
          if (!mintAddress) return;

          const priceUpdate = this.calculatePriceFromBondingCurve(bc, mintAddress, solPriceUsd);
          successful.push(priceUpdate);
          this.cachePrice(priceUpdate);
        });

        // Mark missing as failed
        const foundBondingCurves = new Set(bondingCurves.map(bc => bc.pubkey));
        bondingCurveAddresses.forEach(bcAddress => {
          if (!foundBondingCurves.has(bcAddress)) {
            const mint = bondingCurveToMint.get(bcAddress);
            if (mint) {
              failed.push({
                mintAddress: mint,
                reason: 'Bonding curve not found',
              });
            }
          }
        });

        // Delay between batches
        if (i < batches.length - 1) {
          await this.sleep(GRAPHQL_CONFIG.batchDelay);
        }
      } catch (error) {
        console.error(chalk.red(`BC batch ${i + 1} failed:`), error);
        batch.forEach(mint => {
          failed.push({
            mintAddress: mint,
            reason: 'Batch query failed',
            error: error as Error,
          });
        });
      }
    }

    return {
      successful,
      failed,
      totalQueried: tokenMints.length,
      queryTime: 0,
      graphqlQueries,
    };
  }

  /**
   * Recover prices from AMM pools
   */
  private async recoverAmmPoolPrices(
    tokenMints: string[],
    solPriceUsd: number
  ): Promise<BulkPriceRecoveryResult> {
    const successful: PriceUpdate[] = [];
    const failed: FailedUpdate[] = [];
    let graphqlQueries = 0;

    // Process in batches
    const batches = this.createBatches(tokenMints, GRAPHQL_CONFIG.maxBatchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(chalk.gray(`Processing AMM batch ${i + 1}/${batches.length} (${batch.length} tokens)`));

      try {
        // Query AMM pools
        const poolResponse = await this.client.query<GetAmmPoolsResponse>(
          GET_AMM_POOLS,
          { mints: batch }
        );
        graphqlQueries++;

        const pools = poolResponse.pump_swap_LiquidityPool || [];

        // Get all token accounts for reserves
        const tokenAccounts: string[] = [];
        pools.forEach(pool => {
          if (this.ammPriceCalculator.isValidAmmPool(pool)) {
            tokenAccounts.push(pool.baseAccount, pool.quoteAccount);
          }
        });

        if (tokenAccounts.length > 0) {
          // Query reserves
          const reservesResponse = await this.client.query<GetTokenAccountsResponse>(
            GET_AMM_POOL_RESERVES,
            { tokenAccounts }
          );
          graphqlQueries++;

          const accountMap = new Map<string, string>();
          reservesResponse.spl_Account?.forEach(account => {
            accountMap.set(account.pubkey, account.amount);
          });

          // Process pools with reserves
          pools.forEach(pool => {
            if (!this.ammPriceCalculator.isValidAmmPool(pool)) {
              failed.push({
                mintAddress: pool.tokenMint,
                reason: 'Invalid AMM pool',
              });
              return;
            }

            const solReserves = accountMap.get(pool.baseAccount);
            const tokenReserves = accountMap.get(pool.quoteAccount);

            if (!solReserves || !tokenReserves) {
              failed.push({
                mintAddress: pool.tokenMint,
                reason: 'Missing reserve data',
              });
              return;
            }

            const priceUpdate = this.calculatePriceFromAmmPool(
              pool,
              BigInt(solReserves),
              BigInt(tokenReserves),
              solPriceUsd
            );
            successful.push(priceUpdate);
            this.cachePrice(priceUpdate);
          });
        }

        // Mark tokens without pools as failed
        const foundMints = new Set(pools.map(p => p.tokenMint));
        batch.forEach(mint => {
          if (!foundMints.has(mint)) {
            failed.push({
              mintAddress: mint,
              reason: 'AMM pool not found',
            });
          }
        });

        // Delay between batches
        if (i < batches.length - 1) {
          await this.sleep(GRAPHQL_CONFIG.batchDelay);
        }
      } catch (error) {
        console.error(chalk.red(`AMM batch ${i + 1} failed:`), error);
        batch.forEach(mint => {
          failed.push({
            mintAddress: mint,
            reason: 'Batch query failed',
            error: error as Error,
          });
        });
      }
    }

    return {
      successful,
      failed,
      totalQueried: tokenMints.length,
      queryTime: 0,
      graphqlQueries,
    };
  }

  /**
   * Calculate price from bonding curve data
   */
  private calculatePriceFromBondingCurve(
    data: BondingCurveData,
    mintAddress: string,
    solPriceUsd: number
  ): PriceUpdate {
    const virtualSolReserves = BigInt(data.virtualSolReserves);
    const virtualTokenReserves = BigInt(data.virtualTokenReserves);

    const priceResult = this.priceCalculator.calculateTokenPrice(
      virtualSolReserves,
      virtualTokenReserves,
      solPriceUsd
    );

    const progress = this.priceCalculator.calculateBondingCurveProgress(virtualSolReserves);

    return {
      mintAddress,
      priceInSol: priceResult.priceInSol,
      priceInUsd: priceResult.priceInUsd,
      marketCapUsd: priceResult.marketCapUsd,
      progress,
      virtualSolReserves,
      virtualTokenReserves,
      realSolReserves: data.realSolReserves ? BigInt(data.realSolReserves) : undefined,
      realTokenReserves: data.realTokenReserves ? BigInt(data.realTokenReserves) : undefined,
      lastUpdated: new Date(data._updatedAt),
      source: 'graphql',
    };
  }

  /**
   * Calculate price from AMM pool data
   */
  private calculatePriceFromAmmPool(
    pool: AmmPoolData,
    solReserves: bigint,
    tokenReserves: bigint,
    solPriceUsd: number
  ): AmmPriceUpdate {
    const priceResult = this.ammPriceCalculator.calculateAmmTokenPrice(
      solReserves,
      tokenReserves,
      solPriceUsd
    );

    return {
      mintAddress: pool.tokenMint,
      poolAddress: pool.pubkey,
      priceInSol: priceResult.priceInSol,
      priceInUsd: priceResult.priceInUsd,
      marketCapUsd: priceResult.marketCapUsd,
      progress: 100, // AMM tokens are always 100% graduated
      virtualSolReserves: solReserves,
      virtualTokenReserves: tokenReserves,
      lpSupply: BigInt(pool.lpSupply),
      lastUpdated: new Date(pool._updatedAt),
      source: 'amm',
    };
  }

  /**
   * Update database with recovered prices
   */
  private async updateDatabasePrices(priceUpdates: PriceUpdate[]): Promise<void> {
    const updateTime = new Date();

    // Prepare batch update
    const values = priceUpdates.map(update => [
      update.mintAddress,
      update.priceInSol,
      update.priceInUsd,
      update.marketCapUsd,
      update.progress,
      update.source,
      updateTime,
    ]);

    try {
      await db.query(`
        UPDATE tokens_unified
        SET 
          latest_price_sol = v.price_sol,
          latest_price_usd = v.price_usd,
          latest_market_cap_usd = v.market_cap,
          price_source = v.source,
          updated_at = v.update_time,
          last_graphql_update = v.update_time
        FROM (
          VALUES ${values.map((_, i) => 
            `($${i * 7 + 1}, $${i * 7 + 2}::numeric, $${i * 7 + 3}::numeric, $${i * 7 + 4}::numeric, $${i * 7 + 5}::numeric, $${i * 7 + 6}::text, $${i * 7 + 7}::timestamp)`
          ).join(', ')}
        ) AS v(mint_address, price_sol, price_usd, market_cap, progress, source, update_time)
        WHERE tokens_unified.mint_address = v.mint_address
      `, values.flat());

      console.log(chalk.green(`✅ Updated ${priceUpdates.length} token prices in database`));
    } catch (error) {
      console.error(chalk.red('Failed to update database prices:'), error);
    }
  }

  /**
   * Check if a price is cached and still valid
   */
  private getCachedPrice(mintAddress: string): PriceUpdate | null {
    if (!GRAPHQL_CONFIG.cacheEnabled) return null;

    const cached = this.cache.get(mintAddress);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > GRAPHQL_CONFIG.cacheTTL * 1000) {
      this.cache.delete(mintAddress);
      return null;
    }

    return cached.data;
  }

  /**
   * Cache a price update
   */
  private cachePrice(priceUpdate: PriceUpdate): void {
    if (!GRAPHQL_CONFIG.cacheEnabled) return;

    if (this.cache.size >= GRAPHQL_CONFIG.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(priceUpdate.mintAddress, {
      data: priceUpdate,
      timestamp: Date.now(),
    });
  }

  /**
   * Create batches from array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear the price cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log(chalk.yellow('Price cache cleared'));
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: GRAPHQL_CONFIG.maxCacheSize,
      enabled: GRAPHQL_CONFIG.cacheEnabled,
      ttl: GRAPHQL_CONFIG.cacheTTL,
    };
  }
}