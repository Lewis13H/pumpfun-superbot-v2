/**
 * Debug transaction structure
 */

import 'dotenv/config';
import Client from '@triton-one/yellowstone-grpc';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';

const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function debugStructure() {
  console.log(chalk.blue('Debugging transaction structure...'));
  
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
    
    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err === null || err === undefined) {
          console.log(chalk.green('✅ Connected'));
          resolve();
        } else {
          reject(err);
        }
      });
    });
    
    let found = false;
    
    stream.on('data', (data: any) => {
      if (!found && data?.transaction) {
        found = true;
        
        console.log(chalk.yellow('\nFirst transaction structure:'));
        console.log('data keys:', Object.keys(data));
        
        if (data.transaction) {
          console.log('data.transaction keys:', Object.keys(data.transaction));
          
          if (data.transaction.transaction) {
            const tx = data.transaction.transaction;
            console.log('data.transaction.transaction keys:', Object.keys(tx));
            
            if (tx.transaction) {
              console.log('data.transaction.transaction.transaction keys:', Object.keys(tx.transaction));
              
              if (tx.transaction.message) {
                const msg = tx.transaction.message;
                console.log('message keys:', Object.keys(msg));
                console.log('accountKeys length:', msg.accountKeys?.length || 0);
                
                if (msg.accountKeys && msg.accountKeys.length > 0) {
                  console.log('\nFirst account key:');
                  const firstKey = msg.accountKeys[0];
                  console.log('Type:', typeof firstKey);
                  if (typeof firstKey === 'object') {
                    console.log('Is Buffer?', Buffer.isBuffer(firstKey));
                    console.log('Object keys:', Object.keys(firstKey || {}));
                    if (Buffer.isBuffer(firstKey)) {
                      console.log('Buffer length:', firstKey.length);
                      console.log('As hex:', firstKey.toString('hex').slice(0, 20) + '...');
                    }
                  }
                }
                
                console.log('\nChecking for Raydium:');
                let foundAt = -1;
                msg.accountKeys?.forEach((key: any, idx: number) => {
                  let keyStr = '';
                  if (typeof key === 'string') {
                    keyStr = key;
                  } else if (Buffer.isBuffer(key)) {
                    // Buffers should be 32 bytes for pubkeys
                    if (key.length === 32) {
                      keyStr = key.toString('base64');
                    }
                  }
                  
                  if (keyStr && (keyStr === RAYDIUM_PROGRAM_ID || keyStr.includes('675kPX9M'))) {
                    foundAt = idx;
                    console.log(chalk.green(`Found at index ${idx}: ${keyStr}`));
                  }
                });
                
                if (foundAt === -1) {
                  console.log(chalk.red('Raydium not found in account keys!'));
                }
              }
            }
          }
        }
        
        console.log(chalk.green('\nDone!'));
        (stream as any).cancel();
        process.exit(0);
      }
    });
    
    setTimeout(() => {
      console.log(chalk.yellow('\nTimeout'));
      process.exit(0);
    }, 10000);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

debugStructure().catch(console.error);