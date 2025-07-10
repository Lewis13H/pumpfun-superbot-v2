/**
 * Enhanced AMM Trade Strategy V2
 * Fixes mint address extraction and amount parsing for pump.swap AMM trades
 */

import { PublicKey } from '@solana/web3.js';
import { ParseStrategy, ParseContext, AMMTradeEvent, EventType, TradeType } from '../types';
import { AMM_PROGRAM, WSOL_ADDRESS } from '../../config/constants';
import { Logger } from '../../../core/logger';
import { InnerInstructionParser } from '../inner-instruction-parser';
import bs58 from 'bs58';
import { BN } from '@coral-xyz/anchor';

const logger = new Logger({ context: 'EnhancedAmmTradeStrategyV2' });

export class EnhancedAmmTradeStrategyV2 implements ParseStrategy {
  name = 'EnhancedAmmTradeStrategyV2';
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
          tradeType: discriminatorEvent.tradeType === TradeType.BUY ? 'BUY' : 'SELL',
          mint: discriminatorEvent.mintAddress,
          solAmount: discriminatorEvent.solAmount.toString(),
          tokenAmount: discriminatorEvent.tokenAmount.toString()
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
        return this.parseBuyInstruction(ix, data, context);
      } else if (discriminator.equals(this.SELL_DISCRIMINATOR)) {
        return this.parseSellInstruction(ix, data, context);
      }
    }
    
    return null;
  }
  
  private parseBuyInstruction(ix: any, data: Buffer, context: ParseContext): AMMTradeEvent | null {
    try {
      // Extract accounts based on IDL structure
      const accounts = this.getInstructionAccounts(ix, context);
      if (accounts.length < 9) {
        logger.debug('Insufficient accounts for buy instruction', {
          accountCount: accounts.length,
          signature: context.signature
        });
        return null;
      }
      
      // Account indices from IDL:
      // 0: pool, 1: user, 2: global_config, 3: base_mint, 4: quote_mint
      // 5: user_base_token, 6: user_quote_token, 7: pool_base_token, 8: pool_quote_token
      
      const poolAddress = accounts[0];
      const userAddress = accounts[1];
      const baseMint = accounts[3];    // This is the token mint
      const quoteMint = accounts[4];   // This is SOL mint
      
      // Verify quote mint is SOL
      if (quoteMint !== WSOL_ADDRESS) {
        logger.debug('Quote mint is not SOL for buy', {
          quoteMint,
          expected: WSOL_ADDRESS
        });
      }
      
      // Parse amounts from instruction data
      // After discriminator (8 bytes), the data typically contains:
      // - amount_in (8 bytes) - SOL amount for buy
      // - min_amount_out (8 bytes) - minimum token amount expected
      let solAmount = 0n;
      let minTokenAmount = 0n;
      
      if (data.length >= 24) {
        try {
          // Read amount_in (SOL amount)
          const amountInBuffer = data.slice(8, 16);
          solAmount = new BN(amountInBuffer, 'le').toBigInt();
          
          // Read min_amount_out
          const minAmountOutBuffer = data.slice(16, 24);
          minTokenAmount = new BN(minAmountOutBuffer, 'le').toBigInt();
        } catch (e) {
          logger.debug('Failed to parse amounts from instruction data', { error: e });
        }
      }
      
      // Get actual amounts from inner instructions if available
      const actualAmounts = this.extractActualAmounts(context, baseMint);
      const tokenAmount = actualAmounts.tokenAmount || minTokenAmount;
      
      // Use actual SOL amount if available, otherwise use instruction data
      if (actualAmounts.solAmount > 0n) {
        solAmount = actualAmounts.solAmount;
      }
      
      logger.debug('Parsed buy instruction', {
        userAddress,
        baseMint,
        quoteMint,
        solAmount: solAmount.toString(),
        tokenAmount: tokenAmount.toString(),
        signature: context.signature
      });
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress,
        mintAddress: baseMint,  // Use the actual token mint, not SOL
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
  
  private parseSellInstruction(ix: any, data: Buffer, context: ParseContext): AMMTradeEvent | null {
    try {
      // Extract accounts based on IDL structure
      const accounts = this.getInstructionAccounts(ix, context);
      if (accounts.length < 9) {
        logger.debug('Insufficient accounts for sell instruction', {
          accountCount: accounts.length,
          signature: context.signature
        });
        return null;
      }
      
      const poolAddress = accounts[0];
      const userAddress = accounts[1];
      const baseMint = accounts[3];    // This is the token mint
      const quoteMint = accounts[4];   // This is SOL mint
      
      // Parse amounts from instruction data
      // After discriminator (8 bytes), the data typically contains:
      // - amount_in (8 bytes) - token amount for sell
      // - min_amount_out (8 bytes) - minimum SOL amount expected
      let tokenAmount = 0n;
      let minSolAmount = 0n;
      
      if (data.length >= 24) {
        try {
          // Read amount_in (token amount)
          const amountInBuffer = data.slice(8, 16);
          tokenAmount = new BN(amountInBuffer, 'le').toBigInt();
          
          // Read min_amount_out
          const minAmountOutBuffer = data.slice(16, 24);
          minSolAmount = new BN(minAmountOutBuffer, 'le').toBigInt();
        } catch (e) {
          logger.debug('Failed to parse amounts from instruction data', { error: e });
        }
      }
      
      // Get actual amounts from inner instructions if available
      const actualAmounts = this.extractActualAmounts(context, baseMint);
      const solAmount = actualAmounts.solAmount || minSolAmount;
      
      // Use actual token amount if available
      if (actualAmounts.tokenAmount > 0n) {
        tokenAmount = actualAmounts.tokenAmount;
      }
      
      logger.debug('Parsed sell instruction', {
        userAddress,
        baseMint,
        quoteMint,
        solAmount: solAmount.toString(),
        tokenAmount: tokenAmount.toString(),
        signature: context.signature
      });
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress,
        mintAddress: baseMint,  // Use the actual token mint, not SOL
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
  
  private extractActualAmounts(context: ParseContext, mintAddress: string): {
    solAmount: bigint;
    tokenAmount: bigint;
  } {
    if (!context.innerInstructions || context.innerInstructions.length === 0) {
      return { solAmount: 0n, tokenAmount: 0n };
    }
    
    try {
      const transfers = this.innerIxParser.extractTokenTransfers(context);
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
    } catch {
      return { solAmount: 0n, tokenAmount: 0n };
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
      
      // Get accounts from AMM instruction
      const accounts = this.getInstructionAccounts(ammInstruction, context);
      if (accounts.length < 9) return null;
      
      const poolAddress = accounts[0];
      const userAddress = accounts[1];
      const baseMint = accounts[3];
      
      // Determine trade type from transfers
      const { tradeType, solAmount, tokenAmount } = 
        this.analyzeTransfers(transfers, userAddress);
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        userAddress,
        mintAddress: baseMint,
        solAmount,
        tokenAmount,
        tradeType,
        poolAddress,
        virtualSolReserves: 0n,
        virtualTokenReserves: 0n,
        inputMint: tradeType === TradeType.BUY ? WSOL_ADDRESS : baseMint,
        inAmount: tradeType === TradeType.BUY ? solAmount : tokenAmount,
        outputMint: tradeType === TradeType.BUY ? baseMint : WSOL_ADDRESS,
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
    } else if (context.fullTransaction?.transaction?.transaction?.message?.instructions) {
      instructions.push(...context.fullTransaction.transaction.transaction.message.instructions);
    } else if (context.fullTransaction?.transaction?.message?.instructions) {
      instructions.push(...context.fullTransaction.transaction.message.instructions);
    }
    
    // Add inner instructions if available
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
    if (ix.data.type === 'Buffer' && Array.isArray(ix.data.data)) {
      return Buffer.from(ix.data.data);
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
    solAmount: bigint;
    tokenAmount: bigint;
  } {
    let solAmount = 0n;
    let tokenAmount = 0n;
    let userSentSol = false;
    
    for (const transfer of transfers) {
      if (transfer.mint === 'SOL' || transfer.mint === WSOL_ADDRESS) {
        solAmount += transfer.amount || 0n;
        if (transfer.source === userAddress) {
          userSentSol = true;
        }
      } else if (transfer.mint) {
        tokenAmount += transfer.amount || 0n;
      }
    }
    
    const tradeType = userSentSol ? TradeType.BUY : TradeType.SELL;
    
    return { tradeType, solAmount, tokenAmount };
  }
}