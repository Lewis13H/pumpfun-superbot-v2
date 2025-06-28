#!/usr/bin/env node
/**
 * Bonding Curve Monitor - Quick Fixes Version
 * 
 * This is a patched version of bc-monitor.ts with immediate improvements:
 * - Handles both 225-byte and 113-byte events
 * - Better error logging
 * - Configurable save threshold
 * - Parse statistics tracking
 */

import 'dotenv/config';
import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../stream/client';
import { PUMP_PROGRAM } from '../utils/constants';
import { PublicKey } from '@solana/web3.js';
import { 
  BondingCurveTradeEvent,
  detectTradeTypeFromLogs,
  isValidMintAddress 
} from '../parsers/bc-event-parser';
import { 
  calculateTokenPrice,
  calculateBondingCurveProgress,
  formatPrice,
  formatMarketCap,
  validateReserves
} from '../services/bc-price-calculator';
import { SolPriceService } from '../services/sol-price';
import { BondingCurveDbHandler, ProcessedTradeData } from '../handlers/bc-db-handler';
import { ProgressTracker, formatProgressDisplay, detectGraduationFromLogs } from '../services/bc-progress-tracker';
import chalk from 'chalk';
import bs58 from 'bs58';

// Configuration constants
const MONITOR_NAME = 'Bonding Curve Monitor (Quick Fix)';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
const STATS_UPDATE_INTERVAL_MS = 5000;

// Configurable thresholds
const SAVE_THRESHOLD = Number(process.env.BC_SAVE_THRESHOLD || 8888);
const SAVE_ALL_TOKENS = process.env.SAVE_ALL_TOKENS === 'true';
const DEBUG_PARSE_ERRORS = process.env.DEBUG_PARSE_ERRORS === 'true';

/**
 * Enhanced parse function that handles multiple event sizes
 */
function parsePumpFunTradeEventFlexible(data: Buffer): BondingCurveTradeEvent | null {
  // Support both 225 and 113 byte events
  if (data.length !== 225 && data.length !== 113) {
    return null;
  }
  
  try {
    // Common fields for both formats
    const mint = new PublicKey(data.slice(8, 40)).toString();
    
    // Handle 225-byte format
    if (data.length === 225) {
      const solAmount = data.readBigUInt64LE(40);
      const tokenAmount = data.readBigUInt64LE(48);
      const user = new PublicKey(data.slice(56, 88)).toString();
      const virtualSolReserves = data.readBigUInt64LE(97);
      const virtualTokenReserves = data.readBigUInt64LE(105);
      
      return {
        mint,
        solAmount,
        tokenAmount,
        user,
        virtualSolReserves,
        virtualTokenReserves
      };
    }
    
    // Handle 113-byte format (compact)
    if (data.length === 113) {
      // Different offsets for compact format
      const virtualSolReserves = data.readBigUInt64LE(73);
      const virtualTokenReserves = data.readBigUInt64LE(81);
      
      return {
        mint,
        virtualSolReserves,
        virtualTokenReserves
        // Other fields undefined for compact format
      };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Enhanced event extraction with statistics
 */
function extractTradeEventsWithStats(logs: string[]): {
  events: BondingCurveTradeEvent[];
  stats: { total: number; success: number; failed: number; sizes: Map<number, number> };
} {
  const events: BondingCurveTradeEvent[] = [];
  const stats = {
    total: 0,
    success: 0,
    failed: 0,
    sizes: new Map<number, number>()
  };
  
  for (const log of logs) {
    if (log.includes('Program data:')) {
      const match = log.match(/Program data: (.+)/);
      if (match?.[1]) {
        stats.total++;
        
        try {
          const eventData = Buffer.from(match[1], 'base64');
          
          // Track event sizes
          const size = eventData.length;
          stats.sizes.set(size, (stats.sizes.get(size) || 0) + 1);
          
          // Parse with flexible parser
          const event = parsePumpFunTradeEventFlexible(eventData);
          
          if (event) {
            events.push(event);
            stats.success++;
          } else {
            stats.failed++;
          }
        } catch {
          stats.failed++;
        }
      }
    }
  }
  
  return { events, stats };
}

/**
 * Connection statistics for monitoring health
 */
interface ConnectionStats {
  startTime: Date;
  lastDataReceived: Date;
  transactionsReceived: number;
  reconnections: number;
  errors: number;
  currentStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastError?: string;
  // Phase 2 additions
  tradesDetected: number;
  buysDetected: number;
  sellsDetected: number;
  uniqueMints: Set<string>;
  parseErrors: number;
  // Phase 3 additions
  tokensAboveThreshold: number;
  highestMarketCap: number;
  totalVolumeUsd: number;
  currentSolPrice: number;
  // Quick fix additions
  parseStats: {
    total: number;
    success: number;
    rate: number;
    eventSizes: Map<number, number>;
  };
  saveStats: {
    discovered: number;
    saved: number;
    skipped: number;
    rate: number;
  };
}

/**
 * Main monitoring class with improvements
 */
class BondingCurveMonitorFixed {
  private stats: ConnectionStats;
  private reconnectDelay: number = RECONNECT_DELAY_MS;
  private statsInterval?: NodeJS.Timeout;
  private isShuttingDown: boolean = false;
  private solPriceService: SolPriceService;
  private dbHandler: BondingCurveDbHandler;
  private progressTracker: ProgressTracker;
  private parseErrorSamples: string[] = [];

  constructor() {
    this.stats = {
      startTime: new Date(),
      lastDataReceived: new Date(),
      transactionsReceived: 0,
      reconnections: 0,
      errors: 0,
      currentStatus: 'connecting',
      tradesDetected: 0,
      buysDetected: 0,
      sellsDetected: 0,
      uniqueMints: new Set<string>(),
      parseErrors: 0,
      tokensAboveThreshold: 0,
      highestMarketCap: 0,
      totalVolumeUsd: 0,
      currentSolPrice: 180,
      parseStats: {
        total: 0,
        success: 0,
        rate: 0,
        eventSizes: new Map()
      },
      saveStats: {
        discovered: 0,
        saved: 0,
        skipped: 0,
        rate: 0
      }
    };
    
    // Initialize services
    this.solPriceService = SolPriceService.getInstance();
    this.dbHandler = new BondingCurveDbHandler();
    this.progressTracker = new ProgressTracker();
  }

  /**
   * Start the monitoring service
   */
  async start(): Promise<void> {
    console.log(chalk.cyan.bold(`\n🚀 Starting ${MONITOR_NAME}`));
    console.log(chalk.gray(`Program ID: ${PUMP_PROGRAM}`));
    console.log(chalk.gray(`Time: ${new Date().toISOString()}`));
    console.log(chalk.yellow(`Save Threshold: $${SAVE_THRESHOLD}`));
    console.log(chalk.yellow(`Save All Tokens: ${SAVE_ALL_TOKENS}`));
    console.log(chalk.blue(`Features: Connection ✓ | Parsing ✓ | Prices ✓ | Database ✓ | Progress ✓ | Quick Fixes ✓\n`));

    // Fetch initial SOL price
    try {
      this.stats.currentSolPrice = await this.solPriceService.getPrice();
      console.log(chalk.green(`✅ SOL Price: $${this.stats.currentSolPrice.toFixed(2)}`));
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Using default SOL price: $${this.stats.currentSolPrice}`));
    }

    // Start statistics display
    this.startStatsDisplay();
    
    // Update SOL price periodically
    setInterval(async () => {
      try {
        this.stats.currentSolPrice = await this.solPriceService.getPrice();
      } catch (error) {
        // Keep using last known price
      }
    }, 5000);

    // Set up graceful shutdown
    this.setupShutdownHandlers();

    // Start streaming with automatic reconnection
    await this.connectWithRetry();
  }

  /**
   * Parse transaction to extract trade events with improvements
   */
  private parseTransaction(transactionData: any): void {
    try {
      // Extract logs from nested structure
      const logs = this.extractLogs(transactionData);
      if (!logs || logs.length === 0) {
        return;
      }
      
      // Check for graduation
      const graduationInfo = detectGraduationFromLogs(logs);
      if (graduationInfo.isGraduation) {
        console.log(chalk.green.bold('\n🎓 GRADUATION TRANSACTION DETECTED! 🎓'));
        if (graduationInfo.mintAddress) {
          console.log(chalk.yellow(`Token: ${graduationInfo.mintAddress}`));
        }
        if (graduationInfo.migrationProgram) {
          console.log(chalk.cyan(`Migrating to: ${graduationInfo.migrationProgram}`));
        }
        console.log(chalk.gray('─'.repeat(50)) + '\n');
      }

      // Extract signature for logging
      const signature = this.extractSignature(transactionData);

      // Extract trade events with statistics
      const { events, stats: parseStats } = extractTradeEventsWithStats(logs);
      
      // Update global parse statistics
      this.stats.parseStats.total += parseStats.total;
      this.stats.parseStats.success += parseStats.success;
      this.stats.parseErrors += parseStats.failed;
      
      // Merge event size tracking
      for (const [size, count] of parseStats.sizes) {
        const current = this.stats.parseStats.eventSizes.get(size) || 0;
        this.stats.parseStats.eventSizes.set(size, current + count);
      }
      
      // Calculate parse rate
      if (this.stats.parseStats.total > 0) {
        this.stats.parseStats.rate = (this.stats.parseStats.success / this.stats.parseStats.total) * 100;
      }
      
      if (events.length === 0) {
        return;
      }

      // Detect trade type
      const tradeType = detectTradeTypeFromLogs(logs);
      
      // Process each event
      for (const event of events) {
        if (!isValidMintAddress(event.mint)) {
          this.stats.parseErrors++;
          continue;
        }

        // Validate reserves only if they exist
        if (event.virtualSolReserves && event.virtualTokenReserves) {
          if (!validateReserves(event.virtualSolReserves, event.virtualTokenReserves)) {
            this.stats.parseErrors++;
            continue;
          }
        }

        // Update statistics
        this.stats.tradesDetected++;
        this.stats.uniqueMints.add(event.mint);
        
        if (tradeType === 'buy') {
          this.stats.buysDetected++;
          event.isBuy = true;
        } else if (tradeType === 'sell') {
          this.stats.sellsDetected++;
          event.isBuy = false;
        }

        // Calculate price and market cap
        const priceData = calculateTokenPrice(
          event.virtualSolReserves,
          event.virtualTokenReserves,
          this.stats.currentSolPrice
        );
        
        // Track volume
        if (event.solAmount) {
          const tradeValueUsd = (Number(event.solAmount) / 1e9) * this.stats.currentSolPrice;
          this.stats.totalVolumeUsd += tradeValueUsd;
        }
        
        // Track discovered tokens
        this.stats.saveStats.discovered++;
        
        // Check if we should save based on configuration
        const shouldSave = SAVE_ALL_TOKENS || priceData.marketCapUsd >= SAVE_THRESHOLD;
        
        if (!shouldSave) {
          this.stats.saveStats.skipped++;
          continue;
        }
        
        // Track high market cap tokens
        if (priceData.marketCapUsd >= 8888) {
          this.stats.tokensAboveThreshold++;
        }
        
        // Track highest market cap
        if (priceData.marketCapUsd > this.stats.highestMarketCap) {
          this.stats.highestMarketCap = priceData.marketCapUsd;
        }
        
        // Track progress
        const progressData = this.progressTracker.updateProgress(event.mint, event.virtualSolReserves);
        
        // Check for graduation
        if (this.progressTracker.checkGraduation(event.mint, event.virtualSolReserves)) {
          // Mark in database if above threshold
          if (priceData.marketCapUsd >= SAVE_THRESHOLD) {
            // TODO: Update database to mark as graduated
          }
        }

        // Send to database
        const slot = this.extractSlot(transactionData);
        const blockTime = this.extractBlockTime(transactionData);
        
        const processedData: ProcessedTradeData = {
          event,
          tradeType: tradeType || 'unknown',
          signature,
          priceInSol: priceData.priceInSol,
          priceInUsd: priceData.priceInUsd,
          marketCapUsd: priceData.marketCapUsd,
          progress: progressData.progress,
          slot,
          blockTime
        };
        
        // Send to database handler (non-blocking)
        this.dbHandler.processTrade(processedData)
          .then(() => {
            this.stats.saveStats.saved++;
            // Update save rate
            if (this.stats.saveStats.discovered > 0) {
              this.stats.saveStats.rate = (this.stats.saveStats.saved / this.stats.saveStats.discovered) * 100;
            }
          })
          .catch(err => {
            console.error('Database error:', err);
          });
        
        // Log significant trades (every 10th trade or high value)
        if (this.stats.tradesDetected % 10 === 0 || priceData.marketCapUsd >= 50000) {
          this.logTradeEventWithPrice(event, tradeType, signature, priceData);
        }
      }
    } catch (error) {
      this.stats.parseErrors++;
      
      // Sample parse errors for debugging
      if (DEBUG_PARSE_ERRORS && this.parseErrorSamples.length < 10) {
        this.parseErrorSamples.push(`${error.message} - ${this.extractSignature(transactionData)}`);
      }
      
      // Log every 100th error
      if (this.stats.parseErrors % 100 === 0) {
        console.error(chalk.red('Parse error sample:'), {
          error: error.message,
          signature: this.extractSignature(transactionData),
          hasLogs: !!this.extractLogs(transactionData),
          samples: this.parseErrorSamples.slice(0, 3)
        });
      }
    }
  }

  /**
   * Display current statistics with improvements
   */
  private displayStats(): void {
    const uptime = this.getUptime();
    const dataAge = this.getDataAge();
    
    console.log(chalk.cyan('\n📊 Monitor Statistics (Enhanced):'));
    console.log(chalk.gray('─'.repeat(50)));
    
    // Connection stats
    console.log(chalk.white.bold('Connection:'));
    console.log(`  Status: ${this.getStatusColor(this.stats.currentStatus)}`);
    console.log(`  Uptime: ${chalk.white(uptime)}`);
    console.log(`  Last data: ${chalk.white(dataAge)} ago`);
    
    // Transaction stats
    console.log(chalk.white.bold('\nTransactions:'));
    console.log(`  Received: ${chalk.yellow(this.stats.transactionsReceived.toLocaleString())}`);
    console.log(`  Trades detected: ${chalk.green(this.stats.tradesDetected.toLocaleString())}`);
    console.log(`  Parse errors: ${chalk.red(this.stats.parseErrors)}`);
    console.log(`  Parse rate: ${this.getParseRateColor(this.stats.parseStats.rate)}`);
    
    // Parse statistics
    console.log(chalk.white.bold('\nParse Analysis:'));
    console.log(`  Events parsed: ${chalk.blue(this.stats.parseStats.total.toLocaleString())}`);
    console.log(`  Success: ${chalk.green(this.stats.parseStats.success.toLocaleString())}`);
    console.log(`  Event sizes: ${this.formatEventSizes()}`);
    
    // Trade breakdown
    console.log(chalk.white.bold('\nTrade Analysis:'));
    console.log(`  Buys: ${chalk.green(this.stats.buysDetected.toLocaleString())}`);
    console.log(`  Sells: ${chalk.red(this.stats.sellsDetected.toLocaleString())}`);
    console.log(`  Unique tokens: ${chalk.blue(this.stats.uniqueMints.size.toLocaleString())}`);
    
    // Detection rate
    const detectionRate = this.stats.transactionsReceived > 0 
      ? ((this.stats.tradesDetected / this.stats.transactionsReceived) * 100).toFixed(1)
      : '0.0';
    console.log(`  Detection rate: ${chalk.yellow(detectionRate + '%')}`);
    
    // Price & Market Cap
    console.log(chalk.white.bold('\nPrice & Market Cap:'));
    console.log(`  SOL Price: ${chalk.green('$' + this.stats.currentSolPrice.toFixed(2))}`);
    console.log(`  Total Volume: ${chalk.yellow(formatPrice(this.stats.totalVolumeUsd))}`);
    console.log(`  Highest MC: ${chalk.cyan(formatMarketCap(this.stats.highestMarketCap))}`);
    console.log(`  Above $8,888: ${chalk.yellow(this.stats.tokensAboveThreshold)} tokens`);
    
    // Database stats
    const dbStats = this.dbHandler.getStats();
    console.log(chalk.white.bold('\nDatabase:'));
    console.log(`  Discovered tokens: ${chalk.blue(dbStats.discoveredTokens)}`);
    console.log(`  Tokens saved: ${chalk.green(dbStats.dbStats.tokensTracked)}`);
    console.log(`  Save rate: ${this.getSaveRateColor(this.stats.saveStats.rate)}`);
    console.log(`  Trades saved: ${chalk.green(dbStats.dbStats.tradesProcessed)}`);
    console.log(`  Batch queue: ${chalk.yellow(dbStats.dbStats.queueSize)}`);
    
    // Progress tracking
    const progressStats = this.progressTracker.getStats();
    console.log(chalk.white.bold('\nProgress Tracking:'));
    console.log(`  Tracked tokens: ${chalk.blue(progressStats.trackedTokens)}`);
    console.log(`  Near graduation: ${chalk.yellow(progressStats.graduationCandidates)}`);
    
    // System health
    console.log(chalk.white.bold('\nSystem:'));
    console.log(`  Reconnections: ${chalk.yellow(this.stats.reconnections)}`);
    console.log(`  Total errors: ${chalk.red(this.stats.errors)}`);
    
    if (this.stats.lastError) {
      console.log(`  Last error: ${chalk.red(this.stats.lastError)}`);
    }
    
    console.log(chalk.gray('─'.repeat(50)));
  }

  // Helper methods for enhanced display
  private getParseRateColor(rate: number): string {
    const rateStr = rate.toFixed(1) + '%';
    if (rate >= 95) return chalk.green(rateStr);
    if (rate >= 85) return chalk.yellow(rateStr);
    return chalk.red(rateStr);
  }

  private getSaveRateColor(rate: number): string {
    const rateStr = rate.toFixed(1) + '%';
    if (rate >= 95) return chalk.green(rateStr);
    if (rate >= 80) return chalk.yellow(rateStr);
    return chalk.red(rateStr);
  }

  private formatEventSizes(): string {
    const sizes: string[] = [];
    for (const [size, count] of this.stats.parseStats.eventSizes) {
      sizes.push(`${size}b:${count}`);
    }
    return sizes.join(', ') || 'none';
  }

  // ... (rest of the methods remain the same as original bc-monitor.ts)
  
  /**
   * Create subscription request for pump.fun transactions
   */
  private createSubscriptionRequest(): SubscribeRequest {
    return {
      accounts: {},
      slots: {},
      transactions: {
        pumpfun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_PROGRAM],
          accountExclude: [],
          accountRequired: []
        }
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.CONFIRMED
    };
  }

  /**
   * Connect to stream with automatic retry logic
   */
  private async connectWithRetry(): Promise<void> {
    while (!this.isShuttingDown) {
      try {
        await this.connect();
      } catch (error) {
        this.handleConnectionError(error);
        
        if (!this.isShuttingDown) {
          console.log(chalk.yellow(`\n⏳ Reconnecting in ${this.reconnectDelay / 1000} seconds...`));
          await this.sleep(this.reconnectDelay);
          
          // Exponential backoff
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
          this.stats.reconnections++;
        }
      }
    }
  }

  /**
   * Establish connection and start streaming
   */
  private async connect(): Promise<void> {
    this.stats.currentStatus = 'connecting';
    console.log(chalk.blue('📡 Connecting to Shyft gRPC stream...'));

    const client = StreamClient.getInstance().getClient();
    const stream = await client.subscribe();
    const request = this.createSubscriptionRequest();

    // Set up stream event handlers
    const streamClosed = new Promise<void>((resolve, reject) => {
      stream.on('error', (error) => {
        this.stats.currentStatus = 'error';
        this.stats.lastError = error.message;
        reject(error);
      });

      stream.on('end', () => {
        this.stats.currentStatus = 'disconnected';
        resolve();
      });

      stream.on('close', () => {
        this.stats.currentStatus = 'disconnected';
        resolve();
      });
    });

    // Handle incoming data
    stream.on('data', async (data) => {
      this.stats.lastDataReceived = new Date();
      
      // Handle ping/pong for keepalive
      if (data.ping) {
        const pingId = data.ping.id;
        if (pingId) {
          await stream.write({ pong: { id: pingId } });
        }
        return;
      }

      // Process transactions
      if (data.transaction) {
        this.stats.transactionsReceived++;
        this.parseTransaction(data.transaction);
        
        // Log every 50th transaction with more details
        if (this.stats.transactionsReceived % 50 === 0) {
          console.log(chalk.green(`✅ Processed ${this.stats.transactionsReceived} transactions, ${this.stats.tradesDetected} trades detected`));
        }
      }
    });

    // Send subscription request
    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err === null || err === undefined) {
          resolve();
        } else {
          reject(err);
        }
      });
    });

    // Connection successful
    this.stats.currentStatus = 'connected';
    this.reconnectDelay = RECONNECT_DELAY_MS; // Reset backoff
    console.log(chalk.green.bold('✅ Connected successfully!\n'));

    // Wait for stream to close
    await streamClosed;
  }

  /**
   * Extract logs from transaction data
   */
  private extractLogs(transactionData: any): string[] | null {
    try {
      // Handle nested transaction structure from gRPC
      if (transactionData?.transaction?.meta?.logMessages) {
        return transactionData.transaction.meta.logMessages;
      }
      if (transactionData?.meta?.logMessages) {
        return transactionData.meta.logMessages;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract signature from transaction
   */
  private extractSignature(transactionData: any): string {
    try {
      // Try different structures
      if (transactionData?.transaction?.transaction?.signatures?.[0]) {
        const sig = transactionData.transaction.transaction.signatures[0];
        return typeof sig === 'string' ? sig : bs58.encode(sig);
      }
      if (transactionData?.transaction?.signatures?.[0]) {
        const sig = transactionData.transaction.signatures[0];
        return typeof sig === 'string' ? sig : bs58.encode(sig);
      }
      if (transactionData?.signatures?.[0]) {
        const sig = transactionData.signatures[0];
        return typeof sig === 'string' ? sig : bs58.encode(sig);
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Extract slot from transaction
   */
  private extractSlot(transactionData: any): bigint | undefined {
    try {
      // Check different possible locations
      const slot = transactionData?.slot || 
                   transactionData?.transaction?.slot ||
                   transactionData?.transaction?.transaction?.slot;
      
      if (slot !== undefined && slot !== null) {
        return BigInt(slot);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Extract block time from transaction
   */
  private extractBlockTime(transactionData: any): Date | undefined {
    try {
      // Check meta for block time
      const meta = transactionData?.transaction?.meta || transactionData?.meta;
      const blockTime = meta?.blockTime || transactionData?.blockTime;
      
      if (blockTime) {
        // Block time is in seconds, convert to milliseconds
        return new Date(blockTime * 1000);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Log trade event details with price
   */
  private logTradeEventWithPrice(
    event: BondingCurveTradeEvent, 
    tradeType: string | null, 
    signature: string,
    priceData: ReturnType<typeof calculateTokenPrice>
  ): void {
    const progressData = this.progressTracker.updateProgress(event.mint, event.virtualSolReserves);
    
    console.log(chalk.cyan('\n📊 Trade Event Detected:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Type: ${tradeType ? (tradeType === 'buy' ? chalk.green('BUY 🟢') : chalk.red('SELL 🔴')) : chalk.gray('UNKNOWN')}`);
    console.log(`Mint: ${chalk.yellow(event.mint)}`);
    console.log(`User: ${chalk.white(event.user ? event.user.slice(0, 8) + '...' : 'unknown')}`);
    
    // Trade amounts
    if (event.solAmount) {
      const solAmount = Number(event.solAmount) / 1e9;
      const usdValue = solAmount * this.stats.currentSolPrice;
      console.log(`Amount: ${chalk.green(solAmount.toFixed(4))} SOL (${chalk.green(formatPrice(usdValue))})`);
    }
    if (event.tokenAmount) {
      console.log(`Tokens: ${chalk.blue((Number(event.tokenAmount) / 1e6).toLocaleString())}`);
    }
    
    // Price information
    console.log(chalk.white.bold('\nPrice & Market Cap:'));
    console.log(`Price: ${formatPrice(priceData.priceInUsd)} (${priceData.priceInSol.toFixed(8)} SOL)`);
    console.log(`Market Cap: ${formatMarketCap(priceData.marketCapUsd)}`);
    console.log(`Progress: ${formatProgressDisplay(progressData)}`);
    
    // Threshold indicator
    if (priceData.marketCapUsd >= SAVE_THRESHOLD) {
      console.log(chalk.yellow.bold(`⭐ Above $${SAVE_THRESHOLD} threshold!`));
    }
    
    console.log(chalk.gray(`Signature: ${signature.slice(0, 16)}...`));
    console.log(chalk.gray('─'.repeat(50)));
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: any): void {
    this.stats.errors++;
    this.stats.currentStatus = 'error';
    this.stats.lastError = error.message || 'Unknown error';

    console.error(chalk.red('\n❌ Connection error:'), error.message);
    
    if (error.code === 14) {
      console.log(chalk.yellow('📡 Network connectivity issue detected'));
    } else if (error.code === 16) {
      console.log(chalk.yellow('🔑 Authentication error - check your SHYFT_GRPC_TOKEN'));
    }
  }

  /**
   * Display statistics periodically
   */
  private startStatsDisplay(): void {
    this.statsInterval = setInterval(() => {
      this.displayStats();
    }, STATS_UPDATE_INTERVAL_MS);
  }

  /**
   * Get colored status text
   */
  private getStatusColor(status: string): string {
    switch (status) {
      case 'connected':
        return chalk.green.bold(status.toUpperCase());
      case 'connecting':
        return chalk.yellow(status.toUpperCase());
      case 'disconnected':
        return chalk.gray(status.toUpperCase());
      case 'error':
        return chalk.red(status.toUpperCase());
      default:
        return chalk.white(status.toUpperCase());
    }
  }

  /**
   * Calculate uptime string
   */
  private getUptime(): string {
    const ms = Date.now() - this.stats.startTime.getTime();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Calculate time since last data
   */
  private getDataAge(): string {
    const ms = Date.now() - this.stats.lastDataReceived.getTime();
    const seconds = Math.floor(ms / 1000);
    
    if (seconds < 60) {
      return `${seconds}s`;
    } else {
      return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    }
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return;
      
      this.isShuttingDown = true;
      console.log(chalk.yellow('\n\n🛑 Shutting down...'));
      
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
      }
      
      // Flush database batches
      console.log(chalk.yellow('💾 Flushing database batches...'));
      await this.dbHandler.flush();
      
      // Display final statistics
      this.displayStats();
      
      // Show parse error analysis
      if (this.parseErrorSamples.length > 0) {
        console.log(chalk.yellow('\n📊 Parse Error Analysis:'));
        console.log(`Total errors: ${this.stats.parseErrors}`);
        console.log(`Sample errors:`, this.parseErrorSamples.slice(0, 5));
      }
      
      console.log(chalk.green('\n✅ Shutdown complete'));
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    const monitor = new BondingCurveMonitorFixed();
    await monitor.start();
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  }
}

// Start the monitor
if (require.main === module) {
  main().catch(console.error);
}

export { BondingCurveMonitorFixed };