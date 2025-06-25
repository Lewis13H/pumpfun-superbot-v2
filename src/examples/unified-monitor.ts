#!/usr/bin/env node
import 'dotenv/config';
import { UnifiedMonitor } from '../monitor/unified';

async function main() {
  const monitor = new UnifiedMonitor();
  
  // Set up graceful shutdown
  const shutdown = async () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    await monitor.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  
  try {
    await monitor.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main().catch(console.error);