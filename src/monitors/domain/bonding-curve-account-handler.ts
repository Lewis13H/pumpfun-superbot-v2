/**
 * Bonding Curve Account Handler
 * 
 * This module can be integrated into TokenLifecycleMonitor to provide
 * accurate bonding curve progress tracking based on Shyft examples.
 */

import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { Logger } from '../../core/logger';
import { EventBus, EVENTS } from '../../core/event-bus';
import bs58 from 'bs58';
import * as borsh from '@coral-xyz/borsh';

// Bonding curve account schema
const BONDING_CURVE_SCHEMA = borsh.struct([
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete'),
  borsh.publicKey('creator'),
]);

export class BondingCurveAccountHandler {
  private logger = new Logger({ context: 'BondingCurveAccountHandler' });
  private accountCoder: BorshAccountsCoder | null;
  private bondingCurveDiscriminator: Buffer;
  private lastProgressUpdate: Map<string, { progress: number; complete: boolean }> = new Map();
  
  // Constants from Shyft examples
  private readonly GRADUATION_SOL_TARGET = 84; // 84 SOL for graduation
  private readonly LAMPORTS_PER_SOL = 1_000_000_000;

  constructor(
    programIdl: any | null,
    private eventBus: EventBus,
    private bondingCurveToMint: Map<string, string> = new Map(),
    private database?: any // Optional database service for direct updates
  ) {
    if (programIdl) {
      try {
        this.accountCoder = new BorshAccountsCoder(programIdl);
        this.bondingCurveDiscriminator = (this.accountCoder as any).accountDiscriminator('BondingCurve');
      } catch (error) {
        this.logger.warn('Failed to initialize BorshAccountsCoder, using fallback', error as Error);
        this.accountCoder = null;
        this.bondingCurveDiscriminator = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
      }
    } else {
      this.accountCoder = null;
      this.bondingCurveDiscriminator = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
    }
  }

  /**
   * Process account update from pump.fun program
   */
  async processAccountUpdate(accountData: any): Promise<void> {
    try {
      // Convert account data to buffer (handle different formats)
      let data: Buffer;
      const accountDataRaw = accountData.account.data;
      
      if (typeof accountDataRaw === 'string') {
        // Base64 encoded string
        data = Buffer.from(accountDataRaw, 'base64');
      } else if (Array.isArray(accountDataRaw)) {
        // Check if it's an array of numbers or a nested structure
        if (typeof accountDataRaw[0] === 'string') {
          // Array with base64 string as first element
          data = Buffer.from(accountDataRaw[0], 'base64');
        } else if (typeof accountDataRaw[0] === 'number') {
          // Array of bytes
          data = Buffer.from(accountDataRaw);
        } else {
          // Unknown format
          this.logger.debug('Unknown account data format in handler', { 
            dataType: typeof accountDataRaw[0],
            sample: accountDataRaw.slice(0, 10)
          });
          return;
        }
      } else {
        this.logger.debug('Unexpected account data type in handler', { type: typeof accountDataRaw });
        return;
      }
      
      // Check if this is a BondingCurve account
      if (!this.isBondingCurveAccount(data)) {
        return;
      }

      // Decode the account data
      let decodedData: any;
      
      if (this.accountCoder) {
        // Try using the account coder
        try {
          const decoded = this.accountCoder.decodeAny(data);
          if (!decoded || (decoded.name && decoded.name !== 'BondingCurve')) {
            return;
          }
          decodedData = decoded.data || decoded;
        } catch (error) {
          // Fallback to borsh schema
          this.logger.debug('Account coder failed, using borsh schema', error as Error);
          decodedData = BONDING_CURVE_SCHEMA.decode(data.slice(8));
        }
      } else {
        // Use borsh schema directly
        decodedData = BONDING_CURVE_SCHEMA.decode(data.slice(8));
      }
      
      if (!decodedData) {
        return;
      }

      // Handle pubkey format (could be string or array)
      let pubkey: string;
      if (typeof accountData.account.pubkey === 'string') {
        pubkey = accountData.account.pubkey;
      } else if (Array.isArray(accountData.account.pubkey)) {
        pubkey = bs58.encode(Buffer.from(accountData.account.pubkey));
      } else if (Buffer.isBuffer(accountData.account.pubkey)) {
        pubkey = bs58.encode(accountData.account.pubkey);
      } else {
        this.logger.debug('Unknown pubkey format', { type: typeof accountData.account.pubkey });
        return;
      }
      const lamports = accountData.account.lamports;

      // Calculate progress based on lamports (following Shyft example)
      const solInCurve = lamports / this.LAMPORTS_PER_SOL;
      const progress = Math.min((solInCurve / this.GRADUATION_SOL_TARGET) * 100, 100);

      // Get associated mint address
      const mintAddress = this.bondingCurveToMint.get(pubkey);

      // Format the data
      const bondingCurveData = {
        bondingCurveAddress: pubkey,
        mintAddress,
        progress,
        complete: Boolean(decodedData.complete),
        lamports,
        solInCurve,
        virtualSolReserves: BigInt(decodedData.virtualSolReserves || 0),
        virtualTokenReserves: BigInt(decodedData.virtualTokenReserves || 0),
        realSolReserves: BigInt(decodedData.realSolReserves || 0),
        realTokenReserves: BigInt(decodedData.realTokenReserves || 0),
        tokenTotalSupply: BigInt(decodedData.tokenTotalSupply || 0)
      };
      
      // Debug log for all account updates
      this.logger.debug('BC Account Update', {
        bondingCurve: pubkey.substring(0, 8) + '...',
        mint: mintAddress?.substring(0, 8) + '...',
        complete: decodedData.complete,
        progress: progress.toFixed(2),
        solInCurve: solInCurve.toFixed(4)
      });

      // Log significant updates
      if (progress % 10 === 0 || decodedData.complete) {
        this.logger.info('Bonding Curve Progress Update', {
          bondingCurve: pubkey.substring(0, 8) + '...',
          mint: mintAddress?.substring(0, 8) + '...',
          progress: `${progress.toFixed(1)}%`,
          complete: decodedData.complete,
          solInCurve: solInCurve.toFixed(2)
        });
      }
      
      // Special logging for complete flag detection
      if (decodedData.complete) {
        this.logger.info('🎯 COMPLETE FLAG DETECTED!', {
          bondingCurve: pubkey,
          mintAddress,
          complete: true,
          solInCurve: solInCurve.toFixed(2),
          progress: `${progress.toFixed(1)}%`,
          timestamp: new Date().toISOString()
        });
      }

      // Check if progress or complete status changed
      const lastUpdate = this.lastProgressUpdate.get(pubkey);
      const hasChanged = !lastUpdate || 
                        lastUpdate.progress !== progress || 
                        lastUpdate.complete !== decodedData.complete;
      
      if (hasChanged) {
        // Update database directly if available
        if (this.database && mintAddress) {
          try {
            await this.database.query(
              `UPDATE tokens_unified 
               SET bonding_curve_complete = $1,
                   latest_bonding_curve_progress = $2,
                   graduated_to_amm = $3,
                   updated_at = NOW()
               WHERE mint_address = $4
                  OR (bonding_curve_key = $5 AND bonding_curve_key IS NOT NULL)`,
              [decodedData.complete, progress, decodedData.complete, mintAddress, pubkey]
            );
            
            this.logger.debug('Direct DB update from account handler', {
              bondingCurve: pubkey.substring(0, 8) + '...',
              mint: mintAddress.substring(0, 8) + '...',
              progress: progress.toFixed(2),
              complete: decodedData.complete
            });
          } catch (error) {
            this.logger.error('Failed to update database directly', error as Error);
          }
        }
        
        // Track this update
        this.lastProgressUpdate.set(pubkey, { progress, complete: decodedData.complete });
      }
      
      // Emit progress update event
      this.eventBus.emit(EVENTS.BONDING_CURVE_PROGRESS_UPDATE, bondingCurveData);

      // Check for graduation
      if (decodedData.complete) {
        this.logger.info('🎓 Token Graduated! (Account Handler)', {
          bondingCurve: pubkey,
          mintAddress,
          finalSol: solInCurve.toFixed(2),
          method: 'account_monitoring',
          complete: true
        });

        this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
          ...bondingCurveData,
          graduatedAt: new Date()
        });
      }

    } catch (error) {
      this.logger.error('Failed to process bonding curve account', error as Error);
    }
  }

  /**
   * Check if account data is a BondingCurve account
   */
  private isBondingCurveAccount(data: Buffer): boolean {
    if (data.length < 8) return false;
    
    const discriminator = data.slice(0, 8);
    return discriminator.equals(this.bondingCurveDiscriminator);
  }

  /**
   * Add a bonding curve to mint mapping
   */
  addMapping(bondingCurveAddress: string, mintAddress: string): void {
    this.bondingCurveToMint.set(bondingCurveAddress, mintAddress);
  }
}

/**
 * Integration example for TokenLifecycleMonitor:
 * 
 * 1. In constructor:
 *    const idl = JSON.parse(fs.readFileSync('./src/idls/pump_0.1.0.json', 'utf8'));
 *    this.bcAccountHandler = new BondingCurveAccountHandler(idl, this.eventBus);
 * 
 * 2. In onStart():
 *    // Subscribe to pump.fun accounts
 *    const streamManager = await this.container.resolve('StreamManager');
 *    await streamManager.subscribeToAccountsByOwner(
 *      PUMP_PROGRAM,
 *      (data) => this.bcAccountHandler.processAccountUpdate(data)
 *    );
 * 
 * 3. In BC trade handler:
 *    // Track bonding curve to mint mapping
 *    if (event.bondingCurveKey && event.mintAddress) {
 *      this.bcAccountHandler.addMapping(event.bondingCurveKey, event.mintAddress);
 *    }
 */