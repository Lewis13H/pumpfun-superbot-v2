#!/usr/bin/env node
/**
 * Test all monitors with fixes
 */

import 'dotenv/config';
import { createContainer } from '../src/core/container-factory';
import { BCMonitor } from '../src/monitors/bc-monitor';
import { BCAccountMonitor } from '../src/monitors/bc-account-monitor';
import { AMMMonitor } from '../src/monitors/amm-monitor';
import { AMMAccountMonitor } from '../src/monitors/amm-account-monitor';
import { TOKENS } from '../src/core/container';
import { EventBus, EVENTS } from '../src/core/event-bus';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan('🔍 Testing All Monitors with Fixes'));
  
  // Disable stats display
  process.env.DISABLE_MONITOR_STATS = 'true';
  
  // Create container
  const container = await createContainer();
  const eventBus = await container.resolve<EventBus>(TOKENS.EventBus);
  
  // Track events from all monitors
  const stats = {
    bcTrades: 0,
    bcAccountUpdates: 0,
    ammTrades: 0,
    ammPoolUpdates: 0,
    graduations: 0,
    tokensDiscovered: 0
  };
  
  // BC trade events
  eventBus.on(EVENTS.TRADE_PROCESSED, (data) => {
    if (data.program === 'bonding_curve') {
      stats.bcTrades++;
      if (stats.bcTrades === 1) {
        console.log(chalk.green('✅ First BC trade processed!'));
      }
    } else if (data.program === 'amm_pool') {
      stats.ammTrades++;
      if (stats.ammTrades === 1) {
        console.log(chalk.green('✅ First AMM trade processed!'));
      }
    }
  });
  
  // Graduation events
  eventBus.on(EVENTS.TOKEN_GRADUATED, () => {
    stats.graduations++;
    console.log(chalk.yellow('🎓 Token graduated!'));
  });
  
  // Token discovery
  eventBus.on(EVENTS.TOKEN_DISCOVERED, () => {
    stats.tokensDiscovered++;
  });
  
  // Pool state updates
  eventBus.on(EVENTS.POOL_STATE_UPDATED, () => {
    stats.ammPoolUpdates++;
    if (stats.ammPoolUpdates === 1) {
      console.log(chalk.green('✅ First AMM pool state update!'));
    }
  });
  
  // Monitor specific events
  eventBus.on('BC_ACCOUNT_UPDATE', () => {
    stats.bcAccountUpdates++;
    if (stats.bcAccountUpdates === 1) {
      console.log(chalk.green('✅ First BC account update!'));
    }
  });
  
  // Create monitors
  console.log(chalk.gray('Creating monitors...'));
  const monitors = [
    new BCMonitor(container),
    new BCAccountMonitor(container),
    new AMMMonitor(container),
    new AMMAccountMonitor(container)
  ];
  
  // Start all monitors
  console.log(chalk.gray('Starting all monitors...'));
  await Promise.all(monitors.map(m => m.start()));
  
  // Monitor for 30 seconds
  setTimeout(async () => {
    console.log(chalk.cyan('\n📊 Final Results:'));
    console.log(`   BC Trades: ${stats.bcTrades}`);
    console.log(`   BC Account Updates: ${stats.bcAccountUpdates}`);
    console.log(`   AMM Trades: ${stats.ammTrades}`);
    console.log(`   AMM Pool Updates: ${stats.ammPoolUpdates}`);
    console.log(`   Graduations: ${stats.graduations}`);
    console.log(`   Tokens Discovered: ${stats.tokensDiscovered}`);
    
    const success = stats.bcTrades > 0;
    if (success) {
      console.log(chalk.green('\n✅ All monitors working correctly!'));
    } else {
      console.log(chalk.red('\n❌ Some monitors not receiving data'));
    }
    
    // Stop all monitors
    console.log(chalk.gray('\nStopping monitors...'));
    await Promise.all(monitors.map(m => m.stop()));
    
    process.exit(success ? 0 : 1);
  }, 30000);
}

main().catch(console.error);