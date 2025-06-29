#!/usr/bin/env node
/**
 * AMM Account State Monitor
 * Monitors pump.swap AMM pool accounts to track real-time reserves and pool state
 */

import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { suppressParserWarnings } from '../utils/suppress-parser-warnings';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { formatCurrency } from '../utils/formatters';
import { decodePoolAccount, poolAccountToPlain } from '../utils/amm-pool-decoder';
import { unifiedWebSocketServer, PoolStateEvent } from '../services/unified-websocket-server';

// Program ID
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Pool state service
let poolStateService: AmmPoolStateService;

// Statistics
let stats = {
  accountUpdates: 0,
  poolsTracked: new Set<string>(),
  decodedPools: 0,
  decodeErrors: 0,
  startTime: Date.now(),
};

/**
 * Convert base64 to base58
 */
function convertBase64ToBase58(base64String: string): string {
  const buffer = Buffer.from(base64String, 'base64');
  return bs58.encode(buffer);
}

/**
 * Process account update
 */
async function processAccountUpdate(data: any): Promise<void> {
  try {
    stats.accountUpdates++;
    
    if (!data.account || !data.account.account) return;
    
    const accountInfo = data.account.account;
    const accountPubkey = convertBase64ToBase58(accountInfo.pubkey);
    const owner = accountInfo.owner ? convertBase64ToBase58(accountInfo.owner) : '';
    
    // Only process AMM pool accounts
    if (owner !== PUMP_AMM_PROGRAM_ID.toBase58()) return;
    
    // Decode account data
    const accountData = Buffer.from(accountInfo.data, 'base64');
    
    try {
      // Decode pool account using custom decoder
      const decodedPool = decodePoolAccount(accountData);
      
      if (!decodedPool) {
        stats.decodeErrors++;
        return;
      }
      
      stats.decodedPools++;
      stats.poolsTracked.add(accountPubkey);
      
      // Convert to plain object with string addresses
      const plainPool = poolAccountToPlain(decodedPool);
      
      // Extract pool data
      const poolData = {
        poolAddress: accountPubkey,
        poolBump: plainPool.poolBump,
        index: plainPool.index,
        creator: plainPool.creator,
        baseMint: plainPool.baseMint,
        quoteMint: plainPool.quoteMint,
        lpMint: plainPool.lpMint,
        poolBaseTokenAccount: plainPool.poolBaseTokenAccount,
        poolQuoteTokenAccount: plainPool.poolQuoteTokenAccount,
        lpSupply: Number(plainPool.lpSupply),
        coinCreator: plainPool.coinCreator,
        slot: data.slot || 0,
      };
      
      // Store pool state
      await poolStateService.updatePoolState(poolData);
      
      // Log pool update
      console.log(chalk.green(`✓ Pool state updated: ${poolData.quoteMint}`));
      console.log(chalk.gray(`  Pool: ${accountPubkey}`));
      console.log(chalk.gray(`  LP Supply: ${poolData.lpSupply.toLocaleString()}`));
      console.log(chalk.gray(`  Base Token Account: ${poolData.poolBaseTokenAccount}`));
      console.log(chalk.gray(`  Quote Token Account: ${poolData.poolQuoteTokenAccount}`));
      
    } catch (decodeError) {
      stats.decodeErrors++;
      // Some accounts might not be pools
      if (process.env.DEBUG_PARSE_ERRORS === 'true') {
        console.error(chalk.yellow(`Failed to decode account ${accountPubkey}:`), decodeError);
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error processing account update:'), error);
  }
}

/**
 * Display statistics
 */
function displayStats() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.accountUpdates / elapsed;
  
  console.log(chalk.cyan.bold('\n📊 Account Monitor Statistics'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.white(`Account Updates: ${stats.accountUpdates.toLocaleString()}`));
  console.log(chalk.white(`Pools Tracked: ${stats.poolsTracked.size}`));
  console.log(chalk.white(`Decoded Pools: ${stats.decodedPools.toLocaleString()}`));
  console.log(chalk.white(`Decode Errors: ${stats.decodeErrors.toLocaleString()}`));
  console.log(chalk.white(`Updates/sec: ${rate.toFixed(2)}`));
  console.log(chalk.white(`Runtime: ${elapsed.toFixed(0)}s`));
  console.log(chalk.gray('─'.repeat(50)));
}

/**
 * Handle stream
 */
async function handleStream(client: Client, args: SubscribeRequest) {
  // Stats display interval
  const statsInterval = setInterval(displayStats, 30000); // Every 30 seconds
  
  const stream = await client.subscribe();

  // Create error/end handler
  const streamClosed = new Promise<void>((resolve, reject) => {
    stream.on("error", (error) => {
      console.error(chalk.red("Stream error:"), error);
      clearInterval(statsInterval);
      reject(error);
      stream.end();
    });
    stream.on("end", () => {
      clearInterval(statsInterval);
      resolve();
    });
    stream.on("close", () => {
      clearInterval(statsInterval);
      resolve();
    });
  });

  // Handle data
  stream.on("data", async (data) => {
    if (data?.account) {
      await processAccountUpdate(data);
    }
  });

  // Send subscribe request
  await new Promise<void>((resolve, reject) => {
    stream.write(args, (err: any) => {
      if (err === null || err === undefined) {
        resolve();
      } else {
        reject(err);
      }
    });
  }).catch((reason) => {
    console.error(reason);
    throw reason;
  });

  await streamClosed;
}

/**
 * Main function
 */
async function main() {
  console.log(chalk.cyan.bold('🔍 AMM Account State Monitor'));
  console.log(chalk.gray('Monitoring pump.swap AMM pool accounts...\n'));
  
  // Suppress parser warnings
  suppressParserWarnings();
  
  // Initialize pool state service
  poolStateService = new AmmPoolStateService();
  
  // Broadcast stats periodically
  setInterval(() => {
    unifiedWebSocketServer.broadcastStats({
      source: 'amm_account',
      transactions: 0, // Not applicable for account monitor
      trades: 0,
      errors: stats.decodeErrors,
      uniqueTokens: stats.poolsTracked.size,
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      accountUpdates: stats.accountUpdates,
      decodedPools: stats.decodedPools
    }, 'amm_account');
  }, 5000); // Every 5 seconds
  
  // Create gRPC client
  const grpcEndpoint = process.env.SHYFT_GRPC_ENDPOINT;
  const grpcToken = process.env.SHYFT_GRPC_TOKEN;
  
  if (!grpcEndpoint || !grpcToken) {
    console.error(chalk.red('Missing SHYFT_GRPC_ENDPOINT or SHYFT_GRPC_TOKEN'));
    process.exit(1);
  }
  
  const client = new Client(grpcEndpoint, grpcToken, undefined);
  
  // Create subscription request for AMM pool accounts
  const req: SubscribeRequest = {
    slots: {},
    accounts: {
      pumpswap_amm: {
        account: [],
        filters: [],
        owner: [PUMP_AMM_PROGRAM_ID.toBase58()], // Subscribe to all accounts owned by AMM program
      },
    },
    transactions: {},
    transactionsStatus: {},
    entry: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    ping: undefined,
    commitment: CommitmentLevel.PROCESSED, // Get updates as soon as possible
  };
  
  // Start monitoring
  console.log(chalk.yellow('Starting account monitoring...'));
  console.log(chalk.gray(`Program: ${PUMP_AMM_PROGRAM_ID.toBase58()}\n`));
  
  try {
    await handleStream(client, req);
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
    displayStats();
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nShutting down...'));
  displayStats();
  process.exit(0);
});

// Run the monitor
main().catch(console.error);