#!/usr/bin/env tsx

/**
 * Debug logs for BC trades
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { UnifiedEventParser } from '../src/parsers/unified-event-parser';
import { BCMonitor } from '../src/monitors/bc-monitor';
import { Logger, LogLevel } from '../src/core/logger';

// Enable debug logging
Logger.setGlobalLevel(LogLevel.DEBUG);

async function main() {
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus' as any);
    
    let captured = false;

    // Override processStreamData to capture raw data
    const monitor = new BCMonitor(container);
    const originalProcess = monitor.processStreamData.bind(monitor);
    
    monitor.processStreamData = async function(data: any) {
      if (!captured && data.transaction) {
        captured = true;
        
        const context = UnifiedEventParser.createContext(data);
        console.log(chalk.cyan('\n=== CAPTURED TRANSACTION ==='));
        console.log('Signature:', context.signature);
        console.log('Accounts:', context.accounts.length);
        console.log('Has data:', !!context.data);
        console.log('Data size:', context.data?.length);
        console.log('\n=== LOGS ===');
        context.logs.forEach((log, i) => {
          console.log(`[${i}] ${log}`);
        });
        
        setTimeout(() => process.exit(0), 1000);
      }
      
      return originalProcess(data);
    };
    
    await monitor.start();
    
  } catch (error) {
    console.error(chalk.red('Failed to start:'), error);
    process.exit(1);
  }
}

main().catch(console.error);