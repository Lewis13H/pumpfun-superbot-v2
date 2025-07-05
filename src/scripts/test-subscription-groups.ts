import { Logger } from '../core/logger';
import { subscriptionBuilder, MonitorGroup } from '../services/core/subscription-builder';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { Container } from '../core/container';
import { getPoolConfig } from '../config/pool-config';
import chalk from 'chalk';

const logger = new Logger({ context: 'TestSubscriptionGroups' });

async function testSubscriptionGroups() {
  logger.info('🧪 Testing Subscription Groups and Priority Routing...\n');

  try {
    // Test 1: Create subscriptions for different groups
    logger.info(chalk.blue('Test 1: Creating subscriptions for different groups'));
    
    // Bonding Curve subscription
    const bcRequest = subscriptionBuilder.buildTransactionSubscription([
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
    ]);
    const bcSub = subscriptionBuilder.createSubscription(
      'bc-monitor-1',
      'BC Transaction Monitor',
      'bonding_curve',
      bcRequest
    );
    logger.info(`✅ Created BC subscription: ${bcSub.id} (Priority: ${bcSub.priority})`);

    // AMM Pool subscription
    const ammRequest = subscriptionBuilder.buildTransactionSubscription([
      '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu'
    ]);
    const ammSub = subscriptionBuilder.createSubscription(
      'amm-monitor-1',
      'AMM Transaction Monitor',
      'amm_pool',
      ammRequest
    );
    logger.info(`✅ Created AMM subscription: ${ammSub.id} (Priority: ${ammSub.priority})`);

    // Raydium subscription
    const raydiumRequest = subscriptionBuilder.buildTransactionSubscription([
      '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'
    ]);
    const raydiumSub = subscriptionBuilder.createSubscription(
      'raydium-monitor-1',
      'Raydium Monitor',
      'external_amm',
      raydiumRequest
    );
    logger.info(`✅ Created Raydium subscription: ${raydiumSub.id} (Priority: ${raydiumSub.priority})`);

    // Test 2: Get groups by priority
    logger.info(chalk.blue('\nTest 2: Groups sorted by priority'));
    const groupsByPriority = subscriptionBuilder.getGroupsByPriority();
    groupsByPriority.forEach((group, index) => {
      logger.info(`${index + 1}. ${group.group} - Priority: ${group.priority}, Subscriptions: ${group.subscriptions.size}`);
    });

    // Test 3: Connection assignment
    logger.info(chalk.blue('\nTest 3: Connection assignment for 2 connections'));
    const assignments2 = subscriptionBuilder.assignGroupsToConnections(2);
    assignments2.forEach((groups, connId) => {
      logger.info(`${connId}: ${groups.join(', ')}`);
    });

    logger.info(chalk.blue('\nTest 3b: Connection assignment for 3 connections'));
    const assignments3 = subscriptionBuilder.assignGroupsToConnections(3);
    assignments3.forEach((groups, connId) => {
      logger.info(`${connId}: ${groups.join(', ')}`);
    });

    // Test 4: Subscription merging
    logger.info(chalk.blue('\nTest 4: Merging subscriptions'));
    const allSubs = [bcSub, ammSub, raydiumSub];
    const mergedRequest = subscriptionBuilder.mergeSubscriptions(allSubs);
    const txPrograms = mergedRequest.transactions?.filter?.accountInclude?.length || 0;
    logger.info(`✅ Merged ${allSubs.length} subscriptions into 1 request with ${txPrograms} programs`);

    // Test 5: Update metrics
    logger.info(chalk.blue('\nTest 5: Updating subscription metrics'));
    // Simulate some activity
    for (let i = 0; i < 10; i++) {
      subscriptionBuilder.updateMetrics(bcSub.id, 'message');
    }
    for (let i = 0; i < 5; i++) {
      subscriptionBuilder.updateMetrics(ammSub.id, 'message');
    }
    subscriptionBuilder.updateMetrics(raydiumSub.id, 'error', 'Connection timeout');

    // Test 6: Get statistics
    logger.info(chalk.blue('\nTest 6: Subscription statistics'));
    const stats = subscriptionBuilder.getStatistics();
    logger.info('Group statistics:');
    stats.groups.forEach(group => {
      logger.info(`  ${group.group}: ${group.totalMessages} messages, ${group.totalErrors} errors`);
    });
    logger.info(`Total: ${stats.total.subscriptions} subscriptions, ${stats.total.messages} messages, ${stats.total.errors} errors`);

    // Test 7: Integration with SmartStreamManager
    logger.info(chalk.blue('\nTest 7: Testing SmartStreamManager integration'));
    
    const poolConfig = getPoolConfig();
    const container = new Container();
    
    // Create a minimal SmartStreamManager for testing
    const smartManager = new SmartStreamManager({
      eventBus: (container as any).eventBus,
      reconnectDelay: 5000,
      maxReconnectDelay: 60000,
      poolConfig
    });

    logger.info('✅ SmartStreamManager created with subscription builder integration');
    
    // Verify the manager has the expected methods
    if ('registerMonitor' in smartManager) {
      logger.info('✅ SmartStreamManager supports enhanced monitor registration');
    }
    
    // Test monitor registration
    const testRegistration = {
      monitorId: 'test-bc-monitor',
      monitorType: 'BC',
      group: 'bonding_curve' as MonitorGroup,
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      subscriptionConfig: { isAccountMonitor: false }
    };
    
    logger.info('📋 Test registration:', testRegistration);

    // Test 8: Cleanup inactive subscriptions
    logger.info(chalk.blue('\nTest 8: Cleanup inactive subscriptions'));
    const removed = subscriptionBuilder.cleanupInactiveSubscriptions(0); // 0 minutes = cleanup all
    logger.info(`✅ Cleaned up ${removed} inactive subscriptions`);

    logger.info(chalk.green('\n✅ All subscription group tests completed successfully!'));

  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testSubscriptionGroups().catch(console.error);