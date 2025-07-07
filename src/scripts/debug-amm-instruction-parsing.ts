#!/usr/bin/env npx tsx

/**
 * Debug AMM Instruction Parsing
 * Detailed analysis of why AMM trades aren't being parsed
 */

import 'dotenv/config';
import chalk from 'chalk';
import bs58 from 'bs58';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';

async function main() {
  const logger = new Logger({ context: 'AMM-Debug', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🔍 Debugging AMM Instruction Parsing\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    const parser = await container.resolve('EventParser') as UnifiedEventParser;
    
    const ammProgram = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    let ammTxCount = 0;
    let ammTradesParsed = 0;
    
    // Listen for parser events
    eventBus.on('parser:success', (data) => {
      if (data.eventType === 'AMM_TRADE' || data.eventType === 'amm_trade') {
        console.log(chalk.green(`✅ AMM Trade parsed by ${data.strategy}`));
      }
    });
    
    eventBus.on('parser:failed', (data) => {
      // Log failures for AMM transactions
    });
    
    // Listen for AMM transactions
    eventBus.on(EVENTS.STREAM_DATA, (data) => {
      if (!data?.transaction?.transaction?.transaction) return;
      
      const tx = data.transaction.transaction.transaction;
      const accounts = tx.message?.accountKeys || [];
      
      // Convert to strings
      const accountStrs = accounts.map((acc: any) => 
        typeof acc === 'string' ? acc : bs58.encode(acc)
      );
      
      // Check for AMM program
      if (!accountStrs.includes(ammProgram)) return;
      
      ammTxCount++;
      
      // Only debug first few
      if (ammTxCount <= 3) {
        console.log(chalk.yellow(`\n=== AMM Transaction #${ammTxCount} ===`));
        
        // Get signature
        const sig = data.transaction.transaction.signature;
        const signature = typeof sig === 'string' ? sig : bs58.encode(sig);
        console.log(`Signature: ${signature.substring(0, 20)}...`);
        
        // Check instructions
        const instructions = tx.message?.instructions || [];
        console.log(`Instructions: ${instructions.length}`);
        
        instructions.forEach((ix: any, i: number) => {
          const programIdIndex = ix.programIdIndex;
          const programId = programIdIndex < accountStrs.length ? accountStrs[programIdIndex] : 'unknown';
          console.log(`  [${i}] Program: ${programId.substring(0, 8)}...`);
          
          if (programId === ammProgram && ix.data) {
            const dataBuffer = Buffer.from(ix.data, 'base64');
            console.log(`       Data length: ${dataBuffer.length} bytes`);
            console.log(`       Discriminator: ${dataBuffer[0]}`);
            console.log(`       First 16 bytes: ${dataBuffer.slice(0, 16).toString('hex')}`);
          }
        });
        
        // Check inner instructions
        const innerInstructions = tx.meta?.innerInstructions || [];
        console.log(`Inner instructions: ${innerInstructions.length}`);
        
        // Try to parse
        console.log(chalk.cyan('\nAttempting to parse...'));
        const context = UnifiedEventParser.createContext(data);
        context.programId = ammProgram;
        
        const event = parser.parse(context);
        if (event) {
          ammTradesParsed++;
          console.log(chalk.green('✅ Successfully parsed!'));
          console.log(`Event type: ${event.type}`);
          if ('tradeType' in event) {
            console.log(`Trade type: ${event.tradeType}`);
          }
        } else {
          console.log(chalk.red('❌ Failed to parse'));
          
          // Get parser stats
          const stats = parser.getStats();
          console.log('Parser stats:', stats);
        }
      }
    });
    
    // Start monitor
    const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
    const monitor = new TradingActivityMonitor(container);
    await monitor.start();
    
    console.log('Monitoring AMM instruction parsing...\n');
    
    // Run for 20 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\n🏁 Debug Complete!\n'));
      console.log(`AMM Transactions: ${ammTxCount}`);
      console.log(`AMM Trades Parsed: ${ammTradesParsed}`);
      
      if (ammTxCount > 0 && ammTradesParsed === 0) {
        console.log(chalk.red('\n❌ AMM parsing is failing'));
        console.log('Possible issues:');
        console.log('1. Instruction data format has changed');
        console.log('2. Discriminators are different');
        console.log('3. Transaction structure is different');
      }
      
      // Get final parser stats
      const stats = parser.getStats();
      console.log('\nFinal parser stats:', stats);
      
      process.exit(0);
    }, 20000);
    
  } catch (error) {
    logger.error('Debug failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);