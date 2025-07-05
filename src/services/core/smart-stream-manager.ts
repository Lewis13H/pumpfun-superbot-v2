import { StreamManager, StreamManagerOptions } from '../../core/stream-manager';
import { ConnectionPool, ConnectionPoolConfig, PooledConnection } from './connection-pool';
import { EventBus, EVENTS } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import chalk from 'chalk';

export interface SmartStreamManagerOptions extends Omit<StreamManagerOptions, 'streamClient'> {
  poolConfig: ConnectionPoolConfig;
}

export interface MonitorRegistration {
  monitorId: string;
  monitorType: string;
  programId: string;
  subscriptionConfig?: any;
  connectionId?: string;
}

export class SmartStreamManager extends StreamManager {
  private pool: ConnectionPool;
  private monitorRegistrations: Map<string, MonitorRegistration> = new Map();
  private connectionStreams: Map<string, StreamManager> = new Map();
  private smartLogger: Logger;

  constructor(options: SmartStreamManagerOptions) {
    // Create a dummy client for base class (won't be used)
    super({
      ...options,
      streamClient: { subscribe: () => Promise.resolve() }
    });
    
    this.smartLogger = new Logger({ context: 'SmartStreamManager', color: chalk.cyan });
    this.pool = new ConnectionPool(options.poolConfig);
    
    // Set up pool event listeners
    this.setupPoolEventHandlers();
  }

  private setupPoolEventHandlers(): void {
    this.pool.on('connectionAdded', (connection: PooledConnection) => {
      this.smartLogger.info(`Connection added to pool: ${connection.id}`);
    });

    this.pool.on('connectionUnhealthy', (connection: PooledConnection) => {
      this.smartLogger.warn(`Connection unhealthy: ${connection.id}`);
      this.handleConnectionFailure(connection.id);
    });

    this.pool.on('connectionRecovered', (connection: PooledConnection) => {
      this.smartLogger.info(`Connection recovered: ${connection.id}`);
    });

    this.pool.on('connectionFailed', (connection: PooledConnection) => {
      this.smartLogger.error(`Connection failed: ${connection.id}`);
      this.migrateMonitorsFromConnection(connection.id);
    });
  }

  async initialize(): Promise<void> {
    this.smartLogger.info('Initializing SmartStreamManager with connection pool');
    await this.pool.initialize();
  }

  /**
   * Override subscribeTo to use connection pool
   */
  async subscribeTo(programId: string, subscriptionConfig?: any): Promise<void> {
    // This method is called by monitors, but we need more info
    // For backward compatibility, we'll assign to primary connection
    await this.registerMonitor({
      monitorId: `monitor-${programId}-${Date.now()}`,
      monitorType: this.inferMonitorType(programId),
      programId,
      subscriptionConfig
    });
  }

  /**
   * New method for registering monitors with full information
   */
  async registerMonitor(registration: MonitorRegistration): Promise<void> {
    this.smartLogger.info(`Registering monitor: ${registration.monitorId}`, {
      type: registration.monitorType,
      program: registration.programId
    });

    // Acquire connection from pool
    const connection = await this.pool.acquireConnection(registration.monitorType);
    registration.connectionId = connection.id;

    // Store registration
    this.monitorRegistrations.set(registration.monitorId, registration);

    // Get or create stream manager for this connection
    let streamManager = this.connectionStreams.get(connection.id);
    if (!streamManager) {
      streamManager = this.createStreamManagerForConnection(connection);
      this.connectionStreams.set(connection.id, streamManager);
    }

    // Subscribe through the connection's stream manager
    await streamManager.subscribeTo(registration.programId, registration.subscriptionConfig);
  }

  private createStreamManagerForConnection(connection: PooledConnection): StreamManager {
    // Create a custom event bus that adds connection metadata
    const originalEventBus = (this as any).options.eventBus;
    const wrappedEventBus = {
      emit: (event: string, data: any) => {
        if (event === EVENTS.STREAM_DATA) {
          // Add connection metadata to help monitors identify their data
          originalEventBus.emit(event, {
            ...data,
            connectionId: connection.id,
            connectionPriority: connection.priority
          });
        } else {
          originalEventBus.emit(event, data);
        }
      }
    } as EventBus;

    const streamManager = new StreamManager({
      streamClient: connection.client,
      eventBus: wrappedEventBus,
      reconnectDelay: 5000,
      maxReconnectDelay: 60000
    });

    return streamManager;
  }

  private inferMonitorType(programId: string): string {
    // Infer monitor type from program ID
    // This is for backward compatibility
    if (programId.includes('pump') && !programId.includes('swap')) {
      return 'BC';
    } else if (programId.includes('swap')) {
      return 'AMM';
    } else if (programId.includes('raydium')) {
      return 'Raydium';
    }
    return 'Unknown';
  }

  private async handleConnectionFailure(connectionId: string): Promise<void> {
    // Find monitors using this connection
    const affectedMonitors = Array.from(this.monitorRegistrations.values())
      .filter(reg => reg.connectionId === connectionId);

    if (affectedMonitors.length === 0) return;

    this.smartLogger.warn(`Connection ${connectionId} has issues, attempting to migrate ${affectedMonitors.length} monitors`);

    // Try to migrate to healthy connection
    for (const monitor of affectedMonitors) {
      try {
        // Release current connection
        this.pool.releaseConnection(connectionId);

        // Acquire new connection
        const newConnection = await this.pool.acquireConnection(monitor.monitorType);
        monitor.connectionId = newConnection.id;

        // Re-subscribe on new connection
        await this.registerMonitor(monitor);
        
        this.smartLogger.info(`Successfully migrated monitor ${monitor.monitorId} to connection ${newConnection.id}`);
      } catch (error) {
        this.smartLogger.error(`Failed to migrate monitor ${monitor.monitorId}:`, error);
      }
    }
  }

  private async migrateMonitorsFromConnection(failedConnectionId: string): Promise<void> {
    const streamManager = this.connectionStreams.get(failedConnectionId);
    if (streamManager) {
      await streamManager.stop();
      this.connectionStreams.delete(failedConnectionId);
    }

    await this.handleConnectionFailure(failedConnectionId);
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const baseStats = super.getStats();
    const poolStats = this.pool.getConnectionStats();
    const monitorsByConnection: Record<string, number> = {};

    for (const registration of this.monitorRegistrations.values()) {
      const connId = registration.connectionId || 'unassigned';
      monitorsByConnection[connId] = (monitorsByConnection[connId] || 0) + 1;
    }

    // Return both base stats and extended stats
    return {
      ...baseStats,
      pool: poolStats,
      monitors: {
        total: this.monitorRegistrations.size,
        byConnection: monitorsByConnection
      },
      streams: {
        active: this.connectionStreams.size
      }
    };
  }

  /**
   * Override start to start all connection streams
   */
  async start(): Promise<void> {
    this.smartLogger.info('Starting all connection streams');
    
    const startPromises = Array.from(this.connectionStreams.values()).map(
      stream => stream.start()
    );
    
    await Promise.all(startPromises);
  }

  /**
   * Override stop to stop all streams and shutdown pool
   */
  async stop(): Promise<void> {
    this.smartLogger.info('Stopping SmartStreamManager');

    // Stop all streams
    const stopPromises = Array.from(this.connectionStreams.values()).map(
      stream => stream.stop()
    );
    
    await Promise.all(stopPromises);
    
    // Clear registrations
    this.connectionStreams.clear();
    this.monitorRegistrations.clear();
    
    // Shutdown pool
    await this.pool.shutdown();
  }

  /**
   * Load balancing: Get least loaded connection for a monitor type
   */
  async rebalanceConnections(): Promise<void> {
    this.smartLogger.info('Rebalancing connections across pool');

    const stats = this.pool.getConnectionStats();
    
    // Only rebalance if load is uneven
    if (stats.averageLoad < 50) {
      this.smartLogger.debug('Load is balanced, no rebalancing needed');
      return;
    }

    // Group monitors by connection
    const monitorsByConnection = new Map<string, MonitorRegistration[]>();
    
    for (const monitor of this.monitorRegistrations.values()) {
      const connId = monitor.connectionId || '';
      if (!monitorsByConnection.has(connId)) {
        monitorsByConnection.set(connId, []);
      }
      monitorsByConnection.get(connId)!.push(monitor);
    }

    // Find overloaded connections and migrate some monitors
    for (const [connectionId, monitors] of monitorsByConnection) {
      if (monitors.length > 3) { // Arbitrary threshold
        const toMigrate = monitors.slice(3);
        
        for (const _monitor of toMigrate) {
          try {
            await this.handleConnectionFailure(connectionId);
          } catch (error) {
            this.smartLogger.error(`Failed to migrate monitor during rebalancing:`, error);
          }
        }
      }
    }
  }
}