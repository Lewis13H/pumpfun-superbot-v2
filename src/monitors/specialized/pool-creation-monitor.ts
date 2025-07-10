/**
 * Dedicated Pool Creation Monitor
 * Monitors specifically for AMM pool creation events (graduations)
 * Based on shyft-code-examples patterns
 */

import { Logger } from '../../core/logger';
import { EventBus, EVENTS } from '../../core/event-bus';
import { Pool } from 'pg';
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { PublicKey } from '@solana/web3.js';
import { Idl } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';
import chalk from 'chalk';

const PUMP_AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export class PoolCreationMonitor {
  private client?: Client;
  private stream?: any;
  private parser?: SolanaParser;
  private logger: Logger;
  private isRunning = false;
  private poolCreationCount = 0;
  private lastPoolCreation?: Date;

  constructor(
    private eventBus: EventBus,
    private database: Pool
  ) {
    this.logger = new Logger({ 
      context: 'PoolCreationMonitor'
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Pool creation monitor already running');
      return;
    }

    try {
      // Load AMM IDL
      const idlPath = path.join(__dirname, '../../idls/pump_amm_0.1.0.json');
      const pumpAmmIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl;
      
      this.parser = new SolanaParser([]);
      this.parser.addParserFromIdl(PUMP_AMM_PROGRAM_ID, pumpAmmIdl as any);
      
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
        if (data?.transaction) {
          this.processTransaction(data.transaction);
        }
      });
      
      this.stream.on('error', (error: any) => {
        this.logger.error('Pool creation stream error', error);
        this.reconnect();
      });
      
      this.stream.on('end', () => {
        this.logger.warn('Pool creation stream ended');
        this.reconnect();
      });
      
      // Subscribe to AMM transactions
      const request = {
        accounts: {},
        slots: {},
        transactions: {
          pumpAmm: {
            vote: false,
            failed: false,
            accountInclude: [PUMP_AMM_PROGRAM_ID],
            accountExclude: [],
            accountRequired: []
          }
        },
        transactionsStatus: {},
        entry: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.CONFIRMED
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
      
      this.logger.info('Pool creation monitor started', {
        program: PUMP_AMM_PROGRAM_ID
      });
      
      // Log stats periodically
      setInterval(() => {
        this.logStats();
      }, 60000); // Every minute
      
    } catch (error) {
      this.logger.error('Failed to start pool creation monitor', error as Error);
      this.isRunning = false;
      throw error;
    }
  }

  private async processTransaction(transaction: any): Promise<void> {
    try {
      const tx = transaction?.transaction || transaction;
      const meta = tx?.meta || transaction?.meta;
      
      if (meta?.err) return;
      
      // Get signature
      const signature = transaction?.signature || 
                       (tx?.transaction?.signatures?.[0] && bs58.encode(tx.transaction.signatures[0])) ||
                       (tx?.signatures?.[0] && bs58.encode(tx.signatures[0])) ||
                       null;
      
      if (!signature || !this.parser) return;
      
      // Parse instructions
      const message = tx?.transaction?.message || tx?.message;
      const loadedAddresses = meta?.loadedAddresses;
      
      if (!message) return;
      
      const parsedIxs = this.parser.parseTransactionData(message, loadedAddresses);
      
      // Look for create_pool instruction
      const ammIxs = parsedIxs.filter((ix: any) => 
        ix.programId.equals(new PublicKey(PUMP_AMM_PROGRAM_ID))
      );
      
      for (const ix of ammIxs) {
        if (ix.name === 'create_pool') {
          await this.handlePoolCreation(ix, signature, message);
        }
      }
    } catch (error) {
      // Silent - too many parse errors
    }
  }

  private async handlePoolCreation(instruction: any, signature: string, message: any): Promise<void> {
    try {
      // Extract accounts
      const accounts = instruction.accounts || [];
      
      // Based on pump AMM IDL, typical account order:
      // 0: authority/payer
      // 1: pool account
      // 2: base mint (token)
      // 3: quote mint (SOL)
      // 4-5: vaults
      // etc.
      
      const poolAddress = accounts[1]?.pubkey || accounts[1];
      const baseMint = accounts[2]?.pubkey || accounts[2];
      const quoteMint = accounts[3]?.pubkey || accounts[3];
      
      if (!baseMint) {
        this.logger.warn('Pool creation missing base mint', { signature });
        return;
      }
      
      this.poolCreationCount++;
      this.lastPoolCreation = new Date();
      
      this.logger.info('🎉 POOL CREATION DETECTED!', {
        signature,
        poolAddress,
        baseMint,
        quoteMint,
        totalPools: this.poolCreationCount
      });
      
      // Check if token exists in database
      const tokenResult = await this.database.query(
        'SELECT mint_address, symbol, name, latest_market_cap_usd, bonding_curve_complete FROM tokens_unified WHERE mint_address = $1',
        [baseMint]
      );
      
      if (tokenResult.rows.length > 0) {
        const token = tokenResult.rows[0];
        
        // Update token as graduated
        await this.database.query(`
          UPDATE tokens_unified
          SET graduated_to_amm = true,
              bonding_curve_complete = true,
              current_program = 'amm_pool',
              amm_pool_address = $2,
              graduation_signature = $3,
              graduation_timestamp = NOW(),
              updated_at = NOW()
          WHERE mint_address = $1
        `, [baseMint, poolAddress, signature]);
        
        this.logger.info('✅ Token graduation recorded', {
          symbol: token.symbol || 'Unknown',
          mintAddress: baseMint,
          poolAddress,
          marketCap: token.latest_market_cap_usd
        });
        
        // Emit graduation event
        this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
          mintAddress: baseMint,
          symbol: token.symbol,
          name: token.name,
          poolAddress,
          signature,
          marketCapUsd: token.latest_market_cap_usd,
          method: 'pool_creation',
          graduatedAt: new Date()
        });
      } else {
        this.logger.warn('Pool created for unknown token', {
          mintAddress: baseMint,
          signature
        });
        
        // Create token entry as graduated
        await this.database.query(`
          INSERT INTO tokens_unified (
            mint_address,
            graduated_to_amm,
            bonding_curve_complete,
            current_program,
            amm_pool_address,
            graduation_signature,
            graduation_timestamp,
            created_at,
            updated_at
          ) VALUES ($1, true, true, 'amm_pool', $2, $3, NOW(), NOW(), NOW())
          ON CONFLICT (mint_address) DO UPDATE
          SET graduated_to_amm = true,
              bonding_curve_complete = true,
              current_program = 'amm_pool',
              amm_pool_address = $2,
              graduation_signature = $3,
              graduation_timestamp = NOW(),
              updated_at = NOW()
        `, [baseMint, poolAddress, signature]);
      }
      
    } catch (error) {
      this.logger.error('Error handling pool creation', {
        error,
        signature
      });
    }
  }

  private async reconnect(): Promise<void> {
    this.logger.info('Attempting to reconnect pool creation monitor...');
    
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

  private logStats(): void {
    this.logger.info('Pool creation monitor stats', {
      poolsCreated: this.poolCreationCount,
      lastPoolCreation: this.lastPoolCreation?.toISOString() || 'Never',
      uptime: this.isRunning ? 'Running' : 'Stopped'
    });
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping pool creation monitor');
    
    this.isRunning = false;
    
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