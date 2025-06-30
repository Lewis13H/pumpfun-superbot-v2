#!/usr/bin/env tsx
/**
 * Standalone runner for BC Account Monitor
 */

import { createContainer } from './core/container-factory';
import { BCAccountMonitor } from './monitors/bc-account-monitor';
import { GraduationHandler } from './handlers/graduation-handler';
import { TOKENS } from './core/container';

async function main() {
  console.log('\n🚀 Starting BC Account Monitor...\n');
  
  try {
    // Create and initialize container
    const container = await createContainer();
    
    // Pre-resolve shared services
    await container.resolve(TOKENS.EventBus);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    
    // Initialize graduation handler
    const graduationHandler = await container.resolve(TOKENS.GraduationHandler);
    await (graduationHandler as GraduationHandler).initialize();
    
    // Create and start monitor
    const monitor = new BCAccountMonitor(container);
    await monitor.start();
    
    // Keep process alive
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down BC Account Monitor...');
      await monitor.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start BC Account Monitor:', error);
    process.exit(1);
  }
}

main().catch(console.error);