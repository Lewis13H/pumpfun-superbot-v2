/**
 * AMM Account Monitor Wrapper
 * Wraps the legacy AMM account monitor to work with the refactored architecture
 */

import { PublicKey } from '@solana/web3.js';
import { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import chalk from 'chalk';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { BaseMonitor } from '../core/base-monitor';
import { Container, TOKENS } from '../core/container';
import { EVENTS } from '../core/event-bus';
import { decodePoolAccount, poolAccountToPlain } from '../utils/amm-pool-decoder';
import { AmmPoolStateService } from '../services/amm-pool-state-service';
import * as borsh from '@coral-xyz/borsh';

// Constants
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Token account layout for SPL tokens
const TOKEN_ACCOUNT_LAYOUT = borsh.struct([
  borsh.publicKey('mint'),
  borsh.publicKey('owner'),
  borsh.u64('amount'),
  borsh.u32('delegateOption'),
  borsh.publicKey('delegate'),
  borsh.u8('state'),
  borsh.u32('isNativeOption'),
  borsh.u64('isNative'),
  borsh.u64('delegatedAmount'),
  borsh.u32('closeAuthorityOption'),
  borsh.publicKey('closeAuthority'),
]);

interface AMMAccountMonitorStats {
  accountUpdates: number;
  poolsTracked: Set<string>;
  tokenAccountsTracked: Set<string>;
  decodedPools: number;
  decodedTokenAccounts: number;
  decodeErrors: number;
  reserveUpdates: number;
}

export class AMMAccountMonitorWrapper extends BaseMonitor {
  private ammStats: AMMAccountMonitorStats;
  private poolStateService!: AmmPoolStateService;
  
  // Track relationships
  private tokenAccountToPool = new Map<string, {
    poolAddress: string;
    mintAddress: string;
    isBase: boolean;
  }>();
  
  private knownPools = new Map<string, {
    baseMint: string;
    quoteMint: string;
    baseVault: string;
    quoteVault: string;
  }>();

  constructor(container: Container) {
    super(
      {
        programId: PUMP_AMM_PROGRAM_ID.toBase58(),
        monitorName: 'AMM Account Monitor',
        color: chalk.magenta as any
      },
      container
    );

    // Initialize stats
    this.ammStats = {
      accountUpdates: 0,
      poolsTracked: new Set<string>(),
      tokenAccountsTracked: new Set<string>(),
      decodedPools: 0,
      decodedTokenAccounts: 0,
      decodeErrors: 0,
      reserveUpdates: 0
    };
  }

  /**
   * Initialize services
   */
  protected async initializeServices(): Promise<void> {
    await super.initializeServices();
    
    // Get pool state service
    this.poolStateService = await this.container.resolve(TOKENS.PoolStateService);
    
    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for pool creations from AMM trade monitor
    this.eventBus.on(EVENTS.POOL_CREATED, (data) => {
      this.logger.info('New pool detected', {
        pool: data.poolAddress,
        mint: data.mintAddress
      });
    });
  }

  /**
   * Build subscribe request for AMM accounts
   */
  protected buildSubscribeRequest(): SubscribeRequest {
    return {
      slots: {},
      accounts: {
        pumpswap_amm: {
          account: [],
          filters: [],
          owner: [PUMP_AMM_PROGRAM_ID.toBase58()],
        },
      },
      transactions: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.PROCESSED,
    };
  }

  /**
   * Convert base64 to base58
   */
  private convertBase64ToBase58(base64String: string): string {
    const buffer = Buffer.from(base64String, 'base64');
    return bs58.encode(buffer);
  }

  /**
   * Decode token account data
   */
  private decodeTokenAccount(data: Buffer): { mint: string; owner: string; amount: bigint } | null {
    try {
      if (data.length < 165) return null;
      
      const decoded = TOKEN_ACCOUNT_LAYOUT.decode(data);
      
      return {
        mint: decoded.mint.toBase58(),
        owner: decoded.owner.toBase58(),
        amount: decoded.amount,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Subscribe to token accounts for a pool
   */
  private async subscribeToTokenAccounts(
    poolAddress: string, 
    baseVault: string, 
    quoteVault: string, 
    baseMint: string, 
    quoteMint: string
  ): Promise<void> {
    // Track the relationship
    this.tokenAccountToPool.set(baseVault, {
      poolAddress,
      mintAddress: quoteMint,
      isBase: true,
    });
    
    this.tokenAccountToPool.set(quoteVault, {
      poolAddress,
      mintAddress: quoteMint,
      isBase: false,
    });
    
    this.knownPools.set(poolAddress, {
      baseMint,
      quoteMint,
      baseVault,
      quoteVault,
    });
    
    this.logger.info('Subscribing to vault accounts', {
      pool: poolAddress.slice(0, 8) + '...',
      baseVault: baseVault.slice(0, 8) + '...',
      quoteVault: quoteVault.slice(0, 8) + '...'
    });
    
    // Create a new subscription for these specific token accounts
    const tokenAccountReq: SubscribeRequest = {
      slots: {},
      accounts: {
        [`vault_${poolAddress}`]: {
          account: [baseVault, quoteVault],
          filters: [],
          owner: [],
        },
      },
      transactions: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.PROCESSED,
    };
    
    // Add to existing subscription
    const stream = await this.streamClient.getClient().subscribe();
    
    stream.on("data", async (data) => {
      if (data?.account) {
        await this.processTokenAccountUpdate(data);
      }
    });
    
    // Send subscription
    await new Promise<void>((resolve, reject) => {
      stream.write(tokenAccountReq, (err: any) => {
        if (err === null || err === undefined) {
          this.ammStats.tokenAccountsTracked.add(baseVault);
          this.ammStats.tokenAccountsTracked.add(quoteVault);
          resolve();
        } else {
          this.logger.error('Failed to subscribe to token accounts', err);
          reject(err);
        }
      });
    });
  }

  /**
   * Process token account update
   */
  private async processTokenAccountUpdate(data: any): Promise<void> {
    try {
      if (!data.account || !data.account.account) return;
      
      const accountInfo = data.account.account;
      const accountPubkey = this.convertBase64ToBase58(accountInfo.pubkey);
      
      // Check if this is a token account we're tracking
      const poolInfo = this.tokenAccountToPool.get(accountPubkey);
      if (!poolInfo) return;
      
      // Decode token account
      const accountData = Buffer.from(accountInfo.data, 'base64');
      const tokenAccount = this.decodeTokenAccount(accountData);
      
      if (!tokenAccount) {
        this.logger.error('Failed to decode token account', {
          account: accountPubkey
        });
        return;
      }
      
      this.ammStats.decodedTokenAccounts++;
      
      // Get pool info
      const pool = this.knownPools.get(poolInfo.poolAddress);
      if (!pool) return;
      
      // Log the update
      this.logger.debug('Token account updated', {
        account: accountPubkey.slice(0, 8) + '...',
        pool: poolInfo.poolAddress.slice(0, 8) + '...',
        type: poolInfo.isBase ? 'Base (SOL)' : 'Quote (Token)',
        amount: tokenAccount.amount.toString(),
        mint: tokenAccount.mint
      });
      
      // Update reserves in pool state service
      if (poolInfo.isBase) {
        // This is the SOL vault
        await this.poolStateService.updatePoolReserves(
          poolInfo.mintAddress,
          Number(tokenAccount.amount),
          0,
          data.slot || 0
        );
      } else {
        // This is the token vault - get the SOL reserves too
        const poolState = this.poolStateService.getPoolState(poolInfo.mintAddress);
        if (poolState && poolState.reserves.virtualSolReserves > 0) {
          await this.poolStateService.updatePoolReserves(
            poolInfo.mintAddress,
            poolState.reserves.virtualSolReserves,
            Number(tokenAccount.amount),
            data.slot || 0
          );
          
          this.ammStats.reserveUpdates++;
          
          // Emit pool state update event
          this.eventBus.emit(EVENTS.POOL_STATE_UPDATED, {
            poolAddress: poolInfo.poolAddress,
            mintAddress: poolInfo.mintAddress,
            baseReserves: poolState.reserves.virtualSolReserves,
            quoteReserves: Number(tokenAccount.amount),
            slot: data.slot || 0
          });
          
          this.logger.info('Pool reserves updated', {
            mint: poolInfo.mintAddress.slice(0, 8) + '...',
            sol: (poolState.reserves.virtualSolReserves / 1e9).toFixed(4),
            tokens: (Number(tokenAccount.amount) / 1e6).toLocaleString()
          });
        }
      }
      
    } catch (error) {
      this.logger.error('Error processing token account update', error as Error);
    }
  }

  /**
   * Process stream data
   */
  async processStreamData(data: any): Promise<void> {
    try {
      this.ammStats.accountUpdates++;
      
      if (!data.account || !data.account.account) return;
      
      const accountInfo = data.account.account;
      const accountPubkey = this.convertBase64ToBase58(accountInfo.pubkey);
      
      // Check if it's a token account we're tracking
      if (this.tokenAccountToPool.has(accountPubkey)) {
        await this.processTokenAccountUpdate(data);
        return;
      }
      
      // Otherwise, check if it's a pool account
      const owner = accountInfo.owner ? this.convertBase64ToBase58(accountInfo.owner) : '';
      if (owner !== PUMP_AMM_PROGRAM_ID.toBase58()) return;
      
      // Decode account data
      const accountData = Buffer.from(accountInfo.data, 'base64');
      
      try {
        // Decode pool account
        const decodedPool = decodePoolAccount(accountData);
        
        if (!decodedPool) {
          this.ammStats.decodeErrors++;
          return;
        }
        
        this.ammStats.decodedPools++;
        this.ammStats.poolsTracked.add(accountPubkey);
        
        // Convert to plain object
        const plainPool = poolAccountToPlain(decodedPool);
        
        // Extract pool data
        const poolData = {
          poolAddress: accountPubkey,
          poolBump: plainPool.poolBump,
          index: plainPool.index,
          creator: plainPool.creator,
          baseMint: plainPool.baseMint,
          quoteMint: plainPool.quoteMint,
          lpMint: plainPool.lpMint,
          poolBaseTokenAccount: plainPool.poolBaseTokenAccount,
          poolQuoteTokenAccount: plainPool.poolQuoteTokenAccount,
          lpSupply: Number(plainPool.lpSupply),
          coinCreator: plainPool.coinCreator,
          slot: data.slot || 0,
        };
        
        // Store pool state
        await this.poolStateService.updatePoolState(poolData);
        
        // Emit pool created event if this is a new pool
        if (!this.knownPools.has(accountPubkey)) {
          this.eventBus.emit(EVENTS.POOL_CREATED, {
            poolAddress: accountPubkey,
            mintAddress: poolData.quoteMint,
            baseMint: poolData.baseMint,
            quoteMint: poolData.quoteMint,
            lpMint: poolData.lpMint,
            slot: data.slot || 0
          });
        }
        
        // Subscribe to token accounts if we haven't already
        if (!this.tokenAccountToPool.has(poolData.poolBaseTokenAccount)) {
          await this.subscribeToTokenAccounts(
            accountPubkey,
            poolData.poolBaseTokenAccount,
            poolData.poolQuoteTokenAccount,
            poolData.baseMint,
            poolData.quoteMint
          );
        }
        
        this.logger.info('Pool state updated', {
          mint: poolData.quoteMint,
          pool: accountPubkey,
          lpSupply: poolData.lpSupply.toLocaleString()
        });
        
      } catch (decodeError) {
        this.ammStats.decodeErrors++;
        if (process.env.DEBUG_PARSE_ERRORS === 'true') {
          this.logger.error('Failed to decode account', {
            account: accountPubkey,
            error: decodeError
          });
        }
      }
      
    } catch (error) {
      this.logger.error('Error processing account update', error as Error);
    }
  }

  /**
   * Display statistics
   */
  displayStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();
    const rate = this.ammStats.accountUpdates / (runtime / 1000);

    this.logger.box('AMM Account Monitor Statistics', {
      'Runtime': this.formatDuration(runtime),
      'Account Updates': `${this.formatNumber(this.ammStats.accountUpdates)} (${rate.toFixed(2)}/sec)`,
      'Pools Tracked': this.ammStats.poolsTracked.size,
      'Token Accounts': this.ammStats.tokenAccountsTracked.size,
      'Decoded Pools': this.formatNumber(this.ammStats.decodedPools),
      'Decoded Token Accounts': this.formatNumber(this.ammStats.decodedTokenAccounts),
      'Reserve Updates': this.formatNumber(this.ammStats.reserveUpdates),
      'Decode Errors': this.formatNumber(this.ammStats.decodeErrors),
      'Errors': this.formatNumber(this.stats.errors),
      'Reconnects': this.stats.reconnections
    });
  }

  /**
   * Should log error
   */
  shouldLogError(error: any): boolean {
    const message = error?.message || '';
    // Don't log decode errors unless debug is enabled
    if (message.includes('decode') && process.env.DEBUG_PARSE_ERRORS !== 'true') {
      return false;
    }
    return true;
  }

  /**
   * Shutdown handler
   */
  async onShutdown(): Promise<void> {
    this.logger.info('AMM account monitor shutdown complete', {
      poolsTracked: this.ammStats.poolsTracked.size,
      tokenAccountsTracked: this.ammStats.tokenAccountsTracked.size,
      reserveUpdates: this.ammStats.reserveUpdates
    });
  }
}