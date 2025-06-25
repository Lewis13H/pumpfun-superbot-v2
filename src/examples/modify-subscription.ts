#!/usr/bin/env node

import 'dotenv/config';
import { SubscriptionHandler } from '../stream/subscription';
import { SolPriceService } from '../services/sol-price';
import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';

/**
 * Example demonstrating how to modify subscription without disconnecting
 * Based on Shyft's modifying_subscribe_request example
 */

// Different token program addresses for demonstration
const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

async function main() {
  console.log('🔄 Subscription Modification Demo');
  console.log('This demo will switch between monitoring Pump.fun and Jupiter programs\n');
  
  // Initialize services
  const solPriceService = SolPriceService.getInstance();
  await solPriceService.initialize();
  
  const subscriptionHandler = new SubscriptionHandler();
  
  // Start with Pump.fun monitoring
  console.log('📍 Starting with Pump.fun monitoring...');
  await subscriptionHandler.start();
  
  // After 30 seconds, switch to Jupiter
  setTimeout(async () => {
    console.log('\n🔁 Switching to Jupiter monitoring...');
    
    const jupiterRequest: SubscribeRequest = {
      transactions: {
        jupiter: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [JUPITER_PROGRAM],
          accountExclude: [],
          accountRequired: [],
        },
      },
      accounts: {},
      slots: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.CONFIRMED,
    };
    
    await subscriptionHandler.updateSubscription(jupiterRequest);
  }, 30000);
  
  // After 60 seconds, switch back to Pump.fun
  setTimeout(async () => {
    console.log('\n🔁 Switching back to Pump.fun monitoring...');
    
    const pumpRequest: SubscribeRequest = {
      transactions: {
        pumpfun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_PROGRAM],
          accountExclude: [],
          accountRequired: [],
        },
      },
      accounts: {},
      slots: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.CONFIRMED,
    };
    
    await subscriptionHandler.updateSubscription(pumpRequest);
  }, 60000);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n📡 Shutting down...');
    await subscriptionHandler.stop();
    process.exit(0);
  });
}

main().catch(console.error);