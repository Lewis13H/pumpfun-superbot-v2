#!/usr/bin/env node
/**
 * Quick success test for BC monitor
 */

import 'dotenv/config';
import { createContainer } from '../src/core/container-factory';
import { BCMonitor } from '../src/monitors/bc-monitor';
import { TOKENS } from '../src/core/container';
import { EventBus, EVENTS } from '../src/core/event-bus';
import chalk from 'chalk';

process.env.DISABLE_MONITOR_STATS = 'true';

async function main() {
  console.log(chalk.cyan('Testing BC Monitor...'));
  
  const container = await createContainer();
  const eventBus = await container.resolve<EventBus>(TOKENS.EventBus);
  
  let tradesProcessed = 0;
  
  eventBus.on(EVENTS.TRADE_PROCESSED, () => {
    tradesProcessed++;
  });
  
  const bcMonitor = new BCMonitor(container);
  await bcMonitor.start();
  
  // Quick 5 second test
  setTimeout(() => {
    console.log(chalk.yellow(`Trades processed: ${tradesProcessed}`));
    if (tradesProcessed > 0) {
      console.log(chalk.green('✅ BC Monitor is working!'));
    } else {
      console.log(chalk.red('❌ BC Monitor not processing trades'));
    }
    
    bcMonitor.stop().then(() => {
      process.exit(tradesProcessed > 0 ? 0 : 1);
    });
  }, 5000);
}

main().catch(console.error);