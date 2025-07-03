import { EventEmitter } from 'events';

export interface BCMonitorStats {
  // Connection stats
  connected: boolean;
  connectionUptime: number;
  lastConnected: Date | null;
  reconnectAttempts: number;

  // Transaction stats
  totalTransactions: number;
  transactionsPerSecond: number;
  averageProcessingTime: number;

  // Trade stats
  totalTrades: number;
  buyCount: number;
  sellCount: number;
  parseSuccessRate: number;
  tradesPerMinute: number;

  // Token stats
  uniqueTokens: number;
  tokensAboveThreshold: number;
  totalVolume: number;
  graduatedTokens: number;
  nearGraduation: number;

  // New token detection (Phase 6)
  newTokensDetected: number;
  uniqueCreators: number;
  tokensEnriched: number;

  // Database stats
  queueSize: number;
  savedTokens: number;
  savedTrades: number;
  lastSaveTime: Date | null;

  // Error stats
  totalErrors: number;
  parseErrors: number;
  databaseErrors: number;
  connectionErrors: number;

  // Performance stats
  memoryUsageMB: number;
  cpuUsagePercent: number;
  uptimeSeconds: number;
}

export interface RecentActivity {
  trades: TradeActivity[];
  graduations: GraduationActivity[];
  newTokens: NewTokenActivity[];
  errors: ErrorActivity[];
}

export interface TradeActivity {
  timestamp: Date;
  type: 'buy' | 'sell';
  mint: string;
  symbol?: string;
  amount: number;
  priceUsd: number;
  marketCapUsd: number;
  signature: string;
}

export interface GraduationActivity {
  timestamp: Date;
  mint: string;
  symbol?: string;
  finalSol: number;
  marketCapUsd: number;
}

export interface NewTokenActivity {
  timestamp: Date;
  mint: string;
  creator: string;
  supply: number;
  hasMetadata: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ErrorActivity {
  timestamp: Date;
  type: string;
  message: string;
  count: number;
}

export class BCMonitorStatsAggregator extends EventEmitter {
  private stats: BCMonitorStats;
  private recentActivity: RecentActivity;
  private startTime: Date;
  private statHistory: Map<string, number[]> = new Map();
  private readonly HISTORY_SIZE = 60; // Keep 60 data points for graphs
  private readonly ACTIVITY_SIZE = 50; // Keep last 50 activities

  constructor() {
    super();
    this.startTime = new Date();
    this.stats = this.initializeStats();
    this.recentActivity = this.initializeActivity();
    this.startHistoryTracking();
  }

  private initializeStats(): BCMonitorStats {
    return {
      connected: false,
      connectionUptime: 0,
      lastConnected: null,
      reconnectAttempts: 0,
      totalTransactions: 0,
      transactionsPerSecond: 0,
      averageProcessingTime: 0,
      totalTrades: 0,
      buyCount: 0,
      sellCount: 0,
      parseSuccessRate: 0,
      tradesPerMinute: 0,
      uniqueTokens: 0,
      tokensAboveThreshold: 0,
      totalVolume: 0,
      graduatedTokens: 0,
      nearGraduation: 0,
      newTokensDetected: 0,
      uniqueCreators: 0,
      tokensEnriched: 0,
      queueSize: 0,
      savedTokens: 0,
      savedTrades: 0,
      lastSaveTime: null,
      totalErrors: 0,
      parseErrors: 0,
      databaseErrors: 0,
      connectionErrors: 0,
      memoryUsageMB: 0,
      cpuUsagePercent: 0,
      uptimeSeconds: 0
    };
  }

  private initializeActivity(): RecentActivity {
    return {
      trades: [],
      graduations: [],
      newTokens: [],
      errors: []
    };
  }

  /**
   * Update stats from bc-monitor
   */
  updateStats(updates: Partial<BCMonitorStats>): void {
    Object.assign(this.stats, updates);
    
    // Update derived stats
    this.stats.uptimeSeconds = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    this.stats.memoryUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;
    
    this.emit('stats-updated', this.stats);
  }

  /**
   * Add trade activity
   */
  addTradeActivity(trade: TradeActivity): void {
    this.recentActivity.trades.unshift(trade);
    if (this.recentActivity.trades.length > this.ACTIVITY_SIZE) {
      this.recentActivity.trades.pop();
    }
    
    // Update trade stats
    if (trade.type === 'buy') {
      this.stats.buyCount++;
    } else {
      this.stats.sellCount++;
    }
    this.stats.totalTrades++;
    this.stats.totalVolume += trade.priceUsd;
    
    this.emit('trade-activity', trade);
  }

  /**
   * Add graduation activity
   */
  addGraduationActivity(graduation: GraduationActivity): void {
    this.recentActivity.graduations.unshift(graduation);
    if (this.recentActivity.graduations.length > this.ACTIVITY_SIZE) {
      this.recentActivity.graduations.pop();
    }
    
    this.stats.graduatedTokens++;
    this.emit('graduation-activity', graduation);
  }

  /**
   * Add new token activity
   */
  addNewTokenActivity(token: NewTokenActivity): void {
    this.recentActivity.newTokens.unshift(token);
    if (this.recentActivity.newTokens.length > this.ACTIVITY_SIZE) {
      this.recentActivity.newTokens.pop();
    }
    
    this.stats.newTokensDetected++;
    this.emit('new-token-activity', token);
  }

  /**
   * Add error activity
   */
  addErrorActivity(error: ErrorActivity): void {
    // Group similar errors
    const existing = this.recentActivity.errors.find(
      e => e.type === error.type && e.message === error.message
    );
    
    if (existing) {
      existing.count++;
      existing.timestamp = error.timestamp;
    } else {
      this.recentActivity.errors.unshift(error);
      if (this.recentActivity.errors.length > this.ACTIVITY_SIZE) {
        this.recentActivity.errors.pop();
      }
    }
    
    this.stats.totalErrors++;
    this.emit('error-activity', error);
  }

  /**
   * Get current stats
   */
  getStats(): BCMonitorStats {
    return { ...this.stats };
  }

  /**
   * Get recent activity
   */
  getRecentActivity(): RecentActivity {
    return {
      trades: [...this.recentActivity.trades],
      graduations: [...this.recentActivity.graduations],
      newTokens: [...this.recentActivity.newTokens],
      errors: [...this.recentActivity.errors]
    };
  }

  /**
   * Get stat history for graphs
   */
  getStatHistory(statName: string): number[] {
    return [...(this.statHistory.get(statName) || [])];
  }

  /**
   * Track stat history for graphs
   */
  private startHistoryTracking(): void {
    setInterval(() => {
      // Track key metrics
      this.trackHistory('transactionsPerSecond', this.stats.transactionsPerSecond);
      this.trackHistory('tradesPerMinute', this.stats.tradesPerMinute);
      this.trackHistory('parseSuccessRate', this.stats.parseSuccessRate);
      this.trackHistory('queueSize', this.stats.queueSize);
      this.trackHistory('memoryUsageMB', this.stats.memoryUsageMB);
    }, 1000); // Every second
  }

  private trackHistory(key: string, value: number): void {
    const history = this.statHistory.get(key) || [];
    history.push(value);
    
    if (history.length > this.HISTORY_SIZE) {
      history.shift();
    }
    
    this.statHistory.set(key, history);
  }

  /**
   * Calculate performance metrics
   */
  calculatePerformanceMetrics(): any {
    const txHistory = this.getStatHistory('transactionsPerSecond');
    const parseHistory = this.getStatHistory('parseSuccessRate');
    
    return {
      avgTransactionsPerSecond: txHistory.reduce((a, b) => a + b, 0) / txHistory.length || 0,
      minTransactionsPerSecond: Math.min(...txHistory) || 0,
      maxTransactionsPerSecond: Math.max(...txHistory) || 0,
      avgParseSuccessRate: parseHistory.reduce((a, b) => a + b, 0) / parseHistory.length || 0,
      currentMemoryUsage: this.stats.memoryUsageMB,
      uptime: this.stats.uptimeSeconds
    };
  }

  /**
   * Get dashboard summary
   */
  getDashboardSummary(): any {
    return {
      stats: this.getStats(),
      recentActivity: this.getRecentActivity(),
      performance: this.calculatePerformanceMetrics(),
      graphs: {
        transactionsPerSecond: this.getStatHistory('transactionsPerSecond'),
        tradesPerMinute: this.getStatHistory('tradesPerMinute'),
        parseSuccessRate: this.getStatHistory('parseSuccessRate'),
        queueSize: this.getStatHistory('queueSize'),
        memoryUsage: this.getStatHistory('memoryUsageMB')
      }
    };
  }

  /**
   * Reset stats
   */
  reset(): void {
    this.stats = this.initializeStats();
    this.recentActivity = this.initializeActivity();
    this.statHistory.clear();
    this.startTime = new Date();
  }
}

// Singleton instance
export const bcMonitorStats = new BCMonitorStatsAggregator();