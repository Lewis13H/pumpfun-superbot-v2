/**
 * Failed Transaction Analyzer
 * Analyzes failed transactions to extract insights about failure reasons
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { IDLParserService } from './idl-parser-service';
import bs58 from 'bs58';

export enum FailureReason {
  SLIPPAGE_EXCEEDED = 'slippage_exceeded',
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  MEV_FRONTRUN = 'mev_frontrun',
  PROGRAM_ERROR = 'program_error',
  NETWORK_CONGESTION = 'network_congestion',
  ACCOUNT_NOT_FOUND = 'account_not_found',
  INVALID_INSTRUCTION = 'invalid_instruction',
  UNKNOWN = 'unknown'
}

export interface FailedTransaction {
  signature: string;
  mintAddress?: string;
  userAddress: string;
  failureReason: FailureReason;
  errorMessage?: string;
  intendedAction: 'buy' | 'sell' | 'graduate' | 'unknown';
  slot: bigint;
  blockTime: number;
  mevSuspected: boolean;
  retrySignature?: string;
  analysisMetadata: {
    programError?: string;
    slippageAmount?: number;
    requiredAmount?: bigint;
    availableAmount?: bigint;
    suspiciousPatterns?: string[];
    congestionLevel?: 'low' | 'medium' | 'high';
  };
}

export class FailedTransactionAnalyzer {
  private static instance: FailedTransactionAnalyzer;
  private logger: Logger;
  private eventBus: EventBus;
  private idlParser: IDLParserService;
  
  private failedTxCache: Map<string, FailedTransaction> = new Map();
  private failureStats: Map<FailureReason, number> = new Map();
  private recentSlots: Map<bigint, number> = new Map(); // slot -> failed tx count

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'FailedTxAnalyzer' });
    this.eventBus = eventBus;
    this.idlParser = IDLParserService.getInstance();
    
    // Initialize failure stats
    Object.values(FailureReason).forEach(reason => {
      this.failureStats.set(reason as FailureReason, 0);
    });
  }

  static getInstance(eventBus: EventBus): FailedTransactionAnalyzer {
    if (!FailedTransactionAnalyzer.instance) {
      FailedTransactionAnalyzer.instance = new FailedTransactionAnalyzer(eventBus);
    }
    return FailedTransactionAnalyzer.instance;
  }

  /**
   * Analyze a failed transaction
   */
  async analyzeFailedTransaction(transaction: any): Promise<FailedTransaction | null> {
    try {
      // Check if transaction failed
      const meta = transaction.transaction?.meta || transaction.meta;
      if (!meta || meta.err === null) {
        return null; // Not a failed transaction
      }

      const signature = this.extractSignature(transaction);
      
      // Check cache
      if (this.failedTxCache.has(signature)) {
        return this.failedTxCache.get(signature)!;
      }

      // Analyze failure
      const failureReason = this.determineFailureReason(meta.err, meta.logMessages || []);
      const userAddress = this.extractUserAddress(transaction);
      const intendedAction = this.determineIntendedAction(transaction);
      const mintAddress = this.extractMintAddress(transaction);
      const mevSuspected = await this.detectMEVPattern(transaction);
      
      const failedTx: FailedTransaction = {
        signature,
        mintAddress,
        userAddress,
        failureReason,
        errorMessage: this.extractErrorMessage(meta.err, meta.logMessages),
        intendedAction,
        slot: BigInt(transaction.slot || 0),
        blockTime: transaction.blockTime || Math.floor(Date.now() / 1000),
        mevSuspected,
        analysisMetadata: await this.buildAnalysisMetadata(transaction, failureReason)
      };

      // Cache and track
      this.failedTxCache.set(signature, failedTx);
      this.failureStats.set(failureReason, (this.failureStats.get(failureReason) || 0) + 1);
      this.trackSlotFailures(failedTx.slot);
      
      // Emit event
      this.eventBus.emit('failed_tx:analyzed', failedTx);
      
      this.logger.debug('Failed transaction analyzed', {
        signature,
        reason: failureReason,
        action: intendedAction,
        mevSuspected
      });

      return failedTx;
    } catch (error) {
      this.logger.error('Error analyzing failed transaction', error as Error);
      return null;
    }
  }

  /**
   * Determine failure reason from error and logs
   */
  private determineFailureReason(err: any, logs: string[]): FailureReason {
    const errorStr = JSON.stringify(err);
    const logsStr = logs.join(' ');
    
    // Check for slippage
    if (errorStr.includes('SlippageExceeded') || 
        logsStr.includes('slippage exceeded') ||
        logsStr.includes('price moved')) {
      return FailureReason.SLIPPAGE_EXCEEDED;
    }
    
    // Check for insufficient funds
    if (errorStr.includes('InsufficientFunds') || 
        logsStr.includes('insufficient lamports') ||
        logsStr.includes('not enough SOL')) {
      return FailureReason.INSUFFICIENT_FUNDS;
    }
    
    // Check for account not found
    if (errorStr.includes('AccountNotFound') || 
        logsStr.includes('account does not exist')) {
      return FailureReason.ACCOUNT_NOT_FOUND;
    }
    
    // Check for program errors
    if (errorStr.includes('ProgramError') || 
        errorStr.includes('InstructionError')) {
      return FailureReason.PROGRAM_ERROR;
    }
    
    // Check for invalid instruction
    if (errorStr.includes('InvalidInstruction') || 
        logsStr.includes('invalid instruction')) {
      return FailureReason.INVALID_INSTRUCTION;
    }
    
    // Default to unknown
    return FailureReason.UNKNOWN;
  }

  /**
   * Determine intended action from transaction
   */
  private determineIntendedAction(transaction: any): 'buy' | 'sell' | 'graduate' | 'unknown' {
    try {
      const message = transaction.transaction?.transaction?.message || 
                      transaction.transaction?.message || 
                      transaction.message;
      
      if (!message) return 'unknown';

      // Parse instructions
      const instructions = this.idlParser.parseInstructions(
        message,
        transaction.transaction?.meta?.loadedAddresses || transaction.meta?.loadedAddresses
      );

      // Check instruction names
      for (const ix of instructions) {
        if (ix.name === 'buy' || ix.name.includes('buy')) return 'buy';
        if (ix.name === 'sell' || ix.name.includes('sell')) return 'sell';
        if (ix.name === 'withdraw' || ix.name === 'graduate') return 'graduate';
      }

      // Check logs for clues
      const logs = transaction.transaction?.meta?.logMessages || 
                   transaction.meta?.logMessages || [];
      
      const logsStr = logs.join(' ').toLowerCase();
      if (logsStr.includes('buy')) return 'buy';
      if (logsStr.includes('sell')) return 'sell';
      if (logsStr.includes('withdraw') || logsStr.includes('graduat')) return 'graduate';

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Detect potential MEV patterns
   */
  private async detectMEVPattern(transaction: any): Promise<boolean> {
    try {
      const slot = BigInt(transaction.slot || 0);
      const failedCount = this.recentSlots.get(slot) || 0;
      
      // High failure rate in same slot could indicate MEV
      if (failedCount > 5) {
        return true;
      }
      
      // Check for suspicious patterns in logs
      const logs = transaction.transaction?.meta?.logMessages || 
                   transaction.meta?.logMessages || [];
      const logsStr = logs.join(' ').toLowerCase();
      
      if (logsStr.includes('frontrun') || 
          logsStr.includes('sandwich') ||
          logsStr.includes('price manipulation')) {
        return true;
      }
      
      // Check if slippage failure with high slippage amount
      const metadata = await this.buildAnalysisMetadata(transaction, FailureReason.SLIPPAGE_EXCEEDED);
      if (metadata.slippageAmount && metadata.slippageAmount > 10) {
        return true;
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Build analysis metadata
   */
  private async buildAnalysisMetadata(
    transaction: any, 
    failureReason: FailureReason
  ): Promise<FailedTransaction['analysisMetadata']> {
    const metadata: FailedTransaction['analysisMetadata'] = {};
    
    try {
      // Extract program error details
      const meta = transaction.transaction?.meta || transaction.meta;
      if (meta.err && typeof meta.err === 'object') {
        metadata.programError = JSON.stringify(meta.err);
      }
      
      // Extract slippage info if relevant
      if (failureReason === FailureReason.SLIPPAGE_EXCEEDED) {
        const logs = meta.logMessages || [];
        for (const log of logs) {
          const slippageMatch = log.match(/slippage.*?(\d+)/i);
          if (slippageMatch) {
            metadata.slippageAmount = parseInt(slippageMatch[1]);
          }
        }
      }
      
      // Determine congestion level
      const slot = BigInt(transaction.slot || 0);
      const failedCount = this.recentSlots.get(slot) || 0;
      if (failedCount > 10) {
        metadata.congestionLevel = 'high';
      } else if (failedCount > 5) {
        metadata.congestionLevel = 'medium';
      } else {
        metadata.congestionLevel = 'low';
      }
      
      // Look for suspicious patterns
      const suspiciousPatterns: string[] = [];
      const logs = meta.logMessages || [];
      const logsStr = logs.join(' ').toLowerCase();
      
      if (logsStr.includes('multiple attempts')) {
        suspiciousPatterns.push('multiple_attempts');
      }
      if (logsStr.includes('rapid price change')) {
        suspiciousPatterns.push('rapid_price_change');
      }
      if (failedCount > 5 && failureReason === FailureReason.SLIPPAGE_EXCEEDED) {
        suspiciousPatterns.push('high_slot_failure_rate');
      }
      
      if (suspiciousPatterns.length > 0) {
        metadata.suspiciousPatterns = suspiciousPatterns;
      }
      
    } catch (error) {
      this.logger.debug('Error building metadata', { error });
    }
    
    return metadata;
  }

  /**
   * Extract error message from error and logs
   */
  private extractErrorMessage(err: any, logs: string[]): string {
    if (typeof err === 'string') return err;
    if (err.InstructionError) {
      return `InstructionError: ${JSON.stringify(err.InstructionError)}`;
    }
    
    // Look for error in logs
    for (const log of logs) {
      if (log.includes('Error:') || log.includes('failed:')) {
        return log;
      }
    }
    
    return JSON.stringify(err);
  }

  /**
   * Extract user address from transaction
   */
  private extractUserAddress(transaction: any): string {
    try {
      const accounts = this.extractAccounts(transaction);
      return accounts[0] || 'unknown'; // First account is usually the fee payer
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Extract mint address from transaction
   */
  private extractMintAddress(transaction: any): string | undefined {
    try {
      // Try to get from post token balances
      const meta = transaction.transaction?.meta || transaction.meta;
      if (meta?.postTokenBalances?.length > 0) {
        return meta.postTokenBalances[0].mint;
      }
      
      // Try to parse from instructions
      const message = transaction.transaction?.transaction?.message || 
                      transaction.transaction?.message || 
                      transaction.message;
      
      if (!message) return undefined;

      const instructions = this.idlParser.parseInstructions(
        message,
        meta?.loadedAddresses
      );

      for (const ix of instructions) {
        const mintAccount = ix.accounts.find(a => 
          a.name === 'mint' || a.name === 'tokenMint' || a.name === 'baseMint'
        );
        if (mintAccount) {
          return mintAccount.pubkey.toBase58();
        }
      }
      
      return undefined;
    } catch (error) {
      return undefined;
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
   * Track slot failures for congestion detection
   */
  private trackSlotFailures(slot: bigint): void {
    const count = this.recentSlots.get(slot) || 0;
    this.recentSlots.set(slot, count + 1);
    
    // Clean up old slots (keep last 100)
    if (this.recentSlots.size > 100) {
      const slots = Array.from(this.recentSlots.keys()).sort((a, b) => 
        a < b ? -1 : a > b ? 1 : 0
      );
      const toRemove = slots.slice(0, slots.length - 100);
      toRemove.forEach(s => this.recentSlots.delete(s));
    }
  }

  /**
   * Get failure statistics
   */
  getFailureStats() {
    const stats: Record<string, any> = {
      total: this.failedTxCache.size,
      byReason: {}
    };
    
    for (const [reason, count] of this.failureStats) {
      stats.byReason[reason] = count;
    }
    
    // Calculate MEV suspicion rate
    let mevSuspectedCount = 0;
    for (const tx of this.failedTxCache.values()) {
      if (tx.mevSuspected) mevSuspectedCount++;
    }
    stats.mevSuspicionRate = this.failedTxCache.size > 0 
      ? (mevSuspectedCount / this.failedTxCache.size) * 100 
      : 0;
    
    return stats;
  }

  /**
   * Get recent failures
   */
  getRecentFailures(limit: number = 100): FailedTransaction[] {
    const failures = Array.from(this.failedTxCache.values());
    return failures
      .sort((a, b) => Number(b.slot - a.slot))
      .slice(0, limit);
  }

  /**
   * Find retry attempts for a failed transaction
   */
  async findRetryAttempts(_failedTx: FailedTransaction): Promise<string[]> {
    // This would need to query successful transactions with same user/mint/action
    // For now, return empty array
    return [];
  }

  /**
   * Clear old cache entries
   */
  clearOldCache(): void {
    if (this.failedTxCache.size > 10000) {
      // Keep only recent 5000 transactions
      const txs = Array.from(this.failedTxCache.entries())
        .sort((a, b) => Number(b[1].slot - a[1].slot));
      
      this.failedTxCache.clear();
      txs.slice(0, 5000).forEach(([sig, tx]) => {
        this.failedTxCache.set(sig, tx);
      });
      
      this.logger.debug('Cleared old failed transactions', {
        remaining: this.failedTxCache.size
      });
    }
  }
}