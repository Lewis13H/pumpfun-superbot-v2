/**
 * Refactored Bonding Curve Account Monitor
 * Monitors account state changes to detect graduations
 */

import chalk from 'chalk';
import bs58 from 'bs58';
import * as borsh from '@coral-xyz/borsh';
// import { PublicKey } from '@solana/web3.js';
import { BaseMonitor } from '../core/base-monitor';
import { Container, TOKENS } from '../core/container';
import { PUMP_PROGRAM } from '../utils/config/constants';
import { EVENTS } from '../core/event-bus';
// Removed unused imports TokenRepository and GraduationHandler

interface BCAccountStats {
  accountUpdates: number;
  graduations: number;
  nearGraduations: number;
  parseErrors: number;
}

// Bonding curve account schema (matching IDL structure)
const BONDING_CURVE_SCHEMA = borsh.struct([
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete'),
  borsh.publicKey('creator'),
]);

// Expected discriminator for BondingCurve accounts
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];

export class BCAccountMonitor extends BaseMonitor {
  private bcAccountStats: BCAccountStats;

  constructor(container: Container) {
    super(
      {
        programId: PUMP_PROGRAM,
        monitorName: 'BC Account Monitor',
        color: chalk.cyan as any
      },
      container
    );

    // Initialize stats
    this.bcAccountStats = {
      accountUpdates: 0,
      graduations: 0,
      nearGraduations: 0,
      parseErrors: 0
    };
  }
  
  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Get services from container (kept for future use)
    await this.container.resolve(TOKENS.TokenRepository);
    await this.container.resolve(TOKENS.GraduationHandler);
  }
  

  /**
   * Get subscription key for BC account monitor
   */
  protected getSubscriptionKey(): string {
    return 'pumpfun_accounts';
  }

  /**
   * Build enhanced subscribe request for account updates
   */
  protected buildEnhancedSubscribeRequest(): any {
    const builder = this.subscriptionBuilder;
    
    // Set commitment level
    builder.setCommitment('confirmed');
    
    // Add account subscription for bonding curve accounts
    builder.addAccountSubscription(this.getSubscriptionKey(), {
      owner: [this.options.programId],
      filters: [], // Could add filters for specific accounts
      nonemptyTxnSignature: true
    });
    
    // Also add transaction subscription to catch graduations
    builder.addTransactionSubscription('pumpfun', {
      vote: false,
      failed: false,
      accountInclude: [this.options.programId],
      accountRequired: [],
      accountExclude: []
    });
    
    const config = builder.build();
    this.logger.debug('Built BC account monitor subscription', { config });
    
    return config;
  }

  /**
   * Process account update
   */
  async processStreamData(data: any): Promise<void> {
    try {
      
      // Count all stream data
      this.stats.transactions++;
      
      // Skip ping/pong
      if (data.ping || data.pong) {
        return;
      }
      
      // Extract account info
      const accountInfo = data.account?.account;
      if (!accountInfo) {
        return;
      }

      // The pubkey is in account.account.pubkey
      const accountKey = accountInfo.pubkey;
      if (!accountKey) {
        return;
      }

      // Decode account data
      const accountData = Buffer.from(accountInfo.data, 'base64');
      
      // Check if this is a BondingCurve account by discriminator
      if (accountData.length < 8) {
        return;
      }
      
      const discriminator = Array.from(accountData.slice(0, 8));
      if (JSON.stringify(discriminator) !== JSON.stringify(BONDING_CURVE_DISCRIMINATOR)) {
        // Not a bonding curve account
        return;
      }
      
      try {
        // Skip discriminator (8 bytes) and decode the rest
        const bondingCurveData = accountData.slice(8);
        const bondingCurve = BONDING_CURVE_SCHEMA.decode(bondingCurveData);
        
        if (bondingCurve) {
          this.bcAccountStats.accountUpdates++;
          
          // Extract account pubkey
          const accountPubkey = typeof accountKey === 'string' 
            ? accountKey 
            : bs58.encode(accountKey);
          
          // Calculate progress
          const virtualSolReserves = Number(bondingCurve.virtualSolReserves) / 1e9;
          const progress = ((virtualSolReserves - 30) / 55) * 100; // 30 to 85 SOL = 100%
          
          // Check for graduation
          if (bondingCurve.complete || progress >= 100) {
            this.bcAccountStats.graduations++;
            
            this.logger.warn('🎓 Token Graduated!', {
              bondingCurve: accountPubkey,
              progress: progress.toFixed(2) + '%',
              complete: bondingCurve.complete,
              virtualSOL: virtualSolReserves.toFixed(2) + ' SOL',
              virtualTokenReserves: Number(bondingCurve.virtualTokenReserves) / 1e6,
              creator: bondingCurve.creator.toString()
            });
            
            // Emit graduation event - the GraduationHandler will handle finding the mint
            this.eventBus.emit(EVENTS.TOKEN_GRADUATED, {
              bondingCurveKey: accountPubkey,
              virtualSolReserves: bondingCurve.virtualSolReserves.toString(),
              virtualTokenReserves: bondingCurve.virtualTokenReserves.toString(),
              complete: bondingCurve.complete,
              slot: data.slot,
              creator: bondingCurve.creator.toString()
            });
          } else if (progress > 90) {
            this.bcAccountStats.nearGraduations++;
            
            this.logger.info('Near graduation', {
              account: accountPubkey,
              progress: progress.toFixed(2) + '%',
              virtualSOL: virtualSolReserves.toFixed(2) + ' SOL'
            });
          }
        }
      } catch (decodeError) {
        // Decode failed
        this.bcAccountStats.parseErrors++;
      }
    } catch (error) {
      this.bcAccountStats.parseErrors++;
      if (this.shouldLogError(error)) {
        this.logger.error('Failed to process account update', error as Error);
      }
    }
  }

  /**
   * Display statistics
   */
  displayStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();
    const updateRate = this.calculateRate(this.bcAccountStats.accountUpdates, this.stats.startTime);
    const graduationRate = this.calculateRate(this.bcAccountStats.graduations, this.stats.startTime);

    this.logger.box('BC Account Monitor Statistics', {
      'Runtime': this.formatDuration(runtime),
      'Account Updates': `${this.formatNumber(this.bcAccountStats.accountUpdates)} (${updateRate.toFixed(1)}/min)`,
      'Graduations': `${this.formatNumber(this.bcAccountStats.graduations)} (${graduationRate.toFixed(1)}/min)`,
      'Near Graduations': this.formatNumber(this.bcAccountStats.nearGraduations),
      'Parse Errors': this.formatNumber(this.bcAccountStats.parseErrors),
      'Errors': this.formatNumber(this.stats.errors),
      'Reconnects': this.stats.reconnections
    });
  }

  /**
   * Should log error
   */
  shouldLogError(error: any): boolean {
    const message = error?.message || '';
    
    // Don't log decode errors (many accounts aren't bonding curves)
    if (message.includes('decode') || message.includes('parse')) {
      return false;
    }
    
    return true;
  }

  /**
   * Shutdown handler
   */
  async onShutdown(): Promise<void> {
    this.logger.info('Account monitor shutdown complete', {
      totalUpdates: this.bcAccountStats.accountUpdates,
      totalGraduations: this.bcAccountStats.graduations
    });
  }
}