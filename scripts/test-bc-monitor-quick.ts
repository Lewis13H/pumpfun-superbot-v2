#!/usr/bin/env node
/**
 * Quick test of BC monitor with fixes
 */

import 'dotenv/config';
import { createContainer } from '../src/core/container-factory';
import { BCMonitor } from '../src/monitors/bc-monitor';
import { TOKENS } from '../src/core/container';
import { EventBus, EVENTS } from '../src/core/event-bus';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan('🔍 Testing BC Monitor with fixes'));
  
  // Disable stats display
  process.env.DISABLE_MONITOR_STATS = 'true';
  
  // Create container
  const container = await createContainer();
  const eventBus = await container.resolve<EventBus>(TOKENS.EventBus);
  
  // Track events
  let streamDataCount = 0;
  let tradesProcessed = 0;
  let tokensDiscovered = 0;
  
  eventBus.on(EVENTS.STREAM_DATA, () => {
    streamDataCount++;
  });
  
  eventBus.on(EVENTS.TRADE_PROCESSED, (data) => {
    tradesProcessed++;
    if (tradesProcessed === 1) {
      console.log(chalk.green('🎉 First trade processed!'), {
        mint: data.mintAddress.substring(0, 8) + '...',
        type: data.tradeType,
        marketCap: `$${data.marketCapUsd.toFixed(0)}`
      });
    }
  });
  
  eventBus.on(EVENTS.TOKEN_DISCOVERED, () => {
    tokensDiscovered++;
    console.log(chalk.yellow(`💎 Token discovered! Total: ${tokensDiscovered}`));
  });
  
  // Create and start monitor
  const bcMonitor = new BCMonitor(container);
  await bcMonitor.start();
  
  // Monitor for 20 seconds
  setTimeout(() => {
    console.log(chalk.cyan('\n📊 Test Results:'));
    console.log(`   Stream data events: ${streamDataCount}`);
    console.log(`   Trades processed: ${tradesProcessed}`);
    console.log(`   Tokens discovered: ${tokensDiscovered}`);
    
    if (tradesProcessed === 0) {
      console.log(chalk.red('\n❌ No trades processed - still an issue'));
    } else {
      console.log(chalk.green(`\n✅ Success! ${tradesProcessed} trades processed`));
    }
    
    bcMonitor.stop().then(() => {
      process.exit(0);
    });
  }, 20000);
}

main().catch(console.error);