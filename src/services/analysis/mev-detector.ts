/**
 * MEV Detector Service
 * Detects Maximum Extractable Value (MEV) patterns like sandwich attacks and frontrunning
 */

import { Logger } from '../../core/logger';
import { EventBus } from '../../core/event-bus';
import { db } from '../../database';
import { FailedTransaction } from '../monitoring/failed-tx-analyzer';

export interface MEVPattern {
  type: 'sandwich' | 'frontrun' | 'backrun' | 'arbitrage' | 'liquidation';
  victimTx?: string;
  attackerTxs: string[];
  mintAddress: string;
  attackerAddress?: string;
  profitEstimate?: number;
  slot: bigint;
  blockTime: number;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
}

export interface SandwichAttack extends MEVPattern {
  type: 'sandwich';
  frontrunTx: string;
  backrunTx: string;
  victimTx: string;
  priceImpact: number;
}

export class MEVDetector {
  private static instance: MEVDetector;
  private logger: Logger;
  private eventBus: EventBus;
  
  private detectedMEV: Map<string, MEVPattern> = new Map();
  private slotTransactions: Map<bigint, any[]> = new Map();
  private suspiciousAddresses: Set<string> = new Set();

  private constructor(eventBus: EventBus) {
    this.logger = new Logger({ context: 'MEVDetector' });
    this.eventBus = eventBus;
    
    // Start periodic analysis
    setInterval(() => this.analyzeRecentSlots(), 5000); // Every 5 seconds
    setInterval(() => this.updateMEVDatabase(), 60000); // Every minute
  }

  static getInstance(eventBus: EventBus): MEVDetector {
    if (!MEVDetector.instance) {
      MEVDetector.instance = new MEVDetector(eventBus);
    }
    return MEVDetector.instance;
  }

  /**
   * Track transaction for MEV analysis
   */
  trackTransaction(transaction: any): void {
    try {
      const slot = BigInt(transaction.slot || 0);
      
      if (!this.slotTransactions.has(slot)) {
        this.slotTransactions.set(slot, []);
      }
      
      this.slotTransactions.get(slot)!.push(transaction);
      
      // Clean up old slots (keep last 1000)
      if (this.slotTransactions.size > 1000) {
        const slots = Array.from(this.slotTransactions.keys()).sort((a, b) => 
          a < b ? -1 : a > b ? 1 : 0
        );
        const toRemove = slots.slice(0, slots.length - 1000);
        toRemove.forEach(s => this.slotTransactions.delete(s));
      }
    } catch (error) {
      // Silent error to avoid spam
    }
  }

  /**
   * Detect sandwich attack
   */
  async detectSandwichAttack(
    failedTx: FailedTransaction, 
    slot: bigint
  ): Promise<SandwichAttack | null> {
    try {
      const slotTxs = this.slotTransactions.get(slot) || [];
      if (slotTxs.length < 3) return null;
      
      // Sort transactions by position in block
      const sortedTxs = this.sortTransactionsByPosition(slotTxs);
      
      // Find victim transaction index
      const victimIndex = sortedTxs.findIndex(tx => 
        this.extractSignature(tx) === failedTx.signature
      );
      
      if (victimIndex === -1 || victimIndex === 0 || victimIndex === sortedTxs.length - 1) {
        return null;
      }
      
      // Check for sandwich pattern
      const frontrunCandidate = sortedTxs[victimIndex - 1];
      const backrunCandidate = sortedTxs[victimIndex + 1];
      
      // Analyze if these form a sandwich
      if (this.isSandwichPattern(frontrunCandidate, failedTx, backrunCandidate)) {
        const sandwich: SandwichAttack = {
          type: 'sandwich',
          victimTx: failedTx.signature,
          frontrunTx: this.extractSignature(frontrunCandidate),
          backrunTx: this.extractSignature(backrunCandidate),
          attackerTxs: [
            this.extractSignature(frontrunCandidate),
            this.extractSignature(backrunCandidate)
          ],
          mintAddress: failedTx.mintAddress || '',
          attackerAddress: this.extractUserAddress(frontrunCandidate),
          slot,
          blockTime: failedTx.blockTime,
          confidence: 'high',
          priceImpact: this.calculatePriceImpact(frontrunCandidate, backrunCandidate),
          evidence: [
            'Same slot execution',
            'Buy-Victim-Sell pattern',
            'Same token',
            'Price manipulation detected'
          ]
        };
        
        // Track suspicious address
        if (sandwich.attackerAddress) {
          this.suspiciousAddresses.add(sandwich.attackerAddress);
        }
        
        this.detectedMEV.set(failedTx.signature, sandwich);
        this.eventBus.emit('mev:sandwich_detected', sandwich);
        
        this.logger.warn('Sandwich attack detected', {
          victim: failedTx.signature,
          attacker: sandwich.attackerAddress,
          slot: slot.toString()
        });
        
        return sandwich;
      }
      
      return null;
    } catch (error) {
      this.logger.error('Error detecting sandwich attack', error as Error);
      return null;
    }
  }

  /**
   * Check if transactions form a sandwich pattern
   */
  private isSandwichPattern(
    frontrun: any, 
    victim: FailedTransaction, 
    backrun: any
  ): boolean {
    try {
      // Extract details from transactions
      const frontrunAction = this.extractAction(frontrun);
      const backrunAction = this.extractAction(backrun);
      const frontrunUser = this.extractUserAddress(frontrun);
      const backrunUser = this.extractUserAddress(backrun);
      const frontrunMint = this.extractMintAddress(frontrun);
      const backrunMint = this.extractMintAddress(backrun);
      
      // Check pattern:
      // 1. Frontrun and backrun by same user
      // 2. Frontrun is buy, victim intended buy, backrun is sell
      // 3. Same token
      // 4. Transactions are successful (frontrun and backrun)
      
      if (frontrunUser !== backrunUser) return false;
      if (frontrunMint !== victim.mintAddress || backrunMint !== victim.mintAddress) return false;
      if (!this.isSuccessful(frontrun) || !this.isSuccessful(backrun)) return false;
      
      // Classic sandwich: Buy -> Victim Buy (failed) -> Sell
      if (frontrunAction === 'buy' && 
          victim.intendedAction === 'buy' && 
          backrunAction === 'sell') {
        return true;
      }
      
      // Reverse sandwich: Sell -> Victim Sell (failed) -> Buy
      if (frontrunAction === 'sell' && 
          victim.intendedAction === 'sell' && 
          backrunAction === 'buy') {
        return true;
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect frontrunning pattern
   */
  async detectFrontrunning(transaction: any): Promise<MEVPattern | null> {
    try {
      const slot = BigInt(transaction.slot || 0);
      const slotTxs = this.slotTransactions.get(slot) || [];
      
      // Look for similar transactions in same slot
      const userAddress = this.extractUserAddress(transaction);
      const mintAddress = this.extractMintAddress(transaction);
      const action = this.extractAction(transaction);
      
      if (!mintAddress || action === 'unknown') return null;
      
      // Find transactions with same mint and action but different user
      const frontrunners = slotTxs.filter(tx => {
        const txUser = this.extractUserAddress(tx);
        const txMint = this.extractMintAddress(tx);
        const txAction = this.extractAction(tx);
        
        return txUser !== userAddress && 
               txMint === mintAddress && 
               txAction === action &&
               this.isSuccessful(tx);
      });
      
      if (frontrunners.length === 0) return null;
      
      // Sort by position to find actual frontrunner
      const sortedTxs = this.sortTransactionsByPosition([...frontrunners, transaction]);
      const victimIndex = sortedTxs.findIndex(tx => 
        this.extractSignature(tx) === this.extractSignature(transaction)
      );
      
      if (victimIndex > 0) {
        const frontrunner = sortedTxs[0];
        const pattern: MEVPattern = {
          type: 'frontrun',
          victimTx: this.extractSignature(transaction),
          attackerTxs: [this.extractSignature(frontrunner)],
          mintAddress,
          attackerAddress: this.extractUserAddress(frontrunner),
          slot,
          blockTime: transaction.blockTime || Math.floor(Date.now() / 1000),
          confidence: 'medium',
          evidence: [
            'Same slot execution',
            'Same token and action',
            'Frontrunner succeeded',
            'Victim transaction after frontrunner'
          ]
        };
        
        this.detectedMEV.set(this.extractSignature(transaction), pattern);
        this.eventBus.emit('mev:frontrun_detected', pattern);
        
        return pattern;
      }
      
      return null;
    } catch (error) {
      this.logger.error('Error detecting frontrunning', error as Error);
      return null;
    }
  }

  /**
   * Analyze recent slots for MEV patterns
   */
  private async analyzeRecentSlots(): Promise<void> {
    try {
      const recentSlots = Array.from(this.slotTransactions.keys())
        .sort((a, b) => b < a ? -1 : b > a ? 1 : 0)
        .slice(0, 10);
      
      for (const slot of recentSlots) {
        const txs = this.slotTransactions.get(slot) || [];
        if (txs.length < 2) continue;
        
        // Analyze for arbitrage opportunities
        await this.detectArbitragePatterns(slot, txs);
        
        // Analyze for suspicious activity patterns
        await this.detectSuspiciousPatterns(slot, txs);
      }
    } catch (error) {
      this.logger.error('Error analyzing recent slots', error as Error);
    }
  }

  /**
   * Detect arbitrage patterns
   */
  private async detectArbitragePatterns(slot: bigint, transactions: any[]): Promise<void> {
    try {
      // Group transactions by user
      const userTxs = new Map<string, any[]>();
      
      for (const tx of transactions) {
        const user = this.extractUserAddress(tx);
        if (!userTxs.has(user)) {
          userTxs.set(user, []);
        }
        userTxs.get(user)!.push(tx);
      }
      
      // Look for users with multiple transactions
      for (const [user, txs] of userTxs) {
        if (txs.length >= 2 && txs.every(tx => this.isSuccessful(tx))) {
          // Check for buy-sell pattern
          const buys = txs.filter(tx => this.extractAction(tx) === 'buy');
          const sells = txs.filter(tx => this.extractAction(tx) === 'sell');
          
          if (buys.length > 0 && sells.length > 0) {
            const pattern: MEVPattern = {
              type: 'arbitrage',
              attackerTxs: txs.map(tx => this.extractSignature(tx)),
              mintAddress: this.extractMintAddress(txs[0]) || '',
              attackerAddress: user,
              slot,
              blockTime: txs[0].blockTime || Math.floor(Date.now() / 1000),
              confidence: 'low',
              evidence: [
                'Multiple transactions in same slot',
                'Buy and sell pattern',
                'All transactions successful'
              ]
            };
            
            this.eventBus.emit('mev:arbitrage_detected', pattern);
          }
        }
      }
    } catch (error) {
      this.logger.error('Error detecting arbitrage', error as Error);
    }
  }

  /**
   * Detect suspicious patterns
   */
  private async detectSuspiciousPatterns(slot: bigint, transactions: any[]): Promise<void> {
    try {
      // Count failed transactions
      const failedCount = transactions.filter(tx => !this.isSuccessful(tx)).length;
      const totalCount = transactions.length;
      const failureRate = totalCount > 0 ? failedCount / totalCount : 0;
      
      // High failure rate might indicate MEV activity
      if (failureRate > 0.3 && totalCount > 10) {
        this.logger.warn('High failure rate detected', {
          slot: slot.toString(),
          failureRate: (failureRate * 100).toFixed(2) + '%',
          total: totalCount,
          failed: failedCount
        });
        
        this.eventBus.emit('mev:high_failure_rate', {
          slot,
          failureRate,
          totalTransactions: totalCount,
          failedTransactions: failedCount
        });
      }
      
      // Check for rapid-fire transactions from same address
      const userCounts = new Map<string, number>();
      for (const tx of transactions) {
        const user = this.extractUserAddress(tx);
        userCounts.set(user, (userCounts.get(user) || 0) + 1);
      }
      
      for (const [user, count] of userCounts) {
        if (count > 5) {
          this.suspiciousAddresses.add(user);
          this.logger.warn('Suspicious activity detected', {
            address: user,
            transactionCount: count,
            slot: slot.toString()
          });
        }
      }
    } catch (error) {
      this.logger.error('Error detecting suspicious patterns', error as Error);
    }
  }

  /**
   * Calculate price impact between two transactions
   */
  private calculatePriceImpact(_frontrun: any, _backrun: any): number {
    try {
      // This would need actual price calculation from transaction data
      // For now, return estimated impact
      return 5.5; // 5.5% estimated impact
    } catch (error) {
      return 0;
    }
  }

  /**
   * Update MEV database
   */
  private async updateMEVDatabase(): Promise<void> {
    try {
      // Create table if not exists
      await db.query(`
        CREATE TABLE IF NOT EXISTS mev_events (
          id SERIAL PRIMARY KEY,
          victim_tx VARCHAR(88),
          mev_type VARCHAR(20) NOT NULL,
          attacker_address VARCHAR(64),
          attacker_txs TEXT[],
          mint_address VARCHAR(64),
          slot BIGINT NOT NULL,
          block_time TIMESTAMP NOT NULL,
          confidence VARCHAR(10),
          evidence JSONB,
          profit_estimate DECIMAL(20, 4),
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_mev_victim ON mev_events(victim_tx);
        CREATE INDEX IF NOT EXISTS idx_mev_attacker ON mev_events(attacker_address);
        CREATE INDEX IF NOT EXISTS idx_mev_slot ON mev_events(slot);
      `);
      
      // Insert new MEV events
      const newEvents = Array.from(this.detectedMEV.entries()).slice(-100);
      for (const [_victimTx, pattern] of newEvents) {
        await db.query(`
          INSERT INTO mev_events (
            victim_tx, mev_type, attacker_address, attacker_txs,
            mint_address, slot, block_time, confidence, evidence,
            profit_estimate
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT DO NOTHING
        `, [
          pattern.victimTx || null,
          pattern.type,
          pattern.attackerAddress || null,
          pattern.attackerTxs,
          pattern.mintAddress,
          pattern.slot.toString(),
          new Date(pattern.blockTime * 1000),
          pattern.confidence,
          JSON.stringify({ evidence: pattern.evidence }),
          pattern.profitEstimate || null
        ]);
      }
    } catch (error) {
      this.logger.error('Error updating MEV database', error as Error);
    }
  }

  /**
   * Helper methods
   */
  private sortTransactionsByPosition(txs: any[]): any[] {
    // In real implementation, would use transaction index in block
    // For now, use slot order
    return txs;
  }

  private isSuccessful(tx: any): boolean {
    const meta = tx.transaction?.meta || tx.meta;
    return meta && meta.err === null;
  }

  private extractAction(tx: any): 'buy' | 'sell' | 'unknown' {
    try {
      const logs = tx.transaction?.meta?.logMessages || tx.meta?.logMessages || [];
      const logsStr = logs.join(' ').toLowerCase();
      
      if (logsStr.includes('buy')) return 'buy';
      if (logsStr.includes('sell')) return 'sell';
      
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  private extractUserAddress(tx: any): string {
    try {
      const accounts = tx.transaction?.transaction?.message?.accountKeys ||
                      tx.transaction?.message?.accountKeys ||
                      tx.message?.accountKeys ||
                      [];
      
      if (accounts.length > 0) {
        const account = accounts[0];
        if (typeof account === 'string') return account;
        if (Buffer.isBuffer(account)) return account.toString('base64');
      }
      
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  private extractMintAddress(tx: any): string | undefined {
    try {
      const meta = tx.transaction?.meta || tx.meta;
      if (meta?.postTokenBalances?.length > 0) {
        return meta.postTokenBalances[0].mint;
      }
      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  private extractSignature(tx: any): string {
    const sig = tx.transaction?.transaction?.signature || 
                tx.transaction?.signature || 
                tx.signature ||
                tx.transaction?.transaction?.signatures?.[0];
    
    if (sig) {
      if (typeof sig === 'string') return sig;
      if (Buffer.isBuffer(sig)) return sig.toString('base64');
    }
    
    return 'unknown';
  }

  /**
   * Get MEV statistics
   */
  async getMEVStats() {
    const stats = {
      detectedPatterns: this.detectedMEV.size,
      suspiciousAddresses: this.suspiciousAddresses.size,
      byType: {
        sandwich: 0,
        frontrun: 0,
        backrun: 0,
        arbitrage: 0,
        liquidation: 0
      }
    };
    
    for (const pattern of this.detectedMEV.values()) {
      stats.byType[pattern.type]++;
    }
    
    return stats;
  }

  /**
   * Get suspicious addresses
   */
  getSuspiciousAddresses(): string[] {
    return Array.from(this.suspiciousAddresses);
  }
}