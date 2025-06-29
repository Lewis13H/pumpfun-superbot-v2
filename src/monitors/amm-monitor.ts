#!/usr/bin/env node
/**
 * AMM Pool Monitor - Based on Shyft Examples
 * 
 * Monitors pump.swap AMM graduated tokens using the authoritative Shyft code
 */

import 'dotenv/config';
import { PublicKey, VersionedTransactionResponse } from '@solana/web3.js';
import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { UnifiedDbServiceV2 } from '../database/unified-db-service-v2';
import { SolPriceService } from '../services/sol-price';
import { AutoEnricher } from '../services/auto-enricher';
import { Idl } from '@coral-xyz/anchor';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { SolanaEventParser } from '../utils/event-parser';
import { SolPriceUpdater } from '../services/sol-price-updater';
import chalk from 'chalk';
import ora from 'ora';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { parseSwapTransactionOutput } from '../utils/swapTransactionParser';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';
import { TransactionFormatter } from '../utils/transaction-formatter';
import { bnLayoutFormatter } from '../utils/bn-layout-formatter';
import { suppressParserWarnings } from '../utils/suppress-parser-warnings';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { unifiedWebSocketServer, TradeEvent } from '../services/unified-websocket-server-stub';

// Program ID
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PUMP_SWAP_PROGRAM = PUMP_AMM_PROGRAM_ID.toBase58();

// Token constants
const TOKEN_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1e9;

// Services
let dbService: UnifiedDbServiceV2;
let solPriceService: SolPriceService;
let poolStateService: AmmPoolStateService;
let enricher: AutoEnricher | null = null;
let currentSolPrice = 180; // Default fallback

// Parsers and formatters (following Shyft example)
const TXN_FORMATTER = new TransactionFormatter();
const PUMP_AMM_IX_PARSER = new SolanaParser([]);
PUMP_AMM_IX_PARSER.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as Idl);
// Create silent console for parser to suppress warnings
const silentConsole = {
  ...console,
  warn: () => {},
  error: () => {},
};
const PUMP_AMM_EVENT_PARSER = new SolanaEventParser([], silentConsole);
PUMP_AMM_EVENT_PARSER.addParserFromIdl(PUMP_AMM_PROGRAM_ID.toBase58(), pumpAmmIdl as Idl);

// Statistics
const stats = {
  startTime: new Date(),
  transactions: 0,
  trades: 0,
  buys: 0,
  sells: 0,
  totalVolumeUsd: 0,
  uniqueTokens: new Set<string>(),
  errors: 0,
  reconnections: 0,
  lastSlot: 0,
  lastUpdate: new Date()
};

// Recent trades for dashboard
const recentTrades: {
  time: Date;
  type: 'Buy' | 'Sell';
  mint: string;
  symbol?: string;
  solAmount: number;
  tokenAmount: number;
  priceUsd: number;
  user: string;
  signature: string;
}[] = [];

const MAX_RECENT_TRADES = 20;

/**
 * Decode pump AMM transaction (following Shyft example)
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
    stats.transactions++;
    
    if (!data.transaction) return;
    
    // Format transaction using Shyft formatter
    const txn = TXN_FORMATTER.formTransactionFromJson(
      data.transaction,
      Date.now()
    );
    
    const signature = txn.transaction.signatures[0];
    const slot = txn.slot || 0;
    
    if (slot > stats.lastSlot) {
      stats.lastSlot = slot;
    }
    
    // Decode pump AMM transaction
    const parsedTxn = decodePumpAmmTxn(txn);
    if (!parsedTxn) return;
    
    // Parse swap output
    const formattedSwapTxn = parseSwapTransactionOutput(parsedTxn, txn);
    if (!formattedSwapTxn) return;
    
    const swapEvent = formattedSwapTxn.transactionEvent;
    if (!swapEvent) return;
    
    stats.trades++;
    if (swapEvent.type === 'Buy') {
      stats.buys++;
    } else {
      stats.sells++;
    }
    
    // Update pool reserves from event
    const poolBaseReserves = Number(swapEvent.pool_base_token_reserves || 0);
    const poolQuoteReserves = Number(swapEvent.pool_quote_token_reserves || 0);
    
    if (poolBaseReserves > 0 && poolQuoteReserves > 0) {
      await poolStateService.updatePoolReserves(
        swapEvent.mint,
        poolBaseReserves,
        poolQuoteReserves,
        slot
      );
    }
    
    // Calculate amounts and price based on trade type
    let solAmount: number;
    let tokenAmount: number;
    
    // For pump.swap AMM:
    // - When swapEvent.type is 'Buy': User is buying tokens with SOL
    // - When swapEvent.type is 'Sell': User is selling tokens for SOL
    if (swapEvent.type === 'Buy') {
      // User buys tokens: sends SOL (in_amount) → receives tokens (out_amount)
      solAmount = Number(swapEvent.in_amount) / LAMPORTS_PER_SOL;
      tokenAmount = Number(swapEvent.out_amount) / Math.pow(10, TOKEN_DECIMALS);
    } else {
      // User sells tokens: sends tokens (in_amount) → receives SOL (out_amount)
      tokenAmount = Number(swapEvent.in_amount) / Math.pow(10, TOKEN_DECIMALS);
      solAmount = Number(swapEvent.out_amount) / LAMPORTS_PER_SOL;
    }
    
    // Calculate price per token
    const priceInSol = tokenAmount > 0 ? solAmount / tokenAmount : 0;
    const priceUsd = priceInSol * currentSolPrice;
    
    // Volume is always in SOL value
    const volumeUsd = solAmount * currentSolPrice;
    
    stats.totalVolumeUsd += volumeUsd;
    stats.uniqueTokens.add(swapEvent.mint);
    
    // Add to recent trades
    recentTrades.unshift({
      time: new Date(),
      type: swapEvent.type,
      mint: swapEvent.mint,
      symbol: undefined, // Will be enriched
      solAmount,
      tokenAmount,
      priceUsd,
      user: swapEvent.user,
      signature
    });
    
    if (recentTrades.length > MAX_RECENT_TRADES) {
      recentTrades.pop();
    }
    
    // Broadcast trade via WebSocket
    const tradeEvent: TradeEvent = {
      signature,
      mintAddress: swapEvent.mint,
      tradeType: swapEvent.type.toLowerCase() as 'buy' | 'sell',
      userAddress: swapEvent.user,
      solAmount,
      tokenAmount,
      priceUsd,
      marketCapUsd: priceUsd * 1e9,
      program: 'amm_pool'
    };
    
    unifiedWebSocketServer.broadcastTrade(tradeEvent, 'amm');
    
    // Process in database
    await dbService.processTrade({
      mintAddress: swapEvent.mint,
      signature,
      program: 'amm_pool',
      tradeType: swapEvent.type.toLowerCase() as 'buy' | 'sell',
      userAddress: swapEvent.user,
      solAmount: BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)),
      tokenAmount: BigInt(Math.floor(tokenAmount * Math.pow(10, TOKEN_DECIMALS))),
      priceSol: priceInSol,
      priceUsd,
      marketCapUsd: priceUsd * 1e9, // Assuming 1B supply
      virtualSolReserves: BigInt(poolBaseReserves), // Actual pool reserves
      virtualTokenReserves: BigInt(poolQuoteReserves),
      bondingCurveProgress: 100, // AMM tokens are fully graduated
      slot: BigInt(slot),
      blockTime: new Date()
    });
    
    // Log significant trades
    if (volumeUsd > 100) {
      console.log(
        chalk.cyan(`[AMM ${swapEvent.type}]`),
        chalk.white(`${swapEvent.mint.slice(0, 8)}...`),
        chalk.gray('SOL:'),
        chalk.white(solAmount.toFixed(4)),
        chalk.gray('Tokens:'),
        chalk.white(formatNumber(tokenAmount)),
        chalk.gray('Price:'),
        chalk.green(`$${priceUsd.toFixed(8)}`),
        chalk.gray('Volume:'),
        chalk.yellow(`$${formatCurrency(volumeUsd)}`)
      );
      
      // DEBUG: Log full signature for verification
      console.log(chalk.magenta(`[DEBUG] Full signature: ${signature}`));
      console.log(chalk.magenta(`[DEBUG] Solscan: https://solscan.io/tx/${signature}`));
    }
    
  } catch (error) {
    stats.errors++;
    // Silently handle errors unless debugging
    if (process.env.DEBUG_AMM) {
      console.error(chalk.red('Error processing AMM transaction:'), error);
    }
  }
}

/**
 * Display monitoring dashboard
 */
function displayDashboard(): void {
  console.clear();
  
  const now = new Date();
  const uptime = Math.floor((now.getTime() - stats.startTime.getTime()) / 1000);
  const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;
  
  // Header
  console.log(chalk.cyan.bold('🏊 AMM Pool Monitor - pump.swap'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Connection info
  console.log(
    chalk.white('Status:'),
    chalk.green('● Connected'),
    chalk.gray('|'),
    chalk.white('Uptime:'),
    chalk.cyan(uptimeStr),
    chalk.gray('|'),
    chalk.white('SOL:'),
    chalk.green(`$${currentSolPrice.toFixed(2)}`),
    chalk.gray('|'),
    chalk.white('Slot:'),
    chalk.cyan(stats.lastSlot.toString())
  );
  
  console.log(chalk.gray('─'.repeat(80)));
  
  // Statistics
  console.log(chalk.white.bold('📊 STATISTICS'));
  console.log();
  
  const tps = stats.trades / (uptime || 1);
  
  console.log(
    chalk.white('Transactions:'),
    chalk.cyan(formatNumber(stats.transactions)),
    chalk.gray('|'),
    chalk.white('Trades:'),
    chalk.cyan(formatNumber(stats.trades)),
    chalk.gray(`(${tps.toFixed(2)} TPS)`)
  );
  
  console.log(
    chalk.white('Buys:'),
    chalk.green(formatNumber(stats.buys)),
    chalk.gray('|'),
    chalk.white('Sells:'),
    chalk.red(formatNumber(stats.sells)),
    chalk.gray('|'),
    chalk.white('Ratio:'),
    chalk.yellow(`${((stats.buys / (stats.trades || 1)) * 100).toFixed(1)}% buys`)
  );
  
  console.log(
    chalk.white('Unique Tokens:'),
    chalk.cyan(stats.uniqueTokens.size),
    chalk.gray('|'),
    chalk.white('Total Volume:'),
    chalk.yellow(`$${formatCurrency(stats.totalVolumeUsd)}`)
  );
  
  console.log();
  console.log(chalk.white.bold('💹 RECENT TRADES'));
  console.log(chalk.gray('─'.repeat(80)));
  
  if (recentTrades.length === 0) {
    console.log(chalk.gray('  No trades yet...'));
  } else {
    console.log(
      chalk.gray('  Time    '),
      chalk.gray('Type'),
      chalk.gray('  Token         '),
      chalk.gray('   SOL Amt'),
      chalk.gray('       Price'),
      chalk.gray('    Volume')
    );
    
    for (const trade of recentTrades.slice(0, 10)) {
      const age = Math.floor((now.getTime() - trade.time.getTime()) / 1000);
      const ageStr = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
      
      const typeColor = trade.type === 'Buy' ? chalk.green : chalk.red;
      const typeIcon = trade.type === 'Buy' ? '🟢' : '🔴';
      
      console.log(
        chalk.gray(`  ${ageStr.padEnd(8)}`),
        typeIcon,
        typeColor(trade.type.padEnd(4)),
        chalk.white((trade.symbol || trade.mint.slice(0, 6) + '...').padEnd(14)),
        chalk.cyan(trade.solAmount.toFixed(4).padStart(10)),
        chalk.green(`$${trade.priceUsd.toFixed(6)}`.padStart(12)),
        chalk.yellow(`$${formatCurrency(trade.solAmount * currentSolPrice)}`.padStart(10))
      );
    }
  }
  
  console.log();
  console.log(chalk.gray('─'.repeat(80)));
  console.log(chalk.gray('Press Ctrl+C to stop monitoring...'));
}

/**
 * Handle stream (following Shyft example)
 */
async function handleStream(client: Client, args: SubscribeRequest) {
  console.log(chalk.cyan("Listening to Buy and Sell on pump.swap AMM"));
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

  // Start dashboard updates
  const dashboardInterval = setInterval(() => displayDashboard(), 1000);
  
  // Update SOL price periodically
  const priceInterval = setInterval(async () => {
    currentSolPrice = await solPriceService.getPrice();
  }, 5000);

  // Handle data
  stream.on("data", async (data) => {
    stats.lastUpdate = new Date();
    
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
  clearInterval(dashboardInterval);
  clearInterval(priceInterval);
}

/**
 * Subscribe command with auto-reconnect
 */
async function subscribeCommand(client: Client, args: SubscribeRequest) {
  while (true) {
    try {
      await handleStream(client, args);
    } catch (error) {
      stats.reconnections++;
      console.error(chalk.yellow("Stream error, restarting in 1 second..."));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log(chalk.cyan.bold('🏊 Starting AMM Pool Monitor...'));
  console.log(chalk.gray('Monitoring graduated tokens on pump.swap'));
  
  // Suppress parser warnings
  suppressParserWarnings();
  
  // Initialize services
  dbService = UnifiedDbServiceV2.getInstance();
  solPriceService = SolPriceService.getInstance();
  poolStateService = new AmmPoolStateService();
  
  // Start SOL price updater
  console.log(chalk.yellow('Starting SOL price updater...'));
  SolPriceUpdater.getInstance().start();
  
  // Initialize auto-enricher if API key is available
  if (process.env.HELIUS_API_KEY) {
    console.log(chalk.yellow('Starting auto-enricher...'));
    enricher = AutoEnricher.getInstance();
    await enricher.start();
  }
  
  // Wait for SOL price
  const spinner = ora('Fetching initial SOL price...').start();
  currentSolPrice = await solPriceService.getPrice();
  spinner.succeed(`SOL Price: $${currentSolPrice.toFixed(2)}`);
  
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
  
  // Initialize WebSocket server if not already initialized
  // Note: The API server will initialize it, but we broadcast stats
  setInterval(() => {
    // Broadcast stats periodically
    unifiedWebSocketServer.broadcastStats({
      source: 'amm',
      transactions: stats.transactions,
      trades: stats.trades,
      buys: stats.buys,
      sells: stats.sells,
      errors: stats.errors,
      uniqueTokens: stats.uniqueTokens.size,
      totalVolumeUsd: stats.totalVolumeUsd,
      uptime: Math.floor((new Date().getTime() - stats.startTime.getTime()) / 1000),
      lastSlot: stats.lastSlot
    }, 'amm');
  }, 5000); // Every 5 seconds
  
  // Start monitoring
  await subscribeCommand(client, req);
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\nShutting down AMM monitor...'));
    
    if (enricher) {
      enricher.stop();
    }
    
    await dbService.close();
    process.exit(0);
  });
}

// Run the monitor
main().catch(console.error);