/**
 * Fault Tolerant Manager
 * Implements circuit breakers, failover logic, and state recovery for the smart streaming system
 */

import { Logger } from '../../core/logger';
import { EventBus } from '../../core/event-bus';

export enum CircuitState {
  CLOSED = 'CLOSED',   // Normal operation
  OPEN = 'OPEN',       // Failure detected, blocking requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;     // Number of failures before opening
  recoveryTimeout: number;      // Time to wait before attempting recovery (ms)
  halfOpenRequests: number;     // Number of test requests in half-open state
  monitoringWindow: number;     // Time window for counting failures (ms)
}

export interface ConnectionHealth {
  connectionId: string;
  failures: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  circuitState: CircuitState;
  parseRate: number;
  latency: number;
}

export interface StateCheckpoint {
  timestamp: Date;
  connectionStates: Map<string, ConnectionHealth>;
  lastProcessedSlots: Map<string, bigint>;
  activeSubscriptions: Map<string, string[]>; // connectionId -> subscription IDs
  metrics: {
    totalProcessed: number;
    totalFailures: number;
    averageParseRate: number;
  };
}

export class FaultTolerantManager {
  private logger: Logger;
  private eventBus: EventBus;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private connectionHealth: Map<string, ConnectionHealth> = new Map();
  private lastCheckpoint?: StateCheckpoint;
  private checkpointInterval: NodeJS.Timeout | null = null;
  private recoveryInProgress = false;
  
  // Make connectionHealth accessible for checkpointing
  public getConnectionHealth(): Map<string, ConnectionHealth> {
    return new Map(this.connectionHealth);
  }
  
  constructor(
    smartStreamManager: any, // SmartStreamManager type would create circular dependency
    private config: {
      circuitBreaker: CircuitBreakerConfig;
      checkpointInterval: number; // ms
      maxRecoveryAttempts: number;
      recoveryBackoff: number; // ms
    }
  ) {
    this.logger = new Logger({ context: 'FaultTolerantManager' });
    // Access eventBus from the base StreamManager options
    this.eventBus = smartStreamManager.options?.eventBus || smartStreamManager.smartOptions?.eventBus;
    // Pool access removed - not needed
    
    if (!this.eventBus) {
      throw new Error('EventBus not found in SmartStreamManager');
    }
    
    this.setupEventListeners();
    this.startCheckpointing();
  }
  
  /**
   * Setup event listeners for monitoring connection health
   */
  private setupEventListeners(): void {
    // Monitor connection failures
    this.eventBus.on('connection:error', (data: { connectionId: string; error: Error }) => {
      this.handleConnectionError(data.connectionId, data.error);
    });
    
    // Monitor successful operations
    this.eventBus.on('connection:success', (data: { connectionId: string }) => {
      this.handleConnectionSuccess(data.connectionId);
    });
    
    // Monitor parse rates
    this.eventBus.on('connection:metrics', (data: { connectionId: string; parseRate: number; latency: number }) => {
      this.updateConnectionMetrics(data.connectionId, data.parseRate, data.latency);
    });
    
    // Monitor subscription changes
    this.eventBus.on('subscription:added', (data: { connectionId: string; subscriptionId: string }) => {
      this.trackSubscription(data.connectionId, data.subscriptionId);
    });
    
    this.eventBus.on('subscription:removed', (data: { connectionId: string; subscriptionId: string }) => {
      this.untrackSubscription(data.connectionId, data.subscriptionId);
    });
  }
  
  /**
   * Handle connection error
   */
  private handleConnectionError(connectionId: string, error: Error): void {
    const health = this.getOrCreateHealth(connectionId);
    health.failures++;
    health.lastFailure = new Date();
    
    // Get or create circuit breaker
    let breaker = this.circuitBreakers.get(connectionId);
    if (!breaker) {
      breaker = new CircuitBreaker(this.config.circuitBreaker);
      this.circuitBreakers.set(connectionId, breaker);
    }
    
    // Record failure in circuit breaker
    breaker.recordFailure();
    health.circuitState = breaker.getState();
    
    // Check if we need to trigger failover
    if (breaker.getState() === CircuitState.OPEN) {
      this.logger.error(`Circuit breaker OPEN for connection ${connectionId}`, error);
      this.triggerFailover(connectionId);
    }
    
    // Emit alert
    this.eventBus.emit('fault-tolerance:alert', {
      type: 'connection_failure',
      connectionId,
      error: error.message,
      circuitState: health.circuitState,
      failures: health.failures
    });
  }
  
  /**
   * Handle connection success
   */
  private handleConnectionSuccess(connectionId: string): void {
    const health = this.getOrCreateHealth(connectionId);
    health.lastSuccess = new Date();
    
    const breaker = this.circuitBreakers.get(connectionId);
    if (breaker) {
      breaker.recordSuccess();
      health.circuitState = breaker.getState();
      
      // Check if circuit is now closed after recovery
      if (health.circuitState === CircuitState.CLOSED && health.failures > 0) {
        this.logger.info(`Connection ${connectionId} recovered, circuit breaker CLOSED`);
        health.failures = 0; // Reset failure count
        
        this.eventBus.emit('fault-tolerance:recovery', {
          connectionId,
          recoveryTime: new Date().getTime() - (health.lastFailure?.getTime() || 0)
        });
      }
    }
  }
  
  /**
   * Update connection metrics
   */
  private updateConnectionMetrics(connectionId: string, parseRate: number, latency: number): void {
    const health = this.getOrCreateHealth(connectionId);
    health.parseRate = parseRate;
    health.latency = latency;
    
    // Check for performance degradation
    if (parseRate < 50) { // Less than 50% parse rate
      this.logger.warn(`Low parse rate detected on connection ${connectionId}: ${parseRate}%`);
      this.eventBus.emit('fault-tolerance:alert', {
        type: 'performance_degradation',
        connectionId,
        parseRate,
        latency
      });
    }
    
    if (latency > 5000) { // Greater than 5 seconds
      this.logger.warn(`High latency detected on connection ${connectionId}: ${latency}ms`);
      this.eventBus.emit('fault-tolerance:alert', {
        type: 'high_latency',
        connectionId,
        latency
      });
    }
  }
  
  /**
   * Trigger failover for a failed connection
   */
  private async triggerFailover(failedConnectionId: string): Promise<void> {
    if (this.recoveryInProgress) {
      this.logger.warn('Recovery already in progress, skipping failover');
      return;
    }
    
    this.recoveryInProgress = true;
    this.logger.info(`Triggering failover for connection ${failedConnectionId}`);
    
    try {
      // 1. Find healthy connections
      const healthyConnections = Array.from(this.connectionHealth.entries())
        .filter(([id, health]) => 
          id !== failedConnectionId && 
          health.circuitState === CircuitState.CLOSED &&
          health.parseRate > 80
        )
        .map(([id]) => id);
      
      if (healthyConnections.length === 0) {
        this.logger.error('No healthy connections available for failover');
        await this.attemptEmergencyRecovery();
        return;
      }
      
      // 2. Get subscriptions from failed connection
      const subscriptions = this.lastCheckpoint?.activeSubscriptions.get(failedConnectionId) || [];
      
      if (subscriptions.length === 0) {
        this.logger.info('No active subscriptions on failed connection');
        this.recoveryInProgress = false;
        return;
      }
      
      // 3. Redistribute subscriptions to healthy connections
      const subscriptionsPerConnection = Math.ceil(subscriptions.length / healthyConnections.length);
      
      for (let i = 0; i < subscriptions.length; i += subscriptionsPerConnection) {
        const targetConnection = healthyConnections[i % healthyConnections.length];
        const subsToMove = subscriptions.slice(i, i + subscriptionsPerConnection);
        
        this.logger.info(`Moving ${subsToMove.length} subscriptions to connection ${targetConnection}`);
        
        // This would normally interact with SmartStreamManager to move subscriptions
        // For now, we emit an event for the manager to handle
        this.eventBus.emit('fault-tolerance:failover', {
          from: failedConnectionId,
          to: targetConnection,
          subscriptions: subsToMove
        });
      }
      
      // 4. Mark the failed connection for recovery attempts
      setTimeout(() => {
        this.attemptConnectionRecovery(failedConnectionId);
      }, this.config.recoveryBackoff);
      
    } catch (error) {
      this.logger.error('Failover failed', error as Error);
    } finally {
      this.recoveryInProgress = false;
    }
  }
  
  /**
   * Attempt to recover a failed connection
   */
  private async attemptConnectionRecovery(connectionId: string, attempt: number = 1): Promise<void> {
    if (attempt > this.config.maxRecoveryAttempts) {
      this.logger.error(`Max recovery attempts reached for connection ${connectionId}`);
      return;
    }
    
    this.logger.info(`Attempting recovery for connection ${connectionId} (attempt ${attempt})`);
    
    const breaker = this.circuitBreakers.get(connectionId);
    if (!breaker || breaker.getState() !== CircuitState.OPEN) {
      return; // Already recovered or doesn't need recovery
    }
    
    // Move to half-open state
    breaker.tryReset();
    
    // Emit recovery attempt event
    this.eventBus.emit('fault-tolerance:recovery-attempt', {
      connectionId,
      attempt
    });
    
    // The actual reconnection would be handled by SmartStreamManager
    // We'll check the result after a timeout
    setTimeout(() => {
      const health = this.connectionHealth.get(connectionId);
      if (health && health.circuitState !== CircuitState.CLOSED) {
        // Still not recovered, try again
        const nextAttempt = attempt + 1;
        const backoff = this.config.recoveryBackoff * Math.pow(2, attempt - 1); // Exponential backoff
        
        setTimeout(() => {
          this.attemptConnectionRecovery(connectionId, nextAttempt);
        }, backoff);
      }
    }, this.config.circuitBreaker.recoveryTimeout);
  }
  
  /**
   * Emergency recovery when all connections fail
   */
  private async attemptEmergencyRecovery(): Promise<void> {
    this.logger.error('EMERGENCY: All connections failed, attempting full system recovery');
    
    this.eventBus.emit('fault-tolerance:emergency', {
      timestamp: new Date(),
      connectionStates: Array.from(this.connectionHealth.entries()).map(([id, health]) => ({
        id,
        state: health.circuitState,
        failures: health.failures
      }))
    });
    
    // Reset all circuit breakers after a longer timeout
    setTimeout(() => {
      this.logger.info('Attempting emergency reset of all connections');
      
      for (const [connectionId, breaker] of this.circuitBreakers) {
        breaker.forceReset();
        const health = this.connectionHealth.get(connectionId);
        if (health) {
          health.failures = 0;
          health.circuitState = CircuitState.CLOSED;
        }
      }
      
      // Emit recovery event
      this.eventBus.emit('fault-tolerance:emergency-recovery', {
        timestamp: new Date()
      });
      
    }, this.config.recoveryBackoff * 5); // 5x normal backoff for emergency
  }
  
  /**
   * Start periodic checkpointing
   */
  private startCheckpointing(): void {
    this.checkpointInterval = setInterval(() => {
      this.saveCheckpoint();
    }, this.config.checkpointInterval);
  }
  
  /**
   * Save current state checkpoint
   */
  private saveCheckpoint(): void {
    const checkpoint: StateCheckpoint = {
      timestamp: new Date(),
      connectionStates: new Map(this.connectionHealth),
      lastProcessedSlots: new Map(), // Would be populated from monitors
      activeSubscriptions: new Map(), // Would be populated from pool
      metrics: {
        totalProcessed: 0,
        totalFailures: Array.from(this.connectionHealth.values()).reduce((sum, h) => sum + h.failures, 0),
        averageParseRate: this.calculateAverageParseRate()
      }
    };
    
    this.lastCheckpoint = checkpoint;
    
    // In production, this would persist to disk or database
    this.logger.debug('Checkpoint saved', {
      connections: checkpoint.connectionStates.size,
      failures: checkpoint.metrics.totalFailures,
      parseRate: checkpoint.metrics.averageParseRate
    });
  }
  
  /**
   * Restore from checkpoint (used after restart)
   */
  public async restoreFromCheckpoint(checkpoint: StateCheckpoint): Promise<void> {
    this.logger.info('Restoring from checkpoint', {
      timestamp: checkpoint.timestamp,
      connections: checkpoint.connectionStates.size
    });
    
    this.lastCheckpoint = checkpoint;
    
    // Restore connection health states
    for (const [connectionId, health] of checkpoint.connectionStates) {
      this.connectionHealth.set(connectionId, health);
      
      // Recreate circuit breakers in appropriate state
      const breaker = new CircuitBreaker(this.config.circuitBreaker);
      if (health.circuitState === CircuitState.OPEN) {
        // Force breaker to open state
        for (let i = 0; i < this.config.circuitBreaker.failureThreshold; i++) {
          breaker.recordFailure();
        }
      }
      this.circuitBreakers.set(connectionId, breaker);
    }
    
    // Emit restoration event
    this.eventBus.emit('fault-tolerance:restored', {
      checkpoint: {
        timestamp: checkpoint.timestamp,
        connections: checkpoint.connectionStates.size,
        metrics: checkpoint.metrics
      }
    });
  }
  
  /**
   * Get connection health summary
   */
  public getHealthSummary(): {
    healthy: number;
    degraded: number;
    failed: number;
    connections: Array<{
      id: string;
      state: CircuitState;
      parseRate: number;
      latency: number;
      failures: number;
    }>;
  } {
    let healthy = 0;
    let degraded = 0;
    let failed = 0;
    
    const connections = Array.from(this.connectionHealth.entries()).map(([id, health]) => {
      if (health.circuitState === CircuitState.OPEN) {
        failed++;
      } else if (health.parseRate < 80 || health.latency > 2000) {
        degraded++;
      } else {
        healthy++;
      }
      
      return {
        id,
        state: health.circuitState,
        parseRate: health.parseRate,
        latency: health.latency,
        failures: health.failures
      };
    });
    
    return { healthy, degraded, failed, connections };
  }
  
  /**
   * Helper methods
   */
  private getOrCreateHealth(connectionId: string): ConnectionHealth {
    let health = this.connectionHealth.get(connectionId);
    if (!health) {
      health = {
        connectionId,
        failures: 0,
        circuitState: CircuitState.CLOSED,
        parseRate: 100,
        latency: 0
      };
      this.connectionHealth.set(connectionId, health);
    }
    return health;
  }
  
  private calculateAverageParseRate(): number {
    const rates = Array.from(this.connectionHealth.values()).map(h => h.parseRate);
    if (rates.length === 0) return 0;
    return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  }
  
  private trackSubscription(connectionId: string, subscriptionId: string): void {
    if (!this.lastCheckpoint) {
      this.lastCheckpoint = this.createEmptyCheckpoint();
    }
    
    const subs = this.lastCheckpoint.activeSubscriptions.get(connectionId) || [];
    if (!subs.includes(subscriptionId)) {
      subs.push(subscriptionId);
      this.lastCheckpoint.activeSubscriptions.set(connectionId, subs);
    }
  }
  
  private untrackSubscription(connectionId: string, subscriptionId: string): void {
    if (!this.lastCheckpoint) return;
    
    const subs = this.lastCheckpoint.activeSubscriptions.get(connectionId);
    if (subs) {
      const index = subs.indexOf(subscriptionId);
      if (index > -1) {
        subs.splice(index, 1);
      }
    }
  }
  
  private createEmptyCheckpoint(): StateCheckpoint {
    return {
      timestamp: new Date(),
      connectionStates: new Map(),
      lastProcessedSlots: new Map(),
      activeSubscriptions: new Map(),
      metrics: {
        totalProcessed: 0,
        totalFailures: 0,
        averageParseRate: 100
      }
    };
  }
  
  /**
   * Cleanup
   */
  public stop(): void {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
    }
    
    // Save final checkpoint
    this.saveCheckpoint();
  }
}

/**
 * Circuit Breaker implementation
 */
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;
  private halfOpenTestCount: number = 0;
  
  constructor(
    private config: CircuitBreakerConfig
  ) {}
  
  public recordFailure(): void {
    const now = Date.now();
    
    // Reset failure count if outside monitoring window
    if (now - this.lastFailureTime > this.config.monitoringWindow) {
      this.failures = 0;
    }
    
    this.failures++;
    this.lastFailureTime = now;
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during recovery test, go back to OPEN
      this.state = CircuitState.OPEN;
      this.halfOpenTestCount = 0;
    } else if (this.state === CircuitState.CLOSED && this.failures >= this.config.failureThreshold) {
      // Threshold breached, open the circuit
      this.state = CircuitState.OPEN;
    }
  }
  
  public recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      this.halfOpenTestCount++;
      
      // Check if we've had enough successful tests
      if (this.halfOpenTestCount >= this.config.halfOpenRequests) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successCount = 0;
        this.halfOpenTestCount = 0;
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success in closed state
      if (this.failures > 0) {
        this.failures = Math.max(0, this.failures - 1);
      }
    }
  }
  
  public tryReset(): boolean {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.config.recoveryTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenTestCount = 0;
        this.successCount = 0;
        return true;
      }
    }
    return false;
  }
  
  public forceReset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successCount = 0;
    this.halfOpenTestCount = 0;
  }
  
  public getState(): CircuitState {
    // Check if we should try to move from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      this.tryReset();
    }
    return this.state;
  }
  
  public canPass(): boolean {
    return this.state === CircuitState.CLOSED || 
           (this.state === CircuitState.HALF_OPEN && this.halfOpenTestCount < this.config.halfOpenRequests);
  }
}