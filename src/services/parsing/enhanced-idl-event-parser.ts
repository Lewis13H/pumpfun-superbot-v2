/**
 * Enhanced IDL Event Parser
 * Combines IDL parsing with manual event extraction for complete coverage
 */

import { EventParser, BorshEventCoder, Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { Logger } from '../../core/logger';
import { eventParserService } from '../core/event-parser-service';
import { PUMP_PROGRAM, PUMP_AMM_PROGRAM } from '../../utils/config/constants';

export interface EnhancedParsedEvent {
  name: string;
  data: any;
  programId: string;
  source: 'idl' | 'manual' | 'log';
}

/**
 * Enhanced parser that tries multiple methods to extract events
 */
export class EnhancedIDLEventParser {
  private logger: Logger;
  private eventParsers: Map<string, EventParser>;
  
  constructor() {
    this.logger = new Logger({ context: 'EnhancedIDLEventParser' });
    this.eventParsers = new Map();
  }
  
  /**
   * Parse events using multiple strategies
   */
  async parseTransaction(transaction: any): Promise<EnhancedParsedEvent[]> {
    const events: EnhancedParsedEvent[] = [];
    
    // Strategy 1: Try existing event parser service (most reliable)
    try {
      const serviceEvents = eventParserService.parseTransaction(transaction);
      if (serviceEvents.length > 0) {
        events.push(...serviceEvents.map(e => ({
          ...e,
          source: 'manual' as const
        })));
        this.logger.debug(`Found ${serviceEvents.length} events using EventParserService`);
      }
    } catch (error) {
      this.logger.debug('EventParserService failed', { error });
    }
    
    // Strategy 2: Parse from logs manually
    if (events.length === 0 && transaction.logs) {
      const logEvents = this.parseFromLogs(transaction);
      if (logEvents.length > 0) {
        events.push(...logEvents);
        this.logger.debug(`Found ${logEvents.length} events from logs`);
      }
    }
    
    // Strategy 3: Try Anchor EventParser if we have proper IDL
    if (events.length === 0) {
      try {
        for (const [programId, parser] of this.eventParsers) {
          const anchorEvents = parser.parseLogs(transaction.logs || []);
          for (const event of anchorEvents) {
            events.push({
              name: event.name,
              data: event.data,
              programId,
              source: 'idl'
            });
          }
        }
      } catch (error) {
        this.logger.debug('Anchor EventParser failed', { error });
      }
    }
    
    return events;
  }
  
  /**
   * Parse events from transaction logs
   */
  private parseFromLogs(transaction: any): EnhancedParsedEvent[] {
    const events: EnhancedParsedEvent[] = [];
    const logs = transaction.logs || transaction.meta?.logMessages || [];
    
    for (const log of logs) {
      // Look for event patterns in logs
      if (log.includes('Program log: Instruction: Create')) {
        const event = this.parseCreateEventFromLog(log, transaction);
        if (event) events.push(event);
      } else if (log.includes('Program log: Instruction: Trade') || 
                 log.includes('Program log: Instruction: Buy') ||
                 log.includes('Program log: Instruction: Sell')) {
        const event = this.parseTradeEventFromLog(log, transaction);
        if (event) events.push(event);
      } else if (log.includes('Program log: Instruction: Complete')) {
        const event = this.parseCompleteEventFromLog(log, transaction);
        if (event) events.push(event);
      }
    }
    
    return events.filter(e => e !== null);
  }
  
  /**
   * Parse create event from log
   */
  private parseCreateEventFromLog(log: string, transaction: any): EnhancedParsedEvent | null {
    try {
      // Extract data from instruction or logs
      const instruction = transaction.instructions?.[0];
      if (!instruction) return null;
      
      return {
        name: 'CreateEvent',
        data: {
          mint: this.extractAccount(transaction, 1), // Usually second account
          bondingCurve: this.extractAccount(transaction, 2),
          creator: this.extractAccount(transaction, 0), // First account is creator
          timestamp: transaction.blockTime || Date.now() / 1000
        },
        programId: PUMP_PROGRAM,
        source: 'log'
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Parse trade event from log
   */
  private parseTradeEventFromLog(log: string, transaction: any): EnhancedParsedEvent | null {
    try {
      const isBuy = log.includes('Buy') || log.includes('buy');
      
      return {
        name: 'TradeEvent',
        data: {
          mint: this.extractAccount(transaction, 1),
          trader: this.extractAccount(transaction, 0),
          isBuy,
          timestamp: transaction.blockTime || Date.now() / 1000
        },
        programId: PUMP_PROGRAM,
        source: 'log'
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Parse complete event from log
   */
  private parseCompleteEventFromLog(log: string, transaction: any): EnhancedParsedEvent | null {
    try {
      return {
        name: 'CompleteEvent',
        data: {
          mint: this.extractAccount(transaction, 1),
          bondingCurve: this.extractAccount(transaction, 2),
          timestamp: transaction.blockTime || Date.now() / 1000
        },
        programId: PUMP_PROGRAM,
        source: 'log'
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract account from transaction
   */
  private extractAccount(transaction: any, index: number): string {
    const accounts = transaction.accounts || 
                    transaction.transaction?.message?.accountKeys ||
                    [];
    return accounts[index]?.pubkey || accounts[index] || '';
  }
  
  /**
   * Check if event matches expected pattern
   */
  isExpectedEvent(event: EnhancedParsedEvent, expectedName: string): boolean {
    return event.name.toLowerCase().includes(expectedName.toLowerCase());
  }
  
  /**
   * Get stats about parsing sources
   */
  getSourceStats(events: EnhancedParsedEvent[]): Record<string, number> {
    const stats: Record<string, number> = {
      idl: 0,
      manual: 0,
      log: 0
    };
    
    for (const event of events) {
      stats[event.source]++;
    }
    
    return stats;
  }
}

// Export singleton
export const enhancedIDLEventParser = new EnhancedIDLEventParser();