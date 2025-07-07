/**
 * Enhanced Token Lifecycle Monitor with Bonding Curve Account Monitoring
 * 
 * This version includes:
 * - Monitoring bonding curve account updates for accurate progress
 * - Detecting graduation via the 'complete' field
 * - Real-time progress calculation based on account lamports
 */

import { BaseMonitor } from '../../core/base-monitor';
import { ParsedMessage } from '../../types/stream';
import { Logger } from '../../core/logger';
import { EventBus, EVENTS } from '../../services/event-bus';
import { PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM } from '../../utils/config/constants';
import { EventType } from '../../utils/parsers/types';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import * as fs from 'fs';
import bs58 from 'bs58';

// Bonding curve account structure (matching Shyft examples)
interface BondingCurveAccount {
  discriminator: bigint;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export class TokenLifecycleMonitorEnhanced extends BaseMonitor {
  private logger = new Logger({ context: 'TokenLifecycleMonitorEnhanced' });
  private eventBus: EventBus;
  private accountCoder: BorshAccountsCoder;
  private bondingCurveDiscriminator: Buffer;
  private bondingCurveToMint: Map<string, string> = new Map(); // BC address -> mint address
  
  // Progress calculation constants (from Shyft examples)
  private readonly GRADUATION_SOL_TARGET = 84; // 84 SOL for graduation
  private readonly LAMPORTS_PER_SOL = 1_000_000_000;

  constructor(container: any) {
    super(container, {
      name: 'TokenLifecycleMonitorEnhanced',
      programIds: [PUMP_PROGRAM],
      filters: [],
      subscriptionGroup: 'bonding_curve' // High priority group
    });

    // Load pump.fun IDL for account decoding
    const idlPath = './src/idls/pump_0.1.0.json';
    const programIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    this.accountCoder = new BorshAccountsCoder(programIdl);
    
    // Get discriminator for BondingCurve accounts
    this.bondingCurveDiscriminator = this.accountCoder.accountDiscriminator('BondingCurve');
  }

  async onStart(): Promise<void> {
    this.eventBus = await this.container.resolve('EventBus');
    
    // Subscribe to both transactions AND account updates
    await this.subscribeToAccounts();
    
    this.logger.info('Enhanced Token Lifecycle Monitor started with account monitoring');
  }

  /**
   * Subscribe to pump.fun account updates (owner filter)
   * This gives us real-time bonding curve state updates
   */
  private async subscribeToAccounts(): Promise<void> {
    const streamManager = await this.container.resolve('StreamManager');
    
    // Subscribe to all pump.fun owned accounts
    // This will capture BondingCurve account updates
    await streamManager.subscribeToAccountsByOwner(
      PUMP_PROGRAM,
      (accountData: any) => this.handleAccountUpdate(accountData)
    );
  }

  /**
   * Handle account updates from pump.fun program
   */
  private async handleAccountUpdate(accountData: any): Promise<void> {
    try {
      // Extract account info
      const pubkey = bs58.encode(accountData.account.pubkey);
      const data = accountData.account.data;
      const lamports = accountData.account.lamports;
      
      // Check if this is a BondingCurve account
      if (!this.isBondingCurveAccount(data)) {
        return;
      }

      // Decode bonding curve data
      const bondingCurve = this.decodeBondingCurveAccount(data);
      if (!bondingCurve) {
        return;
      }

      // Calculate progress based on lamports (following Shyft example)
      const solInCurve = lamports / this.LAMPORTS_PER_SOL;
      const progress = Math.min((solInCurve / this.GRADUATION_SOL_TARGET) * 100, 100);

      // Get associated mint address (if we have it)
      const mintAddress = this.bondingCurveToMint.get(pubkey);

      // Log progress update
      this.logger.debug('Bonding curve progress update', {
        bondingCurve: pubkey,
        mintAddress,
        progress: progress.toFixed(2),
        complete: bondingCurve.complete,
        solInCurve: solInCurve.toFixed(2),
        virtualSolReserves: (Number(bondingCurve.virtualSolReserves) / this.LAMPORTS_PER_SOL).toFixed(2),
        realSolReserves: (Number(bondingCurve.realSolReserves) / this.LAMPORTS_PER_SOL).toFixed(2)
      });

      // Emit bonding curve update event
      this.eventBus.emit(EVENTS.BONDING_CURVE_UPDATE, {
        bondingCurveAddress: pubkey,
        mintAddress,
        progress,
        complete: bondingCurve.complete,
        lamports,
        virtualSolReserves: bondingCurve.virtualSolReserves,
        virtualTokenReserves: bondingCurve.virtualTokenReserves,
        realSolReserves: bondingCurve.realSolReserves,
        realTokenReserves: bondingCurve.realTokenReserves,
        tokenTotalSupply: bondingCurve.tokenTotalSupply
      });

      // Check for graduation
      if (bondingCurve.complete) {
        this.logger.info('🎓 Token graduated!', {
          bondingCurve: pubkey,
          mintAddress,
          finalSolReserves: solInCurve.toFixed(2)
        });

        this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
          bondingCurveAddress: pubkey,
          mintAddress,
          graduatedAt: new Date(),
          finalProgress: 100,
          finalSolReserves: bondingCurve.realSolReserves
        });
      }

      // Update metrics
      this.updateMetrics('account_update', {
        progress,
        complete: bondingCurve.complete
      });

    } catch (error) {
      this.logger.error('Failed to handle account update', error as Error);
    }
  }

  /**
   * Check if account data represents a BondingCurve account
   */
  private isBondingCurveAccount(data: string): boolean {
    try {
      const buffer = Buffer.from(data, 'base64');
      if (buffer.length < 8) return false;
      
      const discriminator = buffer.slice(0, 8);
      return discriminator.equals(this.bondingCurveDiscriminator);
    } catch {
      return false;
    }
  }

  /**
   * Decode BondingCurve account data
   */
  private decodeBondingCurveAccount(data: string): BondingCurveAccount | null {
    try {
      const decodedData = this.accountCoder.decodeAny(Buffer.from(data, 'base64'));
      if (!decodedData) return null;

      // Convert to our interface
      return {
        discriminator: BigInt(decodedData.discriminator || 0),
        virtualTokenReserves: BigInt(decodedData.virtualTokenReserves || 0),
        virtualSolReserves: BigInt(decodedData.virtualSolReserves || 0),
        realTokenReserves: BigInt(decodedData.realTokenReserves || 0),
        realSolReserves: BigInt(decodedData.realSolReserves || 0),
        tokenTotalSupply: BigInt(decodedData.tokenTotalSupply || 0),
        complete: Boolean(decodedData.complete)
      };
    } catch (error) {
      this.logger.error('Failed to decode bonding curve account', error as Error);
      return null;
    }
  }

  /**
   * Parse message - handles transactions (existing functionality)
   */
  async parseMessage(message: ParsedMessage): Promise<void> {
    // Skip if not a transaction
    if (!message.transaction) {
      return;
    }

    const signature = message.transaction.signature;
    const slot = message.slot;
    const blockTime = message.blockTime;
    const accounts = message.transaction.transaction.message.accountKeys.map(k => k.toString());

    // Parse transaction
    const parsedEvents = await this.parseTransaction({
      signature,
      slot,
      blockTime,
      accounts,
      logs: message.transaction.meta?.logMessages || [],
      programId: PUMP_PROGRAM
    });

    if (!parsedEvents || parsedEvents.length === 0) {
      return;
    }

    // Process each event
    for (const event of parsedEvents) {
      // Track bonding curve to mint mapping
      if (event.type === EventType.BC_TRADE && event.bondingCurveKey && event.mintAddress) {
        this.bondingCurveToMint.set(event.bondingCurveKey, event.mintAddress);
      }

      // Emit appropriate events based on lifecycle phase
      switch (event.type) {
        case EventType.BC_TRADE:
          await this.handleBCTrade(event);
          break;
        case EventType.TOKEN_CREATED:
          await this.handleTokenCreation(event);
          break;
        default:
          this.logger.debug('Unhandled event type', { type: event.type });
      }
    }

    this.updateMetrics('parsed_transaction', { eventCount: parsedEvents.length });
  }

  /**
   * Handle BC trade event
   */
  private async handleBCTrade(event: any): Promise<void> {
    // Calculate phase based on progress
    const progress = event.bondingCurveProgress || 0;
    let phase = 'EARLY';
    
    if (progress >= 90) {
      phase = 'NEAR_GRADUATION';
    } else if (progress >= 50) {
      phase = 'MATURE';
    } else if (progress >= 20) {
      phase = 'GROWING';
    }

    // Emit lifecycle event
    this.eventBus.emit(EVENTS.TOKEN_LIFECYCLE_UPDATE, {
      mintAddress: event.mintAddress,
      phase,
      progress,
      eventType: 'trade',
      tradeType: event.tradeType,
      solAmount: event.solAmount,
      tokenAmount: event.tokenAmount,
      virtualSolReserves: event.virtualSolReserves,
      virtualTokenReserves: event.virtualTokenReserves,
      signature: event.signature,
      slot: event.slot,
      blockTime: event.blockTime
    });

    // Check for milestones
    if (progress >= 25 && progress < 26) {
      this.emitMilestone(event.mintAddress, '25_PERCENT', progress);
    } else if (progress >= 50 && progress < 51) {
      this.emitMilestone(event.mintAddress, '50_PERCENT', progress);
    } else if (progress >= 75 && progress < 76) {
      this.emitMilestone(event.mintAddress, '75_PERCENT', progress);
    } else if (progress >= 90 && progress < 91) {
      this.emitMilestone(event.mintAddress, '90_PERCENT', progress);
    }
  }

  /**
   * Handle token creation event
   */
  private async handleTokenCreation(event: any): Promise<void> {
    this.logger.info('New token created', {
      mintAddress: event.mintAddress,
      creator: event.creator,
      bondingCurveKey: event.bondingCurveKey
    });

    // Track bonding curve mapping
    if (event.bondingCurveKey && event.mintAddress) {
      this.bondingCurveToMint.set(event.bondingCurveKey, event.mintAddress);
    }

    this.eventBus.emit(EVENTS.TOKEN_LIFECYCLE_CREATED, {
      mintAddress: event.mintAddress,
      creator: event.creator,
      bondingCurveKey: event.bondingCurveKey,
      initialReserves: event.virtualSolReserves,
      signature: event.signature,
      slot: event.slot,
      blockTime: event.blockTime
    });
  }

  /**
   * Emit milestone event
   */
  private emitMilestone(mintAddress: string, milestone: string, progress: number): void {
    this.logger.info(`Token reached ${milestone}`, { mintAddress, progress });
    
    this.eventBus.emit(EVENTS.TOKEN_MILESTONE_REACHED, {
      mintAddress,
      milestone,
      progress,
      timestamp: new Date()
    });
  }

  /**
   * Get subscription configuration with account monitoring
   */
  getSubscriptionConfig() {
    return {
      ...super.getSubscriptionConfig(),
      // Enable account monitoring for pump.fun program
      accounts: {
        owner: [PUMP_PROGRAM],
        // Optional: Add memcmp filter for completed bonding curves
        filters: []
      }
    };
  }
}