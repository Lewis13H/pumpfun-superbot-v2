/**
 * Run Raydium Monitor with Direct Stream
 * Bypasses shared stream for testing
 */

import 'dotenv/config';
import chalk from 'chalk';
import Client from '@triton-one/yellowstone-grpc';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { Logger, LogLevel } from './core/logger';
import { SimpleRaydiumTradeStrategy } from './utils/parsers/strategies/raydium-trade-strategy-simple';
import { EventType } from './utils/parsers/types';

// Set log level
Logger.setGlobalLevel(LogLevel.INFO);

const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function main() {
  const logger = new Logger({ context: 'RaydiumDirect', color: chalk.blue });
  const parser = new SimpleRaydiumTradeStrategy();
  
  try {
    console.log(chalk.blue(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║      🌊 Raydium Direct Monitor - Testing 🌊          ║
║                                                       ║
║      Direct gRPC connection to Raydium AMM            ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`));

    logger.info('Creating direct Raydium stream...');
    
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
    
    // Stats
    let stats = {
      transactions: 0,
      raydiumTxns: 0,
      swaps: 0,
      parseFailures: 0,
      errors: 0
    };
    
    // Process stream
    stream.on('data', async (data: any) => {
      try {
        stats.transactions++;
        
        if (!data?.transaction) return;
        
        const tx = data.transaction.transaction;
        if (!tx?.transaction) return;
        
        // Check if parser can handle this
        if (!parser.canParse(tx.transaction)) {
          return;
        }
        
        stats.raydiumTxns++;
        
        // Parse the transaction
        const events = await parser.parse(tx.transaction, tx);
        
        if (events.length === 0) {
          stats.parseFailures++;
        } else {
          for (const event of events) {
            if (event.type === EventType.RAYDIUM_SWAP) {
              stats.swaps++;
              logger.info(chalk.green('🔄 Raydium swap detected!'), {
                signature: event.signature.slice(0, 8) + '...',
                mint: event.mintAddress.slice(0, 8) + '...',
                type: event.tradeType,
                user: event.userAddress.slice(0, 8) + '...'
              });
            }
          }
        }
        
      } catch (error) {
        stats.errors++;
        logger.error('Error processing transaction', error as Error);
      }
    });
    
    // Display stats every 10 seconds
    setInterval(() => {
      const parseRate = stats.raydiumTxns > 0 
        ? ((stats.swaps / stats.raydiumTxns) * 100).toFixed(1)
        : '0.0';
        
      console.log(chalk.blue('\n📊 Direct Raydium Monitor:'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`Total transactions: ${stats.transactions}`);
      console.log(`Raydium transactions: ${stats.raydiumTxns}`);
      console.log(`Swaps detected: ${stats.swaps}`);
      console.log(`Parse rate: ${parseRate}%`);
      console.log(`Parse failures: ${stats.parseFailures}`);
      console.log(`Errors: ${stats.errors}`);
    }, 10000);
    
    // Handle errors
    stream.on('error', (error: any) => {
      logger.error('Stream error', error);
    });
    
    stream.on('end', () => {
      logger.info('Stream ended');
    });
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      logger.info('Shutting down...');
      stream.cancel();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start direct monitor', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);