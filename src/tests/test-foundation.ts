/**
 * Test the foundation layer components
 */

import chalk from 'chalk';
import { BaseMonitor } from '../core/base-monitor';
import { createTestContainer } from '../core/container-factory';
import { Container, TOKENS } from '../core/container';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger, LogLevel } from '../core/logger';
import { PUMP_PROGRAM } from '../utils/constants';

// Set log level for testing
Logger.setGlobalLevel(LogLevel.DEBUG);

/**
 * Test implementation of BaseMonitor
 */
class TestMonitor extends BaseMonitor {
  private processedCount = 0;
  private testData: any[] = [];

  async processStreamData(data: any): Promise<void> {
    this.processedCount++;
    this.testData.push(data);
    
    // Add custom stats
    this.stats.processed = this.processedCount;
    this.stats.successRate = ((this.processedCount - this.stats.errors) / this.processedCount * 100).toFixed(2);
    
    // Emit test event
    this.eventBus.emit('test:processed', data);
  }

  displayStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();
    const txRate = this.calculateRate(this.stats.transactions, this.stats.startTime);
    
    this.logger.box('Test Monitor Statistics', {
      'Runtime': this.formatDuration(runtime),
      'Transactions': this.formatNumber(this.stats.transactions),
      'Rate': `${txRate.toFixed(1)}/min`,
      'Processed': this.formatNumber(this.processedCount),
      'Errors': this.formatNumber(this.stats.errors),
      'Reconnections': this.stats.reconnections,
      'SOL Price': `$${this.currentSolPrice.toFixed(2)}`,
      'Success Rate': `${this.stats.successRate || '0.00'}%`
    });
  }

  shouldLogError(error: any): boolean {
    // Log all errors in test mode
    return true;
  }

  async onShutdown(): Promise<void> {
    this.logger.info('Test monitor cleanup complete');
  }

  // Test helpers
  getProcessedCount(): number {
    return this.processedCount;
  }

  getTestData(): any[] {
    return this.testData;
  }
}

/**
 * Test the EventBus
 */
async function testEventBus() {
  console.log(chalk.blue('\n=== Testing EventBus ===\n'));
  
  const eventBus = new EventBus();
  let eventReceived = false;
  let asyncEventReceived = false;
  
  // Test synchronous events
  eventBus.on('test:sync', (data) => {
    console.log(chalk.green('✓ Received sync event:'), data);
    eventReceived = true;
  });
  
  eventBus.emit('test:sync', { message: 'Hello sync!' });
  
  // Test async events
  eventBus.on('test:async', async (data) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(chalk.green('✓ Received async event:'), data);
    asyncEventReceived = true;
  });
  
  await eventBus.emitAsync('test:async', { message: 'Hello async!' });
  
  // Test once
  let onceCount = 0;
  eventBus.once('test:once', () => {
    onceCount++;
  });
  
  eventBus.emit('test:once', {});
  eventBus.emit('test:once', {}); // Should not trigger
  
  console.log(chalk.green(`✓ Once event triggered ${onceCount} time(s)`));
  
  // Test unsubscribe
  const unsubscribe = eventBus.on('test:unsub', () => {});
  unsubscribe();
  
  console.log(chalk.green('✓ Unsubscribe worked'));
  
  // Verify results
  if (!eventReceived || !asyncEventReceived || onceCount !== 1) {
    throw new Error('EventBus tests failed');
  }
  
  console.log(chalk.green('\n✓ All EventBus tests passed!\n'));
}

/**
 * Test the Container
 */
async function testContainer() {
  console.log(chalk.blue('\n=== Testing Container ===\n'));
  
  const container = new Container();
  
  // Test singleton registration
  let instanceCount = 0;
  container.registerSingleton('TestService' as any, () => {
    instanceCount++;
    return { id: instanceCount };
  });
  
  const instance1 = await container.resolve('TestService' as any);
  const instance2 = await container.resolve('TestService' as any);
  
  console.log(chalk.green(`✓ Singleton instances: ${instance1.id} === ${instance2.id}`));
  
  // Test transient registration
  let transientCount = 0;
  container.registerTransient('TransientService' as any, () => {
    transientCount++;
    return { id: transientCount };
  });
  
  const trans1 = await container.resolve('TransientService' as any);
  const trans2 = await container.resolve('TransientService' as any);
  
  console.log(chalk.green(`✓ Transient instances: ${trans1.id} !== ${trans2.id}`));
  
  // Test value registration
  container.registerValue('ConfigValue' as any, { env: 'test' });
  const config = await container.resolve('ConfigValue' as any);
  
  console.log(chalk.green('✓ Value registration:'), config);
  
  // Test circular dependency detection
  container.registerSingleton('ServiceA' as any, async () => {
    await container.resolve('ServiceB' as any);
    return { name: 'A' };
  });
  
  container.registerSingleton('ServiceB' as any, async () => {
    await container.resolve('ServiceA' as any);
    return { name: 'B' };
  });
  
  try {
    await container.resolve('ServiceA' as any);
    throw new Error('Should have detected circular dependency');
  } catch (error: any) {
    if (error.message.includes('Circular dependency')) {
      console.log(chalk.green('✓ Circular dependency detected correctly'));
    } else {
      throw error;
    }
  }
  
  console.log(chalk.green('\n✓ All Container tests passed!\n'));
}

/**
 * Test the BaseMonitor
 */
async function testBaseMonitor() {
  console.log(chalk.blue('\n=== Testing BaseMonitor ===\n'));
  
  const container = await createTestContainer();
  const eventBus = await container.resolve(TOKENS.EventBus);
  
  // Listen for monitor events
  let monitorStarted = false;
  let statsUpdated = false;
  
  eventBus.on(EVENTS.MONITOR_STARTED, (data) => {
    console.log(chalk.green('✓ Monitor started event received:'), data);
    monitorStarted = true;
  });
  
  eventBus.on(EVENTS.MONITOR_STATS_UPDATED, (data) => {
    console.log(chalk.green('✓ Stats updated event received'));
    statsUpdated = true;
  });
  
  // Create test monitor
  const monitor = new TestMonitor(
    {
      programId: PUMP_PROGRAM,
      monitorName: 'Test Monitor',
      color: chalk.cyan
    },
    container
  );
  
  // Start monitor
  console.log(chalk.yellow('Starting test monitor (will run for 5 seconds)...\n'));
  
  // Run for 5 seconds then stop
  setTimeout(async () => {
    console.log(chalk.yellow('\nTest complete, shutting down...'));
    
    // Verify results
    if (!monitorStarted) {
      throw new Error('Monitor started event not received');
    }
    
    if (!statsUpdated) {
      throw new Error('Stats updated event not received');
    }
    
    console.log(chalk.green('\n✓ All BaseMonitor tests passed!\n'));
    process.exit(0);
  }, 5000);
  
  await monitor.start();
}

/**
 * Run all tests
 */
async function runTests() {
  console.log(chalk.magenta('\n🧪 Testing Foundation Layer Components\n'));
  
  try {
    await testEventBus();
    await testContainer();
    await testBaseMonitor();
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);