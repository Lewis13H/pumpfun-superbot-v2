#!/usr/bin/env node
/**
 * Bonding Curve Account Monitor
 * Monitors pump.fun bonding curve account states to detect graduations
 * Complements bc-monitor by focusing on account state changes
 */

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import Client, { SubscribeRequest, CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { UnifiedDbServiceV2 } from '../database/unified-db-service-v2';
import * as borsh from '@coral-xyz/borsh';
import bs58 from 'bs58';
import chalk from 'chalk';
import { db } from '../database';

// Constants
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FUN_PROGRAM_ID = new PublicKey(PUMP_FUN_PROGRAM);

// Bonding curve account schema (matching IDL structure)
const BONDING_CURVE_SCHEMA = borsh.struct([
  borsh.u64('virtual_token_reserves'),
  borsh.u64('virtual_sol_reserves'),
  borsh.u64('real_token_reserves'),
  borsh.u64('real_sol_reserves'),
  borsh.u64('token_total_supply'),
  borsh.bool('complete'),
  borsh.publicKey('creator'),
]);

// Expected discriminator for BondingCurve accounts
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];

// Initialize services
const dbService = new UnifiedDbServiceV2();

// Statistics
const stats = {
  startTime: Date.now(),
  accountUpdates: 0,
  bondingCurveAccounts: 0,
  graduationsDetected: 0,
  decodingErrors: 0,
  errors: [],
  lastGraduation: null as { mint: string; timestamp: Date } | null,
};


// Cache for bonding curve -> mint mappings
const bondingCurveToMintCache = new Map<string, string>();

/**
 * Find mint address from bonding curve by reversing PDA derivation
 * In pump.fun, the bonding curve PDA is derived from [b"bonding-curve", mint]
 */
async function findMintFromBondingCurve(bondingCurveAddress: string): Promise<string | null> {
  // Check cache first
  if (bondingCurveToMintCache.has(bondingCurveAddress)) {
    return bondingCurveToMintCache.get(bondingCurveAddress)!;
  }

  // Try to find from recent trades in the database
  try {
    // Look for trades that mention this bonding curve in their transaction
    const result = await db.query(`
      SELECT DISTINCT t.mint_address, tk.symbol, tk.name, MAX(t.created_at) as latest_trade
      FROM trades_unified t
      JOIN tokens_unified tk ON t.mint_address = tk.mint_address
      WHERE t.program = 'bonding_curve'
      AND t.created_at > NOW() - INTERVAL '1 hour'
      GROUP BY t.mint_address, tk.symbol, tk.name
      ORDER BY latest_trade DESC
      LIMIT 100
    `);
    
    // For each mint, derive its bonding curve and check if it matches
    for (const row of result.rows) {
      const mintPubkey = new PublicKey(row.mint_address);
      const [derivedBondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
        PUMP_FUN_PROGRAM_ID
      );
      
      if (derivedBondingCurve.toBase58() === bondingCurveAddress) {
        // Found it! Cache and return
        bondingCurveToMintCache.set(bondingCurveAddress, row.mint_address);
        console.log(chalk.gray(`  Found mint: ${row.symbol || 'Unknown'} (${row.mint_address.slice(0, 8)}...)`));
        return row.mint_address;
      }
    }
    
    return null;
  } catch (error) {
    // Silent error handling
    return null;
  }
}

/**
 * Process account update
 */
async function processAccountUpdate(data: any): Promise<void> {
  stats.accountUpdates++;
  
  try {
    const slot = data.slot || 0n;
    
    if (!data?.account?.account) {
      return;
    }
    
    const account = data.account.account;
    const accountPubkey = bs58.encode(account.pubkey);
    const accountLamports = account.lamports;
    
    // Check if this is a BondingCurve account by discriminator
    if (account.data.length < 8) {
      return;
    }
    
    const discriminator = Array.from(account.data.slice(0, 8));
    if (JSON.stringify(discriminator) !== JSON.stringify(BONDING_CURVE_DISCRIMINATOR)) {
      // Not a bonding curve account
      return;
    }
    
    // Decode bonding curve account data
    let bondingCurve: any = null;
    
    try {
      // Skip discriminator (8 bytes) and decode the rest
      const accountData = account.data.slice(8);
      bondingCurve = BONDING_CURVE_SCHEMA.decode(accountData);
      
      // Convert BN to numbers/strings for easier handling
      const virtualTokenReserves = bondingCurve.virtual_token_reserves.toString();
      const virtualSolReserves = bondingCurve.virtual_sol_reserves.toString();
      const realTokenReserves = bondingCurve.real_token_reserves.toString();
      const realSolReserves = bondingCurve.real_sol_reserves.toString();
      const tokenTotalSupply = bondingCurve.token_total_supply.toString();
      const creator = bondingCurve.creator.toBase58();
      const complete = bondingCurve.complete;
      
      bondingCurve = {
        virtual_token_reserves: virtualTokenReserves,
        virtual_sol_reserves: virtualSolReserves,
        real_token_reserves: realTokenReserves,
        real_sol_reserves: realSolReserves,
        token_total_supply: tokenTotalSupply,
        creator: creator,
        complete: complete
      };
      
    } catch (error) {
      stats.decodingErrors++;
      // Silent error handling
      return;
    }
    
    stats.bondingCurveAccounts++;
    
    // Calculate progress from virtual reserves
    const virtualSolReserves = Number(bondingCurve.virtual_sol_reserves) / 1e9;
    const progress = ((virtualSolReserves - 30) / 55) * 100;
    
    // Log interesting updates
    if (bondingCurve.complete || progress >= 95) {
      console.log(chalk.gray(`\n📊 Update: ${accountPubkey.slice(0, 8)}... | Progress: ${progress.toFixed(1)}% | ${virtualSolReserves.toFixed(2)} SOL`));
    }
    
    // Check for graduation
    if (bondingCurve.complete || progress >= 100) {
      stats.graduationsDetected++;
      stats.lastGraduation = {
        mint: accountPubkey,
        timestamp: new Date()
      };
      
      console.log(chalk.green.bold(`\n🎓 GRADUATION DETECTED`));
      
      // Try to find the mint address
      // In a production system, we'd maintain a mapping of bonding curve -> mint
      const mintAddress = await findMintFromBondingCurve(accountPubkey);
      
      if (mintAddress) {
        console.log(chalk.gray(`Mint: ${mintAddress}`));
        console.log(chalk.gray(`Final SOL: ${virtualSolReserves.toFixed(2)} SOL`));
        
        await dbService.processAccountState({
          mintAddress: mintAddress,
          program: 'bonding_curve',
          accountType: 'bonding_curve',
          bondingCurveComplete: true,
          virtualSolReserves: BigInt(bondingCurve.virtual_sol_reserves),
          virtualTokenReserves: BigInt(bondingCurve.virtual_token_reserves),
          slot
        });
      } else {
        console.log(chalk.yellow(`⚠️  Could not find mint address`));
      }
    }
    
  } catch (error) {
    stats.errors.push({
      type: 'Account Processing',
      error: error.message,
      timestamp: new Date()
    });
    // Silent error handling - errors tracked in stats
  }
}

/**
 * Display dashboard
 */
function displayDashboard(): void {
  console.clear();
  
  const elapsed = Date.now() - stats.startTime;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  
  console.log(chalk.cyan.bold('\n🔍 Bonding Curve Account Monitor'));
  console.log(chalk.gray('─'.repeat(50)));
  
  console.log(`\nRuntime: ${minutes}m ${seconds}s`);
  console.log(`Updates: ${stats.accountUpdates.toLocaleString()} | BC Accounts: ${stats.bondingCurveAccounts.toLocaleString()}`);
  console.log(`Graduations: ${chalk.green(stats.graduationsDetected.toString())} | Errors: ${stats.decodingErrors}`);
  
  if (stats.lastGraduation) {
    const age = Math.floor((Date.now() - stats.lastGraduation.timestamp.getTime()) / 1000);
    console.log(`\nLast Graduation: ${stats.lastGraduation.mint.slice(0, 8)}... (${age}s ago)`);
  }
  
  console.log(chalk.gray('─'.repeat(50)));
}

/**
 * Handle the gRPC stream
 */
async function handleStream(client: Client, args: SubscribeRequest) {
  console.log(chalk.blue('🔄 Connecting to gRPC...'));
  const stream = await client.subscribe();
  
  // Create error/end handler
  const streamClosed = new Promise<void>((resolve, reject) => {
    stream.on('error', (error) => {
      console.error(chalk.red('❌ Stream error:'), error);
      reject(error);
      stream.end();
    });
    stream.on('end', () => {
      console.log(chalk.yellow('⚠️  Stream ended'));
      resolve();
    });
    stream.on('close', () => {
      console.log(chalk.yellow('⚠️  Stream closed'));
      resolve();
    });
  });
  
  // Handle updates
  stream.on('data', async (data: any) => {
    if (data.account) {
      await processAccountUpdate(data);
    }
  });
  
  // Send subscribe request
  await new Promise<void>((resolve, reject) => {
    stream.write(args, (err: any) => {
      if (err === null || err === undefined) {
        console.log(chalk.green('✅ Connected'));
        resolve();
      } else {
        reject(err);
      }
    });
  }).catch((reason) => {
    console.error(chalk.red('Failed to write subscription request:'), reason);
    throw reason;
  });
  
  await streamClosed;
}

/**
 * Main monitoring function
 */
async function main() {
  console.log(chalk.cyan.bold('\n🔍 Bonding Curve Account Monitor'));
  console.log(chalk.gray(`Program: ${PUMP_FUN_PROGRAM}`));
  console.log(chalk.gray(`Started: ${new Date().toLocaleTimeString()}`));
  console.log(chalk.gray('─'.repeat(50)) + '\n');
  
  // Start dashboard updates
  const dashboardInterval = setInterval(displayDashboard, 2000);
  
  try {
    // Create gRPC client
    const grpcEndpoint = process.env.SHYFT_GRPC_ENDPOINT;
    const grpcToken = process.env.SHYFT_GRPC_TOKEN;
    
    if (!grpcEndpoint || !grpcToken) {
      throw new Error('Missing SHYFT_GRPC_ENDPOINT or SHYFT_GRPC_TOKEN');
    }
    
    const client = new Client(grpcEndpoint, grpcToken, undefined);
    
    // Create subscription request
    const request: SubscribeRequest = {
      commitment: CommitmentLevel.PROCESSED,
      accountsDataSlice: [],
      accounts: {
        // Monitor all accounts owned by pump.fun program
        pump_accounts: {
          account: [],
          owner: [PUMP_FUN_PROGRAM],
          filters: []
        }
      },
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      slots: {},
      ping: undefined
    };
    
    await handleStream(client, request);
    
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
    clearInterval(dashboardInterval);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Shutting down...'));
  process.exit(0);
});

// Start monitoring
main().catch(console.error);