/**
 * Simple test of Raydium parser
 */

import 'dotenv/config';
import Client from '@triton-one/yellowstone-grpc';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import { SimpleRaydiumTradeStrategy } from '../utils/parsers/strategies/raydium-trade-strategy-simple';

const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function testParser() {
  console.log(chalk.blue('Testing Raydium parser...'));
  
  const parser = new SimpleRaydiumTradeStrategy();
  
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
    
    let count = 0;
    let parseCount = 0;
    
    stream.on('data', (data: any) => {
      if (data?.transaction) {
        count++;
        const tx = data.transaction.transaction;
        
        // Test canParse
        const canParse = parser.canParse(tx);
        
        if (canParse) {
          console.log(chalk.yellow(`\n[${count}] Parser can parse this transaction!`));
          
          // Test parse
          const events = parser.parse(tx, tx);
          
          if (events && events.length > 0) {
            parseCount++;
            console.log(chalk.green(`✅ Parsed ${events.length} events!`));
            events.forEach((event: any) => {
              console.log(chalk.cyan(`  Event type: ${event.type}`));
              console.log(chalk.cyan(`  Instruction type: ${event.tradeType}`));
            });
          } else {
            console.log(chalk.red('❌ Parser returned no events'));
          }
          
          if (parseCount >= 3) {
            console.log(chalk.green('\nFound enough examples. Stopping...'));
            (stream as any).cancel();
            process.exit(0);
          }
        }
        
        if (count % 100 === 0) {
          console.log(chalk.gray(`Processed ${count}, parsed ${parseCount}`));
        }
      }
    });
    
    setTimeout(() => {
      console.log(chalk.yellow(`\nTimeout. Processed ${count}, parsed ${parseCount}`));
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

testParser().catch(console.error);