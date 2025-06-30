#!/usr/bin/env tsx

/**
 * Simple test of BC Account Monitor
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../src/core/container-factory';
import { BCAccountMonitor } from '../src/monitors/bc-account-monitor';

async function main() {
  try {
    const container = await createContainer();
    const monitor = new BCAccountMonitor(container);
    
    // Override processStreamData to log everything
    const originalProcess = monitor.processStreamData.bind(monitor);
    let dataCount = 0;
    
    monitor.processStreamData = async function(data: any) {
      dataCount++;
      console.log(`[${dataCount}] Data received:`, {
        keys: Object.keys(data),
        hasAccount: !!data.account,
        hasPing: !!data.ping,
        hasTransaction: !!data.transaction
      });
      
      if (data.account) {
        console.log('  Account structure:', {
          keys: Object.keys(data.account),
          pubkey: data.account.pubkey,
          pubkeyType: typeof data.account.pubkey,
          isBuffer: Buffer.isBuffer(data.account.pubkey),
          accountKeys: data.account.account ? Object.keys(data.account.account) : []
        });
        
        // Try to extract pubkey
        let pubkeyStr = 'unknown';
        if (typeof data.account.pubkey === 'string') {
          pubkeyStr = data.account.pubkey;
        } else if (Buffer.isBuffer(data.account.pubkey)) {
          pubkeyStr = require('bs58').encode(data.account.pubkey);
        }
        
        console.log('  Decoded pubkey:', pubkeyStr.substring(0, 20) + '...');
      }
      
      return originalProcess(data);
    };
    
    console.log(chalk.blue('Starting BC Account Monitor...'));
    await monitor.start();
    
    // Run for 30 seconds
    setTimeout(() => {
      console.log(chalk.green(`\nReceived ${dataCount} data packets`));
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    console.error(chalk.red('Failed to start:'), error);
    process.exit(1);
  }
}

main().catch(console.error);