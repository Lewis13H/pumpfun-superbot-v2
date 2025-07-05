import { EventEmitter } from 'events';
import { Logger } from '../../core/logger';
import { PooledConnection } from './connection-pool';
import { MonitorGroup } from './subscription-builder';
import chalk from 'chalk';

export interface ConnectionMetrics {
  connectionId: string;
  tps: number;
  parseRate: number;
  latency: number;
  messageCount: number;
  errorCount: number;
  lastUpdate: Date;
  load: number; // 0-100 representing load percentage
  subscriptionCount: number;
  bytesProcessed: number;
}

export interface LoadBalancerConfig {
  rebalanceThreshold: number; // Load difference threshold to trigger rebalancing (default: 30%)
  minRebalanceInterval: number; // Minimum time between rebalances in ms (default: 60000)
  loadCalculationInterval: number; // How often to calculate load metrics (default: 5000)
  migrationBatchSize: number; // Max subscriptions to migrate at once (default: 2)
  targetLoadRatio: number; // Target load distribution ratio (default: 0.7)
}

export interface MigrationRequest {
  subscriptionId: string;
  fromConnectionId: string;
  toConnectionId: string;
  reason: string;
}

export class LoadBalancer extends EventEmitter {
  private logger: Logger;
  private config: LoadBalancerConfig;
  private connectionMetrics: Map<string, ConnectionMetrics> = new Map();
  private metricsHistory: Map<string, ConnectionMetrics[]> = new Map();
  private lastRebalanceTime: Date = new Date(0);
  private metricsCollectionTimer?: NodeJS.Timeout;
  private rebalanceTimer?: NodeJS.Timeout;
  private isRebalancing: boolean = false;
  
  // Performance tracking
  private startTimes: Map<string, Map<string, number>> = new Map(); // connection -> messageId -> startTime
  private messageWindows: Map<string, number[]> = new Map(); // connection -> timestamps

  constructor(config: Partial<LoadBalancerConfig> = {}) {
    super();
    this.logger = new Logger({ context: 'LoadBalancer', color: chalk.magenta });
    
    this.config = {
      rebalanceThreshold: config.rebalanceThreshold || 30,
      minRebalanceInterval: config.minRebalanceInterval || 60000,
      loadCalculationInterval: config.loadCalculationInterval || 5000,
      migrationBatchSize: config.migrationBatchSize || 2,
      targetLoadRatio: config.targetLoadRatio || 0.7
    };
  }

  /**
   * Initialize load balancer and start metrics collection
   */
  initialize(connections: PooledConnection[]): void {
    this.logger.info('Initializing load balancer', {
      connectionCount: connections.length,
      config: this.config
    });

    // Initialize metrics for each connection
    connections.forEach(conn => {
      this.connectionMetrics.set(conn.id, {
        connectionId: conn.id,
        tps: 0,
        parseRate: 100,
        latency: 0,
        messageCount: 0,
        errorCount: 0,
        lastUpdate: new Date(),
        load: 0,
        subscriptionCount: 0,
        bytesProcessed: 0
      });

      this.metricsHistory.set(conn.id, []);
      this.startTimes.set(conn.id, new Map());
      this.messageWindows.set(conn.id, []);
    });

    // Start metrics collection
    this.startMetricsCollection();
    
    // Start rebalancing checks
    this.startRebalanceMonitoring();
  }

  /**
   * Record the start of message processing
   */
  recordMessageStart(connectionId: string, messageId: string): void {
    const connectionStarts = this.startTimes.get(connectionId);
    if (connectionStarts) {
      connectionStarts.set(messageId, Date.now());
    }
  }

  /**
   * Record the completion of message processing
   */
  recordMessageComplete(
    connectionId: string, 
    messageId: string, 
    success: boolean = true,
    bytesProcessed: number = 0
  ): void {
    const now = Date.now();
    const connectionStarts = this.startTimes.get(connectionId);
    const startTime = connectionStarts?.get(messageId);
    
    if (!startTime) return;

    // Calculate latency
    const latency = now - startTime;
    connectionStarts?.delete(messageId);

    // Update metrics
    const metrics = this.connectionMetrics.get(connectionId);
    if (!metrics) return;

    // Update message window for TPS calculation
    const window = this.messageWindows.get(connectionId) || [];
    window.push(now);
    
    // Keep only messages from last 5 seconds
    const cutoff = now - 5000;
    const recentMessages = window.filter(t => t > cutoff);
    this.messageWindows.set(connectionId, recentMessages);

    // Update metrics
    metrics.messageCount++;
    if (!success) metrics.errorCount++;
    metrics.bytesProcessed += bytesProcessed;
    
    // Calculate rolling averages
    metrics.latency = metrics.latency * 0.9 + latency * 0.1; // Exponential moving average
    metrics.tps = recentMessages.length / 5; // Messages per second over 5 second window
    metrics.parseRate = metrics.messageCount > 0 
      ? ((metrics.messageCount - metrics.errorCount) / metrics.messageCount) * 100 
      : 100;
    
    metrics.lastUpdate = new Date();
  }

  /**
   * Update subscription count for a connection
   */
  updateSubscriptionCount(connectionId: string, count: number): void {
    const metrics = this.connectionMetrics.get(connectionId);
    if (metrics) {
      metrics.subscriptionCount = count;
    }
  }

  /**
   * Start collecting metrics periodically
   */
  private startMetricsCollection(): void {
    this.metricsCollectionTimer = setInterval(() => {
      this.calculateConnectionLoads();
      this.saveMetricsSnapshot();
      this.emitMetricsUpdate();
    }, this.config.loadCalculationInterval);
  }

  /**
   * Calculate load for each connection
   */
  private calculateConnectionLoads(): void {
    const allMetrics = Array.from(this.connectionMetrics.values());
    
    // Find max values for normalization
    const maxTps = Math.max(...allMetrics.map(m => m.tps), 1);
    const maxLatency = Math.max(...allMetrics.map(m => m.latency), 1);
    const maxBytes = Math.max(...allMetrics.map(m => m.bytesProcessed), 1);
    
    // Calculate load for each connection
    for (const metrics of allMetrics) {
      // Load calculation factors:
      // - 40% TPS (higher is more load)
      // - 30% Latency (higher is more load)
      // - 20% Error rate (higher is more load)
      // - 10% Bytes processed (higher is more load)
      
      const tpsLoad = (metrics.tps / maxTps) * 40;
      const latencyLoad = (metrics.latency / maxLatency) * 30;
      const errorLoad = (100 - metrics.parseRate) * 0.2; // 20% weight
      const bytesLoad = (metrics.bytesProcessed / maxBytes) * 10;
      
      metrics.load = Math.min(100, tpsLoad + latencyLoad + errorLoad + bytesLoad);
      
      this.logger.debug(`Connection ${metrics.connectionId} load: ${metrics.load.toFixed(1)}%`, {
        tps: metrics.tps.toFixed(2),
        latency: `${metrics.latency.toFixed(0)}ms`,
        parseRate: `${metrics.parseRate.toFixed(1)}%`,
        bytes: metrics.bytesProcessed
      });
    }
  }

  /**
   * Save metrics snapshot for historical tracking
   */
  private saveMetricsSnapshot(): void {
    const historyLimit = 12; // Keep 1 minute of history at 5 second intervals
    
    for (const [connId, metrics] of this.connectionMetrics) {
      const history = this.metricsHistory.get(connId) || [];
      history.push({ ...metrics }); // Clone metrics
      
      // Limit history size
      if (history.length > historyLimit) {
        history.shift();
      }
      
      this.metricsHistory.set(connId, history);
    }
  }

  /**
   * Start monitoring for rebalancing needs
   */
  private startRebalanceMonitoring(): void {
    this.rebalanceTimer = setInterval(() => {
      if (!this.isRebalancing && this.shouldRebalance()) {
        this.performRebalancing();
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Check if rebalancing is needed
   */
  private shouldRebalance(): boolean {
    // Check if enough time has passed since last rebalance
    const timeSinceLastRebalance = Date.now() - this.lastRebalanceTime.getTime();
    if (timeSinceLastRebalance < this.config.minRebalanceInterval) {
      return false;
    }

    const loads = Array.from(this.connectionMetrics.values()).map(m => m.load);
    if (loads.length < 2) return false;

    const maxLoad = Math.max(...loads);
    const minLoad = Math.min(...loads);
    const loadDifference = maxLoad - minLoad;

    // Rebalance if load difference exceeds threshold
    if (loadDifference > this.config.rebalanceThreshold) {
      this.logger.info('Rebalancing needed', {
        maxLoad: maxLoad.toFixed(1),
        minLoad: minLoad.toFixed(1),
        difference: loadDifference.toFixed(1),
        threshold: this.config.rebalanceThreshold
      });
      return true;
    }

    return false;
  }

  /**
   * Perform load rebalancing
   */
  private async performRebalancing(): Promise<void> {
    if (this.isRebalancing) return;
    
    this.isRebalancing = true;
    this.lastRebalanceTime = new Date();
    
    try {
      this.logger.info('Starting load rebalancing');
      
      // Get connections sorted by load
      const connectionsByLoad = Array.from(this.connectionMetrics.values())
        .sort((a, b) => b.load - a.load);
      
      if (connectionsByLoad.length < 2) {
        this.logger.warn('Not enough connections for rebalancing');
        return;
      }
      
      // Identify overloaded and underloaded connections
      const overloaded = connectionsByLoad.filter(c => c.load > 70);
      const underloaded = connectionsByLoad.filter(c => c.load < 40);
      
      if (overloaded.length === 0 || underloaded.length === 0) {
        this.logger.debug('No significant load imbalance detected');
        return;
      }
      
      // Create migration plan
      const migrations: MigrationRequest[] = [];
      
      for (const source of overloaded) {
        for (const target of underloaded) {
          // Calculate how many subscriptions to move
          const loadDiff = source.load - target.load;
          if (loadDiff < this.config.rebalanceThreshold) continue;
          
          // Estimate subscriptions to migrate (simplified)
          const subsToMigrate = Math.min(
            Math.ceil(source.subscriptionCount * 0.2), // Move 20% at most
            this.config.migrationBatchSize
          );
          
          if (subsToMigrate > 0) {
            // Get actual subscriptions to migrate
            const sourceGroup = this.getGroupForConnection(source.connectionId);
            
            if (sourceGroup) {
              migrations.push({
                subscriptionId: `batch-${sourceGroup}-${Date.now()}`,
                fromConnectionId: source.connectionId,
                toConnectionId: target.connectionId,
                reason: `Load rebalancing: ${source.load.toFixed(1)}% -> ${target.load.toFixed(1)}%`
              });
            }
            
            // Limit migrations per rebalance
            if (migrations.length >= this.config.migrationBatchSize) break;
          }
        }
        
        if (migrations.length >= this.config.migrationBatchSize) break;
      }
      
      // Execute migrations
      if (migrations.length > 0) {
        this.logger.info(`Executing ${migrations.length} migrations`);
        
        for (const migration of migrations) {
          this.emit('migrationRequired', migration);
        }
        
        // Update metrics after migration
        setTimeout(() => {
          this.calculateConnectionLoads();
          this.logger.info('Rebalancing complete', {
            migrations: migrations.length
          });
        }, 1000);
      } else {
        this.logger.debug('No migrations needed');
      }
      
    } catch (error) {
      this.logger.error('Error during rebalancing', error);
    } finally {
      this.isRebalancing = false;
    }
  }

  /**
   * Get monitor group for a connection (simplified mapping)
   */
  private getGroupForConnection(connectionId: string): MonitorGroup | null {
    // This would be more sophisticated in practice
    if (connectionId.includes('0')) return 'bonding_curve';
    if (connectionId.includes('1')) return 'amm_pool';
    if (connectionId.includes('2')) return 'external_amm';
    return null;
  }

  /**
   * Emit metrics update event
   */
  private emitMetricsUpdate(): void {
    const metrics = Array.from(this.connectionMetrics.values());
    this.emit('metricsUpdate', {
      connections: metrics,
      summary: this.getLoadSummary()
    });
  }

  /**
   * Get load summary statistics
   */
  getLoadSummary(): {
    totalTps: number;
    averageLatency: number;
    averageLoad: number;
    maxLoad: number;
    minLoad: number;
    totalMessages: number;
    totalErrors: number;
    overallParseRate: number;
  } {
    const metrics = Array.from(this.connectionMetrics.values());
    
    if (metrics.length === 0) {
      return {
        totalTps: 0,
        averageLatency: 0,
        averageLoad: 0,
        maxLoad: 0,
        minLoad: 0,
        totalMessages: 0,
        totalErrors: 0,
        overallParseRate: 100
      };
    }
    
    const totalMessages = metrics.reduce((sum, m) => sum + m.messageCount, 0);
    const totalErrors = metrics.reduce((sum, m) => sum + m.errorCount, 0);
    
    return {
      totalTps: metrics.reduce((sum, m) => sum + m.tps, 0),
      averageLatency: metrics.reduce((sum, m) => sum + m.latency, 0) / metrics.length,
      averageLoad: metrics.reduce((sum, m) => sum + m.load, 0) / metrics.length,
      maxLoad: Math.max(...metrics.map(m => m.load)),
      minLoad: Math.min(...metrics.map(m => m.load)),
      totalMessages,
      totalErrors,
      overallParseRate: totalMessages > 0 ? ((totalMessages - totalErrors) / totalMessages) * 100 : 100
    };
  }

  /**
   * Get detailed metrics for a specific connection
   */
  getConnectionMetrics(connectionId: string): ConnectionMetrics | null {
    return this.connectionMetrics.get(connectionId) || null;
  }

  /**
   * Get historical metrics for a connection
   */
  getConnectionHistory(connectionId: string): ConnectionMetrics[] {
    return this.metricsHistory.get(connectionId) || [];
  }

  /**
   * Get load prediction for next interval
   */
  predictLoad(connectionId: string): number {
    const history = this.metricsHistory.get(connectionId);
    if (!history || history.length < 3) {
      return this.connectionMetrics.get(connectionId)?.load || 0;
    }
    
    // Simple linear regression on last 3 data points
    const recentLoads = history.slice(-3).map(m => m.load);
    const trend = (recentLoads[2] - recentLoads[0]) / 2;
    const predicted = recentLoads[2] + trend;
    
    return Math.max(0, Math.min(100, predicted));
  }

  /**
   * Force a rebalance check
   */
  forceRebalance(): void {
    this.logger.info('Force rebalance requested');
    this.lastRebalanceTime = new Date(0); // Reset timer
    if (!this.isRebalancing) {
      this.performRebalancing();
    }
  }

  /**
   * Shutdown the load balancer
   */
  shutdown(): void {
    this.logger.info('Shutting down load balancer');
    
    if (this.metricsCollectionTimer) {
      clearInterval(this.metricsCollectionTimer);
    }
    
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
    }
    
    this.connectionMetrics.clear();
    this.metricsHistory.clear();
    this.startTimes.clear();
    this.messageWindows.clear();
    
    this.removeAllListeners();
  }
}