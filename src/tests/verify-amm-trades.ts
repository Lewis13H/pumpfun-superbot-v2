#!/usr/bin/env node
/**
 * Verify AMM trades by capturing 5 recent transactions
 * and providing Solscan links for verification
 */

import 'dotenv/config';
import { PublicKey, VersionedTransactionResponse } from '@solana/web3.js';
import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { Idl } from '@coral-xyz/anchor';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { SolanaEventParser } from '../utils/event-parser';
import chalk from 'chalk';
import { parseSwapTransactionOutput } from '../utils/swapTransactionParser';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';
import { TransactionFormatter } from '../utils/transaction-formatter';
import { bnLayoutFormatter } from '../utils/bn-layout-formatter';
import { suppressParserWarnings } from '../utils/suppress-parser-warnings';

// Program ID
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Token constants
const TOKEN_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1e9;

// Parsers and formatters
const TXN_FORMATTER = new TransactionFormatter();
const PUMP_AMM_IX_PARSER = new SolanaParser([]);
PUMP_AMM_IX_PARSER.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as Idl);

// Create silent console for parser
const silentConsole = {
  ...console,
  warn: () => {},
  error: () => {},
};
const PUMP_AMM_EVENT_PARSER = new SolanaEventParser([], silentConsole);
PUMP_AMM_EVENT_PARSER.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as Idl);

// Collected trades
const trades: any[] = [];
const targetTrades = 5;

/**
 * Decode pump AMM transaction
 */
function decodePumpAmmTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;
  
  try {
    const parsedIxs = PUMP_AMM_IX_PARSER.parseTransactionData(
      tx.transaction.message,
      tx.meta.loadedAddresses,
    );

    const pumpAmmIxs = parsedIxs.filter((ix) =>
      ix.programId.equals(PUMP_AMM_PROGRAM_ID) || 
      ix.programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))
    );

    const parsedInnerIxs = PUMP_AMM_IX_PARSER.parseTransactionWithInnerInstructions(tx);

    const pump_amm_inner_ixs = parsedInnerIxs.filter((ix) =>
      ix.programId.equals(PUMP_AMM_PROGRAM_ID) || 
      ix.programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))
    );

    if (pumpAmmIxs.length === 0) return;
    
    const events = PUMP_AMM_EVENT_PARSER.parseEvent(tx);
    const result = { instructions: { pumpAmmIxs, events }, inner_ixs: pump_amm_inner_ixs };
    bnLayoutFormatter(result);
    
    return result;
  } catch (err) {
    // Silently ignore parse errors
  }
}

/**
 * Process AMM transaction
 */
async function processAmmTransaction(data: any): Promise<void> {
  try {
    if (!data.transaction) return;
    
    // Format transaction
    const txn = TXN_FORMATTER.formTransactionFromJson(
      data.transaction,
      Date.now()
    );
    
    const signature = txn.transaction.signatures[0];
    const slot = txn.slot || 0;
    
    // Decode pump AMM transaction
    const parsedTxn = decodePumpAmmTxn(txn);
    if (!parsedTxn) return;
    
    // Parse swap output
    const formattedSwapTxn = parseSwapTransactionOutput(parsedTxn, txn);
    if (!formattedSwapTxn) return;
    
    const swapEvent = formattedSwapTxn.transactionEvent;
    if (!swapEvent) return;
    
    // Calculate amounts
    const solAmount = Number(swapEvent.in_amount || swapEvent.out_amount) / LAMPORTS_PER_SOL;
    const tokenAmount = Number(swapEvent.out_amount || swapEvent.in_amount) / Math.pow(10, TOKEN_DECIMALS);
    
    // Store trade details
    trades.push({
      signature,
      slot,
      type: swapEvent.type,
      mint: swapEvent.mint,
      user: swapEvent.user,
      solAmount,
      tokenAmount,
      timestamp: new Date(),
      solscanUrl: `https://solscan.io/tx/${signature}`
    });
    
    console.log(chalk.green(`✓ Captured ${swapEvent.type} trade ${trades.length}/${targetTrades}`));
    console.log(chalk.gray(`  Signature: ${signature}`));
    console.log(chalk.gray(`  Mint: ${swapEvent.mint}`));
    console.log(chalk.gray(`  SOL: ${solAmount.toFixed(4)}, Tokens: ${tokenAmount.toFixed(2)}`));
    console.log(chalk.blue(`  Verify: https://solscan.io/tx/${signature}`));
    console.log();
    
    // Stop after collecting target trades
    if (trades.length >= targetTrades) {
      displaySummary();
      process.exit(0);
    }
    
  } catch (error) {
    // Silently handle errors
  }
}

/**
 * Display summary of collected trades
 */
function displaySummary() {
  console.log(chalk.cyan.bold('\n📊 TRADE VERIFICATION SUMMARY'));
  console.log(chalk.gray('─'.repeat(80)));
  
  trades.forEach((trade, index) => {
    console.log(chalk.white(`\n${index + 1}. ${trade.type} Trade`));
    console.log(chalk.gray(`   Signature: ${trade.signature}`));
    console.log(chalk.gray(`   Mint: ${trade.mint}`));
    console.log(chalk.gray(`   User: ${trade.user}`));
    console.log(chalk.gray(`   SOL Amount: ${trade.solAmount.toFixed(4)}`));
    console.log(chalk.gray(`   Token Amount: ${trade.tokenAmount.toFixed(2)}`));
    console.log(chalk.blue(`   🔗 ${trade.solscanUrl}`));
  });
  
  console.log(chalk.gray('\n─'.repeat(80)));
  console.log(chalk.yellow('Please verify these transactions on Solscan to confirm:'));
  console.log(chalk.yellow('1. The transaction shows interaction with pump.swap AMM'));
  console.log(chalk.yellow('2. The amounts match what we detected'));
  console.log(chalk.yellow('3. The trade type (buy/sell) is correct'));
}

/**
 * Handle stream
 */
async function handleStream(client: Client, args: SubscribeRequest) {
  console.log(chalk.cyan("🔍 Capturing AMM trades for verification..."));
  console.log(chalk.gray(`Target: ${targetTrades} trades\n`));
  
  const stream = await client.subscribe();

  // Create error/end handler
  const streamClosed = new Promise<void>((resolve, reject) => {
    stream.on("error", (error) => {
      console.error(chalk.red("Stream error:"), error);
      reject(error);
      stream.end();
    });
    stream.on("end", () => {
      resolve();
    });
    stream.on("close", () => {
      resolve();
    });
  });

  // Handle data
  stream.on("data", async (data) => {
    if (data?.transaction) {
      await processAmmTransaction(data);
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
  // Suppress parser warnings
  suppressParserWarnings();
  
  // Create gRPC client
  const grpcEndpoint = process.env.SHYFT_GRPC_ENDPOINT;
  const grpcToken = process.env.SHYFT_GRPC_TOKEN;
  
  if (!grpcEndpoint || !grpcToken) {
    console.error(chalk.red('Missing SHYFT_GRPC_ENDPOINT or SHYFT_GRPC_TOKEN'));
    process.exit(1);
  }
  
  const client = new Client(grpcEndpoint, grpcToken, undefined);
  
  // Create subscription request
  const req: SubscribeRequest = {
    accounts: {},
    slots: {},
    transactions: {
      pumpAMM: {
        vote: false,
        failed: false,
        signature: undefined,
        accountInclude: [PUMP_AMM_PROGRAM_ID.toBase58()],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    entry: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    ping: undefined,
    commitment: CommitmentLevel.CONFIRMED,
  };
  
  // Start monitoring
  try {
    await handleStream(client, req);
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    if (trades.length > 0) {
      displaySummary();
    }
  }
}

// Run the verification
main().catch(console.error);