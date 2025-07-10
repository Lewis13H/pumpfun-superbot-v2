/**
 * Unified Event Parser
 * Uses strategy pattern to parse different event types
 */

import { ParseStrategy, ParseContext, ParsedEvent } from './types';
// Import all parsing strategies
import { BCTradeStrategy } from './strategies/bc-trade-strategy';
import { BCTradeIDLStrategy } from './strategies/bc-trade-idl-strategy';
// Enhanced AMM strategy with discriminator detection and fixed mint/amount extraction
import { EnhancedAmmTradeStrategyV2 } from './strategies/enhanced-amm-trade-strategy-v2';
// Consolidated AMM strategies (reduced from 6 to 2)
import { UnifiedAmmTradeStrategy } from './strategies/unified-amm-trade-strategy';
import { AMMTradeHeuristicStrategy } from './strategies/amm-trade-heuristic-strategy';
// Legacy AMM strategies (for backward compatibility - to be removed)
import { AMMTradeStrategy } from './strategies/amm-trade-strategy';
import { AMMTradeInstructionStrategy } from './strategies/amm-trade-instruction-strategy';
import { AMMTradeInnerIxStrategy } from './strategies/amm-trade-inner-ix-strategy';
// Liquidity strategies
import { LiquidityStrategy } from './strategies/liquidity-strategy';
import { AmmLiquidityStrategy } from './strategies/amm-liquidity-strategy';
import { Logger } from '../../core/logger';
import { EventBus } from '../../core/event-bus';
import { ParsingMetricsService } from '../../services/monitoring/parsing-metrics-service';
import bs58 from 'bs58';

export interface ParserOptions {
  strategies?: ParseStrategy[];
  eventBus?: EventBus;
  logErrors?: boolean;
  useIDLParsing?: boolean;
}

export class UnifiedEventParser {
  private strategies: ParseStrategy[];
  private eventBus?: EventBus;
  private logger: Logger;
  private metricsService: ParsingMetricsService;
  private stats = {
    total: 0,
    parsed: 0,
    failed: 0,
    byStrategy: new Map<string, number>()
  };

  constructor(options: ParserOptions = {}) {
    // Phase 2 consolidation: Reduced AMM strategies from 6 to 2
    const useConsolidatedParsers = process.env.USE_CONSOLIDATED_PARSERS !== 'false';
    
    if (useConsolidatedParsers) {
      // New consolidated strategy setup
      this.strategies = options.strategies || [
        // BC strategies (unchanged)
        new BCTradeIDLStrategy(),          // BC trades using IDL (most accurate)
        new BCTradeStrategy(),             // BC trades fallback
        
        // AMM strategies (enhanced with discriminator detection and fixed mint/amount extraction)
        new EnhancedAmmTradeStrategyV2(),   // Primary AMM parser with discriminator detection V2
        new UnifiedAmmTradeStrategy(),      // Secondary AMM parser (combines IDL, inner IX, logs)
        new AMMTradeHeuristicStrategy(),    // Fallback AMM parser for edge cases
        
        // Liquidity strategies (unchanged)
        new AmmLiquidityStrategy(),        // AMM liquidity events (deposit/withdraw) using IDL
        new LiquidityStrategy()            // Generic liquidity events fallback
      ];
    } else {
      // Legacy strategy setup (for rollback)
      this.strategies = options.strategies || [
        new BCTradeIDLStrategy(),          // BC trades using IDL (most accurate)
        new BCTradeStrategy(),             // BC trades fallback
        new AMMTradeInnerIxStrategy(),     // AMM trades from inner instructions (most accurate)
        new AMMTradeHeuristicStrategy(),   // AMM trades with heuristics to get reasonable amounts
        new AMMTradeInstructionStrategy(), // AMM trades from instruction data (has slippage issue)
        new AMMTradeStrategy(),            // AMM trades from logs (last resort)
        new AmmLiquidityStrategy(),        // AMM liquidity events (deposit/withdraw) using IDL
        new LiquidityStrategy()            // Generic liquidity events fallback
      ];
    }
    
    this.eventBus = options.eventBus;
    this.logger = new Logger({ 
      context: 'UnifiedEventParser',
      level: options.logErrors ? 0 : 2 // DEBUG if logErrors, else WARN
    });
    this.metricsService = ParsingMetricsService.getInstance();

    // Initialize strategy stats
    this.strategies.forEach(s => this.stats.byStrategy.set(s.name || 'unnamed', 0));
    
    // Log which parser mode we're using
    this.logger.info('Parser initialized', {
      mode: useConsolidatedParsers ? 'enhanced' : 'legacy',
      ammStrategies: useConsolidatedParsers ? 3 : 6,
      totalStrategies: this.strategies.length,
      primaryAmmParser: useConsolidatedParsers ? 'EnhancedAmmTradeStrategy' : 'AMMTradeInnerIxStrategy'
    });
  }

  /**
   * Parse a transaction into an event
   */
  parse(context: ParseContext): ParsedEvent | null {
    this.stats.total++;

    // Extract program ID from context
    const programId = this.extractProgramId(context);

    // Try each strategy in order
    for (const strategy of this.strategies) {
      const startTime = Date.now();
      try {
        if (strategy.canParse(context)) {
          const result = strategy.parse(context);
          // Handle both single event and array of events
          const events = Array.isArray(result) ? result : (result ? [result] : []);
          const event = events.length > 0 ? events[0] : null;
          
          // Track metrics
          this.metricsService.trackParseAttempt({
            strategy: strategy.name || 'unnamed',
            programId: programId || 'unknown',
            success: event !== null,
            signature: context.signature,
            parseTime: Date.now() - startTime
          });
          
          if (event) {
            this.stats.parsed++;
            const strategyName = strategy.name || 'unnamed';
            this.stats.byStrategy.set(
              strategyName, 
              (this.stats.byStrategy.get(strategyName) || 0) + 1
            );
            
            // Emit parse success event
            if (this.eventBus) {
              this.eventBus.emit('parser:success', {
                strategy: strategy.name || 'unnamed',
                eventType: event.type,
                signature: context.signature
              });
            }
            
            return event as ParsedEvent;
          }
        }
      } catch (error) {
        this.logger.error(`Strategy ${strategy.name || 'unnamed'} failed`, error as Error, {
          signature: context.signature
        });
        
        // Track failed attempt
        this.metricsService.trackParseAttempt({
          strategy: strategy.name || 'unnamed',
          programId: programId || 'unknown',
          success: false,
          error: error as Error,
          signature: context.signature,
          parseTime: Date.now() - startTime
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
    this.stats.byStrategy.set(strategy.name || 'unnamed', 0);
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
    this.strategies.forEach(s => this.stats.byStrategy.set(s.name || 'unnamed', 0));
  }

  /**
   * Extract program ID from parse context
   */
  private extractProgramId(context: ParseContext): string | null {
    // Check logs for program ID
    if (context.logs?.length > 0) {
      for (const log of context.logs) {
        // Look for "Program X invoke" or "Program X success" patterns
        const match = log.match(/Program (\w+) (invoke|success)/);
        if (match) {
          const programId = match[1];
          // Check if it's one of our known programs
          if (programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' || // Pump BC
              programId === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' || // Pump AMM
              programId === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') { // Raydium
            return programId;
          }
        }
      }
    }
    
    // Try to extract from full transaction data
    if (context.fullTransaction?.transaction?.transaction?.message?.accountKeys) {
      const accountKeys = context.fullTransaction.transaction.transaction.message.accountKeys;
      const instructions = context.fullTransaction.transaction.transaction.message.instructions || [];
      
      for (const ix of instructions) {
        if (ix.programIdIndex < accountKeys.length) {
          const programKey = accountKeys[ix.programIdIndex];
          const programId = Buffer.isBuffer(programKey) ? bs58.encode(programKey) : programKey;
          
          // Check if it's one of our known programs
          if (programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' || // Pump BC
              programId === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' || // Pump AMM
              programId === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') { // Raydium
            return programId;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Create a parse context from gRPC data
   */
  static createContext(grpcData: any): ParseContext {
    // Extract accounts from the nested structure
    const accounts: string[] = [];
    let instructionData: Buffer | undefined;
    
    
    let message, meta;
    
    try {
      // Handle the nested gRPC structure
      if (grpcData.transaction?.transaction?.transaction) {
        // Standard gRPC structure: data.transaction.transaction.transaction.message
        message = grpcData.transaction.transaction.transaction.message;
        meta = grpcData.transaction.transaction.meta;
      } else if (grpcData.transaction?.transaction) {
        // Fallback structure
        message = grpcData.transaction.transaction.message;
        meta = grpcData.transaction.meta;
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
    

    // Extract logs (from the correct path)
    const logs = grpcData.transaction?.meta?.logMessages || meta?.logMessages || [];
    
    // If we didn't find instruction data, try to extract from logs
    if (!instructionData && logs.length > 0) {
      for (const log of logs) {
        if (log.includes('Program data:')) {
          const match = log.match(/Program data: (.+)/);
          if (match?.[1]) {
            try {
              instructionData = Buffer.from(match[1], 'base64');
              break;
            } catch (error) {
              // Ignore decode errors
            }
          }
        }
      }
    }
    
    // Extract signature (from the correct path)
    let signature = '';
    const sig = grpcData.transaction?.transaction?.signature || 
                grpcData.transaction?.signature || 
                grpcData.transaction?.transaction?.transaction?.signatures?.[0];
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
      slot: BigInt(grpcData.transaction?.slot || grpcData.transaction?.transaction?.slot || grpcData.slot || 0),
      blockTime: grpcData.transaction?.transaction?.blockTime || grpcData.transaction?.blockTime || grpcData.blockTime || Date.now() / 1000,
      accounts,
      logs,
      data: instructionData,
      accountKeys: message?.accountKeys || [],
      userAddress: accounts[0], // First account is usually the fee payer/user
      fullTransaction: grpcData, // Pass full gRPC data for IDL parsing
      meta: meta, // Include meta data with inner instructions
      innerInstructions: meta?.innerInstructions || [],
      preTokenBalances: meta?.preTokenBalances || [],
      postTokenBalances: meta?.postTokenBalances || []
    };
  }
}