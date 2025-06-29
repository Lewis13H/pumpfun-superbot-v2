#!/usr/bin/env node
/**
 * AMM Account Monitor - Simplified Output Version
 * Monitors AMM pool state changes for real-time reserve tracking
 */

import 'dotenv/config';
import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../stream/client';
import { PublicKey } from '@solana/web3.js';
import { decodePoolAccount, poolAccountToPlain } from '../utils/amm-pool-decoder';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { MonitorFormatter } from '../utils/monitor-formatter';
import chalk from 'chalk';
import bs58 from 'bs58';

// Configuration
const AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

/**
 * Simplified AMM Account Monitor
 */
class SimplifiedAMMAccountMonitor {
  private client: any = null;
  private stream: any = null;
  private poolStateService: AmmPoolStateService;
  private formatter: MonitorFormatter;
  
  private stats = {
    poolUpdates: 0,
    uniquePools: new Set<string>(),
    decodingErrors: 0,
    lastUpdateTime: Date.now()
  };

  constructor() {
    this.poolStateService = new AmmPoolStateService();
    this.formatter = new MonitorFormatter();
  }

  async start(): Promise<void> {
    // Display header
    this.formatter.header('AMM ACCOUNT MONITOR', AMM_PROGRAM_ID, {
      'Mode': 'Pool State Tracking',
      'Focus': 'Reserve Updates'
    });

    // Load existing pools
    const stats = this.poolStateService.getStats();
    this.formatter.logSuccess(`Loaded ${stats.poolsTracked} existing pool states`);

    // Start monitoring
    await this.startMonitoring();
    
    // Update stats every 10 seconds
    setInterval(() => this.updateDisplay(), 10000);
  }

  private async startMonitoring(): Promise<void> {
    this.formatter.logInfo('Starting account monitoring...');
    
    try {
      this.client = StreamClient.getInstance().getClient();
      
      const request: SubscribeRequest = {
        slots: {},
        accounts: {
          amm: {
            owner: [AMM_PROGRAM_ID],
            filters: [],
            account: []
          }
        },
        transactions: {},
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
        this.handleAccount(data);
      });
      
    } catch (error) {
      this.formatter.logError('Failed to start monitoring', error);
      setTimeout(() => this.start(), 5000);
    }
  }

  private async handleAccount(data: any): Promise<void> {
    try {
      const accountInfo = data?.account;
      if (!accountInfo) return;
      
      const accountKey = accountInfo.pubkey;
      const accountData = accountInfo.account?.data;
      const slot = accountInfo.slot || 0;
      
      if (!accountKey || !accountData) return;
      
      const pubkey = typeof accountKey === 'string' ? 
        accountKey : bs58.encode(accountKey);
      
      this.stats.lastUpdateTime = Date.now();
      
      // Try to decode as pool state
      try {
        const poolState = decodePoolAccount(accountData);
        if (!poolState) return;
        
        this.stats.poolUpdates++;
        this.stats.uniquePools.add(pubkey);
        
        // Convert to plain object
        const plainPool = poolAccountToPlain(poolState);
        
        // Extract pool data
        const poolData = {
          poolAddress: pubkey,
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
          slot: slot,
        };
        
        // Log pool update
        this.formatter.logAccountUpdate({
          type: 'POOL STATE UPDATE',
          account: pubkey,
          data: {
            'Mint': poolData.quoteMint.slice(0, 8) + '...',
            'LP Supply': poolData.lpSupply.toLocaleString(),
            'Base Token': poolData.poolBaseTokenAccount.slice(0, 8) + '...',
            'Quote Token': poolData.poolQuoteTokenAccount.slice(0, 8) + '...'
          }
        });
        
        // Update pool state service
        await this.poolStateService.updatePoolState(poolData);
        
      } catch (error) {
        this.stats.decodingErrors++;
        // Silently skip non-pool accounts
      }
      
    } catch (error) {
      this.formatter.logError('Account processing error', error);
    }
  }

  private updateDisplay(): void {
    const stats = this.formatter.getStats();
    const timeSinceUpdate = Date.now() - this.stats.lastUpdateTime;
    const status = timeSinceUpdate < 5000 ? 'Active' : 'Waiting';
    
    // Display updated stats
    this.formatter.displayStats({
      'Pool Updates': this.stats.poolUpdates,
      'Unique Pools': this.stats.uniquePools.size,
      'Decoding Errors': this.stats.decodingErrors,
      'Status': status,
      'Cache Size': this.poolStateService.getCacheSize()
    });
    
    this.formatter.footer();
  }
}

// Main execution
(async () => {
  const monitor = new SimplifiedAMMAccountMonitor();
  
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\nShutting down monitor...'));
    process.exit(0);
  });
  
  await monitor.start();
})();