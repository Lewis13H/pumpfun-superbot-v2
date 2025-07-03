/**
 * Token Creation Detector Service
 * Detects new token creation from transaction data
 */

import { Logger } from '../../core/logger';
import { EventBus } from '../../core/event-bus';
import { IDLParserService } from '../core/idl-parser-service';
import { PUMP_PROGRAM } from '../../utils/config/constants';
import bs58 from 'bs58';

export interface NewTokenEvent {
  mintAddress: string;
  creator: string;
  bondingCurveKey?: string;
  transactionSignature: string;
  slot: bigint;
  blockTime: number;
  program: 'bonding_curve' | 'amm_pool';
  initialSupply?: bigint;
  metadata?: {
    name?: string;
    symbol?: string;
    uri?: string;
  };
}

export class TokenCreationDetector {
  private static instance: TokenCreationDetector;
  private logger: Logger;
  private eventBus: EventBus;
  private idlParser: IDLParserService;
  private detectedTokens: Set<string> = new Set();

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'TokenCreationDetector' });
    this.eventBus = eventBus;
    this.idlParser = IDLParserService.getInstance();
  }

  static getInstance(eventBus: EventBus): TokenCreationDetector {
    if (!TokenCreationDetector.instance) {
      TokenCreationDetector.instance = new TokenCreationDetector(eventBus);
    }
    return TokenCreationDetector.instance;
  }

  /**
   * Detect new token creation from transaction
   */
  async detectNewToken(transaction: any): Promise<NewTokenEvent | null> {
    try {
      // Check postTokenBalances for new mints
      const newToken = this.detectFromTokenBalances(transaction);
      if (newToken) {
        return newToken;
      }

      // Check for create instruction
      const createToken = this.detectFromInstructions(transaction);
      if (createToken) {
        return createToken;
      }

      // Check logs for token creation
      const logToken = this.detectFromLogs(transaction);
      if (logToken) {
        return logToken;
      }

      return null;
    } catch (error) {
      this.logger.error('Error detecting new token', error as Error);
      return null;
    }
  }

  /**
   * Detect new token from postTokenBalances
   */
  private detectFromTokenBalances(tx: any): NewTokenEvent | null {
    try {
      const meta = tx.transaction?.meta || tx.meta;
      if (!meta || !meta.postTokenBalances || meta.postTokenBalances.length === 0) {
        return null;
      }

      // Look for new mints in postTokenBalances that don't exist in preTokenBalances
      for (const postBalance of meta.postTokenBalances) {
        const mint = postBalance.mint;
        if (!mint) continue;

        // Check if this mint existed in preTokenBalances
        const existedBefore = meta.preTokenBalances?.some(
          (preBalance: any) => preBalance.mint === mint
        );

        if (!existedBefore && !this.detectedTokens.has(mint)) {
          this.detectedTokens.add(mint);

          // Get creator from first account (fee payer)
          const accounts = this.extractAccounts(tx);
          const creator = accounts[0] || 'unknown';

          // Extract signature
          const signature = this.extractSignature(tx);

          // Determine program type
          const program = this.determineProgramType(tx);

          this.logger.info('New token detected from balances', {
            mint,
            creator,
            signature
          });

          const event: NewTokenEvent = {
            mintAddress: mint,
            creator,
            transactionSignature: signature,
            slot: BigInt(tx.slot || 0),
            blockTime: tx.blockTime || Math.floor(Date.now() / 1000),
            program,
            initialSupply: BigInt(postBalance.uiTokenAmount?.amount || 0)
          };

          // Emit event
          this.eventBus.emit('token:created', event);

          return event;
        }
      }

      return null;
    } catch (error) {
      this.logger.debug('Error in detectFromTokenBalances', { error });
      return null;
    }
  }

  /**
   * Detect new token from create instructions
   */
  private detectFromInstructions(tx: any): NewTokenEvent | null {
    try {
      const message = tx.transaction?.transaction?.message || 
                      tx.transaction?.message || 
                      tx.message;
      
      if (!message) return null;

      // Parse instructions with IDL
      const instructions = this.idlParser.parseInstructions(
        message,
        tx.transaction?.meta?.loadedAddresses || tx.meta?.loadedAddresses
      );

      // Look for create instruction
      for (const ix of instructions) {
        if (ix.name === 'create' || ix.name === 'initialize' || ix.name === 'createBondingCurve') {
          // Extract mint from accounts
          const mintAccount = ix.accounts.find(a => 
            a.name === 'mint' || a.name === 'tokenMint' || a.name === 'newMint'
          );

          if (mintAccount) {
            const mintAddress = mintAccount.pubkey.toBase58();
            
            if (!this.detectedTokens.has(mintAddress)) {
              this.detectedTokens.add(mintAddress);

              const creator = ix.accounts.find(a => 
                a.name === 'user' || a.name === 'payer' || a.name === 'authority'
              )?.pubkey.toBase58() || 'unknown';

              const bondingCurve = ix.accounts.find(a => 
                a.name === 'bondingCurve'
              )?.pubkey.toBase58();

              const signature = this.extractSignature(tx);
              const program = this.determineProgramType(tx);

              this.logger.info('New token detected from instruction', {
                mint: mintAddress,
                creator,
                instruction: ix.name
              });

              const event: NewTokenEvent = {
                mintAddress,
                creator,
                bondingCurveKey: bondingCurve,
                transactionSignature: signature,
                slot: BigInt(tx.slot || 0),
                blockTime: tx.blockTime || Math.floor(Date.now() / 1000),
                program
              };

              // Emit event
              this.eventBus.emit('token:created', event);

              return event;
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
   * Detect new token from logs
   */
  private detectFromLogs(tx: any): NewTokenEvent | null {
    try {
      const logs = tx.transaction?.meta?.logMessages || 
                   tx.meta?.logMessages || 
                   [];

      for (const log of logs) {
        // Look for token creation patterns in logs
        if (log.includes('Token mint:') || 
            log.includes('Created token') ||
            log.includes('Initialized mint')) {
          
          // Extract mint address from log
          const mintMatch = log.match(/([1-9A-HJ-NP-Za-km-z]{32,44})/);
          if (mintMatch) {
            const mintAddress = mintMatch[1];
            
            if (!this.detectedTokens.has(mintAddress)) {
              this.detectedTokens.add(mintAddress);

              const accounts = this.extractAccounts(tx);
              const creator = accounts[0] || 'unknown';
              const signature = this.extractSignature(tx);
              const program = this.determineProgramType(tx);

              this.logger.info('New token detected from logs', {
                mint: mintAddress,
                creator,
                log
              });

              const event: NewTokenEvent = {
                mintAddress,
                creator,
                transactionSignature: signature,
                slot: BigInt(tx.slot || 0),
                blockTime: tx.blockTime || Math.floor(Date.now() / 1000),
                program
              };

              // Emit event
              this.eventBus.emit('token:created', event);

              return event;
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
   * Determine program type from transaction
   */
  private determineProgramType(tx: any): 'bonding_curve' | 'amm_pool' {
    try {
      const accounts = this.extractAccounts(tx);
      const logs = tx.transaction?.meta?.logMessages || tx.meta?.logMessages || [];

      // Check if pump.fun program is involved
      if (accounts.includes(PUMP_PROGRAM) || 
          logs.some((log: string) => log.includes(PUMP_PROGRAM))) {
        return 'bonding_curve';
      }

      // Default to AMM if not bonding curve
      return 'amm_pool';
    } catch (error) {
      return 'bonding_curve'; // Default
    }
  }

  /**
   * Clear detected tokens cache (for memory management)
   */
  clearCache(): void {
    if (this.detectedTokens.size > 10000) {
      // Keep only recent 5000 tokens
      const tokens = Array.from(this.detectedTokens);
      this.detectedTokens = new Set(tokens.slice(-5000));
      this.logger.debug('Cleared token cache', { 
        remaining: this.detectedTokens.size 
      });
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      detectedTokens: this.detectedTokens.size,
      cacheSize: this.detectedTokens.size
    };
  }
}