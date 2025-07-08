#!/usr/bin/env npx tsx

/**
 * Check if gRPC stream includes inner instructions
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import bs58 from 'bs58';

async function main() {
  const logger = new Logger({ context: 'CheckInnerInstructions', color: chalk.cyan });
  
  console.log(chalk.cyan('\n🔍 Checking gRPC Data Structure for Inner Instructions\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    let txCount = 0;
    let withInnerIx = 0;
    let withTokenBalances = 0;
    const examples: any[] = [];
    
    // Listen for raw stream data
    eventBus.on('stream:data', (data) => {
      txCount++;
      
      // Deep dive into the data structure
      if (txCount <= 5) {
        console.log(chalk.yellow(`\n=== Transaction #${txCount} ===`));
        
        // Check all possible paths for meta
        const paths = [
          'data.transaction.transaction.meta',
          'data.transaction.meta',
          'data.meta',
          'data.transaction.transaction.transaction.meta'
        ];
        
        let meta = null;
        let metaPath = '';
        
        for (const path of paths) {
          const parts = path.split('.');
          let current = data;
          let valid = true;
          
          for (const part of parts.slice(1)) { // Skip 'data' prefix
            if (current && current[part] !== undefined) {
              current = current[part];
            } else {
              valid = false;
              break;
            }
          }
          
          if (valid && current) {
            meta = current;
            metaPath = path;
            break;
          }
        }
        
        console.log(`Meta found at: ${metaPath || 'NOT FOUND'}`);
        
        if (meta) {
          console.log('Meta fields present:');
          console.log(`  - err: ${meta.err !== undefined}`);
          console.log(`  - fee: ${meta.fee !== undefined}`);
          console.log(`  - logMessages: ${Array.isArray(meta.logMessages)} (${meta.logMessages?.length || 0} logs)`);
          console.log(`  - innerInstructions: ${Array.isArray(meta.innerInstructions)} (${meta.innerInstructions?.length || 0} groups)`);
          console.log(`  - preTokenBalances: ${Array.isArray(meta.preTokenBalances)} (${meta.preTokenBalances?.length || 0} items)`);
          console.log(`  - postTokenBalances: ${Array.isArray(meta.postTokenBalances)} (${meta.postTokenBalances?.length || 0} items)`);
          console.log(`  - preBalances: ${Array.isArray(meta.preBalances)}`);
          console.log(`  - postBalances: ${Array.isArray(meta.postBalances)}`);
          
          if (meta.innerInstructions && meta.innerInstructions.length > 0) {
            console.log(chalk.green('\n✅ INNER INSTRUCTIONS FOUND!'));
            console.log('Inner instruction groups:');
            meta.innerInstructions.forEach((group: any, i: number) => {
              console.log(`  Group ${i}: index=${group.index}, instructions=${group.instructions?.length || 0}`);
            });
            withInnerIx++;
          }
          
          if (meta.preTokenBalances && meta.postTokenBalances) {
            withTokenBalances++;
          }
        }
        
        // Check if it's an AMM transaction
        const tx = data.transaction?.transaction?.transaction || data.transaction?.transaction || data.transaction;
        if (tx?.message) {
          const accounts = tx.message.accountKeys || [];
          const hasAMM = accounts.some((acc: any) => {
            const accStr = typeof acc === 'string' ? acc : Buffer.isBuffer(acc) ? bs58.encode(acc) : '';
            return accStr.includes('pAMMBay6');
          });
          
          if (hasAMM) {
            console.log(chalk.blue('\n💧 This is an AMM transaction'));
            examples.push({
              hasInnerInstructions: !!meta?.innerInstructions?.length,
              innerInstructionCount: meta?.innerInstructions?.length || 0,
              hasTokenBalances: !!(meta?.preTokenBalances && meta?.postTokenBalances),
              metaPath
            });
          }
        }
      }
      
      // Count overall stats
      const meta = data.transaction?.transaction?.meta || data.transaction?.meta || data.meta;
      if (meta?.innerInstructions?.length > 0) {
        withInnerIx++;
      }
      if (meta?.preTokenBalances && meta?.postTokenBalances) {
        withTokenBalances++;
      }
    });
    
    // Start trading activity monitor (includes AMM)
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring gRPC stream for 30 seconds...\n');
    
    // Run for 30 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n📊 Final Results:\n'));
      console.log(`Total Transactions: ${txCount}`);
      console.log(`With Inner Instructions: ${withInnerIx} (${(withInnerIx/txCount*100).toFixed(1)}%)`);
      console.log(`With Token Balances: ${withTokenBalances} (${(withTokenBalances/txCount*100).toFixed(1)}%)`);
      
      if (examples.length > 0) {
        console.log(chalk.cyan('\n🏊 AMM Transaction Examples:'));
        examples.forEach((ex, i) => {
          console.log(`  ${i + 1}. Inner Instructions: ${ex.hasInnerInstructions} (${ex.innerInstructionCount})`);
          console.log(`     Token Balances: ${ex.hasTokenBalances}`);
          console.log(`     Meta Path: ${ex.metaPath}`);
        });
      }
      
      if (withInnerIx === 0) {
        console.log(chalk.red('\n❌ NO INNER INSTRUCTIONS FOUND IN gRPC STREAM'));
        console.log('\nPossible reasons:');
        console.log('1. Shyft gRPC endpoint may not include inner instructions');
        console.log('2. Need to request a different endpoint or use different parameters');
        console.log('3. May need to use RPC getTransaction for full data');
      } else {
        console.log(chalk.green('\n✅ Inner instructions ARE available in the gRPC stream'));
        console.log('The parsing code needs to be updated to access them properly');
      }
      
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    logger.error('Check failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);