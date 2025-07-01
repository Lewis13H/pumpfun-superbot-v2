#!/usr/bin/env tsx
/**
 * Standalone runner for AMM Monitor
 */

import { createContainer } from './core/container-factory';
import { AMMMonitor } from './monitors/amm-monitor';
import { TOKENS } from './core/container';

async function main() {
  console.log('\n🚀 Starting AMM Pool Monitor...\n');
  
  try {
    // Create and initialize container
    const container = await createContainer();
    
    // Pre-resolve shared services
    await container.resolve(TOKENS.EventBus);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    await container.resolve(TOKENS.PoolStateService);
    
    // Create and start monitor
    const monitor = new AMMMonitor(container);
    await monitor.start();
    
    // Keep process alive
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down AMM Monitor...');
      await monitor.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start AMM Monitor:', error);
    process.exit(1);
  }
}

main().catch(console.error);