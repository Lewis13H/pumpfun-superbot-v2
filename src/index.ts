#!/usr/bin/env node

import 'dotenv/config';
import { SolPriceService } from './services/sol-price';
import { SubscriptionHandler } from './stream/subscription';

async function main() {
  console.log('Pump.fun Token Price Monitor');
  console.log('Streaming live token prices...\n');
  
  try {
    // Initialize SOL price service
    const solPriceService = SolPriceService.getInstance();
    await solPriceService.initialize();
    
    // Start subscription handler
    const subscriptionHandler = new SubscriptionHandler();
    await subscriptionHandler.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();