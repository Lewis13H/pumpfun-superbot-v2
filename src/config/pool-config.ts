import { ConnectionPoolConfig } from '../services/core/connection-pool';

// Environment variable defaults
const DEFAULT_MAX_CONNECTIONS = 3;
const DEFAULT_MIN_CONNECTIONS = 2;
const DEFAULT_HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const DEFAULT_CONNECTION_TIMEOUT = 10000; // 10 seconds
const DEFAULT_MAX_RETRIES = 3;

/**
 * Get connection pool configuration from environment or defaults
 */
export function getPoolConfig(): ConnectionPoolConfig {
  return {
    maxConnections: parseInt(process.env.POOL_MAX_CONNECTIONS || String(DEFAULT_MAX_CONNECTIONS)),
    minConnections: parseInt(process.env.POOL_MIN_CONNECTIONS || String(DEFAULT_MIN_CONNECTIONS)),
    healthCheckInterval: parseInt(process.env.POOL_HEALTH_CHECK_INTERVAL || String(DEFAULT_HEALTH_CHECK_INTERVAL)),
    connectionTimeout: parseInt(process.env.POOL_CONNECTION_TIMEOUT || String(DEFAULT_CONNECTION_TIMEOUT)),
    maxRetries: parseInt(process.env.POOL_MAX_RETRIES || String(DEFAULT_MAX_RETRIES)),
    priorityGroups: {
      high: ['BC', 'BCTransaction', 'BCAccount'],
      medium: ['AMM', 'AMMTransaction', 'AMMAccount'],
      low: ['Raydium', 'RaydiumTransaction', 'RaydiumAccount', 'External']
    }
  };
}

/**
 * Monitor type mappings for backward compatibility
 */
export const MONITOR_TYPE_MAPPINGS = {
  // Bonding Curve monitors
  'pump': 'BC',
  'pumpfun': 'BC',
  'bonding-curve': 'BC',
  
  // AMM monitors
  'pump.swap': 'AMM',
  'pump-swap': 'AMM',
  'amm': 'AMM',
  
  // Raydium monitors
  'raydium': 'Raydium',
  'raydium-amm': 'Raydium',
  
  // Default
  'unknown': 'External'
};

/**
 * Get monitor priority based on type
 */
export function getMonitorPriority(monitorType: string): 'high' | 'medium' | 'low' {
  const config = getPoolConfig();
  
  if (config.priorityGroups.high.includes(monitorType)) return 'high';
  if (config.priorityGroups.medium.includes(monitorType)) return 'medium';
  return 'low';
}

/**
 * Pool configuration for development/testing
 */
export const DEV_POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections: 2,
  minConnections: 1,
  healthCheckInterval: 10000, // 10 seconds for faster testing
  connectionTimeout: 5000,
  maxRetries: 2,
  priorityGroups: {
    high: ['BC', 'BCTransaction', 'BCAccount'],
    medium: ['AMM', 'AMMTransaction', 'AMMAccount'],
    low: ['Raydium', 'RaydiumTransaction', 'RaydiumAccount']
  }
};

/**
 * Pool configuration for production
 */
export const PROD_POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections: 3,
  minConnections: 2,
  healthCheckInterval: 30000,
  connectionTimeout: 10000,
  maxRetries: 3,
  priorityGroups: {
    high: ['BC', 'BCTransaction', 'BCAccount'],
    medium: ['AMM', 'AMMTransaction', 'AMMAccount'],
    low: ['Raydium', 'RaydiumTransaction', 'RaydiumAccount', 'External']
  }
};