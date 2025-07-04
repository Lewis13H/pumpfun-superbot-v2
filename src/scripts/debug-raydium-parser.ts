/**
 * Debug Raydium Parser
 * Analyzes why Raydium transactions are not being parsed
 */

import 'dotenv/config';
import chalk from 'chalk';
import Client from '@triton-one/yellowstone-grpc';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { Logger, LogLevel } from '../core/logger';
import { SimpleRaydiumTradeStrategy } from '../utils/parsers/strategies/raydium-trade-strategy-simple';
import { PublicKey } from '@solana/web3.js';

// Set log level to DEBUG for detailed output
Logger.setGlobalLevel(LogLevel.DEBUG);

const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function main() {
  const logger = new Logger({ context: 'RaydiumDebug', color: chalk.yellow });
  const parser = new SimpleRaydiumTradeStrategy();
  
  try {
    console.log(chalk.yellow(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║      🔍 Raydium Parser Debug 🔍                      ║
║                                                       ║
║      Analyzing Raydium transaction parsing            ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`));

    logger.info('Creating debug Raydium stream...');
    
    const client = new Client(
      process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.ams.shyft.to',
      process.env.SHYFT_GRPC_TOKEN!,
      { '0.1.0': {} }
    );
    
    const stream = await client.subscribe();
    
    const request = {
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
      ping: undefined,
      transactions: {
        raydium: {
          vote: false,
          failed: false,
          accountInclude: [RAYDIUM_PROGRAM_ID],
          accountExclude: [],
          accountRequired: []
        }
      },
      slots: {},
      accounts: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      transactionsStatus: {}
    };
    
    logger.info('Subscribing to Raydium transactions...');
    
    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err === null || err === undefined) {
          logger.info(chalk.green('✅ Connected to Raydium stream'));
          resolve();
        } else {
          reject(err);
        }
      });
    });
    
    let txCount = 0;
    let raydiumCount = 0;
    let debuggedCount = 0;
    const maxDebug = 5; // Debug first 5 Raydium transactions
    
    // Process stream
    stream.on('data', async (data: any) => {
      try {
        txCount++;
        
        if (!data?.transaction) return;
        
        const tx = data.transaction.transaction;
        if (!tx?.transaction) return;
        
        // Check if parser can handle this
        if (!parser.canParse(tx.transaction)) {
          return;
        }
        
        raydiumCount++;
        
        // Debug first few Raydium transactions
        if (debuggedCount < maxDebug) {
          debuggedCount++;
          
          logger.info(chalk.yellow(`\n=== Debugging Raydium Transaction ${debuggedCount}/${maxDebug} ===`));
          logger.info(`Signature: ${tx.signature?.slice(0, 16)}...`);
          
          // Analyze transaction structure
          const message = tx.transaction?.message;
          if (message) {
            const instructions = message.instructions || [];
            const accountKeys = message.accountKeys || [];
            
            logger.info(`Instructions: ${instructions.length}`);
            logger.info(`Account keys: ${accountKeys.length}`);
            
            // Find Raydium instructions
            for (let i = 0; i < instructions.length; i++) {
              const ix = instructions[i];
              const programIdIndex = ix.programIdIndex;
              
              if (typeof programIdIndex === 'number' && accountKeys[programIdIndex]) {
                let programId: string;
                const key = accountKeys[programIdIndex];
                
                if (typeof key === 'string') {
                  programId = key;
                } else if (Buffer.isBuffer(key) && key.length === 32) {
                  try {
                    programId = new PublicKey(key).toBase58();
                  } catch {
                    continue;
                  }
                } else if (key?.pubkey) {
                  programId = key.pubkey;
                } else {
                  continue;
                }
                
                if (programId === RAYDIUM_PROGRAM_ID) {
                  logger.info(chalk.green(`Found Raydium instruction at index ${i}`));
                  
                  // Decode instruction data
                  const data = ix.data;
                  if (data) {
                    try {
                      const decoded = Buffer.from(data, 'base64');
                      const instructionType = decoded[0];
                      
                      logger.info(`Instruction type: ${instructionType}`);
                      logger.info(`Data length: ${decoded.length} bytes`);
                      logger.info(`First 16 bytes (hex): ${decoded.slice(0, 16).toString('hex')}`);
                      logger.info(`Account count: ${ix.accounts?.length || 0}`);
                      
                      // Check if it's a swap instruction
                      if (instructionType === 9 || instructionType === 11) {
                        logger.info(chalk.green(`✓ This is a swap instruction! Type: ${instructionType === 9 ? 'SwapBaseIn' : 'SwapBaseOut'}`));
                      } else {
                        logger.info(chalk.red(`✗ Not a swap instruction. Type: ${instructionType}`));
                      }
                      
                      // Check for logs
                      const logs = tx.meta?.logMessages || [];
                      const rayLog = logs.find((log: string) => log.includes('ray_log:'));
                      if (rayLog) {
                        logger.info(chalk.green('✓ Found ray_log in transaction logs'));
                      } else {
                        logger.info(chalk.red('✗ No ray_log found in transaction logs'));
                      }
                      
                    } catch (e) {
                      logger.error('Failed to decode instruction data', e as Error);
                    }
                  }
                }
              }
            }
          }
          
          // Try parsing
          logger.info('\nAttempting to parse transaction...');
          const events = await parser.parse(tx.transaction, tx);
          
          if (events.length === 0) {
            logger.info(chalk.red('✗ Parser returned no events'));
          } else {
            logger.info(chalk.green(`✓ Parser returned ${events.length} event(s)`));
            for (const event of events) {
              logger.info('Event:', {
                type: event.type,
                tradeType: event.tradeType,
                solAmount: event.solAmount.toString(),
                tokenAmount: event.tokenAmount.toString(),
                mint: event.mintAddress
              });
            }
          }
          
          if (debuggedCount >= maxDebug) {
            logger.info(chalk.yellow('\n=== Debug complete. Stopping... ==='));
            stream.cancel();
            process.exit(0);
          }
        }
        
      } catch (error) {
        logger.error('Error processing transaction', error as Error);
      }
    });
    
    // Display progress
    setInterval(() => {
      logger.info(`Progress: ${txCount} total, ${raydiumCount} Raydium, ${debuggedCount} debugged`);
    }, 5000);
    
    // Handle errors
    stream.on('error', (error: any) => {
      logger.error('Stream error', error);
    });
    
    stream.on('end', () => {
      logger.info('Stream ended');
    });
    
  } catch (error) {
    logger.error('Failed to start debug', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);