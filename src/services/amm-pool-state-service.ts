/**
 * AMM Pool State Service
 * Manages pool state data and provides lookup functionality
 */

import { 
  AmmPoolAccount, 
  AmmPoolReserves, 
  AmmPoolMetrics, 
  AmmPoolState,
  PoolStateUpdate 
} from '../types/amm-pool-state';
import { db } from '../database';
import chalk from 'chalk';
import { ammPriceCalculator } from '../utils/amm-price-calculator';
// import { ammPriceTracker } from './amm-price-tracker';

export class AmmPoolStateService {
  private static instance: AmmPoolStateService | null = null;
  
  // In-memory cache for fast lookups
  private poolStates: Map<string, AmmPoolState> = new Map(); // Key: mint address
  private poolAddressToMint: Map<string, string> = new Map(); // Pool address -> mint address
  
  // Update tracking
  private pendingUpdates: PoolStateUpdate[] = [];
  private updateTimer: NodeJS.Timeout | null = null;
  
  private constructor() {
    // Load existing pool states from database on startup
    this.loadExistingPools();
  }
  
  static getInstance(): AmmPoolStateService {
    if (!this.instance) {
      this.instance = new AmmPoolStateService();
    }
    return this.instance;
  }
  
  /**
   * Load existing pool states from database
   */
  private async loadExistingPools(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT DISTINCT ON (mint_address) 
          mint_address, 
          pool_address,
          virtual_sol_reserves,
          virtual_token_reserves,
          real_sol_reserves,
          real_token_reserves,
          slot,
          created_at
        FROM amm_pool_states
        ORDER BY mint_address, created_at DESC
      `);
      
      console.log(chalk.gray(`Loaded ${result.rows.length} existing pool states from database`));
      
      // Cache the states
      for (const row of result.rows) {
        // Create minimal state for cache
        const state: AmmPoolState = {
          account: {
            poolAddress: row.pool_address,
            quoteMint: row.mint_address,
            // Other fields will be populated when account update arrives
          } as AmmPoolAccount,
          reserves: {
            mintAddress: row.mint_address,
            poolAddress: row.pool_address,
            virtualSolReserves: Number(row.virtual_sol_reserves),
            virtualTokenReserves: Number(row.virtual_token_reserves),
            realSolReserves: row.real_sol_reserves ? Number(row.real_sol_reserves) : undefined,
            realTokenReserves: row.real_token_reserves ? Number(row.real_token_reserves) : undefined,
            lpSupply: 0, // Will be updated
            lastUpdateSlot: Number(row.slot),
            lastUpdateTime: row.created_at,
          },
          metrics: {} as AmmPoolMetrics, // Will be calculated
          isActive: true,
        };
        
        this.poolStates.set(row.mint_address, state);
        this.poolAddressToMint.set(row.pool_address, row.mint_address);
      }
    } catch (error) {
      console.error(chalk.red('Error loading pool states:'), error);
    }
  }
  
  /**
   * Update pool account data
   */
  async updatePoolState(account: AmmPoolAccount): Promise<void> {
    const mintAddress = account.quoteMint;
    
    // Get or create pool state
    let poolState = this.poolStates.get(mintAddress);
    if (!poolState) {
      poolState = {
        account,
        reserves: {
          mintAddress,
          poolAddress: account.poolAddress,
          virtualSolReserves: 0,
          virtualTokenReserves: 0,
          lpSupply: account.lpSupply,
          lastUpdateSlot: account.slot,
          lastUpdateTime: new Date(),
        },
        metrics: {
          mintAddress,
          poolAddress: account.poolAddress,
          pricePerTokenSol: 0,
          pricePerTokenUsd: 0,
          marketCapUsd: 0,
          liquiditySol: 0,
          liquidityUsd: 0,
        },
        isActive: true,
      };
      this.poolStates.set(mintAddress, poolState);
    } else {
      // Update account data
      poolState.account = account;
      poolState.reserves.lpSupply = account.lpSupply;
    }
    
    // Update mapping
    this.poolAddressToMint.set(account.poolAddress, mintAddress);
    
    // Queue update
    this.queueUpdate({
      type: 'account',
      mintAddress,
      poolAddress: account.poolAddress,
      data: { account },
      slot: account.slot,
      timestamp: new Date(),
    });
  }
  
  /**
   * Update pool reserves (from trade events)
   */
  async updatePoolReserves(
    mintAddress: string, 
    solReserves: number, 
    tokenReserves: number,
    slot: number
  ): Promise<void> {
    const poolState = this.poolStates.get(mintAddress);
    if (!poolState) {
      console.warn(chalk.yellow(`No pool state found for ${mintAddress}`));
      return;
    }
    
    // Update reserves
    poolState.reserves.virtualSolReserves = solReserves;
    poolState.reserves.virtualTokenReserves = tokenReserves;
    poolState.reserves.lastUpdateSlot = slot;
    poolState.reserves.lastUpdateTime = new Date();
    
    // Calculate metrics
    await this.calculateMetrics(poolState);
    
    // Queue update
    this.queueUpdate({
      type: 'reserves',
      mintAddress,
      poolAddress: poolState.account.poolAddress,
      data: { reserves: poolState.reserves, metrics: poolState.metrics },
      slot,
      timestamp: new Date(),
    });
  }
  
  /**
   * Calculate pool metrics from reserves
   */
  private async calculateMetrics(poolState: AmmPoolState): Promise<void> {
    const { reserves, metrics } = poolState;
    
    // Skip if no reserves
    if (!reserves.virtualSolReserves || !reserves.virtualTokenReserves) {
      return;
    }
    
    try {
      // Use the new price calculator for accurate calculations
      const priceCalc = await ammPriceCalculator.calculatePrices(reserves);
      
      // Update metrics with calculated values
      metrics.pricePerTokenSol = priceCalc.pricePerTokenSol;
      metrics.pricePerTokenUsd = priceCalc.pricePerTokenUsd;
      metrics.marketCapUsd = priceCalc.marketCapUsd;
      metrics.liquiditySol = priceCalc.liquiditySol;
      metrics.liquidityUsd = priceCalc.liquidityUsd;
      
      // Track price history
      // await ammPriceTracker.trackPrice(
      //   reserves.mintAddress,
      //   reserves,
      //   reserves.lastUpdateSlot
      // );
      
    } catch (error) {
      console.error(chalk.red(`Error calculating metrics for ${reserves.mintAddress}:`), error);
    }
  }
  
  /**
   * Get pool state by mint address
   */
  getPoolState(mintAddress: string): AmmPoolState | undefined {
    return this.poolStates.get(mintAddress);
  }
  
  /**
   * Get pool state by pool address
   */
  getPoolStateByAddress(poolAddress: string): AmmPoolState | undefined {
    const mintAddress = this.poolAddressToMint.get(poolAddress);
    return mintAddress ? this.poolStates.get(mintAddress) : undefined;
  }
  
  /**
   * Get all tracked pools
   */
  getAllPools(): Map<string, AmmPoolState> {
    return this.poolStates;
  }
  
  /**
   * Queue an update for batch processing
   */
  private queueUpdate(update: PoolStateUpdate): void {
    this.pendingUpdates.push(update);
    
    // Schedule batch processing
    if (!this.updateTimer) {
      this.updateTimer = setTimeout(() => this.processPendingUpdates(), 1000);
    }
  }
  
  /**
   * Process pending updates in batch
   */
  private async processPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.length === 0) {
      this.updateTimer = null;
      return;
    }
    
    const updates = [...this.pendingUpdates];
    this.pendingUpdates = [];
    this.updateTimer = null;
    
    try {
      // Group by mint address to get latest update per pool
      const latestUpdates = new Map<string, PoolStateUpdate>();
      for (const update of updates) {
        const existing = latestUpdates.get(update.mintAddress);
        if (!existing || update.slot > existing.slot) {
          latestUpdates.set(update.mintAddress, update);
        }
      }
      
      // Save to database
      for (const update of latestUpdates.values()) {
        const poolState = this.poolStates.get(update.mintAddress);
        if (!poolState) continue;
        
        await this.savePoolState(poolState);
      }
      
      console.log(chalk.gray(`Saved ${latestUpdates.size} pool state updates`));
      
    } catch (error) {
      console.error(chalk.red('Error processing pool updates:'), error);
    }
  }
  
  /**
   * Save pool state to database
   */
  private async savePoolState(poolState: AmmPoolState): Promise<void> {
    const { account, reserves, metrics } = poolState;
    
    try {
      await db.query(`
        INSERT INTO amm_pool_states (
          mint_address,
          pool_address,
          virtual_sol_reserves,
          virtual_token_reserves,
          real_sol_reserves,
          real_token_reserves,
          pool_open,
          slot,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, [
        reserves.mintAddress,
        reserves.poolAddress,
        reserves.virtualSolReserves,
        reserves.virtualTokenReserves,
        reserves.realSolReserves || null,
        reserves.realTokenReserves || null,
        poolState.isActive,
        reserves.lastUpdateSlot,
      ]);
      
      // Update token with latest pool metrics
      await db.query(`
        UPDATE tokens_unified
        SET 
          latest_price_sol = $2,
          latest_price_usd = $3,
          latest_market_cap_usd = $4,
          latest_virtual_sol_reserves = $5,
          latest_virtual_token_reserves = $6,
          latest_update_slot = $7,
          updated_at = NOW()
        WHERE mint_address = $1
      `, [
        reserves.mintAddress,
        metrics.pricePerTokenSol,
        metrics.pricePerTokenUsd,
        metrics.marketCapUsd,
        reserves.virtualSolReserves,
        reserves.virtualTokenReserves,
        reserves.lastUpdateSlot,
      ]);
      
    } catch (error) {
      console.error(chalk.red(`Error saving pool state for ${reserves.mintAddress}:`), error);
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      poolsTracked: this.poolStates.size,
      pendingUpdates: this.pendingUpdates.length,
      pools: Array.from(this.poolStates.values()).map(state => ({
        mint: state.reserves.mintAddress,
        pool: state.reserves.poolAddress,
        priceSol: state.metrics.pricePerTokenSol,
        liquidityUsd: state.metrics.liquidityUsd,
        lastUpdate: state.reserves.lastUpdateTime,
      })),
    };
  }
}