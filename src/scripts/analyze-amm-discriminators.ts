/**
 * Analyze AMM transaction discriminators to understand what instructions are being called
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { StreamManager } from '../core/stream-manager';
import { TOKENS } from '../core/container';
import { Logger, LogLevel } from '../core/logger';

Logger.setGlobalLevel(LogLevel.INFO);

const logger = new Logger({ context: 'AnalyzeDiscriminators', color: chalk.cyan });

// Known discriminators
const KNOWN_DISCRIMINATORS = {
  'buy': [102, 6, 61, 18, 1, 218, 235, 234],
  'sell': [51, 230, 133, 164, 1, 127, 131, 173],
  'deposit': [242, 35, 198, 137, 82, 225, 242, 182],
  'withdraw': [183, 18, 70, 156, 148, 109, 161, 34],
  'create_pool': [233, 146, 209, 142, 207, 104, 64, 188],
  'create_config': [201, 207, 243, 114, 75, 111, 47, 189]
};

async function analyzeDiscriminators() {
  logger.info('🔍 Analyzing AMM transaction discriminators...');
  
  let container: any;
  const discriminatorCounts = new Map<string, number>();
  let totalMessages = 0;
  let ammMessages = 0;
  
  try {
    // Create container
    container = await createContainer();
    
    // Pre-resolve required services
    await container.resolve(TOKENS.StreamClient);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    
    // Get services
    const eventBus = await container.resolve('EventBus' as any);
    const streamManager = await container.resolve(TOKENS.StreamManager) as StreamManager;
    
    logger.info('Monitoring AMM transactions for 30 seconds...');
    
    // Hook into the stream data events
    eventBus.on('stream:data', (data: any) => {
        totalMessages++;
        
        if (data.transaction) {
          const logs = data.transaction?.meta?.logMessages || 
                       data.transaction?.transaction?.meta?.logMessages || [];
          
          // Look for Program data logs
          for (const log of logs) {
            if (log.includes('Program data:') && log.includes('pAMM')) {
              ammMessages++;
              
              const match = log.match(/Program data:\s*(.+)/);
              if (match && match[1]) {
                try {
                  const instructionData = Buffer.from(match[1], 'base64');
                  const discriminator = Array.from(instructionData.slice(0, 8));
                  const discriminatorStr = discriminator.join(',');
                  
                  // Check if it's a known discriminator
                  let instructionName = 'unknown';
                  for (const [name, disc] of Object.entries(KNOWN_DISCRIMINATORS)) {
                    if (disc.join(',') === discriminatorStr) {
                      instructionName = name;
                      break;
                    }
                  }
                  
                  discriminatorCounts.set(instructionName, (discriminatorCounts.get(instructionName) || 0) + 1);
                  
                  if (instructionName === 'deposit' || instructionName === 'withdraw') {
                    logger.info(`🎯 Found ${instructionName} instruction!`, {
                      signature: data.transaction?.transaction?.signature || 'unknown',
                      dataLength: instructionData.length,
                      discriminator: discriminatorStr
                    });
                  }
                } catch (error) {
                  // Ignore decode errors
                }
              }
            }
          }
        }
      }
    });
    
    // Wait 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Display results
    console.log('\n' + chalk.green('=== Analysis Results ==='));
    console.log(chalk.cyan(`\nTotal messages: ${totalMessages}`));
    console.log(chalk.cyan(`AMM messages: ${ammMessages}`));
    console.log(chalk.cyan(`AMM rate: ${((ammMessages / totalMessages) * 100).toFixed(2)}%`));
    
    console.log(chalk.yellow('\n📊 Instruction Distribution:'));
    const sortedCounts = Array.from(discriminatorCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [instruction, count] of sortedCounts) {
      const percentage = ((count / ammMessages) * 100).toFixed(1);
      console.log(`  ${instruction}: ${count} (${percentage}%)`);
    }
    
    if (discriminatorCounts.get('deposit') || discriminatorCounts.get('withdraw')) {
      console.log(chalk.green('\n✅ Liquidity instructions found!'));
    } else {
      console.log(chalk.yellow('\n⚠️ No liquidity instructions found in this sample'));
    }
    
  } catch (error) {
    logger.error('Analysis failed:', error);
  } finally {
    logger.info('Analysis complete!');
    process.exit(0);
  }
}

// Run the analysis
analyzeDiscriminators().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});