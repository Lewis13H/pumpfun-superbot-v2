import Client from '@triton-one/yellowstone-grpc';
import { ChannelOptions } from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import { Logger } from '../../core/logger';

const logger = new Logger({ context: 'ConnectionPool' });

export enum ConnectionStatus {
  IDLE = 'idle',
  ACTIVE = 'active',
  UNHEALTHY = 'unhealthy',
  DISCONNECTED = 'disconnected'
}

export interface ConnectionMetrics {
  requestsPerSecond: number;
  averageLatency: number;
  errorRate: number;
  lastHealthCheck: Date;
  activeSubscriptions: number;
}

export interface PooledConnection {
  id: string;
  client: Client;
  status: ConnectionStatus;
  metrics: ConnectionMetrics;
  priority: number;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface ConnectionPoolConfig {
  maxConnections: number;
  minConnections: number;
  healthCheckInterval: number;
  connectionTimeout: number;
  maxRetries: number;
  priorityGroups: {
    high: string[];
    medium: string[];
    low: string[];
  };
}

export class ConnectionPool extends EventEmitter {
  private connections: Map<string, PooledConnection> = new Map();
  private healthCheckTimer?: NodeJS.Timeout;
  private metricsCollectionTimer?: NodeJS.Timeout;
  
  constructor(private config: ConnectionPoolConfig) {
    super();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing connection pool', {
      maxConnections: this.config.maxConnections,
      minConnections: this.config.minConnections
    });

    // Create minimum connections
    for (let i = 0; i < this.config.minConnections; i++) {
      await this.createConnection(`primary-${i}`, i === 0 ? 1 : 2);
    }

    // Start health monitoring
    this.startHealthChecks();
    this.startMetricsCollection();
  }

  private async createConnection(id: string, priority: number): Promise<PooledConnection> {
    logger.info(`Creating connection: ${id}`);
    
    const endpoint = process.env.SHYFT_GRPC_ENDPOINT || '';
    const token = process.env.SHYFT_GRPC_TOKEN || '';
    
    if (!endpoint || !token) {
      throw new Error('Missing SHYFT_GRPC_ENDPOINT or SHYFT_GRPC_TOKEN');
    }
    
    // Ensure endpoint is a valid URL
    let formattedEndpoint = endpoint;
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      formattedEndpoint = `https://${endpoint}`;
    }
    
    // Configure gRPC channel options based on Shyft examples
    const channelOptions: ChannelOptions = {
      'grpc.keepalive_time_ms': 10000,  // Shyft recommended: 10s
      'grpc.keepalive_timeout_ms': 1000, // Shyft recommended: 1s
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.default_compression_algorithm': 2, // Enable compression
      'grpc.initial_reconnect_backoff_ms': 1000, // Start with 1s
      'grpc.max_reconnect_backoff_ms': 30000,    // Max 30s backoff
      'grpc.client_idle_timeout_ms': 600000,
      'grpc.max_receive_message_length': 50 * 1024 * 1024,
      'grpc.max_send_message_length': 50 * 1024 * 1024,
      'grpc.http2.min_time_between_pings_ms': 10000,
      'grpc.http2.max_pings_without_data': 0, // Allow unlimited pings
    };
    
    const client = new Client(formattedEndpoint, token, channelOptions);

    const connection: PooledConnection = {
      id,
      client,
      status: ConnectionStatus.IDLE,
      priority,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      metrics: {
        requestsPerSecond: 0,
        averageLatency: 0,
        errorRate: 0,
        lastHealthCheck: new Date(),
        activeSubscriptions: 0
      }
    };

    this.connections.set(id, connection);
    this.emit('connectionAdded', connection);
    
    return connection;
  }

  async acquireConnection(monitorType: string): Promise<PooledConnection> {
    // Determine priority based on monitor type
    const priority = this.getMonitorPriority(monitorType);
    
    // Find best available connection
    let bestConnection: PooledConnection | null = null;
    let lowestLoad = Infinity;

    for (const connection of this.connections.values()) {
      if (connection.status !== ConnectionStatus.ACTIVE && 
          connection.status !== ConnectionStatus.IDLE) {
        continue;
      }

      // Calculate load score (lower is better)
      const loadScore = this.calculateLoadScore(connection);
      
      // Prefer connections with matching or higher priority
      const priorityBonus = connection.priority <= priority ? 0 : 1000;
      const totalScore = loadScore + priorityBonus;

      if (totalScore < lowestLoad) {
        lowestLoad = totalScore;
        bestConnection = connection;
      }
    }

    if (!bestConnection) {
      // Try to create new connection if under limit
      if (this.connections.size < this.config.maxConnections) {
        const newId = `dynamic-${Date.now()}`;
        bestConnection = await this.createConnection(newId, priority);
      } else {
        throw new Error('No available connections in pool');
      }
    }

    bestConnection.status = ConnectionStatus.ACTIVE;
    bestConnection.lastUsedAt = new Date();
    
    return bestConnection;
  }

  releaseConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection && connection.status === ConnectionStatus.ACTIVE) {
      connection.status = ConnectionStatus.IDLE;
      this.emit('connectionReleased', connection);
    }
  }

  private getMonitorPriority(monitorType: string): number {
    const { priorityGroups } = this.config;
    
    if (priorityGroups.high.includes(monitorType)) return 1;
    if (priorityGroups.medium.includes(monitorType)) return 2;
    if (priorityGroups.low.includes(monitorType)) return 3;
    
    return 2; // Default to medium
  }

  private calculateLoadScore(connection: PooledConnection): number {
    const { metrics } = connection;
    
    // Weighted score based on various metrics
    const rpsWeight = 0.4;
    const latencyWeight = 0.3;
    const errorWeight = 0.2;
    const subscriptionWeight = 0.1;

    const normalizedRps = Math.min(metrics.requestsPerSecond / 100, 1);
    const normalizedLatency = Math.min(metrics.averageLatency / 1000, 1);
    const normalizedSubs = Math.min(metrics.activeSubscriptions / 10, 1);

    return (
      normalizedRps * rpsWeight +
      normalizedLatency * latencyWeight +
      metrics.errorRate * errorWeight +
      normalizedSubs * subscriptionWeight
    ) * 100;
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      for (const connection of this.connections.values()) {
        await this.checkConnectionHealth(connection);
      }
    }, this.config.healthCheckInterval);
  }

  private async checkConnectionHealth(connection: PooledConnection): Promise<void> {
    try {
      // Don't create test subscriptions - this counts towards rate limit!
      // Instead, use connection state and metrics to determine health
      
      const now = Date.now();
      const timeSinceLastUse = now - connection.lastUsedAt.getTime();
      const isStale = timeSinceLastUse > 300000; // 5 minutes
      
      // Update health check timestamp
      connection.metrics.lastHealthCheck = new Date();
      
      // Determine health based on metrics and staleness
      let isHealthy = true;
      
      // Check if connection is stale
      if (isStale && connection.status === ConnectionStatus.IDLE) {
        logger.warn(`Connection ${connection.id} is stale (${Math.round(timeSinceLastUse / 1000)}s since last use)`);
        isHealthy = false;
      }
      
      // Check error rate
      if (connection.metrics.errorRate > 0.5) {
        logger.warn(`Connection ${connection.id} has high error rate: ${(connection.metrics.errorRate * 100).toFixed(1)}%`);
        isHealthy = false;
      }
      
      // Check if we're getting stream errors frequently
      if (connection.status === ConnectionStatus.UNHEALTHY) {
        // Give it time to recover naturally through actual usage
        const timeSinceUnhealthy = now - (connection.metrics.lastHealthCheck?.getTime() || now);
        if (timeSinceUnhealthy < 60000) { // Less than 1 minute
          return; // Don't change status yet
        }
      }

      if (!isHealthy && connection.status !== ConnectionStatus.UNHEALTHY) {
        connection.status = ConnectionStatus.UNHEALTHY;
        this.emit('connectionUnhealthy', connection);
        
        // Don't attempt reconnection here - let actual usage trigger it
        logger.info(`Connection ${connection.id} marked unhealthy, will recover on next use`);
      } else if (isHealthy && connection.status === ConnectionStatus.UNHEALTHY) {
        // Connection recovered through actual usage
        connection.status = ConnectionStatus.IDLE;
        connection.metrics.errorRate = Math.max(0, connection.metrics.errorRate - 0.1);
        this.emit('connectionRecovered', connection);
      }
    } catch (error) {
      logger.error(`Health check failed for connection ${connection.id}:`, error);
      connection.metrics.errorRate = Math.min(connection.metrics.errorRate + 0.1, 1);
    }
  }

  // Unused for now - reconnection handled differently to avoid rate limit issues
  // private async reconnectConnection(connection: PooledConnection): Promise<void> {
  //   // Don't try to reconnect here - this would create unnecessary subscriptions
  //   // Instead, mark for recovery and let actual usage attempt reconnection
  //   
  //   logger.info(`Connection ${connection.id} marked for recovery on next use`);
  //   
  //   // Reset error rate gradually
  //   connection.metrics.errorRate = Math.max(0, connection.metrics.errorRate - 0.2);
  //   
  //   // The connection will be tested when actually used by a monitor
  //   // This avoids creating test subscriptions that count towards rate limit
  // }

  private startMetricsCollection(): void {
    this.metricsCollectionTimer = setInterval(() => {
      // This would collect real metrics from the connections
      // For now, we'll update based on status
      for (const connection of this.connections.values()) {
        if (connection.status === ConnectionStatus.ACTIVE) {
          // Simulate metrics update
          connection.metrics.requestsPerSecond = 
            Math.random() * 50 + (connection.priority === 1 ? 50 : 20);
        } else {
          connection.metrics.requestsPerSecond *= 0.9; // Decay
        }
      }
    }, 1000);
  }

  getConnection(connectionId: string): PooledConnection | undefined {
    return this.connections.get(connectionId);
  }

  getActiveConnections(): PooledConnection[] {
    return Array.from(this.connections.values()).filter(
      conn => conn.status !== ConnectionStatus.DISCONNECTED
    );
  }

  getConnectionStats(): Record<string, any> {
    const stats = {
      total: this.connections.size,
      active: 0,
      idle: 0,
      unhealthy: 0,
      disconnected: 0,
      averageLoad: 0,
      totalRps: 0
    };

    for (const connection of this.connections.values()) {
      switch (connection.status) {
        case ConnectionStatus.ACTIVE:
          stats.active++;
          break;
        case ConnectionStatus.IDLE:
          stats.idle++;
          break;
        case ConnectionStatus.UNHEALTHY:
          stats.unhealthy++;
          break;
        case ConnectionStatus.DISCONNECTED:
          stats.disconnected++;
          break;
      }
      
      stats.totalRps += connection.metrics.requestsPerSecond;
      stats.averageLoad += this.calculateLoadScore(connection);
    }

    stats.averageLoad /= this.connections.size || 1;
    
    return stats;
  }

  /**
   * Get statistics for monitoring (alias for compatibility)
   */
  async getStatistics() {
    const activeConnections = this.getActiveConnections();
    const healthyConnections = activeConnections.filter(conn => 
      conn.status === ConnectionStatus.IDLE || conn.status === ConnectionStatus.ACTIVE
    );
    
    return {
      totalConnections: this.connections.size,
      activeConnections: activeConnections.length,
      healthyConnections: healthyConnections.length,
      connectionDetails: Array.from(this.connections.values()).map(conn => ({
        id: conn.id,
        status: conn.status,
        priority: conn.priority,
        subscriptions: conn.metrics.activeSubscriptions,
        errorRate: conn.metrics.errorRate
      }))
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down connection pool');
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    if (this.metricsCollectionTimer) {
      clearInterval(this.metricsCollectionTimer);
    }

    // Yellowstone clients don't have explicit disconnect
    // Just clear the connections
    this.connections.clear();
    
    this.emit('shutdown');
  }
}