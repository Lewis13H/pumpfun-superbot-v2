#!/usr/bin/env node
/**
 * AMM Account State Monitor V2
 * Enhanced version that monitors both pool accounts and their token vault accounts
 * to track real-time reserves
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
import { unifiedWebSocketServer, PoolStateEvent } from '../services/unified-websocket-server-stub';
import * as borsh from '@coral-xyz/borsh';

// Program IDs
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Token account layout for SPL tokens
const TOKEN_ACCOUNT_LAYOUT = borsh.struct([
  borsh.publicKey('mint'),
  borsh.publicKey('owner'),
  borsh.u64('amount'),
  borsh.u32('delegateOption'),
  borsh.publicKey('delegate'),
  borsh.u8('state'),
  borsh.u32('isNativeOption'),
  borsh.u64('isNative'),
  borsh.u64('delegatedAmount'),
  borsh.u32('closeAuthorityOption'),
  borsh.publicKey('closeAuthority'),
]);

// Services
let poolStateService: AmmPoolStateService;
let streamClient: Client;

// Track token accounts we're monitoring
const tokenAccountToPool = new Map<string, {
  poolAddress: string;
  mintAddress: string;
  isBase: boolean; // true for SOL vault, false for token vault
}>();

// Track pools we've seen
const knownPools = new Map<string, {
  baseMint: string;
  quoteMint: string;
  baseVault: string;
  quoteVault: string;
}>();

// Statistics
let stats = {
  accountUpdates: 0,
  poolsTracked: new Set<string>(),
  tokenAccountsTracked: new Set<string>(),
  decodedPools: 0,
  decodedTokenAccounts: 0,
  decodeErrors: 0,
  reserveUpdates: 0,
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
 * Decode token account data
 */
function decodeTokenAccount(data: Buffer): { mint: string; owner: string; amount: bigint } | null {
  try {
    // SPL Token accounts have a specific layout
    if (data.length < 165) return null;
    
    const decoded = TOKEN_ACCOUNT_LAYOUT.decode(data);
    
    return {
      mint: decoded.mint.toBase58(),
      owner: decoded.owner.toBase58(),
      amount: decoded.amount,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Subscribe to token accounts for a pool
 */
async function subscribeToTokenAccounts(poolAddress: string, baseVault: string, quoteVault: string, baseMint: string, quoteMint: string) {
  // Track the relationship
  tokenAccountToPool.set(baseVault, {
    poolAddress,
    mintAddress: quoteMint, // The token mint (not SOL)
    isBase: true,
  });
  
  tokenAccountToPool.set(quoteVault, {
    poolAddress,
    mintAddress: quoteMint,
    isBase: false,
  });
  
  knownPools.set(poolAddress, {
    baseMint,
    quoteMint,
    baseVault,
    quoteVault,
  });
  
  console.log(chalk.blue(`📌 Subscribing to vault accounts for pool ${poolAddress.slice(0, 8)}...`));
  console.log(chalk.gray(`  Base vault (SOL): ${baseVault}`));
  console.log(chalk.gray(`  Quote vault (Token): ${quoteVault}`));
  
  // Create a new subscription for these specific token accounts
  const tokenAccountReq: SubscribeRequest = {
    slots: {},
    accounts: {
      [`vault_${poolAddress}`]: {
        account: [baseVault, quoteVault],
        filters: [],
        owner: [], // Token accounts are owned by pool, not token program
      },
    },
    transactions: {},
    transactionsStatus: {},
    entry: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    ping: undefined,
    commitment: CommitmentLevel.PROCESSED,
  };
  
  // Add to existing subscription
  const stream = streamClient.subscribe();
  
  stream.on("data", async (data) => {
    if (data?.account) {
      await processTokenAccountUpdate(data);
    }
  });
  
  // Send subscription
  await new Promise<void>((resolve, reject) => {
    stream.write(tokenAccountReq, (err: any) => {
      if (err === null || err === undefined) {
        stats.tokenAccountsTracked.add(baseVault);
        stats.tokenAccountsTracked.add(quoteVault);
        resolve();
      } else {
        console.error(chalk.red(`Failed to subscribe to token accounts: ${err}`));
        reject(err);
      }
    });
  });
}

/**
 * Process token account update
 */
async function processTokenAccountUpdate(data: any): Promise<void> {
  try {
    if (!data.account || !data.account.account) return;
    
    const accountInfo = data.account.account;
    const accountPubkey = convertBase64ToBase58(accountInfo.pubkey);
    
    // Check if this is a token account we're tracking
    const poolInfo = tokenAccountToPool.get(accountPubkey);
    if (!poolInfo) return;
    
    // Decode token account
    const accountData = Buffer.from(accountInfo.data, 'base64');
    const tokenAccount = decodeTokenAccount(accountData);
    
    if (!tokenAccount) {
      console.error(chalk.red(`Failed to decode token account ${accountPubkey}`));
      return;
    }
    
    stats.decodedTokenAccounts++;
    
    // Get pool info
    const pool = knownPools.get(poolInfo.poolAddress);
    if (!pool) return;
    
    // Determine if we have both reserves
    const otherVault = poolInfo.isBase ? pool.quoteVault : pool.baseVault;
    const otherInfo = tokenAccountToPool.get(otherVault);
    
    // Log the update
    console.log(chalk.cyan(`💰 Token account updated: ${accountPubkey.slice(0, 8)}...`));
    console.log(chalk.gray(`  Pool: ${poolInfo.poolAddress.slice(0, 8)}...`));
    console.log(chalk.gray(`  Type: ${poolInfo.isBase ? 'Base (SOL)' : 'Quote (Token)'}`));
    console.log(chalk.gray(`  Amount: ${tokenAccount.amount.toString()}`));
    console.log(chalk.gray(`  Mint: ${tokenAccount.mint}`));
    
    // Update reserves in pool state service
    if (poolInfo.isBase) {
      // This is the SOL vault
      await poolStateService.updatePoolReserves(
        poolInfo.mintAddress,
        Number(tokenAccount.amount), // SOL reserves
        0, // Will be updated when token vault updates
        data.slot || 0
      );
    } else {
      // This is the token vault - get the SOL reserves too
      const poolState = poolStateService.getPoolState(poolInfo.mintAddress);
      if (poolState && poolState.reserves.virtualSolReserves > 0) {
        await poolStateService.updatePoolReserves(
          poolInfo.mintAddress,
          poolState.reserves.virtualSolReserves, // Keep existing SOL reserves
          Number(tokenAccount.amount), // New token reserves
          data.slot || 0
        );
        
        stats.reserveUpdates++;
        
        // Log successful reserve update
        console.log(chalk.green(`✅ Pool reserves updated for ${poolInfo.mintAddress.slice(0, 8)}...`));
        console.log(chalk.gray(`  SOL: ${(poolState.reserves.virtualSolReserves / 1e9).toFixed(4)}`));
        console.log(chalk.gray(`  Tokens: ${(Number(tokenAccount.amount) / 1e6).toLocaleString()}`));
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error processing token account update:'), error);
  }
}

/**
 * Process pool account update
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
      
      // Subscribe to token accounts if we haven't already
      if (!tokenAccountToPool.has(poolData.poolBaseTokenAccount)) {
        await subscribeToTokenAccounts(
          accountPubkey,
          poolData.poolBaseTokenAccount,
          poolData.poolQuoteTokenAccount,
          poolData.baseMint,
          poolData.quoteMint
        );
      }
      
      // Log pool update
      console.log(chalk.green(`✓ Pool state updated: ${poolData.quoteMint}`));
      console.log(chalk.gray(`  Pool: ${accountPubkey}`));
      console.log(chalk.gray(`  LP Supply: ${poolData.lpSupply.toLocaleString()}`));
      
    } catch (decodeError) {
      stats.decodeErrors++;
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
  console.log(chalk.white(`Token Accounts Tracked: ${stats.tokenAccountsTracked.size}`));
  console.log(chalk.white(`Decoded Pools: ${stats.decodedPools.toLocaleString()}`));
  console.log(chalk.white(`Decoded Token Accounts: ${stats.decodedTokenAccounts.toLocaleString()}`));
  console.log(chalk.white(`Reserve Updates: ${stats.reserveUpdates.toLocaleString()}`));
  console.log(chalk.white(`Decode Errors: ${stats.decodeErrors.toLocaleString()}`));
  console.log(chalk.white(`Updates/sec: ${rate.toFixed(2)}`));
  console.log(chalk.white(`Runtime: ${elapsed.toFixed(0)}s`));
  console.log(chalk.gray('─'.repeat(50)));
}

/**
 * Handle stream
 */
async function handleStream(client: Client, args: SubscribeRequest) {
  streamClient = client;
  
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
      // Check if it's a pool account or token account
      const accountInfo = data.account.account;
      if (accountInfo) {
        const accountPubkey = convertBase64ToBase58(accountInfo.pubkey);
        
        if (tokenAccountToPool.has(accountPubkey)) {
          await processTokenAccountUpdate(data);
        } else {
          await processAccountUpdate(data);
        }
      }
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
  console.log(chalk.cyan.bold('🔍 AMM Account State Monitor V2'));
  console.log(chalk.gray('Enhanced monitoring with token vault tracking...\n'));
  
  // Suppress parser warnings
  suppressParserWarnings();
  
  // Initialize pool state service
  poolStateService = new AmmPoolStateService();
  
  // Broadcast stats periodically
  setInterval(() => {
    unifiedWebSocketServer.broadcastStats({
      source: 'amm_account',
      transactions: 0,
      trades: 0,
      errors: stats.decodeErrors,
      uniqueTokens: stats.poolsTracked.size,
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      accountUpdates: stats.accountUpdates,
      decodedPools: stats.decodedPools,
      tokenAccountsTracked: stats.tokenAccountsTracked.size,
      reserveUpdates: stats.reserveUpdates,
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
  console.log(chalk.yellow('Starting enhanced account monitoring...'));
  console.log(chalk.gray(`AMM Program: ${PUMP_AMM_PROGRAM_ID.toBase58()}`));
  console.log(chalk.gray(`Token Program: ${TOKEN_PROGRAM_ID.toBase58()}\n`));
  
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