/**
 * Find Raydium transactions by subscribing to all and filtering
 */

import 'dotenv/config';
import chalk from 'chalk';
import Client from '@triton-one/yellowstone-grpc';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';

const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_SWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

async function findRaydium() {
  console.log(chalk.blue('Searching for Raydium transactions...'));
  
  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.ams.shyft.to',
    process.env.SHYFT_GRPC_TOKEN!,
    { '0.1.0': {} }
  );

  try {
    const stream = await client.subscribe();
    
    // Subscribe to recent slot to get all transactions
    const request = {
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
      ping: undefined,
      slots: {
        recent: {
          filterByCommitment: true
        }
      },
      accounts: {},
      transactions: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      transactionsStatus: {}
    };
    
    console.log(chalk.yellow('Subscribing to recent slots...'));
    
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
    
    let stats = {
      slots: 0,
      transactions: 0,
      programs: new Map<string, number>(),
      raydiumFound: 0
    };
    
    stream.on('data', (data: any) => {
      // Process slot updates
      if (data?.slots) {
        stats.slots++;
        
        // Check transactions in the slot
        const transactions = data.slots?.slot?.transactions || [];
        for (const tx of transactions) {
          stats.transactions++;
          
          // Get all programs involved
          const accountKeys = tx?.transaction?.message?.accountKeys || [];
          for (const key of accountKeys) {
            const keyStr = typeof key === 'string' ? key : key.toString();
            
            // Track program usage
            if (keyStr.length === 44) { // Valid base58 pubkey length
              const count = stats.programs.get(keyStr) || 0;
              stats.programs.set(keyStr, count + 1);
              
              // Check for Raydium
              if (keyStr === RAYDIUM_PROGRAM_ID) {
                stats.raydiumFound++;
                console.log(chalk.green(`\n✅ RAYDIUM FOUND! Transaction #${stats.raydiumFound}`));
                console.log(chalk.gray(`   Slot: ${data.slots.slot.slot}`));
                console.log(chalk.gray(`   Accounts: ${accountKeys.length}`));
              }
            }
          }
        }
        
        // Status update
        if (stats.slots % 10 === 0) {
          console.log(chalk.gray(`\nProcessed ${stats.slots} slots, ${stats.transactions} transactions`));
          console.log(chalk.gray(`Found ${stats.raydiumFound} Raydium transactions`));
          
          // Show top programs
          const topPrograms = Array.from(stats.programs.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
          
          console.log(chalk.gray('\nTop programs:'));
          for (const [prog, count] of topPrograms) {
            const name = prog === PUMP_FUN_PROGRAM ? 'pump.fun' :
                        prog === PUMP_SWAP_PROGRAM ? 'pump.swap' :
                        prog === RAYDIUM_PROGRAM_ID ? 'RAYDIUM' :
                        prog.slice(0, 8) + '...';
            console.log(chalk.gray(`  ${name}: ${count}`));
          }
        }
      }
    });
    
    stream.on('error', (error: any) => {
      console.error(chalk.red('Stream error:'), error);
    });
    
    // Run for 60 seconds
    setTimeout(() => {
      console.log(chalk.yellow('\n\nFinal Report:'));
      console.log(chalk.blue(`Slots processed: ${stats.slots}`));
      console.log(chalk.blue(`Transactions seen: ${stats.transactions}`));
      console.log(chalk.blue(`Raydium transactions: ${stats.raydiumFound}`));
      
      if (stats.raydiumFound === 0) {
        console.log(chalk.red('\n❌ No Raydium transactions found!'));
        console.log(chalk.yellow('This could mean:'));
        console.log(chalk.yellow('1. No Raydium activity in this time window'));
        console.log(chalk.yellow('2. Need to monitor for longer'));
        console.log(chalk.yellow('3. Raydium program ID might be incorrect'));
      }
      
      stream.cancel();
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

findRaydium().catch(console.error);