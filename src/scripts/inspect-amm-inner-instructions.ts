#!/usr/bin/env npx tsx

/**
 * Inspect AMM Inner Instructions
 * Check what data is available in the gRPC stream for AMM transactions
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import bs58 from 'bs58';

async function main() {
  const logger = new Logger({ context: 'InspectAMMInnerIx', color: chalk.cyan });
  
  console.log(chalk.cyan('\n🔍 Inspecting AMM Transaction Structure\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    let ammTxCount = 0;
    const dataStructureExamples: any[] = [];
    
    // Listen for raw stream data
    eventBus.on('stream:data', (data) => {
      if (!data?.transaction?.transaction?.transaction) return;
      
      const tx = data.transaction.transaction.transaction;
      const meta = data.transaction.meta;
      const accounts = tx.message?.accountKeys || [];
      
      // Check if it's an AMM transaction
      const hasAMM = accounts.some((acc: any) => {
        const accStr = typeof acc === 'string' ? acc : Buffer.isBuffer(acc) ? bs58.encode(acc) : '';
        return accStr.includes('pAMMBay6');
      });
      
      if (!hasAMM) return;
      
      ammTxCount++;
      
      // Analyze first few AMM transactions in detail
      if (ammTxCount <= 3) {
        console.log(chalk.yellow(`\n=== AMM Transaction #${ammTxCount} ===`));
        
        // Check data structure
        console.log('\nData Structure:');
        console.log(`  data.transaction exists: ${!!data.transaction}`);
        console.log(`  data.transaction.meta exists: ${!!data.transaction.meta}`);
        console.log(`  data.transaction.meta.innerInstructions exists: ${!!data.transaction.meta?.innerInstructions}`);
        
        if (meta) {
          console.log(`  meta.innerInstructions: ${meta.innerInstructions ? `Array(${meta.innerInstructions.length})` : 'undefined'}`);
          console.log(`  meta.logMessages: ${meta.logMessages ? `Array(${meta.logMessages.length})` : 'undefined'}`);
          console.log(`  meta.preTokenBalances: ${meta.preTokenBalances ? `Array(${meta.preTokenBalances.length})` : 'undefined'}`);
          console.log(`  meta.postTokenBalances: ${meta.postTokenBalances ? `Array(${meta.postTokenBalances.length})` : 'undefined'}`);
          
          // If inner instructions exist, show them
          if (meta.innerInstructions && meta.innerInstructions.length > 0) {
            console.log(chalk.green('\n✅ Inner Instructions Found!'));
            meta.innerInstructions.forEach((group: any, i: number) => {
              console.log(`\nInner Instruction Group ${i}:`);
              console.log(`  Index: ${group.index}`);
              console.log(`  Instructions: ${group.instructions?.length || 0}`);
              
              if (group.instructions && group.instructions.length > 0) {
                group.instructions.slice(0, 3).forEach((innerIx: any, j: number) => {
                  console.log(`    [${j}] programIdIndex: ${innerIx.programIdIndex}`);
                  if (innerIx.data) {
                    const dataBytes = Buffer.from(innerIx.data, 'base64');
                    console.log(`         data length: ${dataBytes.length} bytes`);
                    console.log(`         first byte: ${dataBytes[0]}`);
                  }
                });
              }
            });
          } else {
            console.log(chalk.red('\n❌ No Inner Instructions'));
          }
          
          // Check token balance changes
          if (meta.preTokenBalances && meta.postTokenBalances) {
            console.log(chalk.blue('\n💰 Token Balance Changes:'));
            const changes: any[] = [];
            
            for (const pre of meta.preTokenBalances) {
              const post = meta.postTokenBalances.find((p: any) => p.accountIndex === pre.accountIndex);
              if (post && pre.uiTokenAmount.uiAmount !== post.uiTokenAmount.uiAmount) {
                const change = post.uiTokenAmount.uiAmount - pre.uiTokenAmount.uiAmount;
                changes.push({
                  accountIndex: pre.accountIndex,
                  mint: pre.mint,
                  change,
                  decimals: pre.uiTokenAmount.decimals
                });
              }
            }
            
            if (changes.length > 0) {
              changes.forEach(c => {
                console.log(`  Account ${c.accountIndex}: ${c.change > 0 ? '+' : ''}${c.change.toFixed(6)}`);
                if (c.mint === 'So11111111111111111111111111111111111111112') {
                  console.log(`    = ${Math.abs(c.change)} SOL`);
                }
              });
            } else {
              console.log('  No token balance changes detected');
            }
          }
        }
        
        // Collect data structure info
        dataStructureExamples.push({
          hasInnerInstructions: !!meta?.innerInstructions,
          innerInstructionCount: meta?.innerInstructions?.length || 0,
          hasTokenBalances: !!(meta?.preTokenBalances && meta?.postTokenBalances),
          tokenBalanceChanges: meta?.preTokenBalances?.length || 0
        });
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Inspecting AMM transaction structure for 15 seconds...\n');
    
    // Run for 15 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n📊 Analysis Summary:\n'));
      console.log(`Total AMM Transactions: ${ammTxCount}`);
      
      if (dataStructureExamples.length > 0) {
        const hasInnerIx = dataStructureExamples.filter(d => d.hasInnerInstructions).length;
        const hasTokenBalances = dataStructureExamples.filter(d => d.hasTokenBalances).length;
        
        console.log(`\nData Availability:`);
        console.log(`  Inner Instructions: ${hasInnerIx}/${dataStructureExamples.length} (${(hasInnerIx/dataStructureExamples.length*100).toFixed(0)}%)`);
        console.log(`  Token Balances: ${hasTokenBalances}/${dataStructureExamples.length} (${(hasTokenBalances/dataStructureExamples.length*100).toFixed(0)}%)`);
        
        if (hasInnerIx === 0) {
          console.log(chalk.red('\n❌ Inner instructions are NOT included in the gRPC stream'));
          console.log(chalk.yellow('\n💡 Alternative Solution:'));
          console.log('Since inner instructions are not available, we should:');
          console.log('1. Use token balance changes to determine actual amounts');
          console.log('2. Parse transaction logs for additional data');
          console.log('3. Use heuristics to identify reasonable amounts');
        } else {
          console.log(chalk.green('\n✅ Inner instructions ARE available'));
          console.log('The parsing logic can be refined to extract actual amounts');
        }
      }
      
      process.exit(0);
    }, 15000);
    
  } catch (error) {
    logger.error('Inspection failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);