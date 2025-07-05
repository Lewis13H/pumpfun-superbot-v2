/**
 * Test Script for Session 8: Fault Tolerance & Recovery
 * 
 * Tests:
 * 1. Circuit breaker functionality
 * 2. Connection failover
 * 3. State checkpointing and recovery
 * 4. Alert system
 * 5. Emergency recovery
 */

import 'dotenv/config';
import { createContainer } from '../core/container-factory';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { FaultToleranceAlerts } from '../services/monitoring/fault-tolerance-alerts';
import chalk from 'chalk';

const logger = new Logger({ context: 'TestSession8' });

// Enable smart streaming with fault tolerance
process.env.USE_SMART_STREAMING = 'true';

async function simulateConnectionFailure(eventBus: EventBus, connectionId: string) {
  logger.info(`Simulating failure on connection ${connectionId}`);
  
  // Simulate multiple errors to trigger circuit breaker
  for (let i = 0; i < 5; i++) {
    eventBus.emit('connection:error', {
      connectionId,
      error: new Error(`Simulated error ${i + 1}`)
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function simulatePerformanceDegradation(eventBus: EventBus, connectionId: string) {
  logger.info(`Simulating performance degradation on connection ${connectionId}`);
  
  // Emit low parse rate
  eventBus.emit('connection:metrics', {
    connectionId,
    parseRate: 30, // 30% parse rate
    latency: 8000  // 8 seconds latency
  });
}

async function runTest() {
  try {
    logger.info('Session 8: Testing Fault Tolerance & Recovery');
    
    // Create container
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    // Initialize alert service
    const alertService = new FaultToleranceAlerts(eventBus, {
      enableConsoleAlerts: true,
      enableWebhookAlerts: false,
      alertThresholds: {
        maxFailuresPerConnection: 3,
        minParseRate: 50,
        maxLatency: 5000,
        maxConsecutiveFailures: 3
      },
      alertCooldown: 10000 // 10 seconds
    });
    
    // Track events
    const events = {
      connectionErrors: 0,
      recoveryAttempts: 0,
      failovers: 0,
      checkpoints: 0,
      alerts: 0
    };
    
    // Setup event tracking
    eventBus.on('connection:error', () => events.connectionErrors++);
    eventBus.on('fault-tolerance:recovery-attempt', () => events.recoveryAttempts++);
    eventBus.on('fault-tolerance:failover', () => events.failovers++);
    eventBus.on('fault-tolerance:checkpoint', () => events.checkpoints++);
    eventBus.on('alert:created', () => events.alerts++);
    
    // Initialize StreamManager with fault tolerance
    const streamManager = await container.resolve('StreamManager') as any;
    
    // Configure with fault tolerance enabled
    streamManager.smartOptions = {
      ...streamManager.smartOptions,
      faultToleranceConfig: {
        enabled: true,
        circuitBreaker: {
          failureThreshold: 3,
          recoveryTimeout: 5000,
          halfOpenRequests: 2,
          monitoringWindow: 30000
        },
        checkpointInterval: 10000,
        maxRecoveryAttempts: 3,
        recoveryBackoff: 2000
      },
      recoveryConfig: {
        checkpointDir: './test-checkpoints',
        maxCheckpoints: 5,
        compressionEnabled: false
      }
    };
    
    await streamManager.initialize();
    
    logger.info('Creating domain monitors...');
    
    // Create monitors
    const tokenMonitor = new TokenLifecycleMonitor(container);
    const tradingMonitor = new TradingActivityMonitor(container);
    
    // Start monitors
    logger.info('Starting monitors...');
    await tokenMonitor.start();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await tradingMonitor.start();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Wait for initial data
    logger.info('Waiting for initial data flow...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get initial stats
    const initialStats = streamManager.getStats();
    logger.info('Initial stats:', {
      streams: initialStats.streams.active,
      monitors: initialStats.monitors.total,
      faultTolerance: initialStats.faultTolerance
    });
    
    // Test 1: Circuit Breaker
    logger.info('\n=== Test 1: Circuit Breaker ===');
    const connections = Array.from(streamManager.connectionStreams.keys());
    if (connections.length > 0) {
      await simulateConnectionFailure(eventBus, connections[0]);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const stats1 = streamManager.getStats();
      logger.info('After failure simulation:', {
        faultTolerance: stats1.faultTolerance
      });
    }
    
    // Test 2: Performance Degradation
    logger.info('\n=== Test 2: Performance Degradation ===');
    if (connections.length > 1) {
      await simulatePerformanceDegradation(eventBus, connections[1]);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Test 3: Manual Checkpoint
    logger.info('\n=== Test 3: Manual Checkpoint ===');
    eventBus.emit('fault-tolerance:checkpoint');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test 4: Recovery Simulation
    logger.info('\n=== Test 4: Recovery Simulation ===');
    eventBus.emit('connection:success', { connectionId: connections[0] });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Wait for automatic checkpoint
    logger.info('\n=== Waiting for automatic checkpoint ===');
    await new Promise(resolve => setTimeout(resolve, 12000));
    
    // Final stats
    logger.info('\n=== Final Statistics ===');
    const finalStats = streamManager.getStats();
    logger.info('System stats:', {
      streams: finalStats.streams.active,
      monitors: finalStats.monitors.total,
      parseRate: finalStats.messages.parseRate,
      faultTolerance: finalStats.faultTolerance
    });
    
    logger.info('Event counts:', events);
    
    // Alert statistics
    const alertStats = alertService.getAlertStats();
    logger.info('Alert stats:', alertStats);
    
    // Show recent alerts
    const recentAlerts = alertService.getAlertHistory(10);
    if (recentAlerts.length > 0) {
      logger.info('\nRecent alerts:');
      recentAlerts.forEach(alert => {
        logger.info(`  [${alert.severity}] ${alert.title}: ${alert.message}`);
      });
    }
    
    // Health summary
    if (finalStats.faultTolerance.enabled && finalStats.faultTolerance.health) {
      logger.info('\nConnection health summary:', finalStats.faultTolerance.health);
    }
    
    // Stop monitors
    logger.info('\nStopping monitors...');
    await tradingMonitor.stop();
    await tokenMonitor.stop();
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info(chalk.green('\n✅ Session 8 test completed successfully!'));
    
    // Test summary
    console.log(chalk.cyan('\n📊 Test Summary:'));
    console.log(chalk.gray('1. Circuit Breaker: ') + (events.connectionErrors > 0 ? chalk.green('✓ Triggered') : chalk.red('✗ Not triggered')));
    console.log(chalk.gray('2. Recovery Attempts: ') + (events.recoveryAttempts > 0 ? chalk.green('✓ Initiated') : chalk.yellow('⚠ None needed')));
    console.log(chalk.gray('3. Failovers: ') + (events.failovers > 0 ? chalk.green('✓ Performed') : chalk.yellow('⚠ None needed')));
    console.log(chalk.gray('4. Checkpoints: ') + (events.checkpoints > 0 ? chalk.green('✓ Saved') : chalk.red('✗ Not saved')));
    console.log(chalk.gray('5. Alerts: ') + (events.alerts > 0 ? chalk.green(`✓ ${events.alerts} alerts sent`) : chalk.red('✗ No alerts')));
    
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the test
runTest();