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

export class BondingCurveAccountHandler {
  private logger = new Logger({ context: 'BondingCurveAccountHandler' });
  private accountCoder: BorshAccountsCoder;
  private bondingCurveDiscriminator: Buffer;
  
  // Constants from Shyft examples
  private readonly GRADUATION_SOL_TARGET = 84; // 84 SOL for graduation
  private readonly LAMPORTS_PER_SOL = 1_000_000_000;

  constructor(
    programIdl: any,
    private eventBus: EventBus,
    private bondingCurveToMint: Map<string, string> = new Map()
  ) {
    this.accountCoder = new BorshAccountsCoder(programIdl);
    this.bondingCurveDiscriminator = (this.accountCoder as any).accountDiscriminator('BondingCurve');
  }

  /**
   * Process account update from pump.fun program
   */
  async processAccountUpdate(accountData: any): Promise<void> {
    try {
      const data = Buffer.from(accountData.account.data, 'base64');
      
      // Check if this is a BondingCurve account
      if (!this.isBondingCurveAccount(data)) {
        return;
      }

      // Decode the account data
      const decodedData = this.accountCoder.decodeAny(data);
      if (!decodedData) {
        return;
      }

      const pubkey = bs58.encode(accountData.account.pubkey);
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