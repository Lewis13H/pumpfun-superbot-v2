#!/usr/bin/env node
/**
 * AMM Pool Monitor - Simplified Output Version
 * Monitors graduated token trades on pump.swap
 */

import 'dotenv/config';
import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../stream/client';
import { PublicKey } from '@solana/web3.js';
import { UnifiedDbServiceV2 } from '../database/unified-db-service-v2';
import { SolPriceService } from '../services/sol-price';
import { swapTransactionParser } from '../utils/swapTransactionParser';
import { TransactionFormatter } from '../utils/transaction-formatter';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { MonitorFormatter } from '../utils/monitor-formatter';
import chalk from 'chalk';
import bs58 from 'bs58';
import ammIdl from '../idls/pump_amm_0.1.0.json';

// Configuration
const AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const SAVE_THRESHOLD = 1000; // $1000 for AMM tokens

/**
 * Simplified AMM Monitor
 */
class SimplifiedAMMMonitor {
  private client: any = null;
  private stream: any = null;
  private parser: SolanaParser;
  private formatter: MonitorFormatter;
  private dbService: UnifiedDbServiceV2;
  private solPriceService: SolPriceService;
  
  private stats = {
    volume: 0,
    buys: 0,
    sells: 0,
    newTokens: 0,
    uniqueTokens: new Set<string>(),
    solPrice: 180
  };

  constructor() {
    this.parser = new SolanaParser([]);
    this.parser.addParserFromIdl(AMM_PROGRAM_ID, ammIdl as any);
    this.formatter = new MonitorFormatter();
    this.dbService = UnifiedDbServiceV2.getInstance();
    this.solPriceService = SolPriceService.getInstance();
  }

  async start(): Promise<void> {
    // Display header
    this.formatter.header('AMM POOL MONITOR', AMM_PROGRAM_ID, {
      'Threshold': `$${SAVE_THRESHOLD}`,
      'Program': 'pump.swap'
    });

    // Get SOL price
    const solPrice = await this.solPriceService.getPrice();
    this.stats.solPrice = solPrice;
    this.formatter.logSuccess(`SOL Price: $${solPrice.toFixed(2)}`);

    // Start monitoring
    await this.startMonitoring();
    
    // Update stats every 10 seconds
    setInterval(() => this.updateDisplay(), 10000);
  }

  private async startMonitoring(): Promise<void> {
    this.formatter.logInfo('Listening to Buy and Sell on pump.swap AMM...');
    
    try {
      this.client = StreamClient.getInstance().getClient();
      
      const request: SubscribeRequest = {
        slots: {},
        accounts: {},
        transactions: {
          amm: {
            vote: false,
            failed: false,
            accountInclude: [AMM_PROGRAM_ID],
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
      
      const formattedTransaction = TransactionFormatter.formatTransaction(data);
      if (!formattedTransaction || !formattedTransaction.signature) return;
      
      const signature = formattedTransaction.signature;
      const slot = formattedTransaction.slot;
      
      // Parse using IDL
      let parsedData;
      try {
        parsedData = this.parser.parseTransaction(formattedTransaction);
      } catch (e) {
        // Silently skip parser warnings
        return;
      }
      
      if (!parsedData || parsedData.length === 0) return;
      
      // Process each instruction
      for (const instruction of parsedData) {
        if (instruction.programId.toString() !== AMM_PROGRAM_ID) continue;
        
        if (instruction.name === 'buy' || instruction.name === 'sell') {
          const trade = swapTransactionParser(
            formattedTransaction,
            instruction,
            instruction.name
          );
          
          if (!trade || !trade.inputMint) continue;
          
          this.formatter.incrementStat('trades');
          
          // Determine actual trade direction based on token configuration
          const isBuy = trade.isBuy;
          if (isBuy) {
            this.stats.buys++;
          } else {
            this.stats.sells++;
          }
          
          // Log trade
          this.formatter.logTrade({
            type: isBuy ? 'buy' : 'sell',
            mint: trade.inputMint,
            amount: trade.amountInUsd || 0,
            price: trade.tokenPriceUsd || 0,
            user: trade.user || undefined,
            signature: signature
          });
          
          // Update stats
          this.stats.uniqueTokens.add(trade.inputMint);
          this.stats.volume += trade.amountInUsd || 0;
          
          // Check if new token
          const isNew = this.stats.uniqueTokens.size > this.stats.newTokens;
          if (isNew) {
            this.stats.newTokens = this.stats.uniqueTokens.size;
            this.formatter.logInfo(`📝 Creating new AMM token: ${trade.inputMint}`);
          }
          
          // Save to database
          this.saveToDatabase(trade, signature, slot);
        }
      }
      
    } catch (error) {
      this.formatter.logError('Transaction processing error', error);
    }
  }

  private async saveToDatabase(trade: any, signature: string, slot: number): Promise<void> {
    try {
      await this.dbService.processTrade({
        signature,
        program: 'amm_pool',
        mint: trade.inputMint,
        tradeType: trade.isBuy ? 'buy' : 'sell',
        userAddress: trade.user || 'unknown',
        solAmount: BigInt(Math.floor((trade.amountInUsd || 0) / this.stats.solPrice * 1e9)),
        tokenAmount: BigInt(trade.inputAmount || 0),
        priceInSol: (trade.tokenPriceUsd || 0) / this.stats.solPrice,
        priceInUsd: trade.tokenPriceUsd || 0,
        marketCapUsd: trade.marketCapUsd || 0,
        virtualSolReserves: BigInt(trade.virtualSolReserves || 0),
        virtualTokenReserves: BigInt(trade.virtualTokenReserves || 0),
        slot,
        blockTime: Date.now()
      });
    } catch (error) {
      this.formatter.logError('Database save failed', error);
    }
  }

  private updateDisplay(): void {
    const stats = this.formatter.getStats();
    
    // Display updated stats
    this.formatter.displayStats({
      'Volume': `$${this.stats.volume.toFixed(2)}`,
      'Buys': this.stats.buys,
      'Sells': this.stats.sells,
      'Buy/Sell Ratio': this.stats.sells > 0 ? 
        `${(this.stats.buys / this.stats.sells * 100).toFixed(1)}%` : 'N/A',
      'Unique Tokens': this.stats.uniqueTokens.size,
      'New Tokens': this.stats.newTokens,
      'SOL Price': `$${this.stats.solPrice.toFixed(2)}`
    });
    
    this.formatter.footer();
  }
}

// Main execution
(async () => {
  const monitor = new SimplifiedAMMMonitor();
  
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\nShutting down monitor...'));
    if (monitor.dbService) {
      await monitor.dbService.close();
    }
    process.exit(0);
  });
  
  await monitor.start();
})();