#!/usr/bin/env node
import { DualProgramSubscription } from '../stream/dual-program-subscription';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 AMM-ONLY TEST MONITOR');
  console.log('Monitoring only AMM transactions for debugging\n');

  const subscription = new DualProgramSubscription({
    onTransaction: (event) => {
      if (event.type === 'amm_swap') {
        console.log('\n✅ AMM SWAP DETECTED!');
        console.log(event.event);
      }
    },
    onError: (error) => {
      console.error('❌ Error:', error.message);
    },
    onConnect: () => {
      console.log('✅ Connected to stream');
    },
  });

  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    subscription.disconnect();
    process.exit(0);
  });

  await subscription.subscribe();
}

main().catch(console.error);