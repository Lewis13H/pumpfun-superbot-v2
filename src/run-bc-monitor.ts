#!/usr/bin/env tsx
/**
 * Standalone runner for BC Monitor
 */

import { createContainer } from './core/container-factory';
import { BCMonitor } from './monitors/bc-monitor';
import { GraduationHandler } from './handlers/graduation-handler';
import { TOKENS } from './core/container';

async function main() {
  console.log('\n🚀 Starting Bonding Curve Monitor...\n');
  
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
    const monitor = new BCMonitor(container);
    await monitor.start();
    
    // Keep process alive
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down BC Monitor...');
      await monitor.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start BC Monitor:', error);
    process.exit(1);
  }
}

main().catch(console.error);