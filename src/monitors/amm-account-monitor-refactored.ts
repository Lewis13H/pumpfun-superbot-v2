/**
 * Refactored AMM Account Monitor
 * Monitors AMM pool account states for reserve changes
 */

import chalk from 'chalk';
import bs58 from 'bs58';
import * as borsh from '@coral-xyz/borsh';
import { PublicKey } from '@solana/web3.js';
import { BaseMonitor } from '../core/base-monitor';
import { Container, TOKENS } from '../core/container';
import { AMM_PROGRAM } from '../utils/constants';
import { EVENTS } from '../core/event-bus';

interface AMMAccountStats {
  accountUpdates: number;
  poolUpdates: number;
  parseErrors: number;
  poolsTracked: Set<string>;
}

// Pool account layout for Borsh deserialization
const POOL_LAYOUT = borsh.struct([
  borsh.u8('poolBump'),
  borsh.u16('index'),
  borsh.publicKey('creator'),
  borsh.publicKey('baseMint'),
  borsh.publicKey('quoteMint'),
  borsh.publicKey('lpMint'),
  borsh.publicKey('poolBaseTokenAccount'),
  borsh.publicKey('poolQuoteTokenAccount'),
  borsh.u64('lpSupply'),
  borsh.publicKey('coinCreator'),
]);

export class AMMAccountMonitorRefactored extends BaseMonitor {
  private ammAccountStats: AMMAccountStats;
  private poolStateService: any;

  constructor(container: Container) {
    super(
      {
        programId: AMM_PROGRAM,
        monitorName: 'AMM Account Monitor',
        color: chalk.blue as any
      },
      container
    );

    // Initialize stats
    this.ammAccountStats = {
      accountUpdates: 0,
      poolUpdates: 0,
      parseErrors: 0,
      poolsTracked: new Set()
    };
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Get pool state service if available
    try {
      this.poolStateService = await this.container.resolve(TOKENS.PoolStateService);
    } catch {
      // Pool state service is optional
      this.logger.warn('Pool state service not available');
    }
  }

  /**
   * Build subscribe request for account updates
   */
  protected buildSubscribeRequest(): any {
    return {
      accounts: {
        client: {
          account: [],
          owner: [this.options.programId],
          filters: []
        }
      },
      commitment: 'confirmed'
    };
  }

  /**
   * Process account update
   */
  async processStreamData(data: any): Promise<void> {
    try {
      // Extract account info
      const accountInfo = data.account?.account;
      if (!accountInfo) {
        return;
      }

      const accountKey = data.account?.pubkey;
      if (!accountKey) {
        return;
      }

      // Decode account data
      const accountData = Buffer.from(accountInfo.data, 'base64');
      
      try {
        // Skip discriminator (8 bytes) and decode the rest
        const poolData = accountData.slice(8);
        const pool = POOL_LAYOUT.decode(poolData);
        
        if (pool) {
          this.ammAccountStats.accountUpdates++;
          
          const poolAddress = typeof accountKey === 'string' 
            ? accountKey 
            : bs58.encode(accountKey);
          
          // Track this pool
          this.ammAccountStats.poolsTracked.add(poolAddress);
          this.ammAccountStats.poolUpdates++;
          
          // Extract pool state with proper conversions
          const poolState = {
            poolAddress,
            poolBump: pool.poolBump,
            index: pool.index,
            creator: pool.creator.toBase58(),
            baseMint: pool.baseMint.toBase58(),
            quoteMint: pool.quoteMint.toBase58(),
            lpMint: pool.lpMint.toBase58(),
            poolBaseTokenAccount: pool.poolBaseTokenAccount.toBase58(),
            poolQuoteTokenAccount: pool.poolQuoteTokenAccount.toBase58(),
            lpSupply: pool.lpSupply.toString(),
            coinCreator: pool.coinCreator.toBase58(),
            slot: data.slot
          };
          
          // Determine which mint is SOL and which is the token
          const isBaseSol = poolState.baseMint === 'So11111111111111111111111111111111111111112';
          const tokenMint = isBaseSol ? poolState.quoteMint : poolState.baseMint;
          
          // Log significant updates
          this.logger.info('AMM pool state updated', {
            pool: poolAddress.substring(0, 8) + '...',
            tokenMint: tokenMint.substring(0, 8) + '...',
            lpSupply: Number(poolState.lpSupply).toLocaleString()
          });
          
          // Update pool state service if available
          if (this.poolStateService) {
            await this.poolStateService.updatePoolState({
              poolAddress,
              poolBump: poolState.poolBump,
              index: poolState.index,
              creator: poolState.creator,
              baseMint: poolState.baseMint,
              quoteMint: poolState.quoteMint,
              lpMint: poolState.lpMint,
              poolBaseTokenAccount: poolState.poolBaseTokenAccount,
              poolQuoteTokenAccount: poolState.poolQuoteTokenAccount,
              lpSupply: Number(poolState.lpSupply),
              coinCreator: poolState.coinCreator,
              slot: data.slot
            });
          }
          
          // Emit pool state update event
          this.eventBus.emit(EVENTS.POOL_STATE_UPDATED, {
            poolAddress,
            mintAddress: tokenMint,
            poolState,
            slot: data.slot
          });
        }
      } catch (decodeError) {
        // Not a pool account or decode failed
        this.ammAccountStats.parseErrors++;
        if (this.ammAccountStats.parseErrors <= 5) {
          this.logger.debug('Failed to decode account', { error: decodeError.message });
        }
      }
    } catch (error) {
      this.ammAccountStats.parseErrors++;
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
    const updateRate = this.calculateRate(this.ammAccountStats.accountUpdates, this.stats.startTime);
    const poolRate = this.calculateRate(this.ammAccountStats.poolUpdates, this.stats.startTime);

    this.logger.box('AMM Account Monitor Statistics', {
      'Runtime': this.formatDuration(runtime),
      'Account Updates': `${this.formatNumber(this.ammAccountStats.accountUpdates)} (${updateRate.toFixed(1)}/min)`,
      'Pool Updates': `${this.formatNumber(this.ammAccountStats.poolUpdates)} (${poolRate.toFixed(1)}/min)`,
      'Unique Pools': this.formatNumber(this.ammAccountStats.poolsTracked.size),
      'Parse Errors': this.formatNumber(this.ammAccountStats.parseErrors),
      'Errors': this.formatNumber(this.stats.errors),
      'Reconnects': this.stats.reconnections
    });
  }

  /**
   * Should log error
   */
  shouldLogError(error: any): boolean {
    const message = error?.message || '';
    
    // Don't log decode errors (many accounts aren't pools)
    if (message.includes('decode') || message.includes('parse')) {
      return false;
    }
    
    return true;
  }

  /**
   * Shutdown handler
   */
  async onShutdown(): Promise<void> {
    this.logger.info('AMM account monitor shutdown complete', {
      totalUpdates: this.ammAccountStats.accountUpdates,
      poolsTracked: this.ammAccountStats.poolsTracked.size
    });
  }
}