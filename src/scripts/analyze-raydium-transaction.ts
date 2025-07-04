/**
 * Analyze a Raydium transaction to understand its structure
 */

import 'dotenv/config';
import Client from '@triton-one/yellowstone-grpc';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import { PublicKey } from '@solana/web3.js';

const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function analyzeRaydiumTransaction() {
  console.log(chalk.blue('Analyzing Raydium transactions...'));
  
  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.ams.shyft.to',
    process.env.SHYFT_GRPC_TOKEN!,
    { '0.1.0': {} }
  );

  try {
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
    let foundRaydiumInKeys = false;
    
    stream.on('data', (data: any) => {
      count++;
      
      if (data?.transaction) {
        const tx = data.transaction.transaction;
        const message = tx?.transaction?.message;
        
        if (!message) return;
        
        const accountKeys = message.accountKeys || [];
        
        // Check if Raydium is in the account keys
        let raydiumIndex = -1;
        const hasRaydium = accountKeys.some((key: any, index: number) => {
          let keyStr: string;
          if (typeof key === 'string') {
            keyStr = key;
          } else if (Buffer.isBuffer(key)) {
            try {
              keyStr = new PublicKey(key).toString();
            } catch {
              return false;
            }
          } else if (key?.toString) {
            keyStr = key.toString();
          } else {
            return false;
          }
          
          if (keyStr === RAYDIUM_PROGRAM_ID) {
            raydiumIndex = index;
            return true;
          }
          return false;
        });
        
        if (hasRaydium && !foundRaydiumInKeys) {
          foundRaydiumInKeys = true;
          console.log(chalk.green(`\n✅ Found Raydium in account keys at index ${raydiumIndex}!`));
          console.log(chalk.yellow('\nTransaction Analysis:'));
          console.log(chalk.gray(`Signature: ${tx.signature?.slice(0, 20)}...`));
          console.log(chalk.gray(`Slot: ${tx.slot}`));
          console.log(chalk.gray(`Account Keys: ${accountKeys.length}`));
          
          // Analyze instructions
          const instructions = message.instructions || [];
          console.log(chalk.yellow(`\nInstructions (${instructions.length}):`));
          
          instructions.forEach((inst: any, idx: number) => {
            const programIdIndex = inst.programIdIndex;
            const programKey = accountKeys[programIdIndex];
            let programId: string;
            
            if (typeof programKey === 'string') {
              programId = programKey;
            } else if (Buffer.isBuffer(programKey)) {
              programId = new PublicKey(programKey).toString();
            } else {
              programId = 'unknown';
            }
            
            console.log(chalk.cyan(`  [${idx}] Program: ${programId === RAYDIUM_PROGRAM_ID ? chalk.green('RAYDIUM') : programId.slice(0, 8) + '...'}`));
            console.log(`       Program Index: ${programIdIndex}`);
            console.log(`       Accounts: [${inst.accounts?.join(', ') || 'none'}]`);
            
            if (inst.data) {
              try {
                const dataBuffer = Buffer.from(inst.data, 'base64');
                console.log(`       Data length: ${dataBuffer.length} bytes`);
                if (dataBuffer.length >= 1) {
                  console.log(`       First byte (instruction type): ${dataBuffer[0]}`);
                }
                if (dataBuffer.length >= 8) {
                  console.log(`       Discriminator: ${dataBuffer.slice(0, 8).toString('hex')}`);
                }
              } catch (e) {
                console.log(`       Data: ${inst.data.slice(0, 20)}...`);
              }
            }
          });
          
          // Check logs
          const logs = tx.meta?.logMessages || [];
          const raydiumLogs = logs.filter((log: string) => log.includes(RAYDIUM_PROGRAM_ID));
          if (raydiumLogs.length > 0) {
            console.log(chalk.yellow('\nRaydium Logs:'));
            raydiumLogs.forEach((log: string, idx: number) => {
              console.log(`  [${idx}] ${log.slice(0, 100)}...`);
            });
          }
          
          // Check for ray_log
          const rayLogs = logs.filter((log: string) => log.includes('ray_log'));
          if (rayLogs.length > 0) {
            console.log(chalk.yellow('\nRay Logs:'));
            rayLogs.forEach((log: string, idx: number) => {
              console.log(`  [${idx}] ${log}`);
            });
          }
          
          console.log(chalk.green('\nAnalysis complete! Stopping...'));
          (stream as any).cancel();
          process.exit(0);
        }
      }
      
      if (count % 100 === 0) {
        console.log(chalk.gray(`Processed ${count} transactions...`));
      }
    });
    
    stream.on('error', (error: any) => {
      console.error(chalk.red('Stream error:'), error);
    });
    
    // Timeout after 1 minute
    setTimeout(() => {
      console.log(chalk.yellow('\nTimeout reached. No Raydium transactions found in account keys.'));
      console.log(chalk.gray(`Processed ${count} total transactions`));
      (stream as any).cancel();
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

analyzeRaydiumTransaction().catch(console.error);