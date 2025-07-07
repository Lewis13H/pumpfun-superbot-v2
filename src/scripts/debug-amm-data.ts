#!/usr/bin/env npx tsx

/**
 * Debug AMM Data
 * Script to see what data AMM transactions contain
 */

import 'dotenv/config';
import chalk from 'chalk';
import bs58 from 'bs58';
import { createContainer } from '../core/container-factory';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';

async function main() {
  const logger = new Logger({ context: 'AMM-Data-Debug', color: chalk.yellow });
  
  console.log(chalk.cyan('\n🔍 AMM Data Debugging Tool\n'));
  
  try {
    // Create container
    const container = await createContainer();
    
    // Track AMM-specific stats
    let ammTransactionsChecked = 0;
    const ammProgram = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    
    // Create custom trading monitor with data inspection
    class DataInspectorMonitor extends TradingActivityMonitor {
      protected async processTransaction(data: any): Promise<void> {
        const tx = data.transaction?.transaction?.transaction;
        if (!tx?.message) return;
        
        const accountKeys = tx.message.accountKeys || [];
        const accountStrs = accountKeys.map((acc: any) => 
          typeof acc === 'string' ? acc : bs58.encode(acc)
        );
        
        // Check if this is an AMM transaction
        if (accountStrs.includes(ammProgram)) {
          ammTransactionsChecked++;
          
          // Only inspect first 3 transactions in detail
          if (ammTransactionsChecked <= 3) {
            const signature = data.transaction?.transaction?.signature || 'unknown';
            logger.info('📝 AMM Transaction Data:', {
              signature: typeof signature === 'string' ? signature : bs58.encode(signature),
              accountCount: accountStrs.length
            });
            
            // Check instructions
            const instructions = tx.message?.instructions || [];
            console.log(chalk.yellow(`  Instructions: ${instructions.length}`));
            
            instructions.forEach((ix: any, index: number) => {
              const programIdIndex = ix.programIdIndex;
              const programId = programIdIndex < accountStrs.length ? accountStrs[programIdIndex] : 'unknown';
              console.log(chalk.gray(`  [${index}]: Program: ${programId}`));
              console.log(chalk.gray(`         Accounts: ${ix.accounts?.length || 0}`));
              if (ix.data) {
                console.log(chalk.gray(`         Data: ${ix.data} (${Buffer.from(ix.data, 'base64').length} bytes)`));
                // If it's AMM instruction, decode the first byte
                if (programId === ammProgram) {
                  const dataBuffer = Buffer.from(ix.data, 'base64');
                  const discriminator = dataBuffer[0];
                  console.log(chalk.green(`         ✨ AMM Instruction Discriminator: ${discriminator}`));
                }
              }
            });
            
            // Check inner instructions
            const innerInstructions = tx.meta?.innerInstructions || [];
            console.log(chalk.yellow(`  Inner Instructions: ${innerInstructions.length}`));
            
            // Create parse context to see what the parser gets
            const context = UnifiedEventParser.createContext(data);
            console.log(chalk.cyan('  Parse Context:'));
            console.log(`    - Signature: ${context.signature}`);
            console.log(`    - Accounts: ${context.accounts.length}`);
            console.log(`    - Logs: ${context.logs.length}`);
            console.log(`    - Has instruction data: ${!!context.data}`);
            if (context.data) {
              console.log(`    - Data length: ${context.data.length} bytes`);
              console.log(`    - Data (hex): ${context.data.toString('hex').substring(0, 64)}...`);
            }
            
            // Check if accounts include SOL mint
            const SOL_MINT = 'So11111111111111111111111111111111111111112';
            const hasSolMint = accountStrs.includes(SOL_MINT);
            console.log(`    - Has SOL mint: ${hasSolMint}`);
            
            // Try to identify token mint (non-SOL, non-program accounts)
            const potentialMints = accountStrs.filter(acc => 
              acc !== SOL_MINT && 
              acc !== ammProgram && 
              acc.length === 44
            );
            console.log(`    - Potential token mints: ${potentialMints.length}`);
            if (potentialMints.length > 0) {
              console.log(`      First: ${potentialMints[0]}`);
            }
            
            console.log('');
          }
        }
        
        // Don't call parent - we're just inspecting
      }
    }
    
    // Create and start the inspector monitor
    const monitor = new DataInspectorMonitor(container);
    await monitor.start();
    
    logger.info('Monitor started, analyzing AMM transaction data...');
    
    // Run for 20 seconds
    setTimeout(async () => {
      console.log(chalk.yellow('\n\n🏁 Analysis complete!'));
      console.log(`\nChecked ${ammTransactionsChecked} AMM transactions`);
      
      await monitor.stop();
      process.exit(0);
    }, 20000); // 20 seconds
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\nShutting down...'));
      await monitor.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start inspector', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);