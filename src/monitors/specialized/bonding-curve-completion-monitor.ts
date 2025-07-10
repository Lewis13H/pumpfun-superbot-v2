/**
 * Bonding Curve Completion Monitor
 * Monitors for bonding curves reaching completion
 * Based on shyft-code-examples/bonding curve/stream_completed_bonding_curve
 */

import { Logger } from '../../core/logger';
import { EventBus, EVENTS } from '../../core/event-bus';
import { Pool } from 'pg';
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { struct, bool, u64 } from '@coral-xyz/borsh';
import bs58 from 'bs58';
import chalk from 'chalk';

const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Bonding curve account structure
const BONDING_CURVE_STRUCTURE = struct([
  u64('discriminator'),
  u64('virtualTokenReserves'),
  u64('virtualSolReserves'),
  u64('realTokenReserves'),
  u64('realSolReserves'),
  u64('tokenTotalSupply'),
  bool('complete')
]);

export class BondingCurveCompletionMonitor {
  private client?: Client;
  private stream?: any;
  private logger: Logger;
  private isRunning = false;
  private completionCount = 0;
  private processedAccounts = new Set<string>();

  constructor(
    private eventBus: EventBus,
    private database: Pool
  ) {
    this.logger = new Logger({ 
      context: 'BCCompletionMonitor'
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('BC completion monitor already running');
      return;
    }

    try {
      // Initialize gRPC client
      this.client = new Client(
        process.env.SHYFT_GRPC_ENDPOINT!,
        process.env.SHYFT_GRPC_TOKEN!,
        undefined
      );
      
      this.stream = await this.client.subscribe();
      this.isRunning = true;
      
      // Set up stream handlers
      this.stream.on('data', (data: any) => {
        if (data?.account) {
          this.processAccount(data.account);
        }
      });
      
      this.stream.on('error', (error: any) => {
        this.logger.error('BC completion stream error', error);
        this.reconnect();
      });
      
      this.stream.on('end', () => {
        this.logger.warn('BC completion stream ended');
        this.reconnect();
      });
      
      // Subscribe to bonding curve accounts where complete = true
      // Using memcmp filter at the 'complete' field offset
      const completeFieldOffset = BONDING_CURVE_STRUCTURE.offsetOf('complete');
      
      const request = {
        slots: {},
        accounts: {
          pumpfun: {
            account: [],
            filters: [
              {
                memcmp: {
                  offset: completeFieldOffset.toString(),
                  bytes: Uint8Array.from([1]) // 1 = true for boolean
                }
              }
            ],
            owner: [PUMP_PROGRAM_ID]
          }
        },
        transactions: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.CONFIRMED,
        entry: {},
        transactionsStatus: {}
      };
      
      await new Promise((resolve, reject) => {
        this.stream.write(request, (err: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(true);
          }
        });
      });
      
      this.logger.info('BC completion monitor started', {
        program: PUMP_PROGRAM_ID,
        filterOffset: completeFieldOffset
      });
      
      // Also check existing bonding curves periodically
      this.checkExistingBondingCurves();
      setInterval(() => this.checkExistingBondingCurves(), 300000); // Every 5 minutes
      
    } catch (error) {
      this.logger.error('Failed to start BC completion monitor', error as Error);
      this.isRunning = false;
      throw error;
    }
  }

  private async processAccount(accountData: any): Promise<void> {
    try {
      const account = accountData.account || accountData;
      
      // Get account address
      let pubkey: string;
      if (typeof account.pubkey === 'string') {
        pubkey = account.pubkey;
      } else if (Array.isArray(account.pubkey)) {
        pubkey = bs58.encode(Buffer.from(account.pubkey));
      } else if (Buffer.isBuffer(account.pubkey)) {
        pubkey = bs58.encode(account.pubkey);
      } else {
        return;
      }
      
      // Skip if already processed recently
      if (this.processedAccounts.has(pubkey)) {
        return;
      }
      this.processedAccounts.add(pubkey);
      
      // Decode account data
      const data = account.data;
      if (!data || data.length < 8) return;
      
      let buffer: Buffer;
      if (typeof data === 'string') {
        buffer = Buffer.from(data, 'base64');
      } else if (Array.isArray(data)) {
        buffer = Buffer.from(data);
      } else {
        buffer = data;
      }
      
      // Skip discriminator (8 bytes)
      const decoded = BONDING_CURVE_STRUCTURE.decode(buffer.slice(8));
      
      if (!decoded.complete) {
        return; // Should be filtered out by memcmp, but double check
      }
      
      this.completionCount++;
      
      // Calculate details
      const virtualTokenReserves = Number(decoded.virtualTokenReserves) / 1e6;
      const virtualSolReserves = Number(decoded.virtualSolReserves) / 1e9;
      
      this.logger.info('🎯 BONDING CURVE COMPLETE!', {
        bondingCurve: pubkey,
        virtualTokens: virtualTokenReserves.toFixed(2),
        virtualSol: virtualSolReserves.toFixed(2),
        totalCompletions: this.completionCount
      });
      
      // Find associated token
      const tokenResult = await this.database.query(
        'SELECT mint_address, symbol, name FROM tokens_unified WHERE bonding_curve_key = $1',
        [pubkey]
      );
      
      if (tokenResult.rows.length > 0) {
        const token = tokenResult.rows[0];
        
        // Update token
        await this.database.query(`
          UPDATE tokens_unified
          SET bonding_curve_complete = true,
              latest_bonding_curve_progress = 100,
              updated_at = NOW()
          WHERE bonding_curve_key = $1
        `, [pubkey]);
        
        this.logger.info('✅ Token BC completion recorded', {
          symbol: token.symbol || 'Unknown',
          mintAddress: token.mint_address,
          bondingCurve: pubkey
        });
        
        // Emit event
        this.eventBus.emit(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, {
          bondingCurveAddress: pubkey,
          mintAddress: token.mint_address,
          progress: 100,
          complete: true,
          virtualSolReserves: decoded.virtualSolReserves,
          virtualTokenReserves: decoded.virtualTokenReserves
        });
      }
      
      // Clear from processed set after 5 minutes
      setTimeout(() => {
        this.processedAccounts.delete(pubkey);
      }, 300000);
      
    } catch (error) {
      this.logger.error('Error processing BC account', error as Error);
    }
  }

  private async checkExistingBondingCurves(): Promise<void> {
    try {
      // Find tokens that might have completed bonding curves
      const result = await this.database.query(`
        SELECT mint_address, bonding_curve_key
        FROM tokens_unified
        WHERE bonding_curve_complete = false
          AND bonding_curve_key IS NOT NULL
          AND latest_bonding_curve_progress >= 95
        LIMIT 50
      `);
      
      this.logger.info(`Checking ${result.rows.length} high-progress bonding curves`);
      
      // We could fetch and check these accounts directly
      // For now, just log for monitoring
      
    } catch (error) {
      this.logger.error('Error checking existing BCs', error as Error);
    }
  }

  private async reconnect(): Promise<void> {
    this.logger.info('Attempting to reconnect BC completion monitor...');
    
    // Clean up
    if (this.stream) {
      try {
        this.stream.end();
        this.stream.removeAllListeners();
      } catch (e) {
        // Ignore
      }
    }
    
    if (this.client) {
      try {
        // Yellowstone client doesn't have close method
      } catch (e) {
        // Ignore
      }
    }
    
    this.isRunning = false;
    
    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Restart
    try {
      await this.start();
    } catch (error) {
      this.logger.error('Failed to reconnect', error as Error);
      // Try again in 30 seconds
      setTimeout(() => this.reconnect(), 30000);
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping BC completion monitor');
    
    this.isRunning = false;
    this.processedAccounts.clear();
    
    if (this.stream) {
      this.stream.end();
      this.stream.removeAllListeners();
      this.stream = undefined;
    }
    
    if (this.client) {
      // Yellowstone client doesn't have close method
      this.client = undefined;
    }
  }
}