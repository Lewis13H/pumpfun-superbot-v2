/**
 * Unified AMM Trade Parser
 * Consolidates multiple parsing strategies into one reliable parser
 * Primary method for parsing pump.swap AMM trades
 */

import { PublicKey } from '@solana/web3.js';
import { ParseStrategy, ParseContext, AMMTradeEvent, EventType, TradeType } from '../types';
import { AMM_PROGRAM, WSOL_ADDRESS } from '../../config/constants';
import { Logger } from '../../../core/logger';
import { InnerInstructionParser } from '../inner-instruction-parser';
import { EventParserService } from '../../../services/core/event-parser-service';

const logger = new Logger({ context: 'UnifiedAmmTradeStrategy' });

export class UnifiedAmmTradeStrategy implements ParseStrategy {
  name = 'UnifiedAmmTradeStrategy';
  private eventParserService: EventParserService;
  private innerIxParser: InnerInstructionParser;
  private ammProgramId: PublicKey;
  
  constructor() {
    this.ammProgramId = new PublicKey(AMM_PROGRAM);
    this.innerIxParser = new InnerInstructionParser();
    this.eventParserService = EventParserService.getInstance();
  }
  
  canParse(context: ParseContext): boolean {
    // Check if it's from pump.swap AMM program
    const isPumpAMM = context.accounts.some(acc => acc === AMM_PROGRAM);
    if (!isPumpAMM) return false;
    
    // Additional validation - must have logs or inner instructions
    const hasLogs = context.logs && context.logs.length > 0;
    const hasInnerIx = context.innerInstructions && context.innerInstructions.length > 0;
    
    return (hasLogs || hasInnerIx) ?? false;
  }
  
  parse(context: ParseContext): AMMTradeEvent | null {
    try {
      // Primary method: Parse events from logs using IDL
      if (context.logs?.length > 0) {
        const event = this.parseFromEventLogs(context);
        if (event) {
          logger.debug('Successfully parsed AMM trade from event logs', {
            signature: context.signature,
            method: 'event_logs'
          });
          return event;
        }
      }
      
      // Secondary method: Parse from inner instructions
      if (context.innerInstructions && context.innerInstructions.length > 0) {
        const event = this.parseFromInnerInstructions(context);
        if (event) {
          logger.debug('Successfully parsed AMM trade from inner instructions', {
            signature: context.signature,
            method: 'inner_instructions'
          });
          return event;
        }
      }
      
      // Tertiary method: Parse from logs with pattern matching
      if (context.logs?.length > 0) {
        const event = this.parseFromLogPatterns(context);
        if (event) {
          logger.debug('Successfully parsed AMM trade from log patterns', {
            signature: context.signature,
            method: 'log_patterns'
          });
          return event;
        }
      }
      
      // Final fallback: Parse from instruction data if available
      if (context.data) {
        const event = this.parseFromInstructionData(context);
        if (event) {
          logger.debug('Successfully parsed AMM trade from instruction data', {
            signature: context.signature,
            method: 'instruction_data'
          });
          return event;
        }
      }
      
      logger.debug('Failed to parse AMM trade with any method', {
        signature: context.signature,
        hasLogs: !!context.logs?.length,
        hasInnerIx: !!context.innerInstructions?.length,
        hasData: !!context.data
      });
      
      return null;
    } catch (error) {
      logger.debug('Error parsing AMM trade', { 
        error, 
        signature: context.signature 
      });
      return null;
    }
  }
  
  private parseFromEventLogs(context: ParseContext): AMMTradeEvent | null {
    if (!context.logs || context.logs.length === 0) return null;
    
    try {
      // Use the event parser service to extract events
      const events = this.eventParserService.parseLogsForEvents(context.logs);
      
      // Look for swap event
      const swapEvent = events.find((e: any) => e.name === 'SwapEvent');
      if (!swapEvent) return null;
      
      // Extract mint address - prefer token mint over WSOL
      const inputMint = swapEvent.data.inputMint;
      const outputMint = swapEvent.data.outputMint;
      const mintAddress = inputMint === WSOL_ADDRESS ? outputMint : inputMint;
      
      if (!mintAddress) return null;
      
      // Determine trade type based on which mint is WSOL
      const tradeType = inputMint === WSOL_ADDRESS ? TradeType.BUY : TradeType.SELL;
      
      // Get actual amounts from inner instructions if available
      const actualAmounts = this.extractActualAmounts(context);
      
      // Convert string amounts to bigint
      const parseAmount = (val: any): bigint => {
        if (typeof val === 'bigint') return val;
        if (typeof val === 'string') return BigInt(val);
        if (typeof val === 'number') return BigInt(val);
        return 0n;
      };
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress: swapEvent.data.user || context.userAddress || 'unknown',
        mintAddress,
        solAmount: actualAmounts.solAmount || parseAmount(swapEvent.data.inputAmount),
        tokenAmount: actualAmounts.tokenAmount || parseAmount(swapEvent.data.outputAmount),
        tradeType,
        poolAddress: swapEvent.data.pool || this.extractPoolAddress(context) || 'unknown',
        virtualSolReserves: parseAmount(swapEvent.data.poolSolReserves),
        virtualTokenReserves: parseAmount(swapEvent.data.poolTokenReserves),
        // Required AMM fields
        inputMint: tradeType === TradeType.BUY ? WSOL_ADDRESS : mintAddress,
        inAmount: tradeType === TradeType.BUY ? (actualAmounts.solAmount || parseAmount(swapEvent.data.inputAmount)) : (actualAmounts.tokenAmount || parseAmount(swapEvent.data.outputAmount)),
        outputMint: tradeType === TradeType.BUY ? mintAddress : WSOL_ADDRESS,
        outAmount: tradeType === TradeType.BUY ? (actualAmounts.tokenAmount || parseAmount(swapEvent.data.outputAmount)) : (actualAmounts.solAmount || parseAmount(swapEvent.data.inputAmount))
      };
    } catch (error) {
      logger.debug('Failed to parse event logs', { error });
      return null;
    }
  }
  
  private parseFromInnerInstructions(context: ParseContext): AMMTradeEvent | null {
    if (!context.innerInstructions || context.innerInstructions.length === 0) return null;
    
    try {
      const transfers = this.innerIxParser.extractTokenTransfers(context);
      if (transfers.length < 2) return null; // Need at least 2 transfers for a swap
      
      // Group transfers by mint
      const transfersByMint = new Map<string, typeof transfers>();
      transfers.forEach(t => {
        const mint = t.mint || 'SOL';
        if (!transfersByMint.has(mint)) {
          transfersByMint.set(mint, []);
        }
        transfersByMint.get(mint)!.push(t);
      });
      
      // Should have exactly 2 mints (SOL and token)
      if (transfersByMint.size !== 2) return null;
      
      // Find SOL and token transfers
      let solTransfers = transfersByMint.get('SOL') || transfersByMint.get(WSOL_ADDRESS) || [];
      let tokenTransfers: typeof transfers = [];
      let tokenMint = '';
      
      for (const [mint, txfers] of transfersByMint) {
        if (mint !== 'SOL' && mint !== WSOL_ADDRESS) {
          tokenTransfers = txfers;
          tokenMint = mint;
        }
      }
      
      if (!tokenMint || tokenTransfers.length === 0) return null;
      
      // Determine trade direction
      const userAddress = context.userAddress || context.accounts[0];
      const userSentSol = solTransfers.some(t => t.source === userAddress);
      const tradeType = userSentSol ? TradeType.BUY : TradeType.SELL;
      
      // Calculate amounts
      const solAmount = solTransfers.reduce((sum, t) => sum + (t.amount || 0n), 0n);
      const tokenAmount = tokenTransfers.reduce((sum, t) => sum + (t.amount || 0n), 0n);
      
      // Try to find pool address from transfers
      const poolAddress = this.findPoolAddressFromTransfers(transfers) || 
                         this.extractPoolAddress(context) || 
                         'unknown';
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress: userAddress || 'unknown',
        mintAddress: tokenMint,
        solAmount,
        tokenAmount,
        tradeType,
        poolAddress,
        virtualSolReserves: 0n, // Will be enriched later
        virtualTokenReserves: 0n, // Will be enriched later
        // Required AMM fields
        inputMint: tradeType === TradeType.BUY ? WSOL_ADDRESS : tokenMint,
        inAmount: tradeType === TradeType.BUY ? solAmount : tokenAmount,
        outputMint: tradeType === TradeType.BUY ? tokenMint : WSOL_ADDRESS,
        outAmount: tradeType === TradeType.BUY ? tokenAmount : solAmount
      };
    } catch (error) {
      logger.debug('Failed to parse from inner instructions', { error });
      return null;
    }
  }
  
  private parseFromLogPatterns(context: ParseContext): AMMTradeEvent | null {
    if (!context.logs || context.logs.length === 0) return null;
    
    try {
      // Look for common swap patterns in logs
      const swapLog = context.logs.find(log => 
        log.includes('SwapEvent') || 
        log.includes('Swap completed') ||
        log.includes('tokens swapped')
      );
      
      if (!swapLog) return null;
      
      // Extract data using regex patterns
      const patterns = {
        user: /user[:\s]+([A-HJ-NP-Za-km-z1-9]{32,44})/i,
        inputMint: /input_?mint[:\s]+([A-HJ-NP-Za-km-z1-9]{32,44})/i,
        outputMint: /output_?mint[:\s]+([A-HJ-NP-Za-km-z1-9]{32,44})/i,
        inputAmount: /input_?amount[:\s]+(\d+)/i,
        outputAmount: /output_?amount[:\s]+(\d+)/i,
        poolSolReserves: /pool_?sol_?reserves[:\s]+(\d+)/i,
        poolTokenReserves: /pool_?token_?reserves[:\s]+(\d+)/i
      };
      
      const extracted: any = {};
      for (const [key, pattern] of Object.entries(patterns)) {
        const match = swapLog.match(pattern);
        if (match) {
          extracted[key] = match[1];
        }
      }
      
      // Need minimum data to create event
      if (!extracted.inputMint || !extracted.outputMint) return null;
      
      const mintAddress = extracted.inputMint === WSOL_ADDRESS 
        ? extracted.outputMint 
        : extracted.inputMint;
      
      const tradeType = extracted.inputMint === WSOL_ADDRESS 
        ? TradeType.BUY 
        : TradeType.SELL;
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress: extracted.user || context.userAddress || 'unknown',
        mintAddress,
        solAmount: BigInt(extracted.inputAmount || 0),
        tokenAmount: BigInt(extracted.outputAmount || 0),
        tradeType,
        poolAddress: this.extractPoolAddress(context) || 'unknown',
        virtualSolReserves: BigInt(extracted.poolSolReserves || 0),
        virtualTokenReserves: BigInt(extracted.poolTokenReserves || 0),
        // Required AMM fields
        inputMint: extracted.inputMint,
        inAmount: BigInt(extracted.inputAmount || 0),
        outputMint: extracted.outputMint,
        outAmount: BigInt(extracted.outputAmount || 0)
      };
    } catch (error) {
      logger.debug('Failed to parse from log patterns', { error });
      return null;
    }
  }
  
  private parseFromInstructionData(context: ParseContext): AMMTradeEvent | null {
    if (!context.data || context.data.length < 8) return null;
    
    try {
      // Check discriminator for swap instruction
      const discriminator = context.data.slice(0, 8);
      
      // Common swap discriminators (these would need to be verified from IDL)
      const SWAP_DISCRIMINATORS = [
        Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]), // swap
        Buffer.from([51, 183, 127, 103, 13, 178, 109, 168])    // swapExactInput
      ];
      
      const isSwap = SWAP_DISCRIMINATORS.some(d => discriminator.equals(d));
      if (!isSwap) return null;
      
      // Basic parsing - this would need proper deserialization based on IDL
      // For now, return minimal event that can be enriched later
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress: context.userAddress || context.accounts[0] || 'unknown',
        mintAddress: 'unknown', // Would need to extract from accounts
        solAmount: 0n,
        tokenAmount: 0n,
        tradeType: TradeType.BUY, // Would need to determine from data
        poolAddress: this.extractPoolAddress(context) || 'unknown',
        virtualSolReserves: 0n,
        virtualTokenReserves: 0n,
        // Required AMM fields - placeholders for now
        inputMint: WSOL_ADDRESS,
        inAmount: 0n,
        outputMint: 'unknown',
        outAmount: 0n
      };
    } catch (error) {
      logger.debug('Failed to parse from instruction data', { error });
      return null;
    }
  }
  
  private extractActualAmounts(context: ParseContext): {
    solAmount: bigint;
    tokenAmount: bigint;
  } {
    if (!context.innerInstructions || context.innerInstructions.length === 0) {
      return { solAmount: 0n, tokenAmount: 0n };
    }
    
    try {
      const transfers = this.innerIxParser.extractTokenTransfers(context);
      
      const solTransfers = transfers.filter(t => 
        t.mint === 'SOL' || t.mint === WSOL_ADDRESS
      );
      const tokenTransfers = transfers.filter(t => 
        t.mint !== 'SOL' && t.mint !== WSOL_ADDRESS
      );
      
      const solAmount = solTransfers.reduce((sum, t) => sum + (t.amount || 0n), 0n);
      const tokenAmount = tokenTransfers.reduce((sum, t) => sum + (t.amount || 0n), 0n);
      
      return { solAmount, tokenAmount };
    } catch {
      return { solAmount: 0n, tokenAmount: 0n };
    }
  }
  
  private extractPoolAddress(context: ParseContext): string | null {
    // Pool is typically at a specific index in accounts array
    // Based on pump.swap IDL analysis, pool is often at index 4
    if (context.accounts && context.accounts.length > 4) {
      const potentialPool = context.accounts[4];
      // Basic validation - not system program or token program
      if (potentialPool !== '11111111111111111111111111111111' && 
          potentialPool !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        return potentialPool;
      }
    }
    
    return null;
  }
  
  private findPoolAddressFromTransfers(transfers: any[]): string | null {
    // Pool address is usually involved in multiple transfers
    const addressCounts = new Map<string, number>();
    
    transfers.forEach(t => {
      if (t.source) {
        addressCounts.set(t.source, (addressCounts.get(t.source) || 0) + 1);
      }
      if (t.destination) {
        addressCounts.set(t.destination, (addressCounts.get(t.destination) || 0) + 1);
      }
    });
    
    // Find address that appears most (likely the pool)
    let maxCount = 0;
    let poolAddress = null;
    
    for (const [address, count] of addressCounts) {
      if (count > maxCount && 
          address !== '11111111111111111111111111111111' &&
          address !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        maxCount = count;
        poolAddress = address;
      }
    }
    
    return poolAddress;
  }
}