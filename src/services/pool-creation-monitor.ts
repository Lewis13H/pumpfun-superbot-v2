/**
 * Pool Creation Monitor
 * Monitors and detects new pool creation events
 */

import { Logger } from '../core/logger';
import { EventBus, EVENTS } from '../core/event-bus';
import { IDLParserService } from './idl-parser-service';
import { EventParserService } from './event-parser-service';
import { PUMP_AMM_PROGRAM } from '../utils/constants';
import bs58 from 'bs58';

export interface PoolCreationEvent {
  poolAddress: string;
  mintAddress: string;
  lpMintAddress: string;
  creator: string;
  transactionSignature: string;
  slot: bigint;
  blockTime: number;
  initialReserves: {
    sol: bigint;
    token: bigint;
  };
  poolType: 'pump_amm' | 'raydium' | 'orca';
}

export class PoolCreationMonitor {
  private static instance: PoolCreationMonitor;
  private logger: Logger;
  private eventBus: EventBus;
  private idlParser: IDLParserService;
  private eventParser: EventParserService;
  private detectedPools: Set<string> = new Set();
  private poolsByMint: Map<string, PoolCreationEvent[]> = new Map();

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'PoolCreationMonitor' });
    this.eventBus = eventBus;
    this.idlParser = IDLParserService.getInstance();
    this.eventParser = EventParserService.getInstance();
  }

  static getInstance(eventBus: EventBus): PoolCreationMonitor {
    if (!PoolCreationMonitor.instance) {
      PoolCreationMonitor.instance = new PoolCreationMonitor(eventBus);
    }
    return PoolCreationMonitor.instance;
  }

  /**
   * Detect pool creation from transaction
   */
  async detectPoolCreation(transaction: any): Promise<PoolCreationEvent | null> {
    try {
      // Try multiple detection methods
      const methods = [
        () => this.detectFromEvents(transaction),
        () => this.detectFromInstructions(transaction),
        () => this.detectFromLogs(transaction),
        () => this.detectFromAccounts(transaction)
      ];

      for (const method of methods) {
        const pool = await method();
        if (pool) {
          return pool;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Error detecting pool creation', error as Error);
      return null;
    }
  }

  /**
   * Detect pool creation from events
   */
  private detectFromEvents(tx: any): PoolCreationEvent | null {
    try {
      // Format transaction for event parsing
      const formattedTx = this.formatTransaction(tx);
      if (!formattedTx) return null;

      // Parse events
      const events = this.eventParser.parseTransaction(formattedTx);
      
      // Look for pool creation event
      const poolEvent = this.eventParser.extractPoolCreatedEvent(events);
      if (poolEvent && !this.detectedPools.has(poolEvent.pool)) {
        this.detectedPools.add(poolEvent.pool);

        const signature = this.extractSignature(tx);
        const poolCreation: PoolCreationEvent = {
          poolAddress: poolEvent.pool,
          mintAddress: poolEvent.mint,
          lpMintAddress: '', // Would need to extract from accounts
          creator: poolEvent.creator,
          transactionSignature: signature,
          slot: BigInt(tx.slot || 0),
          blockTime: tx.blockTime || Math.floor(Date.now() / 1000),
          initialReserves: {
            sol: BigInt(poolEvent.baseReserves || 0),
            token: BigInt(poolEvent.quoteReserves || 0)
          },
          poolType: this.determinePoolType(tx)
        };

        this.storePoolCreation(poolCreation);
        this.logger.info('Pool creation detected from events', {
          pool: poolEvent.pool,
          mint: poolEvent.mint
        });

        return poolCreation;
      }

      return null;
    } catch (error) {
      this.logger.debug('Error in detectFromEvents', { error });
      return null;
    }
  }

  /**
   * Detect pool creation from instructions
   */
  private detectFromInstructions(tx: any): PoolCreationEvent | null {
    try {
      const message = tx.transaction?.transaction?.message || 
                      tx.transaction?.message || 
                      tx.message;
      
      if (!message) return null;

      // Parse instructions
      const instructions = this.idlParser.parseInstructions(
        message,
        tx.transaction?.meta?.loadedAddresses || tx.meta?.loadedAddresses
      );

      // Look for pool creation instructions
      for (const ix of instructions) {
        if (ix.name === 'createPool' || 
            ix.name === 'initializePool' || 
            ix.name === 'create_pool') {
          
          // Extract pool account
          const poolAccount = ix.accounts.find(a => 
            a.name === 'pool' || a.name === 'poolAccount' || a.name === 'ammPool'
          );

          if (poolAccount) {
            const poolAddress = poolAccount.pubkey.toBase58();
            
            if (!this.detectedPools.has(poolAddress)) {
              this.detectedPools.add(poolAddress);

              // Extract other accounts
              const mintAccount = ix.accounts.find(a => 
                a.name === 'mint' || a.name === 'tokenMint' || a.name === 'baseMint'
              );
              const lpMintAccount = ix.accounts.find(a => 
                a.name === 'lpMint' || a.name === 'poolMint'
              );
              const userAccount = ix.accounts.find(a => 
                a.name === 'user' || a.name === 'payer' || a.name === 'creator'
              );

              const signature = this.extractSignature(tx);
              const poolCreation: PoolCreationEvent = {
                poolAddress,
                mintAddress: mintAccount?.pubkey.toBase58() || '',
                lpMintAddress: lpMintAccount?.pubkey.toBase58() || '',
                creator: userAccount?.pubkey.toBase58() || '',
                transactionSignature: signature,
                slot: BigInt(tx.slot || 0),
                blockTime: tx.blockTime || Math.floor(Date.now() / 1000),
                initialReserves: this.extractInitialReserves(ix, tx),
                poolType: this.determinePoolType(tx)
              };

              this.storePoolCreation(poolCreation);
              this.logger.info('Pool creation detected from instruction', {
                pool: poolAddress,
                mint: poolCreation.mintAddress,
                instruction: ix.name
              });

              return poolCreation;
            }
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.debug('Error in detectFromInstructions', { error });
      return null;
    }
  }

  /**
   * Detect pool creation from logs
   */
  private detectFromLogs(tx: any): PoolCreationEvent | null {
    try {
      const logs = tx.transaction?.meta?.logMessages || 
                   tx.meta?.logMessages || 
                   [];

      for (const log of logs) {
        // Look for pool creation patterns
        if (log.includes('Pool created') || 
            log.includes('Initialize pool') ||
            log.includes('Created AMM pool') ||
            log.includes('create_pool')) {
          
          // Try to extract addresses from log
          const addresses = this.extractAddressesFromLog(log);
          if (addresses.length >= 2) {
            const poolAddress = addresses[0];
            
            if (!this.detectedPools.has(poolAddress)) {
              this.detectedPools.add(poolAddress);

              const signature = this.extractSignature(tx);
              const accounts = this.extractAccounts(tx);
              
              const poolCreation: PoolCreationEvent = {
                poolAddress,
                mintAddress: addresses[1] || '',
                lpMintAddress: addresses[2] || '',
                creator: accounts[0] || '',
                transactionSignature: signature,
                slot: BigInt(tx.slot || 0),
                blockTime: tx.blockTime || Math.floor(Date.now() / 1000),
                initialReserves: { sol: BigInt(0), token: BigInt(0) },
                poolType: this.determinePoolType(tx)
              };

              this.storePoolCreation(poolCreation);
              this.logger.info('Pool creation detected from logs', {
                pool: poolAddress,
                log
              });

              return poolCreation;
            }
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.debug('Error in detectFromLogs', { error });
      return null;
    }
  }

  /**
   * Detect pool creation from account changes
   */
  private detectFromAccounts(tx: any): PoolCreationEvent | null {
    try {
      const meta = tx.transaction?.meta || tx.meta;
      if (!meta || !meta.postTokenBalances) return null;

      // Look for new LP mint creation
      for (const postBalance of meta.postTokenBalances) {
        if (!postBalance.mint) continue;

        // Check if this is a new LP mint (didn't exist before)
        const isNewLpMint = !meta.preTokenBalances?.some(
          (pre: any) => pre.mint === postBalance.mint
        );

        if (isNewLpMint && postBalance.owner) {
          // This might be a new pool LP token
          const lpMint = postBalance.mint;
          
          // Try to find the pool account from inner instructions
          const poolAccount = this.findPoolAccountFromInnerInstructions(meta);
          
          if (poolAccount && !this.detectedPools.has(poolAccount)) {
            this.detectedPools.add(poolAccount);

            const signature = this.extractSignature(tx);
            const accounts = this.extractAccounts(tx);
            
            const poolCreation: PoolCreationEvent = {
              poolAddress: poolAccount,
              mintAddress: '', // Would need more analysis
              lpMintAddress: lpMint,
              creator: accounts[0] || '',
              transactionSignature: signature,
              slot: BigInt(tx.slot || 0),
              blockTime: tx.blockTime || Math.floor(Date.now() / 1000),
              initialReserves: { sol: BigInt(0), token: BigInt(0) },
              poolType: this.determinePoolType(tx)
            };

            this.storePoolCreation(poolCreation);
            this.logger.info('Pool creation detected from accounts', {
              pool: poolAccount,
              lpMint
            });

            return poolCreation;
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.debug('Error in detectFromAccounts', { error });
      return null;
    }
  }

  /**
   * Format transaction for event parsing
   */
  private formatTransaction(tx: any): any {
    try {
      // Create a properly formatted transaction for event parser
      return {
        meta: tx.transaction?.meta || tx.meta,
        transaction: {
          message: tx.transaction?.transaction?.message || 
                   tx.transaction?.message || 
                   tx.message
        }
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract initial reserves from instruction
   */
  private extractInitialReserves(ix: any, _tx: any): { sol: bigint; token: bigint } {
    try {
      // Try to get from instruction data
      if (ix.data) {
        const solAmount = ix.data.solAmount || ix.data.baseAmount || 0;
        const tokenAmount = ix.data.tokenAmount || ix.data.quoteAmount || 0;
        return {
          sol: BigInt(solAmount),
          token: BigInt(tokenAmount)
        };
      }

      // Try to get from post balances
      // This would require more complex analysis
      return { sol: BigInt(0), token: BigInt(0) };
    } catch (error) {
      return { sol: BigInt(0), token: BigInt(0) };
    }
  }

  /**
   * Determine pool type
   */
  private determinePoolType(tx: any): 'pump_amm' | 'raydium' | 'orca' {
    try {
      const accounts = this.extractAccounts(tx);
      const logs = tx.transaction?.meta?.logMessages || tx.meta?.logMessages || [];

      // Check for pump AMM
      if (accounts.includes(PUMP_AMM_PROGRAM) || 
          logs.some((log: string) => log.includes(PUMP_AMM_PROGRAM))) {
        return 'pump_amm';
      }

      // Check for Raydium
      const RAYDIUM_AMM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
      if (accounts.includes(RAYDIUM_AMM) || 
          logs.some((log: string) => log.includes('Raydium'))) {
        return 'raydium';
      }

      // Check for Orca
      const ORCA_WHIRLPOOL = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
      if (accounts.includes(ORCA_WHIRLPOOL) || 
          logs.some((log: string) => log.includes('Orca'))) {
        return 'orca';
      }

      // Default to pump AMM
      return 'pump_amm';
    } catch (error) {
      return 'pump_amm';
    }
  }

  /**
   * Extract addresses from log message
   */
  private extractAddressesFromLog(log: string): string[] {
    const addresses: string[] = [];
    const regex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
    const matches = log.match(regex);
    if (matches) {
      addresses.push(...matches);
    }
    return addresses;
  }

  /**
   * Find pool account from inner instructions
   */
  private findPoolAccountFromInnerInstructions(meta: any): string | null {
    try {
      if (!meta.innerInstructions) return null;

      for (const inner of meta.innerInstructions) {
        if (inner.instructions) {
          // Look for account creation patterns
          // This is simplified and would need more complex logic
          for (const ix of inner.instructions) {
            if (ix.parsed?.type === 'createAccount') {
              return ix.parsed.info.newAccount;
            }
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract accounts from transaction
   */
  private extractAccounts(tx: any): string[] {
    try {
      const accountKeys = tx.transaction?.transaction?.message?.accountKeys ||
                         tx.transaction?.message?.accountKeys ||
                         tx.message?.accountKeys ||
                         [];

      return accountKeys.map((key: any) => {
        if (typeof key === 'string') return key;
        if (Buffer.isBuffer(key)) return bs58.encode(key);
        return '';
      }).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  /**
   * Extract signature from transaction
   */
  private extractSignature(tx: any): string {
    try {
      const sig = tx.transaction?.transaction?.signature || 
                  tx.transaction?.signature || 
                  tx.signature ||
                  tx.transaction?.transaction?.signatures?.[0];

      if (sig) {
        if (typeof sig === 'string') return sig;
        if (Buffer.isBuffer(sig)) return bs58.encode(sig);
        if (sig.data) return bs58.encode(Buffer.from(sig.data));
      }

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Store pool creation event
   */
  private storePoolCreation(pool: PoolCreationEvent): void {
    // Add to pools by mint mapping
    if (!this.poolsByMint.has(pool.mintAddress)) {
      this.poolsByMint.set(pool.mintAddress, []);
    }
    this.poolsByMint.get(pool.mintAddress)!.push(pool);

    // Emit pool created event
    this.eventBus.emit(EVENTS.POOL_CREATED, {
      poolAddress: pool.poolAddress,
      mintAddress: pool.mintAddress,
      lpMint: pool.lpMintAddress,
      virtualSolReserves: pool.initialReserves.sol,
      virtualTokenReserves: pool.initialReserves.token,
      signature: pool.transactionSignature,
      slot: pool.slot,
      blockTime: pool.blockTime
    });
  }

  /**
   * Get pools for a mint
   */
  getPoolsForMint(mintAddress: string): PoolCreationEvent[] {
    return this.poolsByMint.get(mintAddress) || [];
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      detectedPools: this.detectedPools.size,
      trackedMints: this.poolsByMint.size,
      totalPools: Array.from(this.poolsByMint.values()).reduce((sum, pools) => sum + pools.length, 0)
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    if (this.detectedPools.size > 10000) {
      // Keep only recent 5000 pools
      const pools = Array.from(this.detectedPools);
      this.detectedPools = new Set(pools.slice(-5000));
      
      // Also clean up pools by mint
      for (const [mint, pools] of this.poolsByMint) {
        if (pools.length > 10) {
          // Keep only last 10 pools per mint
          this.poolsByMint.set(mint, pools.slice(-10));
        }
      }
      
      this.logger.debug('Cleared pool cache', { 
        remainingPools: this.detectedPools.size,
        remainingMints: this.poolsByMint.size
      });
    }
  }
}