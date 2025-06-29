#!/usr/bin/env node
/**
 * Bonding Curve Monitor - Simplified Output Version
 * Uses standardized formatting for consistent terminal display
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
import { MonitorFormatter } from '../utils/monitor-formatter';
import chalk from 'chalk';
import bs58 from 'bs58';

// Configuration
const SAVE_THRESHOLD = Number(process.env.BC_SAVE_THRESHOLD || 8888);
const SAVE_ALL_TOKENS = process.env.SAVE_ALL_TOKENS === 'true';
const DEBUG_ERRORS = process.env.DEBUG_ERRORS === 'true';

// Enhanced parse function that handles multiple event sizes
function parsePumpFunTradeEventFlexible(data: Buffer): BondingCurveTradeEvent | null {
  const sizes = [225, 113];
  
  for (const expectedSize of sizes) {
    if (data.length >= expectedSize) {
      try {
        const reader = new BufferReader(data);
        const event: BondingCurveTradeEvent = {
          mint: reader.readPubkey(),
          solAmount: reader.readUint64(),
          tokenAmount: reader.readUint64(),
          isBuy: reader.readBool(),
          user: reader.readPubkey(),
          timestamp: reader.readInt64(),
          virtualSolReserves: reader.readUint64(),
          virtualTokenReserves: reader.readUint64()
        };
        
        if (isValidMintAddress(event.mint)) {
          return event;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return null;
}

// Buffer reader helper
class BufferReader {
  private offset = 0;
  
  constructor(private buffer: Buffer) {}
  
  readPubkey(): string {
    const key = this.buffer.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(key).toBase58();
  }
  
  readUint64(): bigint {
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
  
  readInt64(): bigint {
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
  
  readBool(): boolean {
    const value = this.buffer.readUInt8(this.offset) === 1;
    this.offset += 1;
    return value;
  }
}

/**
 * Simplified Bonding Curve Monitor
 */
class SimplifiedBondingCurveMonitor {
  private client: any = null;
  private stream: any = null;
  private solPriceService: SolPriceService;
  private dbHandler: BondingCurveDbHandler;
  private progressTracker: ProgressTracker;
  private formatter: MonitorFormatter;
  
  private stats = {
    parseRate: 0,
    saveRate: 0,
    graduations: 0,
    volume: 0,
    uniqueTokens: new Set<string>(),
    solPrice: 180
  };

  constructor() {
    this.solPriceService = SolPriceService.getInstance();
    this.dbHandler = new BondingCurveDbHandler();
    this.progressTracker = new ProgressTracker();
    this.formatter = new MonitorFormatter();
  }

  async start(): Promise<void> {
    // Display header
    this.formatter.header('BONDING CURVE MONITOR', PUMP_PROGRAM, {
      'Threshold': `$${SAVE_THRESHOLD}`,
      'Save All': SAVE_ALL_TOKENS
    });

    // Fetch initial SOL price
    try {
      this.stats.solPrice = await this.solPriceService.getPrice();
      this.formatter.logSuccess(`SOL Price: $${this.stats.solPrice.toFixed(2)}`);
    } catch (error) {
      this.formatter.logWarning(`Using default SOL price: $${this.stats.solPrice}`);
    }

    // Start monitoring
    await this.startMonitoring();
    
    // Update stats every 10 seconds
    setInterval(() => this.updateDisplay(), 10000);
  }

  private async startMonitoring(): Promise<void> {
    this.formatter.logInfo('Connecting to Shyft gRPC stream...');
    
    try {
      this.client = StreamClient.getInstance().getClient();
      
      const request: SubscribeRequest = {
        slots: {},
        accounts: {},
        transactions: {
          pump: {
            vote: false,
            failed: false,
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

      this.stream = await this.client.subscribe();
      
      // Wait for connection confirmation
      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        
        this.stream.on('data', (data: any) => {
          clearTimeout(timeout);
          resolve(true);
        });
        
        this.stream.on('error', (error: Error) => {
          clearTimeout(timeout);
          this.formatter.logError('Stream error', error);
          resolve(false);
        });
      });
      
      if (!connected) {
        throw new Error('Connection timeout');
      }
      
      this.formatter.logSuccess('Connected to gRPC stream');
      
      // Write subscription request
      this.stream.write(request);
      
      this.stream.on('data', (data: any) => {
        this.handleTransaction(data);
      });
      
    } catch (error) {
      this.formatter.logError('Failed to start monitoring', error);
      setTimeout(() => this.start(), 5000);
    }
  }

  private handleTransaction(data: any): void {
    try {
      this.formatter.incrementStat('transactions');
      
      const transaction = data?.transaction?.transaction;
      if (!transaction) return;
      
      const logs = transaction.meta?.logMessages || [];
      const graduationDetected = detectGraduationFromLogs(logs);
      
      if (graduationDetected) {
        this.stats.graduations++;
        this.formatter.logSuccess(`🎓 GRADUATION DETECTED! ${graduationDetected.mint}`);
      }
      
      const accountKeys = transaction.transaction?.message?.accountKeys || [];
      const instructions = transaction.transaction?.message?.instructions || [];
      
      for (const instruction of instructions) {
        const programIdIndex = instruction.programIdIndex;
        if (programIdIndex === undefined) continue;
        
        const programId = accountKeys[programIdIndex];
        if (!programId) continue;
        
        const programIdStr = bs58.encode(programId);
        if (programIdStr !== PUMP_PROGRAM) continue;
        
        const eventData = instruction.data;
        if (!eventData || !Buffer.isBuffer(eventData)) continue;
        
        const event = parsePumpFunTradeEventFlexible(eventData);
        if (!event) {
          if (DEBUG_ERRORS) {
            this.formatter.logWarning(`Parse failed - size: ${eventData.length}`);
          }
          continue;
        }
        
        this.formatter.incrementStat('trades');
        
        const tradeType = detectTradeTypeFromLogs(logs);
        const signature = transaction.signature ? 
          bs58.encode(transaction.signature) : 'unknown';
        
        const priceData = calculateTokenPrice(
          event.virtualSolReserves,
          event.virtualTokenReserves,
          this.stats.solPrice
        );
        
        // Log trade
        this.formatter.logTrade({
          type: tradeType as 'buy' | 'sell' || 'buy',
          mint: event.mint,
          amount: Number(event.solAmount) / 1e9 * this.stats.solPrice,
          price: priceData.priceInUsd,
          user: event.user,
          signature
        });
        
        // Update stats
        this.stats.uniqueTokens.add(event.mint);
        this.stats.volume += Number(event.solAmount) / 1e9 * this.stats.solPrice;
        
        // Save to database if above threshold
        if (SAVE_ALL_TOKENS || priceData.marketCapUsd >= SAVE_THRESHOLD) {
          this.saveToDatabase(event, tradeType, signature, priceData);
        }
      }
      
    } catch (error) {
      this.formatter.logError('Transaction processing error', error);
    }
  }

  private async saveToDatabase(
    event: BondingCurveTradeEvent,
    tradeType: string | null,
    signature: string,
    priceData: ReturnType<typeof calculateTokenPrice>
  ): Promise<void> {
    try {
      await this.dbHandler.saveTransaction({
        signature,
        mint: event.mint,
        tradeType: tradeType || 'unknown',
        solAmount: event.solAmount.toString(),
        tokenAmount: event.tokenAmount.toString(),
        priceInSol: priceData.priceInSol,
        priceInUsd: priceData.priceInUsd,
        marketCapUsd: priceData.marketCapUsd,
        virtualSolReserves: event.virtualSolReserves.toString(),
        virtualTokenReserves: event.virtualTokenReserves.toString(),
        bondingCurveProgress: calculateBondingCurveProgress(event.virtualSolReserves),
        timestamp: Number(event.timestamp),
        userWallet: event.user || 'unknown',
        slot: 0
      });
    } catch (error) {
      this.formatter.logError('Database save failed', error);
    }
  }

  private updateDisplay(): void {
    const stats = this.formatter.getStats();
    
    // Calculate rates
    if (stats.transactions > 0) {
      this.stats.parseRate = (stats.trades / stats.transactions) * 100;
    }
    
    const dbStats = this.dbHandler.getStats();
    if (dbStats.discoveredTokens > 0) {
      this.stats.saveRate = (dbStats.savedTokens / dbStats.discoveredTokens) * 100;
    }
    
    // Display updated stats
    this.formatter.displayStats({
      'Parse Rate': `${this.stats.parseRate.toFixed(1)}%`,
      'Save Rate': `${this.stats.saveRate.toFixed(1)}%`,
      'Graduations': this.stats.graduations,
      'Volume': `$${this.stats.volume.toFixed(2)}`,
      'Unique Tokens': this.stats.uniqueTokens.size,
      'SOL Price': `$${this.stats.solPrice.toFixed(2)}`
    });
    
    this.formatter.footer();
  }
}

// Main execution
(async () => {
  const monitor = new SimplifiedBondingCurveMonitor();
  
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\nShutting down monitor...'));
    process.exit(0);
  });
  
  await monitor.start();
})();