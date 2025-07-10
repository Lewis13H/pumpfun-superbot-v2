/**
 * Graduation Detection Service
 * Monitors for tokens graduating from bonding curve to AMM
 * Based on shyft-code-examples patterns
 */

import { Logger } from '../../core/logger';
import { EventBus, EVENTS } from '../../core/event-bus';
import { Pool } from 'pg';
import { UnifiedEventParser } from '../../utils/parsers/unified-event-parser';
import { EventType } from '../../utils/parsers/types';
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { PublicKey } from '@solana/web3.js';
import { Idl } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';

const PUMP_AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

interface GraduationEvent {
  mintAddress: string;
  signature: string;
  bondingCurveAddress?: string;
  poolAddress?: string;
  timestamp: Date;
  method: 'pool_creation' | 'first_amm_trade' | 'bc_complete_with_pool';
}

export class GraduationDetector {
  private client?: Client;
  private stream?: any;
  private parser?: SolanaParser;
  private logger: Logger;
  private isMonitoring = false;
  private pendingGraduations = new Map<string, { bcComplete: boolean; poolCreated: boolean }>();

  constructor(
    private eventBus: EventBus,
    private database: Pool,
    private eventParser: UnifiedEventParser
  ) {
    this.logger = new Logger({ context: 'GraduationDetector' });
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Listen for bonding curve completions
    this.eventBus.on(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, (data: any) => {
      if (data.complete && data.mintAddress) {
        this.handleBondingCurveComplete(data.mintAddress, data.bondingCurveAddress);
      }
    });

    // Listen for AMM trades
    this.eventBus.on(EVENTS.AMM_TRADE, (event: any) => {
      if (event.type === EventType.AMM_TRADE && event.mintAddress) {
        this.handleFirstAmmTrade(event.mintAddress, event.signature);
      }
    });
  }

  async initialize(): Promise<void> {
    try {
      // Load AMM IDL for pool creation detection
      const idlPath = path.join(__dirname, '../../idls/pump_amm_0.1.0.json');
      const pumpAmmIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl;
      
      this.parser = new SolanaParser([]);
      this.parser.addParserFromIdl(PUMP_AMM_PROGRAM_ID, pumpAmmIdl as any);
      
      this.logger.info('Graduation detector initialized');
    } catch (error) {
      this.logger.error('Failed to initialize graduation detector', error as Error);
    }
  }

  /**
   * Start monitoring for pool creation events
   */
  async startPoolCreationMonitoring(): Promise<void> {
    if (this.isMonitoring) return;
    
    try {
      this.client = new Client(
        process.env.SHYFT_GRPC_ENDPOINT!,
        process.env.SHYFT_GRPC_TOKEN!,
        undefined
      );
      
      this.stream = await this.client.subscribe();
      this.isMonitoring = true;
      
      this.stream.on('data', (data: any) => {
        if (data?.transaction) {
          this.processTransaction(data.transaction);
        }
      });
      
      this.stream.on('error', (error: any) => {
        this.logger.error('Pool creation stream error', error);
        this.stopMonitoring();
      });
      
      // Subscribe to AMM pool creation transactions
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
          if (err) reject(err);
          else resolve(true);
        });
      });
      
      this.logger.info('Started monitoring for AMM pool creations');
    } catch (error) {
      this.logger.error('Failed to start pool creation monitoring', error as Error);
      this.isMonitoring = false;
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
          // Extract mint address from accounts (typically index 2 based on IDL)
          const accounts = ix.accounts || [];
          const mintAddress = accounts[2]?.pubkey || accounts[2];
          
          if (mintAddress) {
            const mintAddressStr = typeof mintAddress === 'string' ? mintAddress : mintAddress.toString();
            this.logger.info('🎉 Pool creation detected!', {
              mintAddress: mintAddressStr,
              signature,
              accounts: accounts.length
            });
            
            await this.handlePoolCreation(mintAddressStr, signature);
          }
        }
      }
    } catch (error) {
      // Silent error - too many parsing errors in stream
    }
  }

  private async handleBondingCurveComplete(mintAddress: string, bondingCurveAddress?: string): Promise<void> {
    const pending = this.pendingGraduations.get(mintAddress) || { bcComplete: false, poolCreated: false };
    pending.bcComplete = true;
    this.pendingGraduations.set(mintAddress, pending);
    
    this.logger.info('Bonding curve complete', { mintAddress, bondingCurveAddress });
    
    // Check if pool already created
    if (pending.poolCreated) {
      await this.confirmGraduation(mintAddress, 'bc_complete_with_pool');
    }
  }

  private async handlePoolCreation(mintAddress: string, signature: string): Promise<void> {
    const pending = this.pendingGraduations.get(mintAddress) || { bcComplete: false, poolCreated: false };
    pending.poolCreated = true;
    this.pendingGraduations.set(mintAddress, pending);
    
    // This is the definitive graduation event
    await this.confirmGraduation(mintAddress, 'pool_creation', signature);
  }

  private async handleFirstAmmTrade(mintAddress: string, signature: string): Promise<void> {
    // Check if already graduated
    const result = await this.database.query(
      'SELECT graduated_to_amm FROM tokens_unified WHERE mint_address = $1',
      [mintAddress]
    );
    
    if (result.rows.length > 0 && !result.rows[0].graduated_to_amm) {
      // First AMM trade for non-graduated token = graduation
      await this.confirmGraduation(mintAddress, 'first_amm_trade', signature);
    }
  }

  private async confirmGraduation(mintAddress: string, method: string, signature?: string): Promise<void> {
    try {
      // Update database
      await this.database.query(`
        UPDATE tokens_unified
        SET graduated_to_amm = true,
            bonding_curve_complete = true,
            current_program = 'amm_pool',
            updated_at = NOW()
        WHERE mint_address = $1
          AND (graduated_to_amm = false OR graduated_to_amm IS NULL)
      `, [mintAddress]);
      
      // Get token details
      const tokenResult = await this.database.query(
        'SELECT symbol, name, latest_market_cap_usd FROM tokens_unified WHERE mint_address = $1',
        [mintAddress]
      );
      
      const token = tokenResult.rows[0];
      
      this.logger.info('🎓 TOKEN GRADUATED!', {
        mintAddress,
        symbol: token?.symbol || 'Unknown',
        marketCap: token?.latest_market_cap_usd,
        method,
        signature
      });
      
      // Emit graduation event
      this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
        mintAddress,
        symbol: token?.symbol,
        name: token?.name,
        marketCapUsd: token?.latest_market_cap_usd,
        method,
        signature,
        graduatedAt: new Date()
      });
      
      // Clean up pending
      this.pendingGraduations.delete(mintAddress);
    } catch (error) {
      this.logger.error('Failed to confirm graduation', { mintAddress, error });
    }
  }

  async stopMonitoring(): Promise<void> {
    this.isMonitoring = false;
    
    if (this.stream) {
      this.stream.end();
      this.stream.removeAllListeners();
      this.stream = undefined;
    }
    
    if (this.client) {
      // Yellowstone client doesn't have close method
      this.client = undefined;
    }
    
    this.logger.info('Stopped graduation monitoring');
  }

  /**
   * Manually check and fix graduated tokens
   */
  async checkAndFixGraduatedTokens(): Promise<void> {
    try {
      // Find tokens with AMM trades that aren't marked as graduated
      const result = await this.database.query(`
        UPDATE tokens_unified
        SET graduated_to_amm = true,
            bonding_curve_complete = true,
            current_program = 'amm_pool',
            updated_at = NOW()
        WHERE mint_address IN (
          SELECT DISTINCT t.mint_address
          FROM tokens_unified t
          INNER JOIN trades_unified tr ON t.mint_address = tr.mint_address
          WHERE tr.program = 'amm_pool'
          AND (t.graduated_to_amm = false OR t.graduated_to_amm IS NULL)
        )
        RETURNING mint_address, symbol
      `);
      
      if (result.rowCount && result.rowCount > 0) {
        this.logger.info(`Fixed ${result.rowCount} graduated tokens`);
      }
      
      // Remove graduated status from tokens without AMM trades
      const resetResult = await this.database.query(`
        UPDATE tokens_unified
        SET graduated_to_amm = false,
            current_program = 'bonding_curve'
        WHERE graduated_to_amm = true
        AND NOT EXISTS (
          SELECT 1 FROM trades_unified tr 
          WHERE tr.mint_address = tokens_unified.mint_address 
          AND tr.program = 'amm_pool'
        )
        RETURNING mint_address
      `);
      
      if (resetResult.rowCount && resetResult.rowCount > 0) {
        this.logger.info(`Reset ${resetResult.rowCount} incorrectly graduated tokens`);
      }
    } catch (error) {
      this.logger.error('Failed to check graduated tokens', error as Error);
    }
  }
}