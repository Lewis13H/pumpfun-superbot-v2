#!/usr/bin/env tsx

/**
 * Debug script to test BC event parsing in isolation
 * Connects to the stream and logs raw transaction data
 */

import 'dotenv/config';
import chalk from 'chalk';
import bs58 from 'bs58';
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { UnifiedEventParser } from '../src/parsers/unified-event-parser';
import { PUMP_PROGRAM } from '../src/utils/constants';

console.log(chalk.blue('====================================='));
console.log(chalk.blue('BC Parser Debug Script'));
console.log(chalk.blue('====================================='));
console.log('This script will show raw transaction data to debug parsing issues\n');

// Initialize the client
const grpcEndpoint = process.env.SHYFT_GRPC_ENDPOINT;
const grpcToken = process.env.SHYFT_GRPC_TOKEN;

if (!grpcEndpoint || !grpcToken) {
  console.error(chalk.red('Missing SHYFT_GRPC_ENDPOINT or SHYFT_GRPC_TOKEN'));
  process.exit(1);
}

const client = new Client(grpcEndpoint, grpcToken, undefined);

// Track statistics
let transactionCount = 0;
let pumpTransactionCount = 0;
let tradeEventCount = 0;
let parseErrorCount = 0;
const eventSizes = new Map<number, number>();

// Create parser
const parser = new UnifiedEventParser({ logErrors: true });

async function main() {
  // Subscribe to pump.fun transactions
  const request = {
    commitment: CommitmentLevel.CONFIRMED,
    accounts: {},
    slots: {},
    accountsDataSlice: [],
    transactions: {
      pump: {
        accountInclude: [PUMP_PROGRAM],
        accountExclude: [],
        accountRequired: []
      }
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    ping: undefined
  };

  console.log(chalk.cyan('Subscribing to pump.fun transactions...'));
  console.log(chalk.gray(`Program: ${PUMP_PROGRAM}\n`));

  const stream = await client.subscribe();

  stream.on('data', (data: any) => {
    transactionCount++;
    
    try {
      // Check if this is a transaction update
      if (!data.transaction) {
        return;
      }

      // Create parse context
      const context = UnifiedEventParser.createContext(data);
      
      // Check if this is a pump.fun transaction
      const isPumpTx = context.accounts.some(acc => acc === PUMP_PROGRAM);
      if (!isPumpTx) {
        return;
      }

      pumpTransactionCount++;

      // Log basic transaction info for first few pump transactions
      if (pumpTransactionCount <= 5) {
        console.log(chalk.gray('\n------- Pump.fun Transaction -------'));
        console.log(`Signature: ${context.signature.substring(0, 20)}...`);
        console.log(`Slot: ${context.slot}`);
        console.log(`Accounts: ${context.accounts.length}`);
        console.log(`Logs: ${context.logs.length}`);
        
        // Show first few logs
        if (context.logs.length > 0) {
          console.log('First logs:');
          context.logs.slice(0, 5).forEach((log, i) => {
            console.log(`  [${i}]: ${log.substring(0, 80)}${log.length > 80 ? '...' : ''}`);
          });
        }

        // Show data size if available
        if (context.data) {
          console.log(chalk.cyan(`\nInstruction Data Size: ${context.data.length} bytes`));
          console.log(`Hex (first 64 bytes): ${context.data.toString('hex').substring(0, 128)}`);
        }
      }

      // Try to parse the event
      const event = parser.parse(context);
      
      if (event) {
        tradeEventCount++;
        console.log(chalk.green('\n✅ Successfully parsed trade event!'));
        console.log(chalk.green(`Type: ${event.type}`));
        console.log(chalk.green(`Trade Type: ${event.tradeType}`));
        console.log(chalk.green(`Mint: ${event.mintAddress}`));
        console.log(chalk.green(`User: ${event.userAddress}`));
        console.log(chalk.green(`SOL Amount: ${Number(event.solAmount) / 1e9}`));
        console.log(chalk.green(`Token Amount: ${Number(event.tokenAmount) / 1e6}`));
      } else if (pumpTransactionCount <= 10) {
        parseErrorCount++;
        console.log(chalk.yellow('\n⚠️ Could not parse trade from transaction'));
        
        // Check why parsing failed
        const hasTradeLog = context.logs.some(log => 
          log.includes('Buy') || log.includes('Sell') || 
          log.includes('buy') || log.includes('sell')
        );
        
        if (!hasTradeLog) {
          console.log(chalk.gray('Reason: No buy/sell instruction found in logs'));
        } else {
          console.log(chalk.gray('Reason: Has trade log but parsing failed'));
          console.log(chalk.gray(`Data size: ${context.data?.length || 0}`));
        }
      }

      // Track event sizes
      if (context.data) {
        eventSizes.set(context.data.length, (eventSizes.get(context.data.length) || 0) + 1);
      }

    } catch (error: any) {
      console.error(chalk.red(`Error processing transaction: ${error.message}`));
    }

    // Display stats periodically
    if (transactionCount % 100 === 0) {
      displayStats();
    }
  });

  // Send subscription
  await new Promise<void>((resolve, reject) => {
    stream.write(request, (err: any) => {
      if (err === null || err === undefined) {
        console.log(chalk.green('✅ Connected to gRPC stream'));
        resolve();
      } else {
        console.error(chalk.red(`Failed to subscribe: ${err}`));
        reject(err);
      }
    });
  });

  // Handle errors
  stream.on('error', (error) => {
    console.error(chalk.red('Stream error:'), error);
  });

  stream.on('end', () => {
    console.log(chalk.yellow('\nStream ended'));
    displayStats();
    process.exit(0);
  });
}

function displayStats() {
  console.log(chalk.cyan('\n========== Statistics =========='));
  console.log(`Total Transactions: ${transactionCount}`);
  console.log(`Pump.fun Transactions: ${pumpTransactionCount}`);
  console.log(`Trade Events Parsed: ${tradeEventCount}`);
  console.log(`Parse Errors: ${parseErrorCount}`);
  
  if (pumpTransactionCount > 0) {
    const parseRate = (tradeEventCount / pumpTransactionCount * 100).toFixed(1);
    console.log(`Parse Rate: ${parseRate}%`);
  }
  
  if (eventSizes.size > 0) {
    console.log('\nEvent Sizes Distribution:');
    const sorted = Array.from(eventSizes.entries()).sort((a, b) => a[0] - b[0]);
    sorted.forEach(([size, count]) => {
      console.log(`  ${size} bytes: ${count} events`);
    });
  }
  
  // Parser stats
  const parserStats = parser.getStats();
  console.log('\nParser Stats:', parserStats);
  console.log('===============================\n');
}

// Run the debug script
main().catch(console.error);

// Handle shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nShutting down...'));
  displayStats();
  process.exit(0);
});