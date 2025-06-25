#!/usr/bin/env node

import 'dotenv/config';
import { SolPriceService } from './services/sol-price';
import { SubscriptionHandler } from './stream/subscription';

let subscriptionHandler: SubscriptionHandler | null = null;

// Handle graceful shutdown
function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    console.log(`\n📡 Received ${signal}, shutting down gracefully...`);
    
    if (subscriptionHandler) {
      await subscriptionHandler.stop();
    }
    
    console.log('👋 Goodbye!');
    process.exit(0);
  };
  
  // Handle different termination signals
  process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C
  process.on('SIGTERM', () => shutdown('SIGTERM')); // Kill command
  process.on('SIGHUP', () => shutdown('SIGHUP'));   // Terminal closed
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    shutdown('uncaughtException');
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
  });
}

async function main() {
  console.log('🚀 Pump.fun Token Price Monitor');
  console.log('📊 Streaming live token prices...');
  console.log('⌨️  Press Ctrl+C to stop\n');
  
  try {
    // Setup graceful shutdown handlers
    setupGracefulShutdown();
    
    // Initialize SOL price service
    const solPriceService = SolPriceService.getInstance();
    await solPriceService.initialize();
    
    // Start subscription handler
    subscriptionHandler = new SubscriptionHandler();
    await subscriptionHandler.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();