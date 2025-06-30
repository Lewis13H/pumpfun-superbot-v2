/**
 * Unified Event Parser
 * Uses strategy pattern to parse different event types
 */

import { ParseStrategy, ParseContext, ParsedEvent } from './types';
import { BCTradeStrategy } from './strategies/bc-trade-strategy';
import { AMMTradeStrategy } from './strategies/amm-trade-strategy';
import { Logger } from '../core/logger';
import { EventBus, EVENTS } from '../core/event-bus';

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
    try {
      const message = grpcData.transaction?.transaction?.transaction?.message;
      if (message?.accountKeys) {
        for (const key of message.accountKeys) {
          if (Buffer.isBuffer(key)) {
            accounts.push(require('bs58').encode(key));
          }
        }
      }
    } catch (error) {
      // Log error but continue
    }

    // Extract logs
    const logs = grpcData.transaction?.transaction?.meta?.logMessages || [];

    return {
      signature: grpcData.transaction?.signature || '',
      slot: BigInt(grpcData.slot || 0),
      blockTime: grpcData.blockTime,
      accounts,
      logs,
      data: grpcData.data
    };
  }
}