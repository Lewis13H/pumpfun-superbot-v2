#!/usr/bin/env npx tsx

/**
 * Debug Account Monitoring
 * Check if we're receiving bonding curve account updates
 */

import 'dotenv/config';
import chalk from 'chalk';
import bs58 from 'bs58';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';

async function main() {
  const logger = new Logger({ context: 'Account-Debug', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🔍 Debugging Account Monitoring\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    // Stats
    let totalMessages = 0;
    let transactionMessages = 0;
    let accountMessages = 0;
    let bcProgram = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    let bondingCurveAccounts = 0;
    const sampleAccountUpdates: any[] = [];
    
    // Listen for raw stream data
    eventBus.on(EVENTS.STREAM_DATA, (data) => {
      totalMessages++;
      
      if (data.transaction) {
        transactionMessages++;
      } else if (data.account) {
        accountMessages++;
        
        // Check if it's a bonding curve account
        const account = data.account?.account;
        if (account?.owner) {
          const owner = typeof account.owner === 'string' ? 
            account.owner : 
            Buffer.isBuffer(account.owner) ? bs58.encode(account.owner) : '';
          
          if (owner === bcProgram) {
            bondingCurveAccounts++;
            
            // Capture first few for analysis
            if (sampleAccountUpdates.length < 3) {
              sampleAccountUpdates.push({
                pubkey: account.pubkey ? 
                  (typeof account.pubkey === 'string' ? account.pubkey : bs58.encode(account.pubkey)) : 
                  'unknown',
                owner,
                lamports: account.lamports,
                dataLength: account.data ? 
                  (typeof account.data === 'string' ? Buffer.from(account.data, 'base64').length : 
                   Array.isArray(account.data) ? account.data.length : 0) : 0,
                slot: data.slot
              });
            }
          }
        }
      }
    });
    
    // Listen for progress updates
    eventBus.on(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, (data) => {
      logger.info('📊 BC Progress Update', {
        mint: data.mintAddress?.substring(0, 8) + '...',
        progress: data.progress?.toFixed(2) + '%',
        complete: data.complete
      });
    });
    
    // Listen for graduation events
    eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
      logger.info('🎓 GRADUATION DETECTED!', {
        mint: data.mintAddress,
        slot: data.graduationSlot
      });
    });
    
    // Start monitor
    console.log('Starting TokenLifecycleMonitor...\n');
    
    const { TokenLifecycleMonitor } = await import('../monitors/domain/token-lifecycle-monitor');
    const monitor = new TokenLifecycleMonitor(container);
    await monitor.start();
    
    // Status updates
    const statusInterval = setInterval(() => {
      console.log(chalk.gray('\n─'.repeat(60)));
      console.log(chalk.cyan('📊 Account Monitoring Stats:'));
      console.log(`Total Messages: ${totalMessages}`);
      console.log(`Transaction Messages: ${transactionMessages} (${((transactionMessages/totalMessages)*100).toFixed(1)}%)`);
      console.log(`Account Messages: ${accountMessages} (${((accountMessages/totalMessages)*100).toFixed(1)}%)`);
      console.log(`Bonding Curve Accounts: ${bondingCurveAccounts}`);
      
      if (accountMessages === 0) {
        console.log(chalk.red('\n⚠️ No account messages received!'));
        console.log('This suggests account subscription is not working.');
      } else if (bondingCurveAccounts === 0) {
        console.log(chalk.yellow('\n⚠️ No bonding curve accounts detected'));
      }
      
      console.log(chalk.gray('─'.repeat(60)));
    }, 10000);
    
    // Run for 30 seconds
    setTimeout(async () => {
      clearInterval(statusInterval);
      
      console.log(chalk.yellow('\n\n🏁 Debug Complete!\n'));
      
      // Show sample account updates
      if (sampleAccountUpdates.length > 0) {
        console.log(chalk.cyan('Sample Bonding Curve Account Updates:'));
        sampleAccountUpdates.forEach((update, i) => {
          console.log(`\n${i + 1}. Account ${update.pubkey.substring(0, 8)}...`);
          console.log(`   Owner: ${update.owner}`);
          console.log(`   Lamports: ${update.lamports}`);
          console.log(`   Data Length: ${update.dataLength} bytes`);
          console.log(`   Slot: ${update.slot}`);
        });
      }
      
      // Analysis
      console.log(chalk.cyan('\n📋 Analysis:'));
      if (accountMessages === 0) {
        console.log(chalk.red('❌ Account subscription not working'));
        console.log('The monitor is not receiving account updates.');
        console.log('This is why graduations are not being detected.');
      } else if (bondingCurveAccounts === 0) {
        console.log(chalk.red('❌ No bonding curve accounts received'));
        console.log('Account updates are received but not for bonding curves.');
      } else {
        console.log(chalk.green(`✅ Receiving bonding curve account updates (${bondingCurveAccounts} total)`));
      }
      
      await monitor.stop();
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    logger.error('Debug failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);