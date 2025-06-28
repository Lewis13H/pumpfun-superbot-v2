/**
 * Enhanced Statistics Tracking for BC Monitor
 * 
 * Provides comprehensive metrics for monitoring health,
 * performance, and data quality during extended test runs.
 */

import chalk from 'chalk';

export interface EnhancedStats {
  // Connection metrics
  connection: {
    status: 'connecting' | 'connected' | 'disconnected' | 'error';
    startTime: Date;
    lastDataReceived: Date;
    disconnections: number;
    reconnections: number;
    lastError?: string;
    streamHealth: number; // percentage
    avgLatency: number; // ms
  };
  
  // Transaction metrics
  transactions: {
    received: number;
    tradesDetected: number;
    parseErrors: number;
    errorRate: number; // percentage
    avgTradesPerTx: number;
  };
  
  // Trade analysis
  trades: {
    buys: number;
    sells: number;
    unknown: number;
    uniqueMints: Set<string>;
    userAddresses: Set<string>;
    totalVolumeUsd: number;
    avgTradeSize: number;
  };
  
  // Price and market cap
  marketData: {
    currentSolPrice: number;
    highestMarketCap: number;
    lowestMarketCap: number;
    aboveThresholdCount: number;
    uniqueAboveThreshold: Set<string>;
    marketCapDistribution: {
      under1k: number;
      '1kTo10k': number;
      '10kTo50k': number;
      '50kTo100k': number;
      over100k: number;
    };
  };
  
  // Database performance
  database: {
    tokensDiscovered: number;
    tokensSaved: number;
    tradesSaved: number;
    batchQueueSize: number;
    avgBatchProcessTime: number;
    cacheHitRate: number;
    totalBatches: number;
    failedBatches: number;
  };
  
  // Progress tracking
  progress: {
    trackedTokens: number;
    nearGraduation: number;
    graduationsDetected: number;
    progressDistribution: {
      '0to25': number;
      '25to50': number;
      '50to75': number;
      '75to90': number;
      '90to100': number;
    };
  };
  
  // System health
  system: {
    memoryUsageMB: number;
    peakMemoryMB: number;
    cpuUsagePercent: number;
    networkBytesReceived: number;
    errorTypes: Map<string, number>;
  };
}

export class MonitorStatsTracker {
  private stats: EnhancedStats;
  private startMemory: number;
  private batchTimings: number[] = [];
  private latencyMeasurements: number[] = [];
  
  constructor() {
    this.startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    this.stats = this.initializeStats();
  }
  
  private initializeStats(): EnhancedStats {
    return {
      connection: {
        status: 'connecting',
        startTime: new Date(),
        lastDataReceived: new Date(),
        disconnections: 0,
        reconnections: 0,
        streamHealth: 100,
        avgLatency: 0
      },
      transactions: {
        received: 0,
        tradesDetected: 0,
        parseErrors: 0,
        errorRate: 0,
        avgTradesPerTx: 0
      },
      trades: {
        buys: 0,
        sells: 0,
        unknown: 0,
        uniqueMints: new Set(),
        userAddresses: new Set(),
        totalVolumeUsd: 0,
        avgTradeSize: 0
      },
      marketData: {
        currentSolPrice: 180,
        highestMarketCap: 0,
        lowestMarketCap: Infinity,
        aboveThresholdCount: 0,
        uniqueAboveThreshold: new Set(),
        marketCapDistribution: {
          under1k: 0,
          '1kTo10k': 0,
          '10kTo50k': 0,
          '50kTo100k': 0,
          over100k: 0
        }
      },
      database: {
        tokensDiscovered: 0,
        tokensSaved: 0,
        tradesSaved: 0,
        batchQueueSize: 0,
        avgBatchProcessTime: 0,
        cacheHitRate: 0,
        totalBatches: 0,
        failedBatches: 0
      },
      progress: {
        trackedTokens: 0,
        nearGraduation: 0,
        graduationsDetected: 0,
        progressDistribution: {
          '0to25': 0,
          '25to50': 0,
          '50to75': 0,
          '75to90': 0,
          '90to100': 0
        }
      },
      system: {
        memoryUsageMB: 0,
        peakMemoryMB: 0,
        cpuUsagePercent: 0,
        networkBytesReceived: 0,
        errorTypes: new Map()
      }
    };
  }
  
  // Update methods
  updateConnection(status: 'connecting' | 'connected' | 'disconnected' | 'error') {
    this.stats.connection.status = status;
    if (status === 'disconnected') {
      this.stats.connection.disconnections++;
    } else if (status === 'connected' && this.stats.connection.disconnections > 0) {
      this.stats.connection.reconnections++;
    }
  }
  
  recordDataReceived() {
    this.stats.connection.lastDataReceived = new Date();
    this.updateStreamHealth();
  }
  
  recordTransaction() {
    this.stats.transactions.received++;
  }
  
  recordTrade(type: 'buy' | 'sell' | 'unknown', mint: string, user: string, volumeUsd: number) {
    this.stats.transactions.tradesDetected++;
    this.stats.trades[type === 'unknown' ? 'unknown' : type + 's' as 'buys' | 'sells']++;
    this.stats.trades.uniqueMints.add(mint);
    this.stats.trades.userAddresses.add(user);
    this.stats.trades.totalVolumeUsd += volumeUsd;
    
    // Update average
    this.stats.trades.avgTradeSize = 
      this.stats.trades.totalVolumeUsd / this.stats.transactions.tradesDetected;
    
    // Update trades per transaction
    this.stats.transactions.avgTradesPerTx = 
      this.stats.transactions.tradesDetected / Math.max(1, this.stats.transactions.received);
  }
  
  recordParseError() {
    this.stats.transactions.parseErrors++;
    this.updateErrorRate();
  }
  
  recordMarketCap(marketCap: number, mint: string) {
    // Update highest/lowest
    if (marketCap > this.stats.marketData.highestMarketCap) {
      this.stats.marketData.highestMarketCap = marketCap;
    }
    if (marketCap < this.stats.marketData.lowestMarketCap) {
      this.stats.marketData.lowestMarketCap = marketCap;
    }
    
    // Track threshold
    if (marketCap >= 8888) {
      this.stats.marketData.aboveThresholdCount++;
      this.stats.marketData.uniqueAboveThreshold.add(mint);
    }
    
    // Update distribution
    if (marketCap < 1000) {
      this.stats.marketData.marketCapDistribution.under1k++;
    } else if (marketCap < 10000) {
      this.stats.marketData.marketCapDistribution['1kTo10k']++;
    } else if (marketCap < 50000) {
      this.stats.marketData.marketCapDistribution['10kTo50k']++;
    } else if (marketCap < 100000) {
      this.stats.marketData.marketCapDistribution['50kTo100k']++;
    } else {
      this.stats.marketData.marketCapDistribution.over100k++;
    }
  }
  
  recordProgress(progress: number) {
    if (progress <= 25) {
      this.stats.progress.progressDistribution['0to25']++;
    } else if (progress <= 50) {
      this.stats.progress.progressDistribution['25to50']++;
    } else if (progress <= 75) {
      this.stats.progress.progressDistribution['50to75']++;
    } else if (progress <= 90) {
      this.stats.progress.progressDistribution['75to90']++;
    } else {
      this.stats.progress.progressDistribution['90to100']++;
    }
  }
  
  recordGraduation() {
    this.stats.progress.graduationsDetected++;
  }
  
  recordBatchProcessing(duration: number, success: boolean = true) {
    this.batchTimings.push(duration);
    this.stats.database.totalBatches++;
    if (!success) {
      this.stats.database.failedBatches++;
    }
    
    // Keep last 100 timings
    if (this.batchTimings.length > 100) {
      this.batchTimings.shift();
    }
    
    // Update average
    this.stats.database.avgBatchProcessTime = 
      this.batchTimings.reduce((a, b) => a + b, 0) / this.batchTimings.length;
  }
  
  updateDatabaseStats(dbStats: any) {
    this.stats.database.tokensDiscovered = dbStats.discoveredTokens || 0;
    this.stats.database.tokensSaved = dbStats.dbStats?.tokensTracked || 0;
    this.stats.database.tradesSaved = dbStats.dbStats?.tradesProcessed || 0;
    this.stats.database.batchQueueSize = dbStats.dbStats?.queueSize || 0;
    this.stats.database.cacheHitRate = dbStats.dbStats?.cacheHitRate || 0;
  }
  
  updateProgressStats(progressStats: any) {
    this.stats.progress.trackedTokens = progressStats.trackedTokens || 0;
    this.stats.progress.nearGraduation = progressStats.graduationCandidates || 0;
  }
  
  recordError(type: string) {
    const count = this.stats.system.errorTypes.get(type) || 0;
    this.stats.system.errorTypes.set(type, count + 1);
  }
  
  updateSolPrice(price: number) {
    this.stats.marketData.currentSolPrice = price;
  }
  
  // Calculate derived metrics
  private updateErrorRate() {
    const total = this.stats.transactions.received;
    if (total > 0) {
      this.stats.transactions.errorRate = 
        (this.stats.transactions.parseErrors / total) * 100;
    }
  }
  
  private updateStreamHealth() {
    const now = Date.now();
    const lastData = this.stats.connection.lastDataReceived.getTime();
    const age = now - lastData;
    
    // Health degrades if no data for >5 seconds
    if (age < 5000) {
      this.stats.connection.streamHealth = 100;
    } else if (age < 15000) {
      this.stats.connection.streamHealth = 80;
    } else if (age < 30000) {
      this.stats.connection.streamHealth = 50;
    } else {
      this.stats.connection.streamHealth = 0;
    }
  }
  
  updateSystemMetrics() {
    const memUsage = process.memoryUsage();
    this.stats.system.memoryUsageMB = memUsage.heapUsed / 1024 / 1024;
    
    if (this.stats.system.memoryUsageMB > this.stats.system.peakMemoryMB) {
      this.stats.system.peakMemoryMB = this.stats.system.memoryUsageMB;
    }
  }
  
  // Display methods
  displayEnhancedStats() {
    this.updateSystemMetrics();
    const uptime = this.getUptime();
    const dataAge = this.getDataAge();
    
    console.log(chalk.cyan('\n📊 Monitor Statistics (Enhanced):'));
    console.log(chalk.gray('─'.repeat(50)));
    
    // Connection
    console.log(chalk.white.bold('Connection:'));
    console.log(`  Status: ${this.getStatusColor(this.stats.connection.status)}`);
    console.log(`  Uptime: ${chalk.white(uptime)}`);
    console.log(`  Last data: ${chalk.white(dataAge)} ago`);
    console.log(`  Stream health: ${this.getHealthColor(this.stats.connection.streamHealth)}%`);
    
    // Transactions
    console.log(chalk.white.bold('\nTransactions:'));
    console.log(`  Received: ${chalk.yellow(this.stats.transactions.received.toLocaleString())} (~${(this.stats.transactions.received / this.getUptimeSeconds()).toFixed(1)}/sec)`);
    console.log(`  Trades detected: ${chalk.green(this.stats.transactions.tradesDetected.toLocaleString())}`);
    console.log(`  Parse errors: ${chalk.red(this.stats.transactions.parseErrors.toLocaleString())}`);
    console.log(`  Error rate: ${this.getErrorRateColor(this.stats.transactions.errorRate)}`);
    
    // Trade Analysis
    console.log(chalk.white.bold('\nTrade Analysis:'));
    const buyPercent = this.stats.transactions.tradesDetected > 0 
      ? ((this.stats.trades.buys / this.stats.transactions.tradesDetected) * 100).toFixed(1)
      : '0.0';
    const sellPercent = this.stats.transactions.tradesDetected > 0
      ? ((this.stats.trades.sells / this.stats.transactions.tradesDetected) * 100).toFixed(1)
      : '0.0';
    console.log(`  Buys: ${chalk.green(this.stats.trades.buys.toLocaleString())} (${buyPercent}%)`);
    console.log(`  Sells: ${chalk.red(this.stats.trades.sells.toLocaleString())} (${sellPercent}%)`);
    console.log(`  Unique tokens: ${chalk.blue(this.stats.trades.uniqueMints.size.toLocaleString())}`);
    console.log(`  Unique users: ${chalk.cyan(this.stats.trades.userAddresses.size.toLocaleString())}`);
    console.log(`  Detection rate: ${chalk.yellow((this.stats.transactions.avgTradesPerTx * 100).toFixed(1) + '%')}`);
    console.log(`  Avg trades/tx: ${chalk.white(this.stats.transactions.avgTradesPerTx.toFixed(2))}`);
    
    // Price & Market Cap
    console.log(chalk.white.bold('\nPrice & Market Cap:'));
    console.log(`  SOL Price: ${chalk.green('$' + this.stats.marketData.currentSolPrice.toFixed(2))}`);
    console.log(`  Total Volume: ${chalk.yellow(this.formatUSD(this.stats.trades.totalVolumeUsd))}`);
    console.log(`  Avg Trade Size: ${chalk.white(this.formatUSD(this.stats.trades.avgTradeSize))}`);
    console.log(`  Highest MC: ${chalk.cyan(this.formatMarketCap(this.stats.marketData.highestMarketCap))}`);
    console.log(`  Above $8,888: ${chalk.yellow(this.stats.marketData.aboveThresholdCount.toLocaleString())} events`);
    console.log(`  Unique above threshold: ${chalk.green(this.stats.marketData.uniqueAboveThreshold.size.toLocaleString())} tokens`);
    
    // Market Cap Distribution
    console.log(chalk.white.bold('\nMarket Cap Distribution:'));
    const totalMC = Object.values(this.stats.marketData.marketCapDistribution).reduce((a, b) => a + b, 0);
    if (totalMC > 0) {
      console.log(`  <$1K: ${this.getDistributionBar(this.stats.marketData.marketCapDistribution.under1k, totalMC)}`);
      console.log(`  $1K-$10K: ${this.getDistributionBar(this.stats.marketData.marketCapDistribution['1kTo10k'], totalMC)}`);
      console.log(`  $10K-$50K: ${this.getDistributionBar(this.stats.marketData.marketCapDistribution['10kTo50k'], totalMC)}`);
      console.log(`  $50K-$100K: ${this.getDistributionBar(this.stats.marketData.marketCapDistribution['50kTo100k'], totalMC)}`);
      console.log(`  >$100K: ${this.getDistributionBar(this.stats.marketData.marketCapDistribution.over100k, totalMC)}`);
    }
    
    // Database Performance
    console.log(chalk.white.bold('\nDatabase Performance:'));
    console.log(`  Discovered tokens: ${chalk.blue(this.stats.database.tokensDiscovered.toLocaleString())}`);
    console.log(`  Tokens saved: ${chalk.green(this.stats.database.tokensSaved.toLocaleString())}`);
    console.log(`  Trades saved: ${chalk.green(this.stats.database.tradesSaved.toLocaleString())}`);
    console.log(`  Batch queue: ${this.getQueueColor(this.stats.database.batchQueueSize)}`);
    console.log(`  Batch processing: ${chalk.white(this.stats.database.avgBatchProcessTime.toFixed(1) + 'ms')} avg`);
    console.log(`  Cache hit rate: ${chalk.green((this.stats.database.cacheHitRate * 100).toFixed(1) + '%')}`);
    console.log(`  Total batches: ${chalk.yellow(this.stats.database.totalBatches.toLocaleString())}`);
    if (this.stats.database.failedBatches > 0) {
      console.log(`  Failed batches: ${chalk.red(this.stats.database.failedBatches.toLocaleString())}`);
    }
    
    // Progress Tracking
    console.log(chalk.white.bold('\nProgress Tracking:'));
    console.log(`  Tracked tokens: ${chalk.blue(this.stats.progress.trackedTokens.toLocaleString())}`);
    console.log(`  Near graduation: ${chalk.yellow(this.stats.progress.nearGraduation.toLocaleString())}`);
    console.log(`  Graduations: ${chalk.green.bold(this.stats.progress.graduationsDetected.toLocaleString())}`);
    
    // Progress Distribution
    const totalProgress = Object.values(this.stats.progress.progressDistribution).reduce((a, b) => a + b, 0);
    if (totalProgress > 0) {
      console.log(chalk.white.bold('\nBonding Curve Distribution:'));
      console.log(`  0-25%: ${this.getDistributionBar(this.stats.progress.progressDistribution['0to25'], totalProgress)}`);
      console.log(`  25-50%: ${this.getDistributionBar(this.stats.progress.progressDistribution['25to50'], totalProgress)}`);
      console.log(`  50-75%: ${this.getDistributionBar(this.stats.progress.progressDistribution['50to75'], totalProgress)}`);
      console.log(`  75-90%: ${this.getDistributionBar(this.stats.progress.progressDistribution['75to90'], totalProgress)}`);
      console.log(`  90-100%: ${this.getDistributionBar(this.stats.progress.progressDistribution['90to100'], totalProgress)}`);
    }
    
    // System Health
    console.log(chalk.white.bold('\nSystem Health:'));
    console.log(`  Memory usage: ${chalk.white(this.stats.system.memoryUsageMB.toFixed(1) + 'MB')} (peak: ${this.stats.system.peakMemoryMB.toFixed(1)}MB)`);
    console.log(`  Memory growth: ${this.getMemoryGrowthColor()}`);
    console.log(`  Reconnections: ${chalk.yellow(this.stats.connection.reconnections.toLocaleString())}`);
    console.log(`  Total errors: ${chalk.red(this.getTotalErrors().toLocaleString())}`);
    
    // Error breakdown
    if (this.stats.system.errorTypes.size > 0) {
      console.log(chalk.white.bold('\nError Types:'));
      for (const [type, count] of this.stats.system.errorTypes) {
        console.log(`  ${type}: ${chalk.red(count.toLocaleString())}`);
      }
    }
    
    if (this.stats.connection.lastError) {
      console.log(`  Last error: ${chalk.red(this.stats.connection.lastError)}`);
    }
    
    console.log(chalk.gray('─'.repeat(50)));
  }
  
  // Helper methods
  private getUptime(): string {
    const ms = Date.now() - this.stats.connection.startTime.getTime();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  private getUptimeSeconds(): number {
    const ms = Date.now() - this.stats.connection.startTime.getTime();
    return Math.max(1, Math.floor(ms / 1000));
  }
  
  private getDataAge(): string {
    const ms = Date.now() - this.stats.connection.lastDataReceived.getTime();
    const seconds = Math.floor(ms / 1000);
    
    if (seconds < 60) {
      return `${seconds}s`;
    } else {
      return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    }
  }
  
  private getStatusColor(status: string): string {
    switch (status) {
      case 'connected':
        return chalk.green.bold(status.toUpperCase());
      case 'connecting':
        return chalk.yellow(status.toUpperCase());
      case 'disconnected':
        return chalk.gray(status.toUpperCase());
      case 'error':
        return chalk.red(status.toUpperCase());
      default:
        return chalk.white(status.toUpperCase());
    }
  }
  
  private getHealthColor(health: number): string {
    if (health >= 90) return chalk.green(health.toString());
    if (health >= 70) return chalk.yellow(health.toString());
    if (health >= 50) return chalk.orange(health.toString());
    return chalk.red(health.toString());
  }
  
  private getErrorRateColor(rate: number): string {
    const rateStr = rate.toFixed(1) + '%';
    if (rate < 5) return chalk.green(rateStr);
    if (rate < 10) return chalk.yellow(rateStr);
    return chalk.red(rateStr);
  }
  
  private getQueueColor(size: number): string {
    if (size < 50) return chalk.green(size.toLocaleString());
    if (size < 100) return chalk.yellow(size.toLocaleString());
    return chalk.red(size.toLocaleString());
  }
  
  private getDistributionBar(count: number, total: number): string {
    const percent = (count / total) * 100;
    const width = 20;
    const filled = Math.round((percent / 100) * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    return `${chalk.cyan(bar)} ${count.toLocaleString()} (${percent.toFixed(1)}%)`;
  }
  
  private getMemoryGrowthColor(): string {
    const growth = this.stats.system.memoryUsageMB - this.startMemory;
    const growthStr = growth >= 0 ? `+${growth.toFixed(1)}MB` : `${growth.toFixed(1)}MB`;
    
    if (growth < 50) return chalk.green(growthStr);
    if (growth < 100) return chalk.yellow(growthStr);
    return chalk.red(growthStr);
  }
  
  private getTotalErrors(): number {
    let total = this.stats.transactions.parseErrors;
    for (const count of this.stats.system.errorTypes.values()) {
      total += count;
    }
    return total;
  }
  
  private formatUSD(value: number): string {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  }
  
  private formatMarketCap(value: number): string {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    } else {
      return `$${value.toFixed(0)}`;
    }
  }
  
  // Export stats for analysis
  exportStats(): EnhancedStats {
    this.updateSystemMetrics();
    return JSON.parse(JSON.stringify({
      ...this.stats,
      trades: {
        ...this.stats.trades,
        uniqueMints: this.stats.trades.uniqueMints.size,
        userAddresses: this.stats.trades.userAddresses.size
      },
      marketData: {
        ...this.stats.marketData,
        uniqueAboveThreshold: this.stats.marketData.uniqueAboveThreshold.size
      },
      system: {
        ...this.stats.system,
        errorTypes: Array.from(this.stats.system.errorTypes.entries())
      }
    }));
  }
}