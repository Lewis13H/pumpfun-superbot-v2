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
    
    // Configure gRPC channel options for better connection stability
    const channelOptions: ChannelOptions = {
      'grpc.keepalive_time_ms': 60000,
      'grpc.keepalive_timeout_ms': 20000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.initial_reconnect_backoff_ms': 2000,
      'grpc.max_reconnect_backoff_ms': 60000,
      'grpc.client_idle_timeout_ms': 600000,
      'grpc.max_receive_message_length': 50 * 1024 * 1024,
      'grpc.max_send_message_length': 50 * 1024 * 1024,
      'grpc.http2.min_time_between_pings_ms': 60000,
      'grpc.http2.max_pings_without_data': 2,
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
      const startTime = Date.now();
      
      // Perform health check - try to create a stream and immediately close it
      let isHealthy = false;
      try {
        const testStream = await connection.client.subscribe();
        if (testStream) {
          testStream.cancel();
          isHealthy = true;
        }
      } catch (streamError) {
        // Stream creation failed, connection is unhealthy
        isHealthy = false;
      }
      
      const latency = Date.now() - startTime;
      
      // Update metrics
      connection.metrics.lastHealthCheck = new Date();
      connection.metrics.averageLatency = 
        (connection.metrics.averageLatency * 0.9) + (latency * 0.1);

      if (!isHealthy) {
        connection.status = ConnectionStatus.UNHEALTHY;
        this.emit('connectionUnhealthy', connection);
        
        // Attempt reconnection
        await this.reconnectConnection(connection);
      } else if (connection.status === ConnectionStatus.UNHEALTHY) {
        connection.status = ConnectionStatus.IDLE;
        this.emit('connectionRecovered', connection);
      }
    } catch (error) {
      logger.error(`Health check failed for connection ${connection.id}:`, error);
      connection.status = ConnectionStatus.DISCONNECTED;
      connection.metrics.errorRate = Math.min(connection.metrics.errorRate + 0.1, 1);
    }
  }

  private async reconnectConnection(connection: PooledConnection): Promise<void> {
    let retries = 0;
    
    while (retries < this.config.maxRetries) {
      try {
        // Test the connection by trying to create a stream
        const testStream = await connection.client.subscribe();
        if (testStream) {
          testStream.cancel();
          
          connection.status = ConnectionStatus.IDLE;
          connection.metrics.errorRate = 0;
          
          logger.info(`Successfully verified connection ${connection.id}`);
          return;
        }
      } catch (error) {
        retries++;
        logger.warn(`Reconnection attempt ${retries} failed for ${connection.id}`);
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
      }
    }
    
    // Mark as disconnected after all retries fail
    connection.status = ConnectionStatus.DISCONNECTED;
    this.emit('connectionFailed', connection);
  }

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