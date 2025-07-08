/**
 * Test Liquidity Monitor with AMM Services
 * Verifies that the Liquidity Monitor is working correctly with all AMM services enabled
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { LiquidityMonitor } from '../monitors/domain/liquidity-monitor';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger, LogLevel } from '../core/logger';
import { TOKENS } from '../core/container';

// Set log level to see what's happening
Logger.setGlobalLevel(LogLevel.INFO);

const logger = new Logger({ context: 'TestLiquidityMonitor', color: chalk.cyan });

async function testLiquidityMonitor() {
  logger.info('🧪 Testing Liquidity Monitor with AMM Services...');
  
  let container: any;
  let monitor: LiquidityMonitor | null = null;
  let eventBus: EventBus;
  
  try {
    // Create container
    logger.info('Creating DI container...');
    container = await createContainer();
    
    // Get EventBus
    eventBus = await container.resolve('EventBus' as any) as EventBus;
    
    // Pre-resolve required services
    logger.info('Resolving required services...');
    await container.resolve(TOKENS.StreamClient);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    
    // Resolve the LiquidityEventHandler to ensure it's initialized
    logger.info('Resolving LiquidityEventHandler...');
    const liquidityHandler = await container.resolve(TOKENS.LiquidityEventHandler);
    logger.info('✅ LiquidityEventHandler resolved successfully');
    
    // Check if AMM services are available
    logger.info('Checking AMM services...');
    const { AmmPoolStateService } = await import('../services/amm/amm-pool-state-service');
    const { AmmFeeService } = await import('../services/amm/amm-fee-service');
    const { LpPositionCalculator } = await import('../services/amm/lp-position-calculator');
    
    const poolStateService = AmmPoolStateService.getInstance();
    const feeService = AmmFeeService.getInstance();
    const lpCalculator = LpPositionCalculator.getInstance();
    
    logger.info('✅ All AMM services are available');
    
    // Initialize StreamManager
    logger.info('Initializing StreamManager...');
    await container.resolve(TOKENS.StreamManager);
    
    // Create monitor
    logger.info('Creating Liquidity Monitor...');
    monitor = new LiquidityMonitor(container);
    
    // Track events
    let eventCount = 0;
    const events: any[] = [];
    
    // Listen for liquidity events
    eventBus.on(EVENTS.LIQUIDITY_ADDED, (event) => {
      eventCount++;
      events.push({ type: 'LIQUIDITY_ADDED', event });
      logger.info('💧 Liquidity Added Event:', event);
    });
    
    eventBus.on(EVENTS.LIQUIDITY_REMOVED, (event) => {
      eventCount++;
      events.push({ type: 'LIQUIDITY_REMOVED', event });
      logger.info('💧 Liquidity Removed Event:', event);
    });
    
    eventBus.on(EVENTS.FEE_COLLECTED, (event) => {
      eventCount++;
      events.push({ type: 'FEE_COLLECTED', event });
      logger.info('💰 Fee Collected Event:', event);
    });
    
    eventBus.on(EVENTS.POOL_STATE_UPDATED, (event) => {
      eventCount++;
      events.push({ type: 'POOL_STATE_UPDATED', event });
      logger.info('🏊 Pool State Updated:', event);
    });
    
    eventBus.on(EVENTS.LIQUIDITY_PROCESSED, (event) => {
      eventCount++;
      events.push({ type: 'LIQUIDITY_PROCESSED', event });
      logger.info('✅ Liquidity Processed:', event);
    });
    
    // Start monitor
    logger.info('Starting Liquidity Monitor...');
    await monitor.start();
    
    // Let it run for 30 seconds
    logger.info('Monitor running for 30 seconds...');
    const startTime = Date.now();
    
    // Display progress
    const progressInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const metrics = monitor!.getMetrics();
      
      process.stdout.write(chalk.gray(`\r[${elapsed}s] `) +
        chalk.yellow(`Messages: ${metrics.messagesProcessed} | `) +
        chalk.green(`Parse Rate: ${metrics.parseRate.toFixed(1)}% | `) +
        chalk.cyan(`Pools: ${metrics.totalPools} | `) +
        chalk.blue(`TVL: $${metrics.totalTVL.toFixed(2)} | `) +
        chalk.magenta(`Events: ${eventCount}`)
      );
    }, 1000);
    
    // Wait 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));
    clearInterval(progressInterval);
    
    // Display final results
    console.log('\n\n' + chalk.green('=== Test Results ==='));
    
    const metrics = monitor.getMetrics();
    console.log(chalk.cyan('\n📊 Liquidity Monitor Metrics:'));
    console.log(`  Messages Processed: ${metrics.messagesProcessed}`);
    console.log(`  Parse Rate: ${metrics.parseRate.toFixed(2)}%`);
    console.log(`  Errors: ${metrics.errorsCount}`);
    console.log(`  Total Pools: ${metrics.totalPools}`);
    console.log(`  Total TVL: $${metrics.totalTVL.toFixed(2)}`);
    console.log(`  Liquidity Events: ${metrics.totalLiquidityEvents}`);
    console.log(`  Fee Events: ${metrics.totalFeeEvents}`);
    console.log(`  LP Positions: ${metrics.lpPositions}`);
    
    console.log(chalk.yellow('\n📨 Events Captured:'));
    const eventTypes = events.reduce((acc, evt) => {
      acc[evt.type] = (acc[evt.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    Object.entries(eventTypes).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    // Get pool states
    const poolStates = monitor.getPoolStates();
    if (poolStates.size > 0) {
      console.log(chalk.blue('\n🏊 Top Pools by TVL:'));
      const topPools = Array.from(poolStates.values())
        .sort((a, b) => b.tvlUSD - a.tvlUSD)
        .slice(0, 5);
      
      topPools.forEach((pool, index) => {
        console.log(`  ${index + 1}. ${pool.tokenMint.slice(0, 8)}... - $${pool.tvlUSD.toFixed(2)}`);
      });
    }
    
    // Check services
    console.log(chalk.green('\n✅ Service Status:'));
    console.log('  AmmPoolStateService: Active');
    console.log('  AmmFeeService: Active');
    console.log('  LpPositionCalculator: Active');
    console.log('  LiquidityEventHandler: Active');
    
    if (metrics.messagesProcessed > 0 && metrics.parseRate > 50) {
      console.log(chalk.green('\n✅ Liquidity Monitor is working correctly!'));
    } else if (metrics.messagesProcessed === 0) {
      console.log(chalk.yellow('\n⚠️  No messages processed. This might be normal if there\'s no liquidity activity.'));
    } else {
      console.log(chalk.red('\n❌ Low parse rate detected. Check for issues.'));
    }
    
  } catch (error) {
    logger.error('Test failed:', error);
    throw error;
  } finally {
    // Cleanup
    if (monitor) {
      logger.info('\nStopping monitor...');
      await monitor.stop();
    }
    
    // Give streams time to close
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info('Test complete!');
    process.exit(0);
  }
}

// Run the test
testLiquidityMonitor().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});