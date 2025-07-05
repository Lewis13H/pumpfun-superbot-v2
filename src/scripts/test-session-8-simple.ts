/**
 * Simple Test Script for Session 8: Fault Tolerance & Recovery
 * Tests fault tolerance without running actual monitors
 */

import 'dotenv/config';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { FaultTolerantManager, CircuitState } from '../services/recovery/fault-tolerant-manager';
import { StateRecoveryService } from '../services/recovery/state-recovery-service';
import { FaultToleranceAlerts } from '../services/monitoring/fault-tolerance-alerts';
import chalk from 'chalk';

const logger = new Logger({ context: 'TestSession8Simple' });

async function testCircuitBreaker() {
  logger.info('\n=== Testing Circuit Breaker ===');
  
  const eventBus = new EventBus();
  let connectionErrors = 0;
  let connectionRecoveries = 0;
  
  eventBus.on('connection:error', () => connectionErrors++);
  eventBus.on('connection:success', () => connectionRecoveries++);
  
  // Mock SmartStreamManager
  const mockManager = {
    options: { eventBus },
    pool: {
      getActiveConnections: () => [
        { id: 'test-conn-1', priority: 'high' },
        { id: 'test-conn-2', priority: 'medium' }
      ]
    }
  };
  
  const ftManager = new FaultTolerantManager(mockManager, {
    circuitBreaker: {
      failureThreshold: 3,
      recoveryTimeout: 2000,
      halfOpenRequests: 2,
      monitoringWindow: 30000
    },
    checkpointInterval: 60000,
    maxRecoveryAttempts: 3,
    recoveryBackoff: 1000
  });
  
  // Test 1: Trigger circuit breaker
  logger.info('Triggering circuit breaker with failures...');
  for (let i = 0; i < 4; i++) {
    eventBus.emit('connection:error', {
      connectionId: 'test-conn-1',
      error: new Error(`Test error ${i + 1}`)
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const health1 = ftManager.getHealthSummary();
  logger.info('Health after failures:', health1);
  
  // Test 2: Performance degradation
  logger.info('\nTesting performance degradation...');
  eventBus.emit('connection:metrics', {
    connectionId: 'test-conn-2',
    parseRate: 30,
    latency: 8000
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 3: Recovery
  logger.info('\nTesting recovery...');
  await new Promise(resolve => setTimeout(resolve, 2500)); // Wait for recovery timeout
  
  eventBus.emit('connection:success', { connectionId: 'test-conn-1' });
  eventBus.emit('connection:success', { connectionId: 'test-conn-1' });
  
  const health2 = ftManager.getHealthSummary();
  logger.info('Health after recovery:', health2);
  
  // Cleanup
  ftManager.stop();
  
  return {
    connectionErrors,
    connectionRecoveries,
    finalHealth: health2
  };
}

async function testStateRecovery() {
  logger.info('\n=== Testing State Recovery ===');
  
  const eventBus = new EventBus();
  
  const recoveryService = new StateRecoveryService(eventBus, {
    checkpointDir: './test-checkpoints',
    maxCheckpoints: 3,
    compressionEnabled: false
  });
  
  // Wait for directory creation
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Test 1: Save checkpoint
  logger.info('Saving test checkpoint...');
  const testCheckpoint = {
    timestamp: new Date(),
    connectionStates: new Map([
      ['conn-1', {
        connectionId: 'conn-1',
        failures: 2,
        circuitState: CircuitState.CLOSED,
        parseRate: 95,
        latency: 100
      }]
    ]),
    lastProcessedSlots: new Map([['conn-1', BigInt(12345)]]),
    activeSubscriptions: new Map([['conn-1', ['sub-1', 'sub-2']]]),
    metrics: {
      totalProcessed: 1000,
      totalFailures: 5,
      averageParseRate: 95
    }
  };
  
  await recoveryService.saveCheckpoint(testCheckpoint);
  
  // Test 2: Load checkpoint
  logger.info('Loading checkpoint...');
  const loaded = await recoveryService.loadLatestCheckpoint();
  
  if (loaded) {
    logger.info('Checkpoint loaded:', {
      timestamp: loaded.timestamp,
      connections: loaded.connectionStates.size,
      slots: loaded.lastProcessedSlots.size
    });
  }
  
  // Test 3: Recovery stats
  const stats = await recoveryService.getRecoveryStats();
  logger.info('Recovery stats:', stats);
  
  return { saved: true, loaded: !!loaded, stats };
}

async function testAlertSystem() {
  logger.info('\n=== Testing Alert System ===');
  
  const eventBus = new EventBus();
  const alerts: any[] = [];
  
  eventBus.on('alert:created', (alert) => alerts.push(alert));
  
  const alertService = new FaultToleranceAlerts(eventBus, {
    enableConsoleAlerts: false, // Disable console output for test
    enableWebhookAlerts: false,
    alertThresholds: {
      maxFailuresPerConnection: 3,
      minParseRate: 50,
      maxLatency: 5000,
      maxConsecutiveFailures: 2
    },
    alertCooldown: 1000
  });
  
  // Test various alert types
  logger.info('Triggering various alerts...');
  
  // Connection failure
  eventBus.emit('fault-tolerance:alert', {
    type: 'connection_failure',
    connectionId: 'test-conn',
    failures: 5,
    error: 'Connection timeout',
    circuitState: CircuitState.OPEN
  });
  
  // Performance degradation
  eventBus.emit('fault-tolerance:alert', {
    type: 'performance_degradation',
    connectionId: 'test-conn',
    parseRate: 40
  });
  
  // High latency
  eventBus.emit('fault-tolerance:alert', {
    type: 'high_latency',
    connectionId: 'test-conn',
    latency: 10000
  });
  
  // Recovery
  eventBus.emit('fault-tolerance:recovery', {
    connectionId: 'test-conn',
    recoveryTime: 5000
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const alertStats = alertService.getAlertStats();
  logger.info('Alert statistics:', alertStats);
  
  return { alerts: alerts.length, stats: alertStats };
}

async function runTests() {
  try {
    logger.info(chalk.cyan('Session 8: Fault Tolerance & Recovery - Simple Tests'));
    
    // Run individual tests
    const circuitBreakerResults = await testCircuitBreaker();
    const stateRecoveryResults = await testStateRecovery();
    const alertResults = await testAlertSystem();
    
    // Summary
    console.log(chalk.cyan('\n📊 Test Summary:'));
    console.log(chalk.gray('1. Circuit Breaker:'));
    console.log(`   - Errors tracked: ${circuitBreakerResults.connectionErrors}`);
    console.log(`   - Recoveries: ${circuitBreakerResults.connectionRecoveries}`);
    console.log(`   - Failed connections: ${circuitBreakerResults.finalHealth.failed}`);
    
    console.log(chalk.gray('\n2. State Recovery:'));
    console.log(`   - Checkpoint saved: ${stateRecoveryResults.saved ? '✓' : '✗'}`);
    console.log(`   - Checkpoint loaded: ${stateRecoveryResults.loaded ? '✓' : '✗'}`);
    console.log(`   - Total checkpoints: ${stateRecoveryResults.stats.checkpointCount}`);
    
    console.log(chalk.gray('\n3. Alert System:'));
    console.log(`   - Alerts generated: ${alertResults.alerts}`);
    console.log(`   - Alert types: ${Object.keys(alertResults.stats.byType).join(', ')}`);
    
    logger.info(chalk.green('\n✅ All tests completed successfully!'));
    
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the tests
runTests();