/**
 * Test script to check if we're receiving Raydium transactions
 */

import 'dotenv/config';
import Client from '@triton-one/yellowstone-grpc';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';

const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function testRaydiumStream() {
  console.log(chalk.blue('Testing Raydium transaction stream...'));
  
  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.ams.shyft.to',
    process.env.SHYFT_GRPC_TOKEN!,
    { '0.1.0': {} }
  );

  try {
    // Create subscription for Raydium transactions
    const stream = client.subscribe();
    
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
      entry: {}
    };
    
    console.log(chalk.yellow('Subscribing to Raydium transactions...'));
    
    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err === null || err === undefined) {
          console.log(chalk.green('✅ Connected to stream'));
          resolve();
        } else {
          reject(err);
        }
      });
    });
    
    let count = 0;
    let raydiumCount = 0;
    
    stream.on('data', (data: any) => {
      count++;
      
      if (data?.transaction) {
        const tx = data.transaction.transaction;
        const accountKeys = tx?.transaction?.message?.accountKeys || [];
        
        // Check if Raydium is in the accounts
        const hasRaydium = accountKeys.some((key: any) => {
          const keyStr = typeof key === 'string' ? key : key.toString();
          return keyStr === RAYDIUM_PROGRAM_ID;
        });
        
        if (hasRaydium) {
          raydiumCount++;
          console.log(chalk.green(`\n✅ Raydium transaction found! #${raydiumCount}`));
          console.log(chalk.gray(`   Signature: ${tx.signature?.slice(0, 20)}...`));
          console.log(chalk.gray(`   Slot: ${tx.slot}`));
          
          // Check for swap instructions
          const instructions = tx?.transaction?.message?.instructions || [];
          for (let i = 0; i < instructions.length; i++) {
            const ix = instructions[i];
            const programIdIndex = ix.programIdIndex;
            if (typeof programIdIndex === 'number' && accountKeys[programIdIndex]) {
              const programId = accountKeys[programIdIndex];
              if (programId === RAYDIUM_PROGRAM_ID) {
                console.log(chalk.blue(`   Raydium instruction at index ${i}`));
                
                // Try to decode instruction type
                if (ix.data) {
                  try {
                    const decoded = Buffer.from(ix.data, 'base64');
                    const instructionType = decoded[0];
                    console.log(chalk.blue(`   Instruction type: ${instructionType}`));
                    if (instructionType === 9) {
                      console.log(chalk.yellow('   🔄 SwapBaseIn detected!'));
                    } else if (instructionType === 11) {
                      console.log(chalk.yellow('   🔄 SwapBaseOut detected!'));
                    }
                  } catch (e) {
                    console.log(chalk.red('   Failed to decode instruction'));
                  }
                }
              }
            }
          }
        }
      }
      
      // Status update every 100 transactions
      if (count % 100 === 0) {
        console.log(chalk.gray(`Processed ${count} transactions, found ${raydiumCount} Raydium transactions`));
      }
    });
    
    stream.on('error', (error: any) => {
      console.error(chalk.red('Stream error:'), error);
    });
    
    stream.on('end', () => {
      console.log(chalk.yellow('Stream ended'));
    });
    
    // Run for 30 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\nStopping test...'));
      console.log(chalk.blue(`Final stats: ${count} total transactions, ${raydiumCount} Raydium transactions`));
      stream.cancel();
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

testRaydiumStream().catch(console.error);