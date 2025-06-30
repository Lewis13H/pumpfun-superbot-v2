/**
 * AMM Pool Price Recovery using cached pool states
 * Uses data from amm-account-monitor to calculate prices for stale graduated tokens
 */

import { db } from '../database';
import { SolPriceService } from './sol-price';
import { PriceCalculator } from './price-calculator';
import chalk from 'chalk';

interface PoolStateData {
  mintAddress: string;
  poolAddress: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  lastUpdated: Date;
}

export class AmmPoolPriceRecovery {
  private static instance: AmmPoolPriceRecovery;
  private solPriceService: SolPriceService;
  
  private constructor() {
    this.solPriceService = SolPriceService.getInstance();
  }
  
  static getInstance(): AmmPoolPriceRecovery {
    if (!AmmPoolPriceRecovery.instance) {
      AmmPoolPriceRecovery.instance = new AmmPoolPriceRecovery();
    }
    return AmmPoolPriceRecovery.instance;
  }
  
  /**
   * Recover prices for graduated tokens using cached pool states
   */
  async recoverPricesFromPoolStates(tokenMints: string[]): Promise<{
    successful: any[];
    failed: any[];
  }> {
    const successful: any[] = [];
    const failed: any[] = [];
    
    console.log(chalk.blue(`🔍 Recovering prices from AMM pool states for ${tokenMints.length} graduated tokens...`));
    
    const solPrice = await this.solPriceService.getPrice();
    
    try {
      // Get latest pool states for all requested tokens
      const poolStates = await this.getLatestPoolStates(tokenMints);
      
      // Create a map for easy lookup
      const stateMap = new Map<string, PoolStateData>();
      poolStates.forEach(state => {
        stateMap.set(state.mintAddress, state);
      });
      
      // Process each token
      for (const mint of tokenMints) {
        const poolState = stateMap.get(mint);
        
        if (!poolState) {
          failed.push({
            mintAddress: mint,
            reason: 'No pool state data available',
          });
          continue;
        }
        
        // Check if pool state is too old (>1 hour)
        const stateAge = Date.now() - poolState.lastUpdated.getTime();
        if (stateAge > 3600000) {
          console.log(chalk.yellow(`⚠️ Pool state for ${mint.slice(0, 8)}... is ${Math.floor(stateAge / 60000)} minutes old`));
        }
        
        // Calculate price from reserves
        const calculator = new PriceCalculator();
        const priceResult = calculator.calculateAMMPrice(
          poolState.virtualSolReserves,
          poolState.virtualTokenReserves,
          true, // isBaseSOL
          solPrice
        );
        
        successful.push({
          mintAddress: mint,
          poolAddress: poolState.poolAddress,
          priceInSol: priceResult.priceInSol,
          priceInUsd: priceResult.priceInUsd,
          marketCapUsd: priceResult.marketCapUsd,
          progress: 100,
          virtualSolReserves: poolState.virtualSolReserves,
          virtualTokenReserves: poolState.virtualTokenReserves,
          lastUpdated: poolState.lastUpdated,
          source: 'amm_pool_state',
        });
      }
      
      // Update database with recovered prices
      if (successful.length > 0) {
        await this.updateTokenPrices(successful);
      }
      
    } catch (error) {
      console.error(chalk.red('Error recovering from pool states:'), error);
      // Mark all as failed
      tokenMints.forEach(mint => {
        failed.push({
          mintAddress: mint,
          reason: `Pool state recovery error: ${error.message}`,
          error,
        });
      });
    }
    
    console.log(chalk.green(`✅ Pool state recovery: ${successful.length} successful, ${failed.length} failed`));
    
    return { successful, failed };
  }
  
  /**
   * Get latest pool states from database
   */
  private async getLatestPoolStates(tokenMints: string[]): Promise<PoolStateData[]> {
    const result = await db.query(`
      WITH latest_states AS (
        SELECT 
          mint_address,
          pool_address,
          virtual_sol_reserves,
          virtual_token_reserves,
          created_at,
          ROW_NUMBER() OVER (PARTITION BY mint_address ORDER BY created_at DESC) as rn
        FROM amm_pool_states
        WHERE mint_address = ANY($1)
          AND virtual_sol_reserves > 0
          AND virtual_token_reserves > 0
      )
      SELECT 
        mint_address,
        pool_address,
        virtual_sol_reserves,
        virtual_token_reserves,
        created_at
      FROM latest_states
      WHERE rn = 1
    `, [tokenMints]);
    
    return result.rows.map(row => ({
      mintAddress: row.mint_address,
      poolAddress: row.pool_address,
      virtualSolReserves: BigInt(row.virtual_sol_reserves),
      virtualTokenReserves: BigInt(row.virtual_token_reserves),
      lastUpdated: row.created_at,
    }));
  }
  
  /**
   * Update token prices in database
   */
  private async updateTokenPrices(priceUpdates: any[]): Promise<void> {
    const updateTime = new Date();
    
    // Prepare batch update
    const values = priceUpdates.map(update => [
      update.mintAddress,
      update.priceInSol,
      update.priceInUsd,
      update.marketCapUsd,
      'amm_pool_state',
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
          updated_at = v.update_time
        FROM (
          VALUES ${values.map((_, i) => 
            `($${i * 6 + 1}, $${i * 6 + 2}::numeric, $${i * 6 + 3}::numeric, $${i * 6 + 4}::numeric, $${i * 6 + 5}::text, $${i * 6 + 6}::timestamp)`
          ).join(', ')}
        ) AS v(mint_address, price_sol, price_usd, market_cap, source, update_time)
        WHERE tokens_unified.mint_address = v.mint_address
      `, values.flat());
      
      console.log(chalk.green(`✅ Updated ${priceUpdates.length} token prices from pool states`));
    } catch (error) {
      console.error(chalk.red('Failed to update token prices:'), error);
    }
  }
}