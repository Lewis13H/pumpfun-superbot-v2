#!/usr/bin/env tsx

/**
 * Test the BC Account Monitor for graduations
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { BCAccountMonitorRefactored } from '../src/monitors/bc-account-monitor-refactored';
import { Logger, LogLevel } from '../src/core/logger';
import { EVENTS } from '../src/core/event-bus';

// Enable debug logging
Logger.setGlobalLevel(LogLevel.INFO);

async function main() {
  try {
    console.log(chalk.blue('================================='));
    console.log(chalk.blue('BC Account Monitor Test'));
    console.log(chalk.blue('================================='));
    
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus' as any);
    const dbService = await container.resolve('DatabaseService' as any);
    
    let graduationCount = 0;
    let accountUpdateCount = 0;
    
    // Listen for graduation events
    eventBus.on(EVENTS.TOKEN_GRADUATED, async (data: any) => {
      graduationCount++;
      console.log(chalk.green('\n🎓 GRADUATION DETECTED!'));
      console.log(`Bonding Curve: ${data.bondingCurveKey}`);
      console.log(`Virtual SOL: ${Number(data.virtualSolReserves) / 1e9} SOL`);
      console.log(`Complete: ${data.complete}`);
      console.log(`Slot: ${data.slot}`);
      
      // TODO: The monitor doesn't save graduations to DB
      // We need to derive the mint address from the bonding curve address
      // and update the tokens_unified table
    });
    
    // Track all events
    eventBus.on('*', (eventName: string, data: any) => {
      if (eventName.startsWith('monitor:')) {
        console.log(chalk.gray(`Event: ${eventName}`));
      }
    });
    
    const monitor = new BCAccountMonitorRefactored(container);
    await monitor.start();
    
    console.log(chalk.green('\n✅ Account monitor started!'));
    console.log(chalk.gray('Monitoring for account updates and graduations...'));
    
    // Run for 60 seconds then show summary
    setTimeout(async () => {
      console.log(chalk.yellow('\n=== SUMMARY ==='));
      console.log(`Total graduations detected: ${graduationCount}`);
      
      // Check if any graduations were saved to DB
      const recentGraduations = await dbService.query(
        `SELECT COUNT(*) as count FROM tokens_unified 
         WHERE graduated_to_amm = true 
         AND graduation_at > NOW() - INTERVAL '1 minute'`
      );
      
      console.log(`Graduations in DB (last minute): ${recentGraduations.rows[0].count}`);
      
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    console.error(chalk.red('Failed to start:'), error);
    process.exit(1);
  }
}

main().catch(console.error);