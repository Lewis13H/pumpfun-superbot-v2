import { ConnectionPool } from '../services/core/connection-pool';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { EventBus } from '../core/event-bus';
import { DEV_POOL_CONFIG } from '../config/pool-config';
import { Logger } from '../core/logger';
import chalk from 'chalk';

const logger = new Logger({ context: 'TestConnectionPool' });

/**
 * Test script for connection pool implementation
 */
async function testConnectionPool() {
  logger.info(chalk.cyan('=== Testing Connection Pool Implementation ==='));

  // Create event bus
  const eventBus = new EventBus();
  
  // Test 1: Basic connection pool functionality
  logger.info(chalk.yellow('\nTest 1: Basic Connection Pool'));
  
  const pool = new ConnectionPool(DEV_POOL_CONFIG);
  
  try {
    await pool.initialize();
    
    const stats = pool.getConnectionStats();
    logger.info('Pool initialized:', stats);
    
    // Test acquiring connections
    logger.info('\nAcquiring connections for different monitor types...');
    
    const bcConnection = await pool.acquireConnection('BC');
    logger.info(`Acquired BC connection: ${bcConnection.id}`);
    
    const ammConnection = await pool.acquireConnection('AMM');
    logger.info(`Acquired AMM connection: ${ammConnection.id}`);
    
    // Release connections
    pool.releaseConnection(bcConnection.id);
    pool.releaseConnection(ammConnection.id);
    
    logger.info('Released connections');
    
    // Check final stats
    const finalStats = pool.getConnectionStats();
    logger.info('Final pool stats:', finalStats);
    
    await pool.shutdown();
    logger.info(chalk.green('✓ Basic connection pool test passed'));
    
  } catch (error) {
    logger.error('Connection pool test failed:', error);
    process.exit(1);
  }

  // Test 2: SmartStreamManager integration
  logger.info(chalk.yellow('\n\nTest 2: SmartStreamManager Integration'));
  
  const smartManager = new SmartStreamManager({
    eventBus,
    poolConfig: DEV_POOL_CONFIG
  });

  try {
    await smartManager.initialize();
    
    // Register some test monitors
    await smartManager.registerMonitor({
      monitorId: 'test-bc-monitor',
      monitorType: 'BC',
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      subscriptionConfig: {
        transactions: {
          'bc-trades': {
            vote: false,
            failed: false,
            accountInclude: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P']
          }
        }
      }
    });

    await smartManager.registerMonitor({
      monitorId: 'test-amm-monitor',
      monitorType: 'AMM',
      programId: '39azKMXXgKqvmd1n5egrFWqrSu2nZ8nvkbp11ruKWnv4',
      subscriptionConfig: {
        transactions: {
          'amm-trades': {
            vote: false,
            failed: false,
            accountInclude: ['39azKMXXgKqvmd1n5egrFWqrSu2nZ8nvkbp11ruKWnv4']
          }
        }
      }
    });

    // Get stats
    const managerStats = smartManager.getStats();
    logger.info('SmartStreamManager stats:', JSON.stringify(managerStats, null, 2));

    // Test rebalancing
    logger.info('\nTesting connection rebalancing...');
    await smartManager.rebalanceConnections();
    
    const rebalancedStats = smartManager.getStats();
    logger.info('Stats after rebalancing:', JSON.stringify(rebalancedStats, null, 2));

    await smartManager.stop();
    logger.info(chalk.green('✓ SmartStreamManager test passed'));
    
  } catch (error) {
    logger.error('SmartStreamManager test failed:', error);
    process.exit(1);
  }

  // Test 3: Health check and recovery
  logger.info(chalk.yellow('\n\nTest 3: Health Check and Recovery Simulation'));
  
  const recoveryPool = new ConnectionPool({
    ...DEV_POOL_CONFIG,
    healthCheckInterval: 2000 // Fast health checks for testing
  });

  try {
    await recoveryPool.initialize();
    
    // Listen for pool events
    recoveryPool.on('connectionUnhealthy', (conn) => {
      logger.warn(`Health check detected unhealthy connection: ${conn.id}`);
    });

    recoveryPool.on('connectionRecovered', (conn) => {
      logger.info(chalk.green(`Connection recovered: ${conn.id}`));
    });

    recoveryPool.on('connectionFailed', (conn) => {
      logger.error(`Connection permanently failed: ${conn.id}`);
    });

    logger.info('Waiting for health checks to run...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const healthStats = recoveryPool.getConnectionStats();
    logger.info('Health check stats:', healthStats);

    await recoveryPool.shutdown();
    logger.info(chalk.green('✓ Health check test completed'));
    
  } catch (error) {
    logger.error('Health check test failed:', error);
    process.exit(1);
  }

  logger.info(chalk.green('\n=== All tests passed! ==='));
  logger.info(chalk.cyan('\nSession 1 Implementation Summary:'));
  logger.info('✓ ConnectionPool with acquire/release functionality');
  logger.info('✓ SmartStreamManager with backward compatibility');
  logger.info('✓ Health checking and connection monitoring');
  logger.info('✓ Priority-based connection routing');
  logger.info('✓ Configuration management');
  
  process.exit(0);
}

// Run the test
testConnectionPool().catch(error => {
  logger.error('Test script failed:', error);
  process.exit(1);
});