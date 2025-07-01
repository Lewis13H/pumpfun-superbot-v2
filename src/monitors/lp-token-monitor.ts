/**
 * LP Token Monitor
 * Monitors LP token accounts to track user positions
 */

import { PublicKey } from '@solana/web3.js';
import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import { BaseMonitor } from '../core/base-monitor';
import { Container, TOKENS } from '../core/container';
import { EVENTS } from '../core/event-bus';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import { TOKEN_PROGRAM_ID } from '../utils/constants';

interface LpTokenStats {
  accounts: number;
  positions: number;
  uniqueUsers: Set<string>;
  uniquePools: Set<string>;
  totalValueTracked: number;
  lastSlot: number;
}

interface TokenAccountData {
  address: string;
  mint: string;
  owner: string;
  amount: bigint;
  decimals: number;
}

export class LpTokenMonitor extends BaseMonitor {
  private lpStats: LpTokenStats;
  private poolStateService!: AmmPoolStateService;
  private lpMintAddresses: Set<string> = new Set();
  private lastMintRefresh: number = 0;
  private readonly MINT_REFRESH_INTERVAL = 60000; // Refresh LP mints every minute

  constructor(container: Container) {
    super(
      {
        programId: TOKEN_PROGRAM_ID.toBase58(),
        monitorName: 'LP Token Monitor',
        color: chalk.magenta as any
      },
      container
    );

    // Initialize stats
    this.lpStats = {
      accounts: 0,
      positions: 0,
      uniqueUsers: new Set<string>(),
      uniquePools: new Set<string>(),
      totalValueTracked: 0,
      lastSlot: 0
    };
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Get pool state service
    this.poolStateService = await this.container.resolve(TOKENS.PoolStateService);
    
    // Load initial LP mint addresses
    await this.refreshLpMintAddresses();
    
    this.logger.info('LP Token Monitor initialized', {
      trackedMints: this.lpMintAddresses.size
    });
  }

  /**
   * Refresh LP mint addresses from pool state service
   */
  private async refreshLpMintAddresses(): Promise<void> {
    try {
      const poolsMap = this.poolStateService.getAllPools();
      this.lpMintAddresses.clear();
      
      for (const [, pool] of poolsMap) {
        if (pool.account.lpMint) {
          this.lpMintAddresses.add(pool.account.lpMint);
        }
      }
      
      this.lastMintRefresh = Date.now();
      this.logger.debug('Refreshed LP mint addresses', {
        count: this.lpMintAddresses.size
      });
    } catch (error) {
      this.logger.error('Failed to refresh LP mint addresses', error as Error);
    }
  }

  /**
   * Get subscription key for LP token accounts
   */
  protected getSubscriptionKey(): string {
    return 'lp_token_accounts';
  }

  /**
   * Check if we should process this data
   */
  protected isRelevantTransaction(data: any): boolean {
    // This monitor only processes account updates
    return !!data.account;
  }

  /**
   * Build subscribe request for LP token accounts
   */
  protected buildSubscribeRequest(): any {
    // Refresh mints if needed
    if (Date.now() - this.lastMintRefresh > this.MINT_REFRESH_INTERVAL) {
      this.refreshLpMintAddresses().catch(err => 
        this.logger.error('Failed to refresh LP mints', err)
      );
    }

    // Build filters for LP token accounts
    const filters = Array.from(this.lpMintAddresses).map(mint => ({
      memcmp: {
        offset: 0, // Mint address is at offset 0 in token account
        bytes: mint
      }
    }));

    if (filters.length === 0) {
      // No LP mints to track yet - subscribe to a dummy account to keep connection alive
      // We'll refresh and resubscribe when LP mints are available
      return {
        accounts: {
          dummy: {
            owner: ['11111111111111111111111111111111'], // System program (won't match anything)
            filters: [{
              memcmp: {
                offset: 0,
                bytes: '11111111111111111111111111111111'
              }
            }]
          }
        },
        slots: {},
        transactions: {},
        transactionsStatus: {},
        entry: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        ping: undefined,
        commitment: CommitmentLevel.CONFIRMED,
      };
    }

    return {
      accounts: {
        lp_token_accounts: {
          owner: [TOKEN_PROGRAM_ID.toBase58()],
          filters,
          // Only get account data updates, not transactions
          nonemptyTxnSignature: false
        }
      },
      slots: {},
      transactions: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.CONFIRMED,
    };
  }

  /**
   * Process stream data (account updates)
   */
  async processStreamData(data: any): Promise<void> {
    try {
      if (!data.account) return;
      
      const accountInfo = data.account;
      const slot = accountInfo.slot || 0;
      
      if (slot > this.lpStats.lastSlot) {
        this.lpStats.lastSlot = slot;
      }
      
      // Parse token account data
      const tokenAccount = this.parseTokenAccount(accountInfo);
      if (!tokenAccount) return;
      
      // Check if this is an LP token
      if (!this.lpMintAddresses.has(tokenAccount.mint)) {
        return;
      }
      
      this.lpStats.accounts++;
      
      // Get pool info for this LP mint
      const poolState = this.poolStateService.getPoolByLpMint(tokenAccount.mint);
      if (!poolState) {
        this.logger.warn('Pool not found for LP mint', { mint: tokenAccount.mint });
        return;
      }
      
      // Track unique users and pools
      this.lpStats.uniqueUsers.add(tokenAccount.owner);
      this.lpStats.uniquePools.add(poolState.account.poolAddress);
      
      // Only process non-zero balances
      if (tokenAccount.amount > 0n) {
        this.lpStats.positions++;
        
        // Emit LP position update event
        this.eventBus.emit(EVENTS.LP_POSITION_UPDATED, {
          account: tokenAccount,
          poolAddress: poolState.account.poolAddress,
          mintAddress: poolState.reserves.mintAddress,
          slot
        });
        
        // Log significant positions
        const lpBalance = Number(tokenAccount.amount) / Math.pow(10, tokenAccount.decimals);
        if (lpBalance > 1000) { // Significant position
          this.logger.info('Significant LP position detected', {
            user: tokenAccount.owner.slice(0, 8) + '...',
            pool: poolState.account.poolAddress.slice(0, 8) + '...',
            mint: poolState.reserves.mintAddress.slice(0, 8) + '...',
            lpBalance: lpBalance.toFixed(2)
          });
        }
      }
      
    } catch (error) {
      this.stats.errors++;
      this.logger.error('Error processing LP token account', error as Error);
    }
  }

  /**
   * Parse token account data
   */
  private parseTokenAccount(accountInfo: any): TokenAccountData | null {
    try {
      const data = accountInfo.data;
      if (!data || data.length < 165) return null; // Token account is 165 bytes
      
      // Token account layout:
      // 0-32: mint
      // 32-64: owner
      // 64-72: amount (u64)
      // 72-73: delegate option
      // ... other fields
      
      const mint = new PublicKey(data.slice(0, 32)).toBase58();
      const owner = new PublicKey(data.slice(32, 64)).toBase58();
      const amount = BigInt('0x' + data.slice(64, 72).reverse().toString('hex'));
      
      // For simplicity, assume 6 decimals for LP tokens
      // In production, you'd query the mint for decimals
      const decimals = 6;
      
      return {
        address: accountInfo.pubkey,
        mint,
        owner,
        amount,
        decimals
      };
    } catch (error) {
      this.logger.debug('Failed to parse token account', { error });
      return null;
    }
  }

  /**
   * Display statistics
   */
  displayStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();

    this.logger.box('LP Token Monitor Statistics', {
      'Runtime': this.formatDuration(runtime),
      'Account Updates': this.formatNumber(this.lpStats.accounts),
      'Active Positions': this.formatNumber(this.lpStats.positions),
      'Unique Users': this.lpStats.uniqueUsers.size,
      'Unique Pools': this.lpStats.uniquePools.size,
      'Tracked LP Mints': this.lpMintAddresses.size,
      'Last Slot': this.lpStats.lastSlot,
      'Errors': this.formatNumber(this.stats.errors),
      'Reconnects': this.stats.reconnections
    });
  }

  /**
   * Should log error
   */
  shouldLogError(error: any): boolean {
    const message = error?.message || '';
    return !message.includes('ComputeBudget') && process.env.DEBUG_LP === 'true';
  }

  /**
   * Shutdown handler
   */
  async onShutdown(): Promise<void> {
    this.logger.info('LP token monitor shutdown complete', {
      totalAccounts: this.lpStats.accounts,
      activePositions: this.lpStats.positions,
      uniqueUsers: this.lpStats.uniqueUsers.size
    });
  }
}