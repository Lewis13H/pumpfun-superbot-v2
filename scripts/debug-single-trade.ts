#!/usr/bin/env tsx

/**
 * Debug a single BC trade
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { BCMonitor } from '../src/monitors/bc-monitor';
import { Logger, LogLevel } from '../src/core/logger';
import { EVENTS } from '../src/core/event-bus';

// Enable debug logging
Logger.setGlobalLevel(LogLevel.DEBUG);

async function main() {
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus' as any);

    let captured = false;

    // Capture just one trade with full details
    eventBus.on(EVENTS.BC_TRADE, (data: any) => {
      if (captured) return;
      captured = true;
      
      const trade = data.trade;
      console.log(chalk.cyan('\n=== CAPTURED BC TRADE ==='));
      console.log(JSON.stringify(trade, (key, value) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      }, 2));
      
      setTimeout(() => process.exit(0), 1000);
    });

    const monitor = new BCMonitor(container);
    await monitor.start();
    
  } catch (error) {
    console.error(chalk.red('Failed to start:'), error);
    process.exit(1);
  }
}

main().catch(console.error);