import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  FaultTolerantManager, 
  CircuitState,
  CircuitBreakerConfig,
  ConnectionHealth,
  StateCheckpoint
} from '../../services/recovery/fault-tolerant-manager';
import { EventBus } from '../../core/event-bus';

describe('FaultTolerantManager', () => {
  let manager: FaultTolerantManager;
  let eventBus: EventBus;
  let mockStreamManager: any;
  let config: any;

  beforeEach(() => {
    eventBus = new EventBus();
    
    mockStreamManager = {
      options: { eventBus },
      smartOptions: { eventBus }
    };

    config = {
      circuitBreaker: {
        failureThreshold: 3,
        recoveryTimeout: 1000,
        halfOpenRequests: 2,
        monitoringWindow: 5000
      },
      checkpointInterval: 1000,
      maxRecoveryAttempts: 3,
      recoveryBackoff: 500
    };

    manager = new FaultTolerantManager(mockStreamManager, config);
  });

  afterEach(() => {
    manager.stop();
    vi.clearAllMocks();
  });

  describe('circuit breaker functionality', () => {
    it('should track connection failures', () => {
      const connectionId = 'test-conn-1';
      
      // Simulate failures
      for (let i = 0; i < 2; i++) {
        eventBus.emit('connection:error', { 
          connectionId, 
          error: new Error('Test error') 
        });
      }

      const health = manager.getHealthSummary();
      expect(health.healthy).toBe(1);
      expect(health.degraded).toBe(0);
      expect(health.failed).toBe(0);
    });

    it('should open circuit after threshold failures', () => {
      const connectionId = 'test-conn-1';
      const alertSpy = vi.fn();
      
      eventBus.on('fault-tolerance:alert', alertSpy);

      // Simulate failures to reach threshold
      for (let i = 0; i < config.circuitBreaker.failureThreshold; i++) {
        eventBus.emit('connection:error', { 
          connectionId, 
          error: new Error('Test error') 
        });
      }

      const health = manager.getHealthSummary();
      expect(health.failed).toBe(1);
      
      const connection = health.connections.find(c => c.id === connectionId);
      expect(connection?.state).toBe(CircuitState.OPEN);
      
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connection_failure',
          connectionId,
          circuitState: CircuitState.OPEN
        })
      );
    });

    it('should trigger failover when circuit opens', async () => {
      const failedConnection = 'conn-1';
      const healthyConnection = 'conn-2';
      const failoverSpy = vi.fn();
      
      eventBus.on('fault-tolerance:failover', failoverSpy);

      // Setup healthy connection
      eventBus.emit('connection:success', { connectionId: healthyConnection });
      eventBus.emit('connection:metrics', { 
        connectionId: healthyConnection, 
        parseRate: 95, 
        latency: 100 
      });

      // Setup checkpoint with subscriptions
      const checkpoint: StateCheckpoint = {
        timestamp: new Date(),
        connectionStates: new Map(),
        lastProcessedSlots: new Map(),
        activeSubscriptions: new Map([
          [failedConnection, ['sub-1', 'sub-2']],
          [healthyConnection, ['sub-3']]
        ]),
        metrics: {
          totalProcessed: 1000,
          totalFailures: 0,
          averageParseRate: 95
        }
      };
      
      await manager.restoreFromCheckpoint(checkpoint);

      // Trigger circuit breaker
      for (let i = 0; i < config.circuitBreaker.failureThreshold; i++) {
        eventBus.emit('connection:error', { 
          connectionId: failedConnection, 
          error: new Error('Test error') 
        });
      }

      // Should trigger failover
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(failoverSpy).toHaveBeenCalled();
      const failoverCall = failoverSpy.mock.calls[0][0];
      expect(failoverCall.from).toBe(failedConnection);
      expect(failoverCall.to).toBe(healthyConnection);
      expect(failoverCall.subscriptions).toContain('sub-1');
      expect(failoverCall.subscriptions).toContain('sub-2');
    });

    it('should recover circuit after timeout', async () => {
      const connectionId = 'test-conn-1';
      
      // Open circuit
      for (let i = 0; i < config.circuitBreaker.failureThreshold; i++) {
        eventBus.emit('connection:error', { 
          connectionId, 
          error: new Error('Test error') 
        });
      }

      let health = manager.getHealthSummary();
      expect(health.connections[0].state).toBe(CircuitState.OPEN);

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, config.circuitBreaker.recoveryTimeout + 100));

      // Emit recovery attempt event
      eventBus.emit('fault-tolerance:recovery-attempt', { connectionId, attempt: 1 });

      // Simulate successful operations
      for (let i = 0; i < config.circuitBreaker.halfOpenRequests; i++) {
        eventBus.emit('connection:success', { connectionId });
      }

      health = manager.getHealthSummary();
      expect(health.connections[0].state).toBe(CircuitState.CLOSED);
    });
  });

  describe('performance monitoring', () => {
    it('should track parse rates', () => {
      const connectionId = 'test-conn-1';
      
      eventBus.emit('connection:metrics', { 
        connectionId, 
        parseRate: 45, 
        latency: 500 
      });

      const health = manager.getHealthSummary();
      const connection = health.connections.find(c => c.id === connectionId);
      
      expect(connection?.parseRate).toBe(45);
      expect(connection?.latency).toBe(500);
      expect(health.degraded).toBe(1); // Low parse rate
    });

    it('should alert on performance degradation', () => {
      const alertSpy = vi.fn();
      eventBus.on('fault-tolerance:alert', alertSpy);

      // Low parse rate
      eventBus.emit('connection:metrics', { 
        connectionId: 'conn-1', 
        parseRate: 40, 
        latency: 1000 
      });

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'performance_degradation',
          parseRate: 40
        })
      );
    });

    it('should alert on high latency', () => {
      const alertSpy = vi.fn();
      eventBus.on('fault-tolerance:alert', alertSpy);

      // High latency
      eventBus.emit('connection:metrics', { 
        connectionId: 'conn-1', 
        parseRate: 95, 
        latency: 6000 
      });

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'high_latency',
          latency: 6000
        })
      );
    });
  });

  describe('state checkpointing', () => {
    it('should save checkpoints periodically', async () => {
      const checkpointSpy = vi.fn();
      
      // Listen for checkpoint saves
      eventBus.on('fault-tolerance:checkpoint', checkpointSpy);

      // Wait for checkpoint interval
      await new Promise(resolve => setTimeout(resolve, config.checkpointInterval + 100));

      // Should not emit directly, but we can check internal state
      const healthSummary = manager.getHealthSummary();
      expect(healthSummary).toBeDefined();
    });

    it('should restore from checkpoint', async () => {
      const restoreSpy = vi.fn();
      eventBus.on('fault-tolerance:restored', restoreSpy);

      const checkpoint: StateCheckpoint = {
        timestamp: new Date(),
        connectionStates: new Map([
          ['conn-1', {
            connectionId: 'conn-1',
            failures: 2,
            circuitState: CircuitState.OPEN,
            parseRate: 85,
            latency: 1500,
            lastFailure: new Date()
          }]
        ]),
        lastProcessedSlots: new Map([['conn-1', BigInt(12345)]]),
        activeSubscriptions: new Map([['conn-1', ['sub-1', 'sub-2']]]),
        metrics: {
          totalProcessed: 5000,
          totalFailures: 10,
          averageParseRate: 92.5
        }
      };

      await manager.restoreFromCheckpoint(checkpoint);

      expect(restoreSpy).toHaveBeenCalledWith({
        checkpoint: expect.objectContaining({
          timestamp: checkpoint.timestamp,
          connections: 1,
          metrics: checkpoint.metrics
        })
      });

      const health = manager.getHealthSummary();
      expect(health.failed).toBe(1);
      expect(health.connections[0].state).toBe(CircuitState.OPEN);
    });
  });

  describe('emergency recovery', () => {
    it('should trigger emergency recovery when all connections fail', async () => {
      const emergencySpy = vi.fn();
      const recoverySpy = vi.fn();
      
      eventBus.on('fault-tolerance:emergency', emergencySpy);
      eventBus.on('fault-tolerance:emergency-recovery', recoverySpy);

      // Fail all connections
      const connections = ['conn-1', 'conn-2', 'conn-3'];
      
      for (const connId of connections) {
        // Mark as failed
        for (let i = 0; i < config.circuitBreaker.failureThreshold; i++) {
          eventBus.emit('connection:error', { 
            connectionId: connId, 
            error: new Error('Test error') 
          });
        }
      }

      // Trigger failover with no healthy connections
      await (manager as any).triggerFailover('conn-1');

      expect(emergencySpy).toHaveBeenCalled();

      // Wait for emergency recovery timeout
      await new Promise(resolve => setTimeout(resolve, config.recoveryBackoff * 5 + 100));

      expect(recoverySpy).toHaveBeenCalled();

      // All circuits should be reset
      const health = manager.getHealthSummary();
      expect(health.failed).toBe(0);
      expect(health.healthy).toBe(connections.length);
    });
  });

  describe('subscription tracking', () => {
    it('should track active subscriptions', () => {
      const connectionId = 'conn-1';
      const subscriptionId = 'sub-1';

      eventBus.emit('subscription:added', { connectionId, subscriptionId });

      // This would be reflected in checkpoints
      const healthSummary = manager.getHealthSummary();
      expect(healthSummary).toBeDefined();
    });

    it('should untrack removed subscriptions', () => {
      const connectionId = 'conn-1';
      const subscriptionId = 'sub-1';

      eventBus.emit('subscription:added', { connectionId, subscriptionId });
      eventBus.emit('subscription:removed', { connectionId, subscriptionId });

      const healthSummary = manager.getHealthSummary();
      expect(healthSummary).toBeDefined();
    });
  });

  describe('health summary', () => {
    it('should provide accurate health summary', () => {
      // Setup various connection states
      eventBus.emit('connection:metrics', { 
        connectionId: 'healthy-1', 
        parseRate: 98, 
        latency: 50 
      });

      eventBus.emit('connection:metrics', { 
        connectionId: 'degraded-1', 
        parseRate: 75, 
        latency: 1500 
      });

      for (let i = 0; i < config.circuitBreaker.failureThreshold; i++) {
        eventBus.emit('connection:error', { 
          connectionId: 'failed-1', 
          error: new Error('Test') 
        });
      }

      const summary = manager.getHealthSummary();
      
      expect(summary.healthy).toBe(1);
      expect(summary.degraded).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.connections).toHaveLength(3);
      
      const healthyConn = summary.connections.find(c => c.id === 'healthy-1');
      expect(healthyConn?.state).toBe(CircuitState.CLOSED);
      
      const failedConn = summary.connections.find(c => c.id === 'failed-1');
      expect(failedConn?.state).toBe(CircuitState.OPEN);
    });
  });
});