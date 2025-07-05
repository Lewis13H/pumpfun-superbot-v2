import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionPool, ConnectionPoolConfig } from '../../services/core/connection-pool';
import { EventEmitter } from 'events';

// Mock the stream client
const mockStreamClient = {
  subscribe: vi.fn().mockResolvedValue(undefined)
};

describe('ConnectionPool', () => {
  let pool: ConnectionPool;
  let config: ConnectionPoolConfig;

  beforeEach(() => {
    config = {
      grpcEndpoint: 'test://endpoint',
      grpcToken: 'test-token',
      maxConnections: 3,
      minConnections: 2,
      connectionTimeout: 1000,
      healthCheckInterval: 1000,
      maxRetries: 3
    };
    
    // Mock the connection factory
    vi.mock('../../core/stream-client', () => ({
      createStreamClient: () => mockStreamClient
    }));
    
    pool = new ConnectionPool(config);
  });

  afterEach(async () => {
    await pool.shutdown();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create minimum connections on initialize', async () => {
      await pool.initialize();
      
      const stats = pool.getConnectionStats();
      expect(stats.totalConnections).toBe(config.minConnections);
      expect(stats.activeConnections).toBe(config.minConnections);
      expect(stats.healthyConnections).toBe(config.minConnections);
    });

    it('should emit connectionAdded events', async () => {
      const spy = vi.fn();
      pool.on('connectionAdded', spy);
      
      await pool.initialize();
      
      expect(spy).toHaveBeenCalledTimes(config.minConnections);
    });

    it('should start health checks after initialization', async () => {
      await pool.initialize();
      
      // Wait for health check interval
      await new Promise(resolve => setTimeout(resolve, config.healthCheckInterval + 100));
      
      const connections = pool.getActiveConnections();
      expect(connections.every(c => c.stats.lastHealthCheck !== undefined)).toBe(true);
    });
  });

  describe('connection acquisition', () => {
    beforeEach(async () => {
      await pool.initialize();
    });

    it('should acquire connection with priority routing', async () => {
      const bcConnection = await pool.acquireConnection('bonding_curve');
      expect(bcConnection.priority).toBe('high');
      
      const ammConnection = await pool.acquireConnection('amm_pool');
      expect(ammConnection.priority).toBe('medium');
      
      const externalConnection = await pool.acquireConnection('external_amm');
      expect(externalConnection.priority).toBe('low');
    });

    it('should reuse connections when possible', async () => {
      const conn1 = await pool.acquireConnection('bonding_curve');
      const conn2 = await pool.acquireConnection('bonding_curve');
      
      // Should get different connections due to load balancing
      expect(conn1.id).not.toBe(conn2.id);
    });

    it('should create new connection when max not reached', async () => {
      const initialStats = pool.getConnectionStats();
      
      // Acquire all available connections
      for (let i = 0; i < config.minConnections; i++) {
        await pool.acquireConnection('test');
      }
      
      // This should create a new connection
      await pool.acquireConnection('test');
      
      const finalStats = pool.getConnectionStats();
      expect(finalStats.totalConnections).toBe(initialStats.totalConnections + 1);
    });

    it('should wait when max connections reached', async () => {
      // Fill pool to max
      for (let i = pool.getConnectionStats().totalConnections; i < config.maxConnections; i++) {
        await pool.acquireConnection('test');
      }
      
      const stats = pool.getConnectionStats();
      expect(stats.totalConnections).toBe(config.maxConnections);
      
      // This should not increase connection count
      const acquirePromise = pool.acquireConnection('test');
      
      // Should timeout waiting
      await expect(Promise.race([
        acquirePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      ])).rejects.toThrow('Timeout');
    });
  });

  describe('connection health', () => {
    beforeEach(async () => {
      await pool.initialize();
    });

    it('should mark unhealthy connections', async () => {
      const connection = pool.getActiveConnections()[0];
      
      // Simulate health check failure
      connection.stats.consecutiveFailures = 3;
      connection.stats.healthy = false;
      
      const spy = vi.fn();
      pool.on('connectionUnhealthy', spy);
      
      // Trigger health check
      await (pool as any).checkConnectionHealth(connection);
      
      expect(spy).toHaveBeenCalledWith(connection);
    });

    it('should recover unhealthy connections', async () => {
      const connection = pool.getActiveConnections()[0];
      
      // Mark as unhealthy
      connection.stats.healthy = false;
      connection.stats.consecutiveFailures = 3;
      
      // Then recover
      connection.stats.healthy = true;
      connection.stats.consecutiveFailures = 0;
      
      const spy = vi.fn();
      pool.on('connectionRecovered', spy);
      
      // Trigger health check
      await (pool as any).checkConnectionHealth(connection);
      
      expect(spy).toHaveBeenCalledWith(connection);
    });

    it('should emit connectionFailed after max retries', async () => {
      const connection = pool.getActiveConnections()[0];
      
      connection.stats.consecutiveFailures = config.maxRetries + 1;
      connection.stats.healthy = false;
      
      const spy = vi.fn();
      pool.on('connectionFailed', spy);
      
      // Trigger health check
      await (pool as any).checkConnectionHealth(connection);
      
      expect(spy).toHaveBeenCalledWith(connection);
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      await pool.initialize();
    });

    it('should track connection statistics', async () => {
      const stats = await pool.getStatistics();
      
      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('activeConnections');
      expect(stats).toHaveProperty('healthyConnections');
      expect(stats).toHaveProperty('unhealthyConnections');
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('averageRequestTime');
      expect(stats).toHaveProperty('connectionDetails');
      
      expect(stats.connectionDetails).toBeInstanceOf(Array);
      expect(stats.connectionDetails.length).toBe(stats.totalConnections);
    });

    it('should update statistics on operations', async () => {
      const initialStats = await pool.getStatistics();
      
      // Perform some operations
      await pool.acquireConnection('test');
      await pool.acquireConnection('test');
      
      const finalStats = await pool.getStatistics();
      
      expect(finalStats.totalRequests).toBeGreaterThan(initialStats.totalRequests);
    });
  });

  describe('shutdown', () => {
    it('should close all connections on shutdown', async () => {
      await pool.initialize();
      
      const connectionCount = pool.getConnectionStats().totalConnections;
      expect(connectionCount).toBeGreaterThan(0);
      
      await pool.shutdown();
      
      const finalStats = pool.getConnectionStats();
      expect(finalStats.totalConnections).toBe(0);
      expect(finalStats.activeConnections).toBe(0);
    });

    it('should stop health checks on shutdown', async () => {
      await pool.initialize();
      
      const healthCheckSpy = vi.spyOn(pool as any, 'performHealthChecks');
      
      await pool.shutdown();
      
      // Wait for what would be health check interval
      await new Promise(resolve => setTimeout(resolve, config.healthCheckInterval + 100));
      
      // Should not have been called after shutdown
      expect(healthCheckSpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle connection creation failures', async () => {
      // Mock failure
      vi.mocked(mockStreamClient.subscribe).mockRejectedValueOnce(new Error('Connection failed'));
      
      const pool = new ConnectionPool(config);
      
      // Should still initialize with remaining connections
      await expect(pool.initialize()).resolves.not.toThrow();
      
      const stats = pool.getConnectionStats();
      expect(stats.totalConnections).toBeLessThan(config.minConnections);
    });

    it('should handle acquire timeout', async () => {
      const shortTimeoutConfig = { ...config, connectionTimeout: 10 };
      const pool = new ConnectionPool(shortTimeoutConfig);
      
      await pool.initialize();
      
      // Fill pool
      for (let i = 0; i < config.maxConnections; i++) {
        await pool.acquireConnection('test');
      }
      
      // This should timeout
      await expect(pool.acquireConnection('test')).rejects.toThrow('timeout');
    });
  });
});