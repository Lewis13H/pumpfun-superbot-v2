#!/usr/bin/env node

/**
 * Test script to verify bonding curve account handler is working
 */

import { Container } from '../core/container';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import { EventBus, EVENTS } from '../core/event-bus';

async function testAccountHandler() {
  console.log('🧪 Testing Bonding Curve Account Handler...\n');
  
  const container = new Container();
  const eventBus = await container.resolve('EventBus') as EventBus;
  
  // Listen for bonding curve events
  let progressUpdateCount = 0;
  let graduationCount = 0;
  
  eventBus.on(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, (data) => {
    progressUpdateCount++;
    console.log('📊 BC Progress Update:', {
      mint: data.mintAddress?.substring(0, 8) + '...',
      bondingCurve: data.bondingCurveAddress?.substring(0, 8) + '...',
      progress: data.progress?.toFixed(2) + '%',
      complete: data.complete,
      solInCurve: data.solInCurve?.toFixed(4) + ' SOL'
    });
  });
  
  eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
    graduationCount++;
    console.log('🎓 GRADUATION DETECTED!', {
      mint: data.mintAddress,
      bondingCurve: data.bondingCurveKey,
      slot: data.graduationSlot
    });
  });
  
  // Create and start monitor
  const monitor = new TokenLifecycleMonitor(container);
  
  console.log('Starting TokenLifecycleMonitor...');
  await monitor.start();
  
  // Wait for some data
  console.log('\nWaiting for account updates...');
  console.log('(First 5 account updates will show debug info)\n');
  
  // Run for 2 minutes
  const runtime = 120000;
  await new Promise(resolve => setTimeout(resolve, runtime));
  
  // Show results
  console.log('\n📈 Test Results:');
  console.log(`  Account Updates: ${progressUpdateCount}`);
  console.log(`  Graduations Detected: ${graduationCount}`);
  
  const stats = monitor.getStats();
  console.log('\n📊 Monitor Stats:');
  console.log(`  Total Account Updates: ${stats.accountUpdates}`);
  console.log(`  Account Handler: ${stats.accountHandler || 'unknown'}`);
  console.log(`  Graduations: ${stats.graduations}`);
  console.log(`  Near Graduations: ${stats.nearGraduations}`);
  console.log(`  Parse Rate: ${stats.parseRate}%`);
  
  // Stop monitor
  console.log('\nStopping monitor...');
  await monitor.stop();
  
  process.exit(0);
}

// Run test
testAccountHandler().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});