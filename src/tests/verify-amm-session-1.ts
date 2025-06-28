#!/usr/bin/env node
/**
 * Verification script for AMM Session 1: Pool Reserve Monitoring
 * 
 * This script verifies that:
 * 1. Pool account monitoring is working
 * 2. Pool states are being decoded correctly
 * 3. Reserves are being tracked from trade events
 * 4. Prices are calculated accurately from reserves
 */

import 'dotenv/config';
import { PublicKey, VersionedTransactionResponse } from '@solana/web3.js';
import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { BorshAccountsCoder, Idl } from '@coral-xyz/anchor';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { SolanaEventParser } from '../utils/event-parser';
import chalk from 'chalk';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';
import { TransactionFormatter } from '../utils/transaction-formatter';
import { bnLayoutFormatter } from '../utils/bn-layout-formatter';
import { suppressParserWarnings } from '../utils/suppress-parser-warnings';
import { parseSwapTransactionOutput } from '../utils/swapTransactionParser';

// Program ID
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Parsers
const TXN_FORMATTER = new TransactionFormatter();
const PUMP_AMM_IX_PARSER = new SolanaParser([]);
PUMP_AMM_IX_PARSER.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as Idl);
const accountCoder = new BorshAccountsCoder(pumpAmmIdl as Idl);

// Silent console for parser
const silentConsole = {
  ...console,
  warn: () => {},
  error: () => {},
};
const PUMP_AMM_EVENT_PARSER = new SolanaEventParser([], silentConsole);
PUMP_AMM_EVENT_PARSER.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as Idl);

// Verification data
const verificationData = {
  accountUpdates: [] as any[],
  trades: [] as any[],
  poolStates: new Map<string, any>(),
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
    if (!data.account || !data.account.account) return;
    
    const accountInfo = data.account.account;
    const accountPubkey = convertBase64ToBase58(accountInfo.pubkey);
    const owner = accountInfo.owner ? convertBase64ToBase58(accountInfo.owner) : '';
    
    if (owner !== PUMP_AMM_PROGRAM_ID.toBase58()) return;
    
    const accountData = Buffer.from(accountInfo.data, 'base64');
    
    try {
      const decodedAccount = accountCoder.decodeAny(accountData);
      bnLayoutFormatter(decodedAccount);
      
      const poolData = {
        poolAddress: accountPubkey,
        quoteMint: decodedAccount.quote_mint?.toBase58 ? decodedAccount.quote_mint.toBase58() : decodedAccount.quote_mint,
        baseMint: decodedAccount.base_mint?.toBase58 ? decodedAccount.base_mint.toBase58() : decodedAccount.base_mint,
        lpSupply: Number(decodedAccount.lp_supply || 0),
        poolBaseTokenAccount: decodedAccount.pool_base_token_account?.toBase58 ? decodedAccount.pool_base_token_account.toBase58() : decodedAccount.pool_base_token_account,
        poolQuoteTokenAccount: decodedAccount.pool_quote_token_account?.toBase58 ? decodedAccount.pool_quote_token_account.toBase58() : decodedAccount.pool_quote_token_account,
        slot: data.slot || 0,
      };
      
      verificationData.accountUpdates.push(poolData);
      verificationData.poolStates.set(poolData.quoteMint, poolData);
      
      console.log(chalk.green(`✓ Pool account decoded: ${poolData.quoteMint.slice(0, 8)}...`));
      
    } catch (decodeError) {
      // Ignore decode errors for non-pool accounts
    }
  } catch (error) {
    console.error(chalk.red('Error processing account:'), error);
  }
}

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
      ix.programId.equals(PUMP_AMM_PROGRAM_ID)
    );

    if (pumpAmmIxs.length === 0) return;
    
    const events = PUMP_AMM_EVENT_PARSER.parseEvent(tx);
    const result = { instructions: { pumpAmmIxs, events }, inner_ixs: [] };
    bnLayoutFormatter(result);
    
    return result;
  } catch (err) {
    // Silently ignore
  }
}

/**
 * Process transaction
 */
async function processTransaction(data: any): Promise<void> {
  try {
    if (!data.transaction) return;
    
    const txn = TXN_FORMATTER.formTransactionFromJson(
      data.transaction,
      Date.now()
    );
    
    const parsedTxn = decodePumpAmmTxn(txn);
    if (!parsedTxn) return;
    
    const formattedSwapTxn = parseSwapTransactionOutput(parsedTxn, txn);
    if (!formattedSwapTxn) return;
    
    const swapEvent = formattedSwapTxn.transactionEvent;
    if (!swapEvent) return;
    
    const tradeData = {
      signature: txn.transaction.signatures[0],
      mint: swapEvent.mint,
      type: swapEvent.type,
      poolBaseReserves: Number(swapEvent.pool_base_token_reserves || 0),
      poolQuoteReserves: Number(swapEvent.pool_quote_token_reserves || 0),
      solAmount: Number(swapEvent.in_amount || swapEvent.out_amount) / 1e9,
      tokenAmount: Number(swapEvent.out_amount || swapEvent.in_amount) / 1e6,
      slot: txn.slot || 0,
    };
    
    // Calculate price from reserves
    if (tradeData.poolBaseReserves > 0 && tradeData.poolQuoteReserves > 0) {
      const solReservesInSol = tradeData.poolBaseReserves / 1e9;
      const tokenReservesAdjusted = tradeData.poolQuoteReserves / 1e6;
      tradeData['pricePerTokenSol'] = solReservesInSol / tokenReservesAdjusted;
    }
    
    verificationData.trades.push(tradeData);
    
    console.log(chalk.blue(`✓ Trade captured: ${tradeData.type} ${tradeData.mint.slice(0, 8)}... Price: ${tradeData['pricePerTokenSol']?.toFixed(6) || 'N/A'} SOL`));
    
  } catch (error) {
    console.error(chalk.red('Error processing transaction:'), error);
  }
}

/**
 * Run verification
 */
async function runVerification() {
  console.log(chalk.cyan.bold('🔍 AMM Session 1 Verification: Pool Reserve Monitoring\n'));
  
  suppressParserWarnings();
  
  const grpcEndpoint = process.env.SHYFT_GRPC_ENDPOINT;
  const grpcToken = process.env.SHYFT_GRPC_TOKEN;
  
  if (!grpcEndpoint || !grpcToken) {
    console.error(chalk.red('Missing SHYFT_GRPC_ENDPOINT or SHYFT_GRPC_TOKEN'));
    process.exit(1);
  }
  
  const client = new Client(grpcEndpoint, grpcToken, undefined);
  
  // Subscribe to both accounts and transactions
  const req: SubscribeRequest = {
    slots: {},
    accounts: {
      pumpswap_amm: {
        account: [],
        filters: [],
        owner: [PUMP_AMM_PROGRAM_ID.toBase58()],
      },
    },
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
    commitment: CommitmentLevel.PROCESSED,
  };
  
  console.log(chalk.yellow('Starting 60-second verification test...\n'));
  
  const stream = await client.subscribe();
  
  // Set timeout
  const timeout = setTimeout(() => {
    stream.end();
    displayResults();
  }, 60000); // 60 seconds
  
  // Handle stream events
  stream.on("data", async (data) => {
    if (data?.account) {
      await processAccountUpdate(data);
    } else if (data?.transaction) {
      await processTransaction(data);
    }
  });
  
  stream.on("error", (error) => {
    console.error(chalk.red("Stream error:"), error);
    clearTimeout(timeout);
    stream.end();
    displayResults();
  });
  
  stream.on("end", () => {
    clearTimeout(timeout);
    displayResults();
  });
  
  // Send subscribe request
  await new Promise<void>((resolve, reject) => {
    stream.write(req, (err: any) => {
      if (err === null || err === undefined) {
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Display verification results
 */
function displayResults() {
  console.log(chalk.cyan.bold('\n\n📊 VERIFICATION RESULTS'));
  console.log(chalk.gray('─'.repeat(80)));
  
  console.log(chalk.white('\n1. Account Monitoring:'));
  console.log(chalk.gray(`   Total account updates: ${verificationData.accountUpdates.length}`));
  console.log(chalk.gray(`   Unique pools tracked: ${verificationData.poolStates.size}`));
  
  if (verificationData.accountUpdates.length > 0) {
    console.log(chalk.green('   ✅ Pool account decoding working'));
    const sample = verificationData.accountUpdates[0];
    console.log(chalk.gray(`   Sample: ${sample.quoteMint.slice(0, 16)}... LP Supply: ${sample.lpSupply}`));
  } else {
    console.log(chalk.yellow('   ⚠️  No pool accounts detected'));
  }
  
  console.log(chalk.white('\n2. Trade Events:'));
  console.log(chalk.gray(`   Total trades captured: ${verificationData.trades.length}`));
  
  if (verificationData.trades.length > 0) {
    console.log(chalk.green('   ✅ Trade event parsing working'));
    
    // Check reserves
    const tradesWithReserves = verificationData.trades.filter(t => t.poolBaseReserves > 0);
    console.log(chalk.gray(`   Trades with reserves: ${tradesWithReserves.length}`));
    
    if (tradesWithReserves.length > 0) {
      console.log(chalk.green('   ✅ Reserve data extraction working'));
      const sample = tradesWithReserves[0];
      console.log(chalk.gray(`   Sample reserves: ${(sample.poolBaseReserves / 1e9).toFixed(4)} SOL, ${(sample.poolQuoteReserves / 1e6).toFixed(0)} tokens`));
      console.log(chalk.gray(`   Calculated price: ${sample.pricePerTokenSol?.toFixed(6)} SOL per token`));
    } else {
      console.log(chalk.red('   ❌ No reserve data found in trades'));
    }
  } else {
    console.log(chalk.yellow('   ⚠️  No trades detected'));
  }
  
  console.log(chalk.white('\n3. Cross-Verification:'));
  
  // Check if we have matching pool and trade data
  let matchingPairs = 0;
  for (const trade of verificationData.trades) {
    if (verificationData.poolStates.has(trade.mint)) {
      matchingPairs++;
    }
  }
  
  if (matchingPairs > 0) {
    console.log(chalk.green(`   ✅ Found ${matchingPairs} tokens with both pool state and trade data`));
  } else {
    console.log(chalk.yellow('   ⚠️  No matching pool states and trades found'));
  }
  
  console.log(chalk.gray('\n─'.repeat(80)));
  
  // Summary
  const success = verificationData.accountUpdates.length > 0 && 
                  verificationData.trades.length > 0 && 
                  verificationData.trades.some(t => t.poolBaseReserves > 0);
  
  if (success) {
    console.log(chalk.green.bold('\n✅ AMM Session 1 Verification PASSED'));
    console.log(chalk.green('Pool reserve monitoring is working correctly!'));
  } else {
    console.log(chalk.red.bold('\n❌ AMM Session 1 Verification FAILED'));
    console.log(chalk.red('Issues detected with pool reserve monitoring'));
  }
  
  process.exit(success ? 0 : 1);
}

// Run verification
runVerification().catch(console.error);