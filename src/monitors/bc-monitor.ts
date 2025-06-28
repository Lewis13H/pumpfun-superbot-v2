#!/usr/bin/env node
/**
 * Bonding Curve Monitor - Phase 2: Transaction Parsing
 * 
 * A focused pump.fun bonding curve monitoring service that:
 * - Establishes reliable gRPC connection to Shyft
 * - Subscribes to pump.fun program transactions
 * - Implements robust error handling and reconnection logic
 * - Tracks basic statistics and connection health
 * - Parses trade events from transaction logs (Phase 2)
 * - Detects buy/sell operations and extracts trade data (Phase 2)
 * 
 * Phase 2 adds transaction parsing capabilities to extract
 * meaningful trade data from pump.fun transactions.
 */

import 'dotenv/config';
import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../stream/client';
import { PUMP_PROGRAM } from '../utils/constants';
import { 
  BondingCurveTradeEvent,
  extractTradeEventsFromLogs, 
  detectTradeTypeFromLogs,
  isValidMintAddress 
} from '../parsers/bc-event-parser';
import chalk from 'chalk';
import bs58 from 'bs58';

// Configuration constants
const MONITOR_NAME = 'Bonding Curve Monitor';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
const STATS_UPDATE_INTERVAL_MS = 5000;

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
}

/**
 * Main monitoring class
 */
class BondingCurveMonitor {
  private stats: ConnectionStats;
  private reconnectDelay: number = RECONNECT_DELAY_MS;
  private statsInterval?: NodeJS.Timeout;
  private isShuttingDown: boolean = false;

  constructor() {
    this.stats = {
      startTime: new Date(),
      lastDataReceived: new Date(),
      transactionsReceived: 0,
      reconnections: 0,
      errors: 0,
      currentStatus: 'connecting',
      // Phase 2 additions
      tradesDetected: 0,
      buysDetected: 0,
      sellsDetected: 0,
      uniqueMints: new Set<string>(),
      parseErrors: 0
    };
  }

  /**
   * Start the monitoring service
   */
  async start(): Promise<void> {
    console.log(chalk.cyan.bold(`\n🚀 Starting ${MONITOR_NAME} - Phase 2`));
    console.log(chalk.gray(`Program ID: ${PUMP_PROGRAM}`));
    console.log(chalk.gray(`Time: ${new Date().toISOString()}`));
    console.log(chalk.blue(`Features: Connection ✓ | Parsing ✓ | Prices ⏳ | Database ⏳\n`));

    // Start statistics display
    this.startStatsDisplay();

    // Set up graceful shutdown
    this.setupShutdownHandlers();

    // Start streaming with automatic reconnection
    await this.connectWithRetry();
  }

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
        
        // Phase 2: Parse transaction
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
   * Parse transaction to extract trade events (Phase 2)
   */
  private parseTransaction(transactionData: any): void {
    try {
      // Extract logs from nested structure
      const logs = this.extractLogs(transactionData);
      if (!logs || logs.length === 0) {
        return;
      }
      

      // Extract signature for logging
      const signature = this.extractSignature(transactionData);

      // Extract trade events
      const events = extractTradeEventsFromLogs(logs);
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

        // Log significant trades (every 10th trade in Phase 2)
        if (this.stats.tradesDetected % 10 === 0) {
          this.logTradeEvent(event, tradeType, signature);
        }
      }
    } catch (error) {
      this.stats.parseErrors++;
      // Silently handle parse errors in Phase 2
    }
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
   * Log trade event details
   */
  private logTradeEvent(event: BondingCurveTradeEvent, tradeType: string | null, signature: string): void {
    console.log(chalk.cyan('\n📊 Trade Event Detected:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Type: ${tradeType ? chalk.green(tradeType.toUpperCase()) : chalk.gray('UNKNOWN')}`);
    console.log(`Mint: ${chalk.yellow(event.mint.slice(0, 8) + '...' + event.mint.slice(-6))}`);
    console.log(`User: ${chalk.white(event.user ? event.user.slice(0, 8) + '...' : 'unknown')}`);
    
    if (event.solAmount) {
      console.log(`SOL Amount: ${chalk.green((Number(event.solAmount) / 1e9).toFixed(4))} SOL`);
    }
    if (event.tokenAmount) {
      console.log(`Token Amount: ${chalk.blue((Number(event.tokenAmount) / 1e6).toFixed(2))}`);
    }
    
    console.log(`Virtual SOL: ${chalk.gray((Number(event.virtualSolReserves) / 1e9).toFixed(2))} SOL`);
    console.log(`Virtual Tokens: ${chalk.gray((Number(event.virtualTokenReserves) / 1e6).toFixed(0))}`);
    console.log(`Signature: ${chalk.gray(signature.slice(0, 16) + '...')}`);
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
   * Display current statistics
   */
  private displayStats(): void {
    const uptime = this.getUptime();
    const dataAge = this.getDataAge();
    
    console.log(chalk.cyan('\n📊 Monitor Statistics:'));
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
    
    // Trade breakdown (Phase 2)
    console.log(chalk.white.bold('\nTrade Analysis:'));
    console.log(`  Buys: ${chalk.green(this.stats.buysDetected.toLocaleString())}`);
    console.log(`  Sells: ${chalk.red(this.stats.sellsDetected.toLocaleString())}`);
    console.log(`  Unique tokens: ${chalk.blue(this.stats.uniqueMints.size.toLocaleString())}`);
    
    // Detection rate
    const detectionRate = this.stats.transactionsReceived > 0 
      ? ((this.stats.tradesDetected / this.stats.transactionsReceived) * 100).toFixed(1)
      : '0.0';
    console.log(`  Detection rate: ${chalk.yellow(detectionRate + '%')}`);
    
    // System health
    console.log(chalk.white.bold('\nSystem:'));
    console.log(`  Reconnections: ${chalk.yellow(this.stats.reconnections)}`);
    console.log(`  Total errors: ${chalk.red(this.stats.errors)}`);
    
    if (this.stats.lastError) {
      console.log(`  Last error: ${chalk.red(this.stats.lastError)}`);
    }
    
    console.log(chalk.gray('─'.repeat(50)));
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
      
      // Display final statistics
      this.displayStats();
      
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
    const monitor = new BondingCurveMonitor();
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

export { BondingCurveMonitor };