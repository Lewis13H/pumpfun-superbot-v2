/**
 * AMM Price Tracker Service
 * Tracks price history, calculates price changes, and manages price alerts
 */

import { AmmPoolReserves } from '../types/amm-pool-state';
import { ammPriceCalculator, PriceCalculation } from '../utils/amm-price-calculator';
import { db } from '../database';
import chalk from 'chalk';

interface PriceSnapshot {
  timestamp: Date;
  pricePerTokenSol: number;
  pricePerTokenUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  solReserves: number;
  tokenReserves: number;
  slot: number;
}

interface PriceMetrics {
  current: PriceSnapshot;
  change1m?: number;     // 1 minute change %
  change5m?: number;     // 5 minute change %
  change15m?: number;    // 15 minute change %
  change1h?: number;     // 1 hour change %
  change24h?: number;    // 24 hour change %
  high24h?: number;      // 24h high price
  low24h?: number;       // 24h low price
  volume24h?: number;    // 24h volume in USD
}

export class AmmPriceTracker {
  // Price history cache: mint address -> price snapshots
  private priceHistory: Map<string, PriceSnapshot[]> = new Map();
  
  // Configuration
  private readonly MAX_HISTORY_SIZE = 1440; // 24 hours at 1 minute intervals
  private readonly SNAPSHOT_INTERVAL = 60000; // 1 minute
  
  // Batch save timer
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingSaves: Map<string, PriceSnapshot> = new Map();
  
  constructor() {
    // Load recent price history on startup
    this.loadRecentHistory();
  }
  
  /**
   * Load recent price history from database
   */
  private async loadRecentHistory(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT 
          mint_address,
          price_sol,
          price_usd,
          market_cap_usd,
          reserves_sol,
          reserves_token,
          slot,
          created_at
        FROM price_update_sources
        WHERE 
          update_source = 'amm_trade' AND
          created_at > NOW() - INTERVAL '24 hours'
        ORDER BY mint_address, created_at DESC
      `);
      
      // Group by mint address
      const historyByMint = new Map<string, PriceSnapshot[]>();
      
      for (const row of result.rows) {
        const snapshot: PriceSnapshot = {
          timestamp: row.created_at,
          pricePerTokenSol: parseFloat(row.price_sol),
          pricePerTokenUsd: parseFloat(row.price_usd),
          marketCapUsd: parseFloat(row.market_cap_usd),
          liquidityUsd: 0, // Will be calculated
          solReserves: parseInt(row.reserves_sol),
          tokenReserves: parseInt(row.reserves_token),
          slot: parseInt(row.slot),
        };
        
        const history = historyByMint.get(row.mint_address) || [];
        history.push(snapshot);
        historyByMint.set(row.mint_address, history);
      }
      
      // Store in memory cache
      for (const [mint, history] of historyByMint) {
        this.priceHistory.set(mint, history.slice(0, this.MAX_HISTORY_SIZE));
      }
      
      console.log(chalk.gray(`Loaded price history for ${historyByMint.size} tokens`));
      
    } catch (error) {
      console.error(chalk.red('Error loading price history:'), error);
    }
  }
  
  /**
   * Track a new price update
   */
  async trackPrice(
    mintAddress: string,
    reserves: AmmPoolReserves,
    slot: number
  ): Promise<PriceMetrics> {
    // Calculate current prices
    const priceCalc = await ammPriceCalculator.calculatePrices(reserves);
    
    // Create snapshot
    const snapshot: PriceSnapshot = {
      timestamp: new Date(),
      pricePerTokenSol: priceCalc.pricePerTokenSol,
      pricePerTokenUsd: priceCalc.pricePerTokenUsd,
      marketCapUsd: priceCalc.marketCapUsd,
      liquidityUsd: priceCalc.liquidityUsd,
      solReserves: reserves.virtualSolReserves,
      tokenReserves: reserves.virtualTokenReserves,
      slot,
    };
    
    // Add to history
    this.addToHistory(mintAddress, snapshot);
    
    // Calculate metrics
    const metrics = this.calculateMetrics(mintAddress, snapshot);
    
    // Queue for save
    this.queuePriceSave(mintAddress, snapshot);
    
    return metrics;
  }
  
  /**
   * Add snapshot to history
   */
  private addToHistory(mintAddress: string, snapshot: PriceSnapshot): void {
    const history = this.priceHistory.get(mintAddress) || [];
    
    // Add to beginning (newest first)
    history.unshift(snapshot);
    
    // Trim to max size
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.splice(this.MAX_HISTORY_SIZE);
    }
    
    this.priceHistory.set(mintAddress, history);
  }
  
  /**
   * Calculate price metrics including changes
   */
  private calculateMetrics(mintAddress: string, current: PriceSnapshot): PriceMetrics {
    const history = this.priceHistory.get(mintAddress) || [];
    const metrics: PriceMetrics = { current };
    
    if (history.length < 2) {
      return metrics;
    }
    
    const now = current.timestamp.getTime();
    
    // Find historical snapshots
    const snapshot1m = this.findSnapshotNearTime(history, now - 60000);        // 1 minute ago
    const snapshot5m = this.findSnapshotNearTime(history, now - 300000);       // 5 minutes ago
    const snapshot15m = this.findSnapshotNearTime(history, now - 900000);      // 15 minutes ago
    const snapshot1h = this.findSnapshotNearTime(history, now - 3600000);      // 1 hour ago
    const snapshot24h = this.findSnapshotNearTime(history, now - 86400000);    // 24 hours ago
    
    // Calculate changes
    if (snapshot1m) {
      metrics.change1m = this.calculatePriceChange(snapshot1m.pricePerTokenUsd, current.pricePerTokenUsd);
    }
    if (snapshot5m) {
      metrics.change5m = this.calculatePriceChange(snapshot5m.pricePerTokenUsd, current.pricePerTokenUsd);
    }
    if (snapshot15m) {
      metrics.change15m = this.calculatePriceChange(snapshot15m.pricePerTokenUsd, current.pricePerTokenUsd);
    }
    if (snapshot1h) {
      metrics.change1h = this.calculatePriceChange(snapshot1h.pricePerTokenUsd, current.pricePerTokenUsd);
    }
    if (snapshot24h) {
      metrics.change24h = this.calculatePriceChange(snapshot24h.pricePerTokenUsd, current.pricePerTokenUsd);
    }
    
    // Calculate 24h high/low
    const last24h = history.filter(s => 
      s.timestamp.getTime() > now - 86400000
    );
    
    if (last24h.length > 0) {
      metrics.high24h = Math.max(...last24h.map(s => s.pricePerTokenUsd));
      metrics.low24h = Math.min(...last24h.map(s => s.pricePerTokenUsd));
    }
    
    return metrics;
  }
  
  /**
   * Find snapshot nearest to target time
   */
  private findSnapshotNearTime(history: PriceSnapshot[], targetTime: number): PriceSnapshot | null {
    let closest: PriceSnapshot | null = null;
    let minDiff = Infinity;
    
    for (const snapshot of history) {
      const diff = Math.abs(snapshot.timestamp.getTime() - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snapshot;
      }
    }
    
    // Only return if within 2 minutes of target
    return minDiff < 120000 ? closest : null;
  }
  
  /**
   * Calculate percentage price change
   */
  private calculatePriceChange(oldPrice: number, newPrice: number): number {
    if (oldPrice === 0) return 0;
    return ((newPrice - oldPrice) / oldPrice) * 100;
  }
  
  /**
   * Queue price for batch save
   */
  private queuePriceSave(mintAddress: string, snapshot: PriceSnapshot): void {
    this.pendingSaves.set(mintAddress, snapshot);
    
    // Schedule batch save
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => this.savePriceBatch(), 5000); // Save every 5 seconds
    }
  }
  
  /**
   * Save price batch to database
   */
  private async savePriceBatch(): Promise<void> {
    if (this.pendingSaves.size === 0) {
      this.saveTimer = null;
      return;
    }
    
    const saves = [...this.pendingSaves.entries()];
    this.pendingSaves.clear();
    this.saveTimer = null;
    
    try {
      // Prepare batch insert
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;
      
      for (const [mintAddress, snapshot] of saves) {
        placeholders.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        
        values.push(
          mintAddress,
          'amm_trade',
          snapshot.pricePerTokenSol,
          snapshot.pricePerTokenUsd,
          snapshot.marketCapUsd,
          snapshot.solReserves,
          snapshot.tokenReserves,
          0, // latency_ms
          snapshot.slot
        );
      }
      
      const query = `
        INSERT INTO price_update_sources (
          mint_address, update_source, price_sol, price_usd, 
          market_cap_usd, reserves_sol, reserves_token, latency_ms, slot
        ) VALUES ${placeholders.join(', ')}
      `;
      
      await db.query(query, values);
      
    } catch (error) {
      console.error(chalk.red('Error saving price batch:'), error);
    }
  }
  
  /**
   * Get current price metrics for a token
   */
  getMetrics(mintAddress: string): PriceMetrics | null {
    const history = this.priceHistory.get(mintAddress);
    if (!history || history.length === 0) {
      return null;
    }
    
    return this.calculateMetrics(mintAddress, history[0]);
  }
  
  /**
   * Get price history for a token
   */
  getHistory(mintAddress: string, limit?: number): PriceSnapshot[] {
    const history = this.priceHistory.get(mintAddress) || [];
    return limit ? history.slice(0, limit) : history;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const tokensTracked = this.priceHistory.size;
    const totalSnapshots = Array.from(this.priceHistory.values())
      .reduce((sum, history) => sum + history.length, 0);
    
    return {
      tokensTracked,
      totalSnapshots,
      pendingSaves: this.pendingSaves.size,
      avgHistorySize: tokensTracked > 0 ? Math.round(totalSnapshots / tokensTracked) : 0,
    };
  }
}

// Export singleton instance
export const ammPriceTracker = new AmmPriceTracker();