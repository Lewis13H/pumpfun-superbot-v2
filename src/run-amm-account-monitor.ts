#!/usr/bin/env tsx
/**
 * Standalone runner for AMM Account Monitor
 */

import { createContainer } from './core/container-factory';
import { AMMAccountMonitor } from './monitors/amm-account-monitor';
import { TOKENS } from './core/container';

async function main() {
  console.log('\n🚀 Starting AMM Account Monitor...\n');
  
  try {
    // Create and initialize container
    const container = await createContainer();
    
    // Pre-resolve shared services
    await container.resolve(TOKENS.EventBus);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    await container.resolve(TOKENS.AmmPoolStateService);
    
    // Create and start monitor
    const monitor = new AMMAccountMonitor(container);
    await monitor.start();
    
    // Keep process alive
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down AMM Account Monitor...');
      await monitor.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start AMM Account Monitor:', error);
    process.exit(1);
  }
}

main().catch(console.error);