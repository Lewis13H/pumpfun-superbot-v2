/**
 * Liquidity Depth Tracker Service
 * Tracks liquidity depth and price impact for tokens over time
 */

import { Logger } from '../core/logger';
import { EventBus, EVENTS } from '../core/event-bus';
import { db } from '../database';

export interface LiquiditySnapshot {
  mintAddress: string;
  slot: bigint;
  timestamp: Date;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  priceSol: number;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  volumeLast24h: number;
  tradesLast24h: number;
  priceImpact1Sol: number;  // Price impact for 1 SOL trade
  priceImpact10Sol: number; // Price impact for 10 SOL trade
  depth: {
    buy: Array<{ price: number; size: number; total: number }>;
    sell: Array<{ price: number; size: number; total: number }>;
  };
}

export interface LiquidityTrend {
  mintAddress: string;
  timeWindow: {
    start: Date;
    end: Date;
  };
  startLiquidity: number;
  endLiquidity: number;
  liquidityChange: number;
  liquidityChangePercent: number;
  avgLiquidity: number;
  minLiquidity: number;
  maxLiquidity: number;
  volatility: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface LiquidityAlert {
  type: 'low_liquidity' | 'liquidity_drain' | 'liquidity_spike' | 'high_volatility';
  mintAddress: string;
  tokenSymbol?: string;
  timestamp: Date;
  currentLiquidity: number;
  previousLiquidity: number;
  changePercent: number;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface DepthAnalysis {
  mintAddress: string;
  timestamp: Date;
  bidDepth: number;    // Total buy side liquidity
  askDepth: number;    // Total sell side liquidity
  depthRatio: number;  // Bid/Ask ratio
  spread: number;      // Bid-ask spread
  resilience: number;  // 0-100 score of market resilience
  manipulationRisk: 'low' | 'medium' | 'high';
}

export class LiquidityDepthTracker {
  private static instance: LiquidityDepthTracker;
  private logger: Logger;
  private eventBus: EventBus;
  
  private liquiditySnapshots: Map<string, LiquiditySnapshot[]> = new Map();
  private currentLiquidity: Map<string, LiquiditySnapshot> = new Map();
  private liquidityAlerts: LiquidityAlert[] = [];
  
  // Thresholds
  private readonly LOW_LIQUIDITY_THRESHOLD = 1000; // $1,000 USD
  private readonly LIQUIDITY_DRAIN_THRESHOLD = -50; // -50% change
  private readonly LIQUIDITY_SPIKE_THRESHOLD = 200; // +200% change
  private readonly HIGH_VOLATILITY_THRESHOLD = 0.3; // 30% standard deviation

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'LiquidityDepthTracker' });
    this.eventBus = eventBus;
    
    this.setupEventListeners();
    this.startPeriodicTasks();
  }

  static async create(eventBus: EventBus): Promise<LiquidityDepthTracker> {
    if (!LiquidityDepthTracker.instance) {
      LiquidityDepthTracker.instance = new LiquidityDepthTracker(eventBus);
      await LiquidityDepthTracker.instance.initialize();
    }
    return LiquidityDepthTracker.instance;
  }

  /**
   * Initialize the service
   */
  private async initialize(): Promise<void> {
    await this.createTables();
    await this.loadRecentSnapshots();
    
    this.logger.info('Liquidity depth tracker initialized', {
      trackedTokens: this.currentLiquidity.size
    });
  }

  /**
   * Create required database tables
   */
  private async createTables(): Promise<void> {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS liquidity_snapshots (
          id SERIAL PRIMARY KEY,
          mint_address VARCHAR(64) NOT NULL,
          slot BIGINT NOT NULL,
          virtual_sol_reserves BIGINT NOT NULL,
          virtual_token_reserves BIGINT NOT NULL,
          real_sol_reserves BIGINT NOT NULL,
          real_token_reserves BIGINT NOT NULL,
          price_sol DECIMAL(20, 12) NOT NULL,
          price_usd DECIMAL(20, 4) NOT NULL,
          liquidity_usd DECIMAL(20, 4) NOT NULL,
          market_cap_usd DECIMAL(20, 4) NOT NULL,
          volume_24h DECIMAL(20, 4) DEFAULT 0,
          trades_24h INTEGER DEFAULT 0,
          price_impact_1_sol DECIMAL(10, 6),
          price_impact_10_sol DECIMAL(10, 6),
          depth_data JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(mint_address, slot)
        );
        
        CREATE INDEX IF NOT EXISTS idx_liquidity_mint_time ON liquidity_snapshots(mint_address, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_liquidity_slot ON liquidity_snapshots(slot DESC);
        
        CREATE TABLE IF NOT EXISTS liquidity_alerts (
          id SERIAL PRIMARY KEY,
          alert_type VARCHAR(20) NOT NULL,
          mint_address VARCHAR(64) NOT NULL,
          token_symbol VARCHAR(50),
          current_liquidity DECIMAL(20, 4) NOT NULL,
          previous_liquidity DECIMAL(20, 4),
          change_percent DECIMAL(10, 2),
          severity VARCHAR(10) NOT NULL,
          message TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_alerts_mint ON liquidity_alerts(mint_address);
        CREATE INDEX IF NOT EXISTS idx_alerts_type ON liquidity_alerts(alert_type);
        
        CREATE TABLE IF NOT EXISTS depth_analysis (
          id SERIAL PRIMARY KEY,
          mint_address VARCHAR(64) NOT NULL,
          bid_depth DECIMAL(20, 4) NOT NULL,
          ask_depth DECIMAL(20, 4) NOT NULL,
          depth_ratio DECIMAL(10, 4) NOT NULL,
          spread DECIMAL(10, 6) NOT NULL,
          resilience_score INTEGER,
          manipulation_risk VARCHAR(10),
          analysis_data JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
    } catch (error) {
      this.logger.error('Error creating tables', error as Error);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for trade events to update liquidity
    this.eventBus.on(EVENTS.TRADE_PROCESSED, this.handleTradeProcessed.bind(this));
    
    // Listen for pool state updates
    this.eventBus.on(EVENTS.POOL_STATE_UPDATED, this.handlePoolStateUpdated.bind(this));
    
    // Listen for AMM trades
    this.eventBus.on(EVENTS.AMM_TRADE, this.handleAmmTrade.bind(this));
  }

  /**
   * Start periodic tasks
   */
  private startPeriodicTasks(): void {
    // Take snapshots every minute
    setInterval(() => this.takeSnapshots(), 60000);
    
    // Analyze trends every 5 minutes
    setInterval(() => this.analyzeTrends(), 300000);
    
    // Check for alerts every 30 seconds
    setInterval(() => this.checkAlerts(), 30000);
    
    // Clean up old data every hour
    setInterval(() => this.cleanupOldData(), 3600000);
  }

  /**
   * Handle trade processed
   */
  private async handleTradeProcessed(event: any): Promise<void> {
    try {
      const mintAddress = event.mintAddress;
      if (!mintAddress) return;
      
      // Update current liquidity data
      const current = this.currentLiquidity.get(mintAddress) || this.createEmptySnapshot(mintAddress);
      
      // Update reserves if available
      if (event.virtualSolReserves && event.virtualTokenReserves) {
        current.virtualSolReserves = BigInt(event.virtualSolReserves);
        current.virtualTokenReserves = BigInt(event.virtualTokenReserves);
      }
      
      if (event.realSolReserves && event.realTokenReserves) {
        current.realSolReserves = BigInt(event.realSolReserves);
        current.realTokenReserves = BigInt(event.realTokenReserves);
      }
      
      // Update price and liquidity
      current.priceSol = event.priceSol || current.priceSol;
      current.priceUsd = event.priceUsd || current.priceUsd;
      current.marketCapUsd = event.marketCapUsd || current.marketCapUsd;
      
      // Calculate liquidity
      current.liquidityUsd = this.calculateLiquidityUsd(current);
      
      // Update slot and timestamp
      current.slot = BigInt(event.slot || 0);
      current.timestamp = new Date();
      
      this.currentLiquidity.set(mintAddress, current);
      
    } catch (error) {
      // Silent error to avoid spam
    }
  }

  /**
   * Handle pool state updated
   */
  private async handlePoolStateUpdated(event: any): Promise<void> {
    try {
      const mintAddress = event.mintAddress;
      if (!mintAddress) return;
      
      const current = this.currentLiquidity.get(mintAddress) || this.createEmptySnapshot(mintAddress);
      
      // Update from pool state
      if (event.baseReserves && event.quoteReserves) {
        current.virtualSolReserves = BigInt(event.baseReserves);
        current.virtualTokenReserves = BigInt(event.quoteReserves);
        current.realSolReserves = current.virtualSolReserves;
        current.realTokenReserves = current.virtualTokenReserves;
      }
      
      // Calculate price impact
      current.priceImpact1Sol = this.calculatePriceImpact(current, 1);
      current.priceImpact10Sol = this.calculatePriceImpact(current, 10);
      
      // Update liquidity
      current.liquidityUsd = this.calculateLiquidityUsd(current);
      current.timestamp = new Date();
      
      this.currentLiquidity.set(mintAddress, current);
      
      // Check for significant changes
      await this.checkLiquidityChange(mintAddress, current);
      
    } catch (error) {
      this.logger.error('Error handling pool state', error as Error);
    }
  }

  /**
   * Handle AMM trade
   */
  private async handleAmmTrade(event: any): Promise<void> {
    try {
      const mintAddress = event.mintAddress;
      if (!mintAddress) return;
      
      const current = this.currentLiquidity.get(mintAddress);
      if (current) {
        // Update 24h volume
        current.volumeLast24h = (current.volumeLast24h || 0) + (event.volumeUsd || 0);
        current.tradesLast24h = (current.tradesLast24h || 0) + 1;
      }
    } catch (error) {
      // Silent error
    }
  }

  /**
   * Take liquidity snapshots
   */
  private async takeSnapshots(): Promise<void> {
    try {
      const snapshots: LiquiditySnapshot[] = [];
      
      for (const [mintAddress, current] of this.currentLiquidity) {
        // Only snapshot tokens with some liquidity
        if (current.liquidityUsd > 100) {
          // Calculate depth
          current.depth = await this.calculateDepth(current);
          
          snapshots.push({ ...current });
          
          // Add to history
          if (!this.liquiditySnapshots.has(mintAddress)) {
            this.liquiditySnapshots.set(mintAddress, []);
          }
          this.liquiditySnapshots.get(mintAddress)!.push(current);
          
          // Keep only recent snapshots in memory
          const history = this.liquiditySnapshots.get(mintAddress)!;
          if (history.length > 60) { // Keep 1 hour of minute snapshots
            this.liquiditySnapshots.set(mintAddress, history.slice(-60));
          }
        }
      }
      
      // Store snapshots in database
      await this.storeSnapshots(snapshots);
      
      this.logger.debug('Liquidity snapshots taken', {
        count: snapshots.length
      });
    } catch (error) {
      this.logger.error('Error taking snapshots', error as Error);
    }
  }

  /**
   * Analyze liquidity trends
   */
  private async analyzeTrends(): Promise<void> {
    try {
      const trends: LiquidityTrend[] = [];
      
      for (const [mintAddress, snapshots] of this.liquiditySnapshots) {
        if (snapshots.length < 5) continue; // Need at least 5 snapshots
        
        const recent = snapshots.slice(-15); // Last 15 minutes
        const trend = this.calculateTrend(mintAddress, recent);
        
        if (trend) {
          trends.push(trend);
          
          // Emit trend event
          this.eventBus.emit('liquidity:trend_detected', trend);
          
          // Check for concerning trends
          if (trend.trend === 'decreasing' && trend.liquidityChangePercent < -30) {
            this.createAlert({
              type: 'liquidity_drain',
              mintAddress,
              timestamp: new Date(),
              currentLiquidity: trend.endLiquidity,
              previousLiquidity: trend.startLiquidity,
              changePercent: trend.liquidityChangePercent,
              severity: 'high',
              message: `Liquidity draining: ${Math.abs(trend.liquidityChangePercent).toFixed(1)}% decrease`
            });
          }
        }
      }
      
      // Perform depth analysis for top tokens
      const topTokens = Array.from(this.currentLiquidity.entries())
        .sort((a, b) => b[1].liquidityUsd - a[1].liquidityUsd)
        .slice(0, 20);
      
      for (const [mintAddress, snapshot] of topTokens) {
        const analysis = await this.analyzeDepth(mintAddress, snapshot);
        if (analysis) {
          await this.storeDepthAnalysis(analysis);
        }
      }
    } catch (error) {
      this.logger.error('Error analyzing trends', error as Error);
    }
  }

  /**
   * Check for liquidity alerts
   */
  private async checkAlerts(): Promise<void> {
    try {
      for (const [mintAddress, current] of this.currentLiquidity) {
        // Check for low liquidity
        if (current.liquidityUsd < this.LOW_LIQUIDITY_THRESHOLD) {
          this.createAlert({
            type: 'low_liquidity',
            mintAddress,
            timestamp: new Date(),
            currentLiquidity: current.liquidityUsd,
            previousLiquidity: 0,
            changePercent: 0,
            severity: 'medium',
            message: `Low liquidity: $${current.liquidityUsd.toFixed(2)}`
          });
        }
        
        // Check volatility
        const history = this.liquiditySnapshots.get(mintAddress);
        if (history && history.length > 10) {
          const volatility = this.calculateVolatility(history.slice(-10));
          if (volatility > this.HIGH_VOLATILITY_THRESHOLD) {
            this.createAlert({
              type: 'high_volatility',
              mintAddress,
              timestamp: new Date(),
              currentLiquidity: current.liquidityUsd,
              previousLiquidity: current.liquidityUsd,
              changePercent: volatility * 100,
              severity: 'medium',
              message: `High liquidity volatility: ${(volatility * 100).toFixed(1)}%`
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Error checking alerts', error as Error);
    }
  }

  /**
   * Check liquidity change
   */
  private async checkLiquidityChange(
    mintAddress: string, 
    current: LiquiditySnapshot
  ): Promise<void> {
    try {
      const history = this.liquiditySnapshots.get(mintAddress);
      if (!history || history.length === 0) return;
      
      const previous = history[history.length - 1];
      const changePercent = ((current.liquidityUsd - previous.liquidityUsd) / previous.liquidityUsd) * 100;
      
      if (changePercent <= this.LIQUIDITY_DRAIN_THRESHOLD) {
        this.createAlert({
          type: 'liquidity_drain',
          mintAddress,
          timestamp: new Date(),
          currentLiquidity: current.liquidityUsd,
          previousLiquidity: previous.liquidityUsd,
          changePercent,
          severity: 'high',
          message: `Significant liquidity drain: ${Math.abs(changePercent).toFixed(1)}% decrease`
        });
      } else if (changePercent >= this.LIQUIDITY_SPIKE_THRESHOLD) {
        this.createAlert({
          type: 'liquidity_spike',
          mintAddress,
          timestamp: new Date(),
          currentLiquidity: current.liquidityUsd,
          previousLiquidity: previous.liquidityUsd,
          changePercent,
          severity: 'low',
          message: `Liquidity spike: ${changePercent.toFixed(1)}% increase`
        });
      }
    } catch (error) {
      // Silent error
    }
  }

  /**
   * Calculate liquidity in USD
   */
  private calculateLiquidityUsd(snapshot: LiquiditySnapshot): number {
    try {
      const solReserves = Number(snapshot.virtualSolReserves) / 1e9;
      const solPrice = snapshot.priceUsd / snapshot.priceSol; // SOL price in USD
      return solReserves * solPrice * 2; // Total liquidity is 2x SOL value
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate price impact
   */
  private calculatePriceImpact(snapshot: LiquiditySnapshot, tradeSizeSol: number): number {
    try {
      const k = Number(snapshot.virtualSolReserves) * Number(snapshot.virtualTokenReserves);
      const currentSol = Number(snapshot.virtualSolReserves) / 1e9;
      const currentToken = Number(snapshot.virtualTokenReserves) / 1e6;
      
      // Calculate new reserves after trade
      const newSol = currentSol + tradeSizeSol;
      const newToken = k / (newSol * 1e9) / 1e6;
      
      // Calculate prices
      const currentPrice = currentSol / currentToken;
      const newPrice = newSol / newToken;
      
      // Price impact percentage
      return ((newPrice - currentPrice) / currentPrice) * 100;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate market depth
   */
  private async calculateDepth(snapshot: LiquiditySnapshot): Promise<LiquiditySnapshot['depth']> {
    // Simplified depth calculation based on liquidity
    const depth = {
      buy: [] as Array<{ price: number; size: number; total: number }>,
      sell: [] as Array<{ price: number; size: number; total: number }>
    };
    
    // Generate synthetic depth based on liquidity
    const basePrice = snapshot.priceSol;
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2]; // Price steps
    
    for (const step of steps) {
      // Buy side (lower prices)
      const buyPrice = basePrice * (1 - step);
      const buySize = snapshot.liquidityUsd * step * 0.1; // Simplified
      depth.buy.push({
        price: buyPrice,
        size: buySize,
        total: buySize
      });
      
      // Sell side (higher prices)
      const sellPrice = basePrice * (1 + step);
      const sellSize = snapshot.liquidityUsd * step * 0.1;
      depth.sell.push({
        price: sellPrice,
        size: sellSize,
        total: sellSize
      });
    }
    
    return depth;
  }

  /**
   * Calculate trend
   */
  private calculateTrend(mintAddress: string, snapshots: LiquiditySnapshot[]): LiquidityTrend | null {
    if (snapshots.length < 2) return null;
    
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    
    const liquidities = snapshots.map(s => s.liquidityUsd);
    const avgLiquidity = liquidities.reduce((a, b) => a + b, 0) / liquidities.length;
    const minLiquidity = Math.min(...liquidities);
    const maxLiquidity = Math.max(...liquidities);
    
    const changePercent = ((last.liquidityUsd - first.liquidityUsd) / first.liquidityUsd) * 100;
    
    // Calculate volatility
    const variance = liquidities.reduce((sum, liq) => 
      sum + Math.pow(liq - avgLiquidity, 2), 0
    ) / liquidities.length;
    const volatility = Math.sqrt(variance) / avgLiquidity;
    
    // Determine trend
    let trend: 'increasing' | 'decreasing' | 'stable';
    if (changePercent > 10) trend = 'increasing';
    else if (changePercent < -10) trend = 'decreasing';
    else trend = 'stable';
    
    return {
      mintAddress,
      timeWindow: {
        start: first.timestamp,
        end: last.timestamp
      },
      startLiquidity: first.liquidityUsd,
      endLiquidity: last.liquidityUsd,
      liquidityChange: last.liquidityUsd - first.liquidityUsd,
      liquidityChangePercent: changePercent,
      avgLiquidity,
      minLiquidity,
      maxLiquidity,
      volatility,
      trend
    };
  }

  /**
   * Calculate volatility
   */
  private calculateVolatility(snapshots: LiquiditySnapshot[]): number {
    if (snapshots.length < 2) return 0;
    
    const liquidities = snapshots.map(s => s.liquidityUsd);
    const avg = liquidities.reduce((a, b) => a + b, 0) / liquidities.length;
    
    const variance = liquidities.reduce((sum, liq) => 
      sum + Math.pow(liq - avg, 2), 0
    ) / liquidities.length;
    
    return Math.sqrt(variance) / avg;
  }

  /**
   * Analyze market depth
   */
  private async analyzeDepth(
    mintAddress: string, 
    snapshot: LiquiditySnapshot
  ): Promise<DepthAnalysis> {
    const depth = snapshot.depth || await this.calculateDepth(snapshot);
    
    const bidDepth = depth.buy.reduce((sum, level) => sum + level.size, 0);
    const askDepth = depth.sell.reduce((sum, level) => sum + level.size, 0);
    const depthRatio = bidDepth / (askDepth || 1);
    
    // Calculate spread
    const bestBid = depth.buy[0]?.price || 0;
    const bestAsk = depth.sell[0]?.price || 0;
    const spread = bestAsk > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : 0;
    
    // Calculate resilience score (0-100)
    const liquidityScore = Math.min(snapshot.liquidityUsd / 10000, 1) * 30; // Up to 30 points
    const depthScore = Math.min(depthRatio / 2, 1) * 30; // Up to 30 points  
    const spreadScore = Math.max(0, (5 - spread) / 5) * 20; // Up to 20 points
    const volumeScore = Math.min(snapshot.volumeLast24h / 100000, 1) * 20; // Up to 20 points
    
    const resilience = Math.round(liquidityScore + depthScore + spreadScore + volumeScore);
    
    // Determine manipulation risk
    let manipulationRisk: 'low' | 'medium' | 'high';
    if (resilience > 70 && snapshot.liquidityUsd > 50000) {
      manipulationRisk = 'low';
    } else if (resilience > 40 || snapshot.liquidityUsd > 10000) {
      manipulationRisk = 'medium';
    } else {
      manipulationRisk = 'high';
    }
    
    return {
      mintAddress,
      timestamp: new Date(),
      bidDepth,
      askDepth,
      depthRatio,
      spread,
      resilience,
      manipulationRisk
    };
  }

  /**
   * Create alert
   */
  private createAlert(alert: LiquidityAlert): void {
    this.liquidityAlerts.push(alert);
    
    // Keep only recent alerts
    if (this.liquidityAlerts.length > 1000) {
      this.liquidityAlerts = this.liquidityAlerts.slice(-1000);
    }
    
    // Emit alert
    this.eventBus.emit('liquidity:alert', alert);
    
    // Store in database
    this.storeAlert(alert);
    
    this.logger.warn('Liquidity alert', {
      type: alert.type,
      mint: alert.mintAddress,
      severity: alert.severity,
      message: alert.message
    });
  }

  /**
   * Store snapshots in database
   */
  private async storeSnapshots(snapshots: LiquiditySnapshot[]): Promise<void> {
    try {
      for (const snapshot of snapshots) {
        await db.query(`
          INSERT INTO liquidity_snapshots (
            mint_address, slot, virtual_sol_reserves, virtual_token_reserves,
            real_sol_reserves, real_token_reserves, price_sol, price_usd,
            liquidity_usd, market_cap_usd, volume_24h, trades_24h,
            price_impact_1_sol, price_impact_10_sol, depth_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (mint_address, slot) DO NOTHING
        `, [
          snapshot.mintAddress,
          snapshot.slot.toString(),
          snapshot.virtualSolReserves.toString(),
          snapshot.virtualTokenReserves.toString(),
          snapshot.realSolReserves.toString(),
          snapshot.realTokenReserves.toString(),
          snapshot.priceSol,
          snapshot.priceUsd,
          snapshot.liquidityUsd,
          snapshot.marketCapUsd,
          snapshot.volumeLast24h,
          snapshot.tradesLast24h,
          snapshot.priceImpact1Sol,
          snapshot.priceImpact10Sol,
          JSON.stringify(snapshot.depth)
        ]);
      }
    } catch (error) {
      this.logger.error('Error storing snapshots', error as Error);
    }
  }

  /**
   * Store alert in database
   */
  private async storeAlert(alert: LiquidityAlert): Promise<void> {
    try {
      await db.query(`
        INSERT INTO liquidity_alerts (
          alert_type, mint_address, token_symbol, current_liquidity,
          previous_liquidity, change_percent, severity, message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        alert.type,
        alert.mintAddress,
        alert.tokenSymbol || null,
        alert.currentLiquidity,
        alert.previousLiquidity,
        alert.changePercent,
        alert.severity,
        alert.message
      ]);
    } catch (error) {
      this.logger.error('Error storing alert', error as Error);
    }
  }

  /**
   * Store depth analysis
   */
  private async storeDepthAnalysis(analysis: DepthAnalysis): Promise<void> {
    try {
      await db.query(`
        INSERT INTO depth_analysis (
          mint_address, bid_depth, ask_depth, depth_ratio,
          spread, resilience_score, manipulation_risk, analysis_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        analysis.mintAddress,
        analysis.bidDepth,
        analysis.askDepth,
        analysis.depthRatio,
        analysis.spread,
        analysis.resilience,
        analysis.manipulationRisk,
        JSON.stringify({
          timestamp: analysis.timestamp,
          details: 'Depth analysis results'
        })
      ]);
    } catch (error) {
      this.logger.error('Error storing depth analysis', error as Error);
    }
  }

  /**
   * Load recent snapshots from database
   */
  private async loadRecentSnapshots(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT DISTINCT ON (mint_address) 
          mint_address, slot, virtual_sol_reserves, virtual_token_reserves,
          real_sol_reserves, real_token_reserves, price_sol, price_usd,
          liquidity_usd, market_cap_usd, volume_24h, trades_24h,
          price_impact_1_sol, price_impact_10_sol
        FROM liquidity_snapshots
        WHERE created_at > NOW() - INTERVAL '1 hour'
        ORDER BY mint_address, created_at DESC
      `);
      
      for (const row of result.rows) {
        const snapshot: LiquiditySnapshot = {
          mintAddress: row.mint_address,
          slot: BigInt(row.slot),
          timestamp: new Date(),
          virtualSolReserves: BigInt(row.virtual_sol_reserves),
          virtualTokenReserves: BigInt(row.virtual_token_reserves),
          realSolReserves: BigInt(row.real_sol_reserves),
          realTokenReserves: BigInt(row.real_token_reserves),
          priceSol: parseFloat(row.price_sol),
          priceUsd: parseFloat(row.price_usd),
          liquidityUsd: parseFloat(row.liquidity_usd),
          marketCapUsd: parseFloat(row.market_cap_usd),
          volumeLast24h: parseFloat(row.volume_24h),
          tradesLast24h: parseInt(row.trades_24h),
          priceImpact1Sol: parseFloat(row.price_impact_1_sol),
          priceImpact10Sol: parseFloat(row.price_impact_10_sol),
          depth: { buy: [], sell: [] }
        };
        
        this.currentLiquidity.set(row.mint_address, snapshot);
      }
    } catch (error) {
      this.logger.error('Error loading snapshots', error as Error);
    }
  }

  /**
   * Create empty snapshot
   */
  private createEmptySnapshot(mintAddress: string): LiquiditySnapshot {
    return {
      mintAddress,
      slot: 0n,
      timestamp: new Date(),
      virtualSolReserves: 0n,
      virtualTokenReserves: 0n,
      realSolReserves: 0n,
      realTokenReserves: 0n,
      priceSol: 0,
      priceUsd: 0,
      liquidityUsd: 0,
      marketCapUsd: 0,
      volumeLast24h: 0,
      tradesLast24h: 0,
      priceImpact1Sol: 0,
      priceImpact10Sol: 0,
      depth: { buy: [], sell: [] }
    };
  }

  /**
   * Get current liquidity
   */
  getCurrentLiquidity(mintAddress: string): LiquiditySnapshot | undefined {
    return this.currentLiquidity.get(mintAddress);
  }

  /**
   * Get liquidity history
   */
  getLiquidityHistory(mintAddress: string): LiquiditySnapshot[] {
    return this.liquiditySnapshots.get(mintAddress) || [];
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 100): LiquidityAlert[] {
    return this.liquidityAlerts.slice(-limit);
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    // Clean up old snapshots from memory
    for (const [mint, snapshots] of this.liquiditySnapshots) {
      const recent = snapshots.filter(s => s.timestamp.getTime() > oneHourAgo);
      if (recent.length === 0) {
        this.liquiditySnapshots.delete(mint);
      } else {
        this.liquiditySnapshots.set(mint, recent);
      }
    }
    
    // Clean up old alerts
    this.liquidityAlerts = this.liquidityAlerts.filter(a => 
      a.timestamp.getTime() > oneHourAgo
    );
    
    this.logger.debug('Cleaned up old liquidity data', {
      remainingTokens: this.currentLiquidity.size,
      remainingAlerts: this.liquidityAlerts.length
    });
  }
}