/**
 * Debug Test for Liquidity Monitor
 * Logs all messages to understand what's being received
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger, LogLevel } from '../core/logger';
import { TOKENS } from '../core/container';
import { StreamManager } from '../core/stream-manager';

// Set log level to DEBUG to see everything
Logger.setGlobalLevel(LogLevel.DEBUG);

const logger = new Logger({ context: 'TestLiquidityDebug', color: chalk.cyan });

async function debugLiquidityMonitor() {
  logger.info('🔍 Debug Test for Liquidity Monitor...');
  
  let container: any;
  let streamManager: StreamManager;
  
  try {
    // Create container
    container = await createContainer();
    
    // Get EventBus
    const eventBus = await container.resolve('EventBus' as any) as EventBus;
    
    // Pre-resolve required services
    await container.resolve(TOKENS.StreamClient);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    
    // Get StreamManager
    streamManager = await container.resolve(TOKENS.StreamManager) as StreamManager;
    
    // Track all messages
    let totalMessages = 0;
    let ammMessages = 0;
    const logCounts = new Map<string, number>();
    const sampleLogs: string[][] = [];
    
    // Subscribe directly to AMM programs
    logger.info('Creating direct subscription to AMM programs...');
    
    const subscriptionConfig = {
      commitment: 'confirmed' as const,
      accounts: {},
      slots: {},
      transactions: {
        'liquidity_debug': {
          vote: false,
          failed: false,
          accountInclude: [
            'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
            '61acRgpURKTU8LKPJKs6WQa18KzD9ogavXzjxfD84KLu'
          ],
          accountExclude: [],
          accountRequired: []
        }
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: []
    };
    
    // Hook into the stream manager's message processing
    let originalHandler: any;
    const messageHandler = (data: any) => {
      totalMessages++;
      
      try {
        // Check if it's an AMM-related message
        if (data.transaction) {
          const accounts = data.transaction?.transaction?.transaction?.message?.accountKeys || [];
          const hasAmm = accounts.some((key: any) => {
            const address = Buffer.isBuffer(key) ? key.toString('base64') : key;
            return address.includes('pAMM') || address.includes('61ac');
          });
          
          if (hasAmm) {
            ammMessages++;
            
            // Get logs
            const logs = data.transaction?.meta?.logMessages || 
                        data.transaction?.transaction?.meta?.logMessages || [];
            
            // Count log patterns
            for (const log of logs) {
              // Look for any instruction patterns
              if (log.includes('Instruction:')) {
                const match = log.match(/Instruction:\s*(\w+)/);
                if (match) {
                  const instruction = match[1];
                  logCounts.set(instruction, (logCounts.get(instruction) || 0) + 1);
                }
              }
              
              // Look for specific patterns
              const patterns = [
                'liquidity', 'Liquidity',
                'add_liquidity', 'AddLiquidity',
                'remove_liquidity', 'RemoveLiquidity',
                'mint_lp', 'burn_lp',
                'fee', 'Fee',
                'swap', 'Swap'
              ];
              
              for (const pattern of patterns) {
                if (log.toLowerCase().includes(pattern.toLowerCase())) {
                  const key = `contains_${pattern}`;
                  logCounts.set(key, (logCounts.get(key) || 0) + 1);
                }
              }
            }
            
            // Save sample logs for first few AMM messages
            if (sampleLogs.length < 5 && logs.length > 0) {
              sampleLogs.push(logs);
            }
          }
        }
      } catch (error) {
        logger.error('Error processing message:', error);
      }
      
      // Display progress
      if (totalMessages % 100 === 0) {
        process.stdout.write(chalk.gray(`\r[${totalMessages} msgs] `) +
          chalk.yellow(`AMM: ${ammMessages} | `) +
          chalk.cyan(`Instructions: ${logCounts.size}`)
        );
      }
    };
    
    // Start monitoring by hooking into the existing stream
    if (streamManager['stream']) {
      streamManager['stream'].on('data', messageHandler);
      logger.info('Hooked into existing stream, monitoring for 30 seconds...');
    } else {
      // Start the stream manager
      await streamManager.start();
      // Try again
      if (streamManager['stream']) {
        streamManager['stream'].on('data', messageHandler);
        logger.info('Stream started, monitoring for 30 seconds...');
      } else {
        throw new Error('Could not access stream');
      }
    }
    
    // Wait 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Display results
    console.log('\n\n' + chalk.green('=== Debug Results ==='));
    
    console.log(chalk.cyan('\n📊 Message Statistics:'));
    console.log(`  Total Messages: ${totalMessages}`);
    console.log(`  AMM Messages: ${ammMessages}`);
    console.log(`  AMM Rate: ${((ammMessages / totalMessages) * 100).toFixed(2)}%`);
    
    console.log(chalk.yellow('\n📋 Instruction Counts:'));
    const sortedCounts = Array.from(logCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [instruction, count] of sortedCounts.slice(0, 20)) {
      console.log(`  ${instruction}: ${count}`);
    }
    
    console.log(chalk.magenta('\n📜 Sample Logs:'));
    sampleLogs.slice(0, 3).forEach((logs, i) => {
      console.log(`\nSample ${i + 1}:`);
      logs.slice(0, 10).forEach(log => console.log(`  ${log}`));
    });
    
  } catch (error) {
    logger.error('Debug test failed:', error);
    throw error;
  } finally {
    await new Promise(resolve => setTimeout(resolve, 2000));
    logger.info('Debug test complete!');
    process.exit(0);
  }
}

// Run the debug test
debugLiquidityMonitor().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});