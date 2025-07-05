import { StreamManager, StreamManagerOptions } from '../../core/stream-manager';
import { ConnectionPool, ConnectionPoolConfig, PooledConnection } from './connection-pool';
import { EventBus, EVENTS } from '../../core/event-bus';
import { Logger } from '../../core/logger';
import { 
  subscriptionBuilder, 
  MonitorGroup
} from './subscription-builder';
import { LoadBalancer, LoadBalancerConfig, MigrationRequest } from './load-balancer';
import chalk from 'chalk';

export interface SmartStreamManagerOptions extends Omit<StreamManagerOptions, 'streamClient'> {
  poolConfig: ConnectionPoolConfig;
  loadBalancerConfig?: Partial<LoadBalancerConfig>;
}

export interface MonitorRegistration {
  monitorId: string;
  monitorType: string;
  group: MonitorGroup;
  programId: string;
  subscriptionConfig?: any;
  connectionId?: string;
  subscriptionId?: string;
}

export class SmartStreamManager extends StreamManager {
  private pool: ConnectionPool;
  private loadBalancer: LoadBalancer;
  private monitorRegistrations: Map<string, MonitorRegistration> = new Map();
  private connectionStreams: Map<string, StreamManager> = new Map();
  private smartLogger: Logger;
  private messageTracking: Map<string, string> = new Map(); // messageId -> connectionId
  private subscriptionCounts: Map<string, number> = new Map(); // connectionId -> count
  private subscriptionGroups: Map<string, string> = new Map(); // subscriptionId -> group

  constructor(options: SmartStreamManagerOptions) {
    // Create a dummy client for base class (won't be used)
    super({
      ...options,
      streamClient: { subscribe: () => Promise.resolve() }
    });
    
    this.smartLogger = new Logger({ context: 'SmartStreamManager', color: chalk.cyan });
    this.pool = new ConnectionPool(options.poolConfig);
    this.loadBalancer = new LoadBalancer(options.loadBalancerConfig);
    
    // Set up event listeners
    this.setupPoolEventHandlers();
    this.setupLoadBalancerHandlers();
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

  private setupLoadBalancerHandlers(): void {
    // Handle migration requests from load balancer
    this.loadBalancer.on('migrationRequired', async (migration: MigrationRequest) => {
      this.smartLogger.info('Load balancer requested migration', migration);
      await this.handleMigrationRequest(migration);
    });

    // Handle metrics updates
    this.loadBalancer.on('metricsUpdate', (data: any) => {
      this.smartLogger.debug('Load metrics updated', {
        totalTps: data.summary.totalTps.toFixed(2),
        avgLoad: data.summary.averageLoad.toFixed(1),
        maxLoad: data.summary.maxLoad.toFixed(1)
      });
    });
  }

  async initialize(): Promise<void> {
    this.smartLogger.info('Initializing SmartStreamManager with connection pool');
    await this.pool.initialize();
    
    // Initialize load balancer with connections
    const connections = this.pool.getActiveConnections();
    this.loadBalancer.initialize(connections);
  }

  /**
   * Override subscribeTo to use connection pool
   */
  async subscribeTo(programId: string, subscriptionConfig?: any): Promise<void> {
    // This method is called by monitors, but we need more info
    // For backward compatibility, we'll assign to primary connection
    const monitorType = this.inferMonitorType(programId);
    const group = this.inferMonitorGroup(programId);
    
    await this.registerMonitor({
      monitorId: `monitor-${programId}-${Date.now()}`,
      monitorType,
      group,
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
      group: registration.group,
      program: registration.programId
    });

    // Create enhanced subscription
    const subscriptionRequest = registration.subscriptionConfig?.isAccountMonitor
      ? subscriptionBuilder.buildAccountSubscription([registration.programId])
      : subscriptionBuilder.buildTransactionSubscription([registration.programId]);
    
    const enhancedSub = subscriptionBuilder.createSubscription(
      registration.monitorId,
      registration.monitorType,
      registration.group,
      subscriptionRequest
    );
    
    registration.subscriptionId = enhancedSub.id;

    // Acquire connection from pool based on group priority
    const connection = await this.pool.acquireConnection(registration.group);
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
    
    // Update subscription metrics
    subscriptionBuilder.updateMetrics(enhancedSub.id, 'message');
    
    // Update connection subscription count in load balancer
    this.updateConnectionSubscriptionCounts();
  }

  private createStreamManagerForConnection(connection: PooledConnection): StreamManager {
    const connectionId = connection.id;
    const originalEventBus = (this as any).options.eventBus;
    
    // Create a wrapped event bus that tracks metrics
    const wrappedEventBus = {
      emit: (event: string, data: any) => {
        if (event === EVENTS.STREAM_DATA) {
          // Generate unique message ID
          const messageId = `${connectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          // Track message start
          this.loadBalancer.recordMessageStart(connectionId, messageId);
          this.messageTracking.set(messageId, connectionId);
          
          // Add connection metadata and message ID
          const enhancedData = {
            ...data,
            connectionId,
            connectionPriority: connection.priority,
            _messageId: messageId
          };
          
          // Emit to original bus
          originalEventBus.emit(event, enhancedData);
          
          // Track message completion after a short delay
          // In practice, monitors would call back when done processing
          setTimeout(() => {
            const bytesProcessed = JSON.stringify(data).length;
            this.loadBalancer.recordMessageComplete(connectionId, messageId, true, bytesProcessed);
            this.messageTracking.delete(messageId);
          }, 10);
          
        } else if (event === EVENTS.MONITOR_ERROR) {
          // Track errors
          const messageId = data._messageId;
          if (messageId && this.messageTracking.has(messageId)) {
            const connId = this.messageTracking.get(messageId)!;
            this.loadBalancer.recordMessageComplete(connId, messageId, false);
            this.messageTracking.delete(messageId);
          }
          originalEventBus.emit(event, data);
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

  private inferMonitorGroup(programId: string): MonitorGroup {
    // Map program IDs to subscription groups
    const BC_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    const PUMP_SWAP_PROGRAM = '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu';
    const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    const RAYDIUM_PROGRAM = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
    
    if (programId === BC_PROGRAM) {
      return 'bonding_curve';
    } else if (programId === PUMP_SWAP_PROGRAM || programId === PUMP_AMM_PROGRAM) {
      return 'amm_pool';
    } else if (programId === RAYDIUM_PROGRAM || programId.includes('raydium')) {
      return 'external_amm';
    }
    
    // Default to medium priority AMM pool group
    return 'amm_pool';
  }

  private async handleMigrationRequest(migration: MigrationRequest): Promise<void> {
    // Find monitors to migrate based on the request
    const monitorsToMigrate = Array.from(this.monitorRegistrations.values())
      .filter(reg => reg.connectionId === migration.fromConnectionId)
      .slice(0, 2); // Migrate up to 2 monitors at a time

    if (monitorsToMigrate.length === 0) {
      this.smartLogger.warn('No monitors found for migration request', migration);
      return;
    }

    for (const monitor of monitorsToMigrate) {
      try {
        // Update registration
        const oldConnectionId = monitor.connectionId;
        monitor.connectionId = migration.toConnectionId;
        
        // Get or create stream manager for target connection
        let targetStreamManager = this.connectionStreams.get(migration.toConnectionId);
        if (!targetStreamManager) {
          const targetConnection = this.pool.getConnection(migration.toConnectionId);
          if (!targetConnection) {
            throw new Error(`Target connection ${migration.toConnectionId} not found`);
          }
          targetStreamManager = this.createStreamManagerForConnection(targetConnection);
          this.connectionStreams.set(migration.toConnectionId, targetStreamManager);
        }
        
        // Re-subscribe on new connection
        await targetStreamManager.subscribeTo(monitor.programId, monitor.subscriptionConfig);
        
        this.smartLogger.info(`Migrated monitor ${monitor.monitorId} from ${oldConnectionId} to ${migration.toConnectionId}`);
      } catch (error) {
        this.smartLogger.error(`Failed to migrate monitor ${monitor.monitorId}:`, error);
        // Revert connection ID on failure
        monitor.connectionId = migration.fromConnectionId;
      }
    }
    
    // Update subscription counts
    this.updateConnectionSubscriptionCounts();
  }

  private updateConnectionSubscriptionCounts(): void {
    // Clear and rebuild subscription counts
    this.subscriptionCounts.clear();
    
    for (const registration of this.monitorRegistrations.values()) {
      const connId = registration.connectionId || '';
      this.subscriptionCounts.set(connId, (this.subscriptionCounts.get(connId) || 0) + 1);
      
      // Update subscription group mapping
      if (registration.subscriptionId) {
        this.subscriptionGroups.set(registration.subscriptionId, registration.group);
      }
    }
    
    // Update load balancer with counts
    for (const [connId, count] of this.subscriptionCounts) {
      this.loadBalancer.updateSubscriptionCount(connId, count);
    }
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
    const subscriptionStats = subscriptionBuilder.getStatistics();
    const loadStats = this.loadBalancer.getLoadSummary();
    const monitorsByConnection: Record<string, number> = {};
    const monitorsByGroup: Record<string, number> = {};

    for (const registration of this.monitorRegistrations.values()) {
      const connId = registration.connectionId || 'unassigned';
      monitorsByConnection[connId] = (monitorsByConnection[connId] || 0) + 1;
      
      const group = registration.group;
      monitorsByGroup[group] = (monitorsByGroup[group] || 0) + 1;
    }

    // Return both base stats and extended stats
    return {
      ...baseStats,
      pool: poolStats,
      subscriptions: subscriptionStats,
      load: loadStats,
      monitors: {
        total: this.monitorRegistrations.size,
        byConnection: monitorsByConnection,
        byGroup: monitorsByGroup
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
    this.messageTracking.clear();
    
    // Shutdown load balancer
    this.loadBalancer.shutdown();
    
    // Shutdown pool
    await this.pool.shutdown();
  }

  /**
   * Load balancing: Force a rebalance check
   */
  async rebalanceConnections(): Promise<void> {
    this.smartLogger.info('Requesting connection rebalance');
    this.loadBalancer.forceRebalance();
  }

  /**
   * Get detailed load metrics for monitoring
   */
  getLoadMetrics() {
    const summary = this.loadBalancer.getLoadSummary();
    const connections: any[] = [];
    
    for (const conn of this.pool.getActiveConnections()) {
      const metrics = this.loadBalancer.getConnectionMetrics(conn.id);
      if (metrics) {
        connections.push({
          id: conn.id,
          priority: conn.priority,
          ...metrics
        });
      }
    }
    
    return {
      summary,
      connections,
      connectionLoads: summary.connectionLoads,
      predictions: connections.map(c => ({
        connectionId: c.id,
        predictedLoad: this.loadBalancer.predictLoad(c.id)
      }))
    };
  }

  /**
   * Get pool information for monitoring
   */
  async getPoolInfo() {
    const poolStats = await this.pool.getStatistics();
    return {
      totalConnections: poolStats.totalConnections,
      activeConnections: poolStats.activeConnections,
      healthyConnections: poolStats.healthyConnections,
      totalSubscriptions: this.monitorRegistrations.size
    };
  }

  /**
   * Get subscription groups for monitoring
   */
  getSubscriptionGroups(): Map<string, number> {
    const groups = new Map<string, number>();
    
    // Count subscriptions by group
    this.subscriptionGroups.forEach((group) => {
      groups.set(group, (groups.get(group) || 0) + 1);
    });
    
    return groups;
  }
}