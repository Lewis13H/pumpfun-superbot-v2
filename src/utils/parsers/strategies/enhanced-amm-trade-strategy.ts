/**
 * Enhanced AMM Trade Strategy
 * Properly handles pump.swap AMM trades using discriminator detection
 * Replaces the existing unified strategy with correct parsing
 */

import { PublicKey } from '@solana/web3.js';
import { ParseStrategy, ParseContext, AMMTradeEvent, EventType, TradeType } from '../types';
import { AMM_PROGRAM, WSOL_ADDRESS } from '../../config/constants';
import { Logger } from '../../../core/logger';
import { InnerInstructionParser } from '../inner-instruction-parser';
import bs58 from 'bs58';

const logger = new Logger({ context: 'EnhancedAmmTradeStrategy' });

export class EnhancedAmmTradeStrategy implements ParseStrategy {
  name = 'EnhancedAmmTradeStrategy';
  private innerIxParser: InnerInstructionParser;
  
  // Discriminators from pump AMM IDL
  private readonly BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
  private readonly SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
  
  constructor() {
    this.innerIxParser = new InnerInstructionParser();
  }
  
  canParse(context: ParseContext): boolean {
    // Check if this transaction involves the pump.swap AMM program
    return this.hasAMMProgram(context);
  }
  
  parse(context: ParseContext): AMMTradeEvent | null {
    try {
      // Primary method: Parse from instruction discriminators
      const discriminatorEvent = this.parseFromDiscriminator(context);
      if (discriminatorEvent) {
        logger.debug('Successfully parsed AMM trade from discriminator', {
          signature: context.signature,
          tradeType: discriminatorEvent.tradeType
        });
        return discriminatorEvent;
      }
      
      // Fallback: Parse from inner instructions if available
      if (context.innerInstructions && context.innerInstructions.length > 0) {
        const innerIxEvent = this.parseFromEnhancedInnerInstructions(context);
        if (innerIxEvent) {
          logger.debug('Successfully parsed AMM trade from inner instructions', {
            signature: context.signature
          });
          return innerIxEvent;
        }
      }
      
      logger.debug('Failed to parse AMM trade', {
        signature: context.signature,
        hasInnerIx: !!context.innerInstructions?.length
      });
      
      return null;
    } catch (error) {
      logger.error('Error parsing AMM trade', error as Error, {
        signature: context.signature
      });
      return null;
    }
  }
  
  private hasAMMProgram(context: ParseContext): boolean {
    // Check in account keys
    if (context.accounts?.includes(AMM_PROGRAM)) {
      return true;
    }
    
    // Check in instructions
    const instructions = this.extractAllInstructions(context);
    return instructions.some(ix => this.getInstructionProgram(ix, context) === AMM_PROGRAM);
  }
  
  private parseFromDiscriminator(context: ParseContext): AMMTradeEvent | null {
    const instructions = this.extractAllInstructions(context);
    
    for (const ix of instructions) {
      const programId = this.getInstructionProgram(ix, context);
      if (programId !== AMM_PROGRAM) continue;
      
      // Get instruction data
      const data = this.getInstructionData(ix);
      if (!data || data.length < 8) continue;
      
      // Check discriminator
      const discriminator = data.slice(0, 8);
      
      if (discriminator.equals(this.BUY_DISCRIMINATOR)) {
        return this.parseBuyInstruction(ix, context);
      } else if (discriminator.equals(this.SELL_DISCRIMINATOR)) {
        return this.parseSellInstruction(ix, context);
      }
    }
    
    return null;
  }
  
  private parseBuyInstruction(ix: any, context: ParseContext): AMMTradeEvent | null {
    try {
      // Extract accounts based on IDL structure
      const accounts = this.getInstructionAccounts(ix, context);
      if (accounts.length < 9) return null;
      
      // Account indices from IDL:
      // 0: pool, 1: user, 2: global_config, 3: base_mint, 4: quote_mint
      // 5: user_base_token, 6: user_quote_token, 7: pool_base_token, 8: pool_quote_token
      
      const poolAddress = accounts[0];
      const userAddress = accounts[1];
      const baseMint = accounts[3];
      const quoteMint = accounts[4];
      
      // For pump.swap, quote is always SOL and base is the token
      const mintAddress = baseMint;
      
      // Get actual amounts from inner instructions
      const transfers = this.extractTransfersFromContext(context);
      const { solAmount, tokenAmount } = this.calculateAmountsFromTransfers(transfers, mintAddress, 'buy');
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress,
        mintAddress,
        solAmount,
        tokenAmount,
        tradeType: TradeType.BUY,
        poolAddress,
        virtualSolReserves: 0n, // Will be enriched by pool state
        virtualTokenReserves: 0n, // Will be enriched by pool state
        // AMM specific fields
        inputMint: quoteMint, // SOL for buys
        inAmount: solAmount,
        outputMint: baseMint, // Token for buys
        outAmount: tokenAmount
      };
    } catch (error) {
      logger.debug('Failed to parse buy instruction', { error });
      return null;
    }
  }
  
  private parseSellInstruction(ix: any, context: ParseContext): AMMTradeEvent | null {
    try {
      // Extract accounts based on IDL structure
      const accounts = this.getInstructionAccounts(ix, context);
      if (accounts.length < 9) return null;
      
      const poolAddress = accounts[0];
      const userAddress = accounts[1];
      const baseMint = accounts[3];
      const quoteMint = accounts[4];
      
      // For pump.swap, quote is always SOL and base is the token
      const mintAddress = baseMint;
      
      // Get actual amounts from inner instructions
      const transfers = this.extractTransfersFromContext(context);
      const { solAmount, tokenAmount } = this.calculateAmountsFromTransfers(transfers, mintAddress, 'sell');
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress,
        mintAddress,
        solAmount,
        tokenAmount,
        tradeType: TradeType.SELL,
        poolAddress,
        virtualSolReserves: 0n, // Will be enriched by pool state
        virtualTokenReserves: 0n, // Will be enriched by pool state
        // AMM specific fields
        inputMint: baseMint, // Token for sells
        inAmount: tokenAmount,
        outputMint: quoteMint, // SOL for sells
        outAmount: solAmount
      };
    } catch (error) {
      logger.debug('Failed to parse sell instruction', { error });
      return null;
    }
  }
  
  private parseFromEnhancedInnerInstructions(context: ParseContext): AMMTradeEvent | null {
    if (!context.innerInstructions || context.innerInstructions.length === 0) return null;
    
    try {
      const transfers = this.innerIxParser.extractTokenTransfers(context);
      if (transfers.length < 2) return null;
      
      // Find the AMM instruction in the main instructions
      const ammInstruction = this.findAMMInstruction(context);
      if (!ammInstruction) return null;
      
      // Determine trade type from transfers
      const userAddress = context.userAddress || context.accounts[0];
      const { tradeType, mintAddress, solAmount, tokenAmount } = 
        this.analyzeTransfers(transfers, userAddress);
      
      if (!mintAddress) return null;
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress: userAddress || 'unknown',
        mintAddress,
        solAmount,
        tokenAmount,
        tradeType,
        poolAddress: this.findPoolAddress(transfers, context) || 'unknown',
        virtualSolReserves: 0n,
        virtualTokenReserves: 0n,
        inputMint: tradeType === TradeType.BUY ? WSOL_ADDRESS : mintAddress,
        inAmount: tradeType === TradeType.BUY ? solAmount : tokenAmount,
        outputMint: tradeType === TradeType.BUY ? mintAddress : WSOL_ADDRESS,
        outAmount: tradeType === TradeType.BUY ? tokenAmount : solAmount
      };
    } catch (error) {
      logger.debug('Failed to parse from enhanced inner instructions', { error });
      return null;
    }
  }
  
  // Helper methods
  
  private extractAllInstructions(context: ParseContext): any[] {
    const instructions: any[] = [];
    
    // Check if we have compiled instructions from full transaction
    if (context.fullTransaction?.transaction?.transaction?.message?.compiledInstructions) {
      instructions.push(...context.fullTransaction.transaction.transaction.message.compiledInstructions);
    } else if (context.fullTransaction?.transaction?.message?.compiledInstructions) {
      instructions.push(...context.fullTransaction.transaction.message.compiledInstructions);
    }
    
    // Add inner instructions
    if (context.innerInstructions) {
      context.innerInstructions.forEach(group => {
        if (group.instructions) {
          instructions.push(...group.instructions);
        }
      });
    }
    
    return instructions;
  }
  
  private getInstructionProgram(ix: any, context: ParseContext): string | null {
    if (ix.programId) {
      return typeof ix.programId === 'string' ? ix.programId : ix.programId.toString();
    }
    
    if (typeof ix.programIdIndex === 'number' && context.accounts) {
      return context.accounts[ix.programIdIndex] || null;
    }
    
    return null;
  }
  
  private getInstructionData(ix: any): Buffer | null {
    if (!ix.data) return null;
    
    if (Buffer.isBuffer(ix.data)) return ix.data;
    if (typeof ix.data === 'string') {
      return Buffer.from(ix.data, 'base64');
    }
    if (Array.isArray(ix.data)) {
      return Buffer.from(ix.data);
    }
    
    return null;
  }
  
  private getInstructionAccounts(ix: any, context: ParseContext): string[] {
    const accounts: string[] = [];
    
    if (!ix.accounts || !context.accounts) return accounts;
    
    // Convert account indices to addresses
    for (const accountIndex of ix.accounts) {
      if (typeof accountIndex === 'number' && context.accounts[accountIndex]) {
        accounts.push(context.accounts[accountIndex]);
      }
    }
    
    return accounts;
  }
  
  private extractTransfersFromContext(context: ParseContext): any[] {
    if (!context.innerInstructions || context.innerInstructions.length === 0) return [];
    
    try {
      return this.innerIxParser.extractTokenTransfers(context);
    } catch {
      return [];
    }
  }
  
  private calculateAmountsFromTransfers(
    transfers: any[], 
    mintAddress: string, 
    tradeType: 'buy' | 'sell'
  ): { solAmount: bigint; tokenAmount: bigint } {
    let solAmount = 0n;
    let tokenAmount = 0n;
    
    for (const transfer of transfers) {
      if (transfer.mint === 'SOL' || transfer.mint === WSOL_ADDRESS) {
        solAmount += transfer.amount || 0n;
      } else if (transfer.mint === mintAddress) {
        tokenAmount += transfer.amount || 0n;
      }
    }
    
    return { solAmount, tokenAmount };
  }
  
  private findAMMInstruction(context: ParseContext): any {
    const instructions = this.extractAllInstructions(context);
    
    for (const ix of instructions) {
      const programId = this.getInstructionProgram(ix, context);
      if (programId === AMM_PROGRAM) {
        return ix;
      }
    }
    
    return null;
  }
  
  private analyzeTransfers(transfers: any[], userAddress: string): {
    tradeType: TradeType;
    mintAddress: string;
    solAmount: bigint;
    tokenAmount: bigint;
  } {
    let solAmount = 0n;
    let tokenAmount = 0n;
    let mintAddress = '';
    let userSentSol = false;
    
    for (const transfer of transfers) {
      if (transfer.mint === 'SOL' || transfer.mint === WSOL_ADDRESS) {
        solAmount += transfer.amount || 0n;
        if (transfer.source === userAddress) {
          userSentSol = true;
        }
      } else if (transfer.mint) {
        tokenAmount += transfer.amount || 0n;
        mintAddress = transfer.mint;
      }
    }
    
    const tradeType = userSentSol ? TradeType.BUY : TradeType.SELL;
    
    return { tradeType, mintAddress, solAmount, tokenAmount };
  }
  
  private findPoolAddress(transfers: any[], context: ParseContext): string | null {
    // Pool address is typically involved in multiple transfers
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
    
    // Fallback to extracting from context accounts
    if (!poolAddress && context.accounts && context.accounts.length > 4) {
      // Pool is typically at index 4 in pump.swap transactions
      poolAddress = context.accounts[4];
    }
    
    return poolAddress;
  }
}