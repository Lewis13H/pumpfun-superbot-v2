/**
 * Unified Event Parser
 * Uses strategy pattern to parse different event types
 */

import { ParseStrategy, ParseContext, ParsedEvent } from './types';
import { BCTradeStrategy } from './strategies/bc-trade-strategy';
import { AMMTradeStrategy } from './strategies/amm-trade-strategy';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import bs58 from 'bs58';

export interface ParserOptions {
  strategies?: ParseStrategy[];
  eventBus?: EventBus;
  logErrors?: boolean;
}

export class UnifiedEventParser {
  private strategies: ParseStrategy[];
  private eventBus?: EventBus;
  private logger: Logger;
  private stats = {
    total: 0,
    parsed: 0,
    failed: 0,
    byStrategy: new Map<string, number>()
  };
  private static _debugged = false;

  constructor(options: ParserOptions = {}) {
    this.strategies = options.strategies || [
      new BCTradeStrategy(),
      new AMMTradeStrategy()
    ];
    this.eventBus = options.eventBus;
    this.logger = new Logger({ 
      context: 'UnifiedEventParser',
      level: options.logErrors ? 0 : 2 // DEBUG if logErrors, else WARN
    });

    // Initialize strategy stats
    this.strategies.forEach(s => this.stats.byStrategy.set(s.name, 0));
  }

  /**
   * Parse a transaction into an event
   */
  parse(context: ParseContext): ParsedEvent | null {
    this.stats.total++;

    // Try each strategy in order
    for (const strategy of this.strategies) {
      try {
        if (strategy.canParse(context)) {
          const event = strategy.parse(context);
          if (event) {
            this.stats.parsed++;
            this.stats.byStrategy.set(
              strategy.name, 
              (this.stats.byStrategy.get(strategy.name) || 0) + 1
            );
            
            // Emit parse success event
            if (this.eventBus) {
              this.eventBus.emit('parser:success', {
                strategy: strategy.name,
                eventType: event.type,
                signature: context.signature
              });
            }
            
            return event;
          }
        }
      } catch (error) {
        this.logger.error(`Strategy ${strategy.name} failed`, error as Error, {
          signature: context.signature
        });
      }
    }

    // No strategy could parse the event
    this.stats.failed++;
    
    if (this.eventBus) {
      this.eventBus.emit('parser:failed', {
        signature: context.signature,
        reason: 'No matching strategy'
      });
    }

    return null;
  }

  /**
   * Parse a batch of contexts
   */
  parseBatch(contexts: ParseContext[]): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    
    for (const context of contexts) {
      const event = this.parse(context);
      if (event) {
        events.push(event);
      }
    }
    
    return events;
  }

  /**
   * Add a custom parsing strategy
   */
  addStrategy(strategy: ParseStrategy): void {
    this.strategies.push(strategy);
    this.stats.byStrategy.set(strategy.name, 0);
  }

  /**
   * Remove a strategy by name
   */
  removeStrategy(name: string): void {
    this.strategies = this.strategies.filter(s => s.name !== name);
    this.stats.byStrategy.delete(name);
  }

  /**
   * Get parser statistics
   */
  getStats() {
    const parseRate = this.stats.total > 0 
      ? (this.stats.parsed / this.stats.total * 100).toFixed(1)
      : '0.0';

    return {
      total: this.stats.total,
      parsed: this.stats.parsed,
      failed: this.stats.failed,
      parseRate: `${parseRate}%`,
      byStrategy: Object.fromEntries(this.stats.byStrategy)
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats.total = 0;
    this.stats.parsed = 0;
    this.stats.failed = 0;
    this.strategies.forEach(s => this.stats.byStrategy.set(s.name, 0));
  }

  /**
   * Create a parse context from gRPC data
   */
  static createContext(grpcData: any): ParseContext {
    // Extract accounts from the nested structure
    const accounts: string[] = [];
    let instructionData: Buffer | undefined;
    
    // Debug first transaction
    if (!this._debugged) {
      console.log('DEBUG: First gRPC data structure:', JSON.stringify(grpcData, (key, value) => {
        if (Buffer.isBuffer(value)) {
          return { type: 'Buffer', length: value.length, first10: Array.from(value.slice(0, 10)) };
        }
        return value;
      }, 2).substring(0, 1000));
      this._debugged = true;
    }
    
    try {
      // Handle the nested gRPC structure: transaction.transaction.transaction
      let message, meta;
      
      if (grpcData.transaction?.transaction?.transaction) {
        // Standard gRPC structure
        const innerTx = grpcData.transaction.transaction.transaction;
        message = innerTx.message;
        meta = grpcData.transaction.transaction.meta;
      } else if (grpcData.transaction?.transaction) {
        // Fallback structure
        message = grpcData.transaction.transaction.message;
        meta = grpcData.transaction.transaction.meta;
      } else if (grpcData.transaction) {
        // Direct structure
        message = grpcData.transaction.message;
        meta = grpcData.transaction.meta;
      }
      
      if (message?.accountKeys) {
        for (const key of message.accountKeys) {
          if (Buffer.isBuffer(key)) {
            accounts.push(bs58.encode(key));
          }
        }
      }
      
      // Extract instruction data for pump.fun trades
      const instructions = message?.instructions || [];
      for (const ix of instructions) {
        const programIdIndex = ix.programIdIndex;
        if (programIdIndex < accounts.length) {
          const programId = accounts[programIdIndex];
          
          // Check if this is pump.fun program
          if (programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
            // Get the instruction data
            if (ix.data && typeof ix.data === 'string') {
              instructionData = Buffer.from(ix.data, 'base64');
            }
            break;
          }
        }
      }
      
      // Check inner instructions if we haven't found data yet
      if (!instructionData && meta?.innerInstructions) {
        for (const inner of meta.innerInstructions) {
          if (inner.instructions) {
            for (const innerIx of inner.instructions) {
              // Check for CPI events which might contain our data
              if (innerIx.data && typeof innerIx.data === 'string') {
                const data = Buffer.from(innerIx.data, 'base64');
                // Check if it's the right size for pump.fun events
                if (data.length === 225 || data.length === 113) {
                  instructionData = data;
                  break;
                }
              }
            }
          }
          if (instructionData) break;
        }
      }
    } catch (error) {
      // Log error but continue
    }
    
    // Debug: Log what we found
    if (!this._debugged && accounts.length > 0) {
      console.log('DEBUG: Parse results:', {
        accounts: accounts.length,
        instructionData: instructionData ? instructionData.length : 'none',
        hasMeta: !!meta,
        hasMessage: !!message
      });
    }

    // Extract logs
    const logs = grpcData.transaction?.transaction?.meta?.logMessages || [];
    
    // If we didn't find instruction data, try to extract from logs
    if (!instructionData && logs.length > 0) {
      for (const log of logs) {
        if (log.includes('Program data:')) {
          const match = log.match(/Program data: (.+)/);
          if (match?.[1]) {
            try {
              instructionData = Buffer.from(match[1], 'base64');
              if (!this._debugged) {
                console.log('DEBUG: Extracted data from logs:', instructionData.length);
              }
              break;
            } catch (error) {
              // Ignore decode errors
            }
          }
        }
      }
    }
    
    // Extract signature (might be a Buffer)
    let signature = '';
    const sig = grpcData.transaction?.transaction?.signature;
    if (sig) {
      if (Buffer.isBuffer(sig)) {
        signature = bs58.encode(sig);
      } else if (sig.type === 'Buffer' && Array.isArray(sig.data)) {
        // Handle Buffer-like object from JSON
        signature = bs58.encode(Buffer.from(sig.data));
      } else if (typeof sig === 'string') {
        signature = sig;
      }
    }

    return {
      signature,
      slot: BigInt(grpcData.transaction?.slot || grpcData.slot || 0),
      blockTime: grpcData.blockTime || grpcData.transaction?.blockTime,
      accounts,
      logs,
      data: instructionData
    };
  }
}