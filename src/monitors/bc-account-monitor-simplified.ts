#!/usr/bin/env node
/**
 * Bonding Curve Account Monitor - Simplified Output Version
 * Monitors account state changes and detects graduations
 */

import 'dotenv/config';
import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { StreamClient } from '../stream/client';
import { PUMP_PROGRAM } from '../utils/constants';
import { PublicKey } from '@solana/web3.js';
import { unifiedDBService } from '../database/unified-db-service-v2';
import { MonitorFormatter } from '../utils/monitor-formatter';
import * as borsh from '@coral-xyz/borsh';
import chalk from 'chalk';
import bs58 from 'bs58';

// Bonding curve account structure
interface BondingCurveAccount {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

// Borsh schema for decoding
const bondingCurveSchema = borsh.struct([
  borsh.u8('discriminator0'),
  borsh.u8('discriminator1'),
  borsh.u8('discriminator2'),
  borsh.u8('discriminator3'),
  borsh.u8('discriminator4'),
  borsh.u8('discriminator5'),
  borsh.u8('discriminator6'),
  borsh.u8('discriminator7'),
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete')
]);

/**
 * Simplified BC Account Monitor
 */
class SimplifiedBCAccountMonitor {
  private client: any = null;
  private stream: any = null;
  private formatter: MonitorFormatter;
  
  private stats = {
    graduations: 0,
    accountUpdates: 0,
    mintResolutionFailures: 0,
    activeAccounts: new Set<string>()
  };

  constructor() {
    this.formatter = new MonitorFormatter();
  }

  async start(): Promise<void> {
    // Display header
    this.formatter.header('BC ACCOUNT MONITOR', PUMP_PROGRAM, {
      'Mode': 'Account State Tracking',
      'Focus': 'Graduation Detection'
    });

    // Start monitoring
    await this.startMonitoring();
    
    // Update stats every 10 seconds
    setInterval(() => this.updateDisplay(), 10000);
  }

  private async startMonitoring(): Promise<void> {
    this.formatter.logInfo('Subscribing to pump.fun account updates...');
    
    try {
      this.client = StreamClient.getInstance().getClient();
      
      const request: SubscribeRequest = {
        slots: {},
        accounts: {
          pump: {
            owner: [PUMP_PROGRAM],
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

  private handleAccount(data: any): void {
    try {
      const accountInfo = data?.account;
      if (!accountInfo) return;
      
      const accountKey = accountInfo.pubkey;
      const accountData = accountInfo.account?.data;
      
      if (!accountKey || !accountData) return;
      
      const pubkey = typeof accountKey === 'string' ? 
        accountKey : bs58.encode(accountKey);
      
      this.stats.accountUpdates++;
      this.stats.activeAccounts.add(pubkey);
      
      // Try to decode as bonding curve
      try {
        const decoded = bondingCurveSchema.decode(Buffer.from(accountData));
        const bondingCurve = decoded as BondingCurveAccount;
        
        // Calculate progress
        const progress = this.calculateProgress(bondingCurve.virtualSolReserves);
        
        // Log account update
        this.formatter.logAccountUpdate({
          type: 'BONDING CURVE UPDATE',
          account: pubkey,
          data: {
            'Progress': `${progress.toFixed(2)}%`,
            'Complete': bondingCurve.complete ? 'YES' : 'NO',
            'Virtual SOL': `${(Number(bondingCurve.virtualSolReserves) / 1e9).toFixed(2)} SOL`,
            'Real SOL': `${(Number(bondingCurve.realSolReserves) / 1e9).toFixed(2)} SOL`
          }
        });
        
        // Check for graduation
        if (progress >= 100 || bondingCurve.complete) {
          this.stats.graduations++;
          this.formatter.logSuccess(`🎓 GRADUATION DETECTED! Progress: ${progress.toFixed(2)}%`);
          
          // Try to find mint address
          this.findAndUpdateMintAddress(pubkey, bondingCurve);
        }
        
      } catch (error) {
        // Not a bonding curve account, skip silently
      }
      
    } catch (error) {
      this.formatter.logError('Account processing error', error);
    }
  }

  private calculateProgress(virtualSolReserves: bigint): number {
    const INITIAL_VIRTUAL_SOL = 30n * 1000000000n; // 30 SOL
    const MAX_VIRTUAL_SOL = 85n * 1000000000n; // 85 SOL
    
    const currentReserves = virtualSolReserves;
    const additionalSol = currentReserves > INITIAL_VIRTUAL_SOL ? 
      currentReserves - INITIAL_VIRTUAL_SOL : 0n;
    const maxAdditionalSol = MAX_VIRTUAL_SOL - INITIAL_VIRTUAL_SOL;
    
    return Number((additionalSol * 10000n) / maxAdditionalSol) / 100;
  }

  private async findAndUpdateMintAddress(bondingCurveAddress: string, bondingCurve: BondingCurveAccount): Promise<void> {
    try {
      // Simplified - just log the graduation
      // In production, this would reverse-engineer the mint from the PDA
      this.formatter.logInfo(`Graduation recorded for curve ${bondingCurveAddress.slice(0, 8)}...`);
    } catch (error) {
      this.stats.mintResolutionFailures++;
      this.formatter.logWarning('Could not resolve mint address');
    }
  }

  private updateDisplay(): void {
    const stats = this.formatter.getStats();
    
    // Display updated stats
    this.formatter.displayStats({
      'Account Updates': this.stats.accountUpdates,
      'Active Accounts': this.stats.activeAccounts.size,
      'Graduations': this.stats.graduations,
      'Mint Resolution Failures': this.stats.mintResolutionFailures
    });
    
    this.formatter.footer();
  }
}

// Main execution
(async () => {
  const monitor = new SimplifiedBCAccountMonitor();
  
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\nShutting down monitor...'));
    process.exit(0);
  });
  
  await monitor.start();
})();