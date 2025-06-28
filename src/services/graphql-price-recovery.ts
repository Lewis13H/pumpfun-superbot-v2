/**
 * GraphQL-based Price Recovery Service
 * Efficiently recovers prices for multiple tokens using bulk queries
 */

import { ShyftGraphQLClient } from './graphql-client';
import { SolPriceService } from './sol-price';
import { 
  BondingCurveData, 
  GetBondingCurvesResponse, 
  PriceUpdate, 
  BulkPriceRecoveryResult,
  FailedUpdate 
} from '../types/graphql.types';
import { GET_BONDING_CURVES, GET_UPDATED_BONDING_CURVES } from '../graphql/queries/bonding-curve.queries';
import { calculateBondingCurveProgress, calculateTokenPrice } from './bc-price-calculator';
import { GRAPHQL_CONFIG } from '../config/graphql.config';
import { deriveBondingCurveAddresses } from '../utils/pump-addresses';
import chalk from 'chalk';

export class GraphQLPriceRecovery {
  private static instance: GraphQLPriceRecovery;
  private client: ShyftGraphQLClient;
  private solPriceService: SolPriceService;
  private cache: Map<string, { data: PriceUpdate; timestamp: number }> = new Map();
  
  private constructor() {
    this.client = ShyftGraphQLClient.getInstance();
    this.solPriceService = SolPriceService.getInstance();
  }
  
  static getInstance(): GraphQLPriceRecovery {
    if (!GraphQLPriceRecovery.instance) {
      GraphQLPriceRecovery.instance = new GraphQLPriceRecovery();
    }
    return GraphQLPriceRecovery.instance;
  }
  
  /**
   * Recover prices for multiple tokens in a single query
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
    
    // Process in batches
    const batches = this.createBatches(uncachedMints, GRAPHQL_CONFIG.maxBatchSize);
    const currentSolPrice = await this.solPriceService.getPrice();
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(chalk.gray(`Processing batch ${i + 1}/${batches.length} (${batch.length} tokens)`));
      
      try {
        const batchResults = await this.processBatch(batch, currentSolPrice);
        graphqlQueries++;
        
        successful.push(...batchResults.successful);
        failed.push(...batchResults.failed);
        
        // Add delay between batches
        if (i < batches.length - 1) {
          await this.sleep(GRAPHQL_CONFIG.batchDelay);
        }
      } catch (error) {
        console.error(chalk.red(`Batch ${i + 1} failed:`), error);
        // Add all tokens in failed batch
        batch.forEach(mint => {
          failed.push({
            mintAddress: mint,
            reason: 'Batch query failed',
            error: error as Error,
          });
        });
      }
    }
    
    const queryTime = Date.now() - startTime;
    console.log(chalk.green(
      `✅ Price recovery complete: ${successful.length} successful, ${failed.length} failed in ${queryTime}ms`
    ));
    
    return {
      successful,
      failed,
      totalQueried: uniqueMints.length,
      queryTime,
      graphqlQueries,
    };
  }
  
  /**
   * Process a single batch of tokens
   */
  private async processBatch(
    tokenMints: string[], 
    solPriceUsd: number
  ): Promise<{ successful: PriceUpdate[]; failed: FailedUpdate[] }> {
    const successful: PriceUpdate[] = [];
    const failed: FailedUpdate[] = [];
    
    try {
      // Derive bonding curve addresses from token mints
      const addressMap = deriveBondingCurveAddresses(tokenMints);
      const bondingCurveAddresses = Array.from(addressMap.values());
      
      // Create reverse map for looking up mint from bonding curve
      const bondingCurveToMint = new Map<string, string>();
      addressMap.forEach((bcAddress, mint) => {
        bondingCurveToMint.set(bcAddress, mint);
      });
      
      const response = await this.client.query<GetBondingCurvesResponse>(
        GET_BONDING_CURVES,
        { pubkeys: bondingCurveAddresses }
      );
      
      const bondingCurves = response.pump_BondingCurve || [];
      const foundBondingCurves = new Set(bondingCurves.map(bc => bc.pubkey));
      
      // Process found bonding curves
      for (const bcData of bondingCurves) {
        const mintAddress = bondingCurveToMint.get(bcData.pubkey);
        if (!mintAddress) continue;
        
        try {
          const priceUpdate = this.calculatePriceFromReserves(bcData, mintAddress, solPriceUsd);
          successful.push(priceUpdate);
          this.cachePrice(priceUpdate);
        } catch (error) {
          failed.push({
            mintAddress,
            reason: 'Failed to calculate price',
            error: error as Error,
          });
        }
      }
      
      // Mark not found tokens
      for (const [mint, bcAddress] of addressMap.entries()) {
        if (!foundBondingCurves.has(bcAddress)) {
          failed.push({
            mintAddress: mint,
            reason: 'Bonding curve not found',
          });
        }
      }
      
    } catch (error) {
      throw error;
    }
    
    return { successful, failed };
  }
  
  /**
   * Get bonding curves for specific tokens
   */
  async getBondingCurves(mints: string[]): Promise<BondingCurveData[]> {
    const batches = this.createBatches(mints, GRAPHQL_CONFIG.maxBatchSize);
    const allResults: BondingCurveData[] = [];
    
    for (const batch of batches) {
      // Derive bonding curve addresses
      const addressMap = deriveBondingCurveAddresses(batch);
      const bondingCurveAddresses = Array.from(addressMap.values());
      
      const response = await this.client.query<GetBondingCurvesResponse>(
        GET_BONDING_CURVES,
        { pubkeys: bondingCurveAddresses }
      );
      
      allResults.push(...(response.pump_BondingCurve || []));
    }
    
    return allResults;
  }
  
  /**
   * Get recently updated bonding curves (useful for recovery after downtime)
   */
  async getUpdatedBondingCurves(since: Date, limit: number = 1000): Promise<BondingCurveData[]> {
    const response = await this.client.query<GetBondingCurvesResponse>(
      GET_UPDATED_BONDING_CURVES,
      { 
        since: since.toISOString(),
        limit 
      }
    );
    
    return response.pump_BondingCurve || [];
  }
  
  /**
   * Calculate price information from bonding curve data
   */
  calculatePriceFromReserves(data: BondingCurveData, mintAddress: string, solPriceUsd: number): PriceUpdate {
    const virtualSolReserves = BigInt(data.virtualSolReserves);
    const virtualTokenReserves = BigInt(data.virtualTokenReserves);
    
    // Calculate price and market cap
    const priceResult = calculateTokenPrice(
      virtualSolReserves,
      virtualTokenReserves,
      solPriceUsd
    );
    
    // Calculate progress
    const progress = calculateBondingCurveProgress(virtualSolReserves);
    
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
    
    // Enforce max cache size
    if (this.cache.size >= GRAPHQL_CONFIG.maxCacheSize) {
      // Remove oldest entry
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
  
  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}