/**
 * AMM Trade Heuristic Parsing Strategy
 * Uses heuristics to determine reasonable trade amounts when metadata is not available
 */

import { ParseStrategy, ParseContext, AMMTradeEvent, EventType, TradeType } from '../types';
import { AMM_PROGRAM } from '../../config/constants';
import { Logger } from '../../../core/logger';
import bs58 from 'bs58';

const logger = new Logger({ context: 'AMMTradeHeuristicStrategy' });

// Correct discriminators from IDL
const DISCRIMINATORS = {
  BUY: 102,   // Discriminator for buy instruction
  SELL: 51    // Discriminator for sell instruction
};

export class AMMTradeHeuristicStrategy implements ParseStrategy {
  name = 'AMMTradeHeuristicStrategy';

  canParse(context: ParseContext): boolean {
    // Check if it's from pump.swap AMM program
    const isAMMProgram = context.accounts.some(acc => acc === AMM_PROGRAM);
    if (!isAMMProgram) return false;

    // Check if we have the full transaction data
    const fullTx = context.fullTransaction;
    if (!fullTx?.transaction?.transaction?.transaction) return false;

    const tx = fullTx.transaction.transaction.transaction;
    const instructions = tx.message?.instructions || [];
    
    // Look for AMM instruction
    return instructions.some((ix: any) => {
      const programIdIndex = ix.programIdIndex;
      const accountKeys = tx.message?.accountKeys || [];
      if (programIdIndex >= accountKeys.length) return false;
      
      const programId = accountKeys[programIdIndex];
      const programIdStr = typeof programId === 'string' ? programId : 
                          Buffer.isBuffer(programId) ? bs58.encode(programId) : '';
      
      return programIdStr === AMM_PROGRAM && ix.data;
    });
  }

  parse(context: ParseContext): AMMTradeEvent | null {
    try {
      const fullTx = context.fullTransaction;
      const tx = fullTx.transaction.transaction.transaction;
      const accountKeys = tx.message?.accountKeys || [];
      const instructions = tx.message?.instructions || [];
      
      // Convert account keys to strings
      const accountStrs = accountKeys.map((acc: any) => 
        typeof acc === 'string' ? acc : bs58.encode(acc)
      );
      
      // Find AMM instruction
      let ammInstruction = null;
      
      for (const ix of instructions) {
        const programIdIndex = ix.programIdIndex;
        if (programIdIndex >= accountStrs.length) continue;
        
        const programId = accountStrs[programIdIndex];
        if (programId !== AMM_PROGRAM || !ix.data) continue;
        
        ammInstruction = ix;
        break;
      }
      
      if (!ammInstruction) return null;
      
      const dataBuffer = Buffer.from(ammInstruction.data, 'base64');
      const discriminator = dataBuffer[0];
      
      // Check if it's buy or sell
      const isBuy = discriminator === DISCRIMINATORS.BUY;
      const isSell = discriminator === DISCRIMINATORS.SELL;
      
      if (!isBuy && !isSell) return null;
      
      // Parse amounts from instruction data
      const baseAmount = this.readUInt64LE(dataBuffer, 1);
      const quoteAmount = this.readUInt64LE(dataBuffer, 9);
      
      // Apply heuristics to determine actual amounts
      const { solAmount, tokenAmount } = this.applyHeuristics(
        baseAmount,
        quoteAmount,
        isBuy,
        context.logs
      );
      
      // Get accounts involved
      const instructionAccounts = ammInstruction.accounts || [];
      const userAddress = instructionAccounts.length > 0 ? accountStrs[instructionAccounts[0]] : accountStrs[0];
      const poolAddress = this.findPoolAccount(accountStrs, instructionAccounts);
      
      // Find token mint
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const tokenMint = this.findTokenMint(accountStrs, SOL_MINT);
      
      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        tradeType: isBuy ? TradeType.BUY : TradeType.SELL,
        mintAddress: tokenMint || 'unknown',
        userAddress,
        poolAddress: poolAddress || 'unknown',
        inputMint: isBuy ? SOL_MINT : tokenMint || 'unknown',
        inAmount: isBuy ? solAmount : tokenAmount,
        outputMint: isBuy ? tokenMint || 'unknown' : SOL_MINT,
        outAmount: isBuy ? tokenAmount : solAmount,
        solAmount,
        tokenAmount
      };
    } catch (error) {
      logger.debug('Failed to parse AMM trade with heuristics', { error, signature: context.signature });
      return null;
    }
  }

  private applyHeuristics(
    baseAmount: bigint,
    quoteAmount: bigint,
    isBuy: boolean,
    _logs: string[]
  ): { solAmount: bigint, tokenAmount: bigint } {
    // More aggressive heuristics based on typical pump.fun trading patterns
    const MAX_TYPICAL_SOL = 100n * 1_000_000_000n; // 100 SOL is typical max
    const MIN_REASONABLE_SOL = 10_000_000n; // 0.01 SOL minimum
    
    // Check if amounts are in the billions range (indicating they're slippage params)
    const BILLION = 1_000_000_000n;
    const isBillionsRange = quoteAmount > BILLION * BILLION; // > 1 billion SOL
    
    if (isBuy) {
      // For buy: baseAmount is desired tokens, quoteAmount is max SOL to spend
      let estimatedSolAmount = quoteAmount;
      
      // If quote amount is absurdly high (billions of SOL), it's definitely a slippage param
      if (isBillionsRange) {
        // Typical buy amounts are 0.1-10 SOL
        // Use a very aggressive scaling: divide by 1 billion
        estimatedSolAmount = quoteAmount / BILLION;
        
        // Further adjust if still too high
        if (estimatedSolAmount > MAX_TYPICAL_SOL) {
          estimatedSolAmount = estimatedSolAmount / 1000n;
        }
      } else if (quoteAmount > MAX_TYPICAL_SOL) {
        // Less extreme but still high - divide by 100
        estimatedSolAmount = quoteAmount / 100n;
      }
      
      // Ensure within reasonable bounds
      if (estimatedSolAmount > MAX_TYPICAL_SOL) {
        estimatedSolAmount = MAX_TYPICAL_SOL;
      }
      if (estimatedSolAmount < MIN_REASONABLE_SOL) {
        estimatedSolAmount = MIN_REASONABLE_SOL;
      }
      
      return { solAmount: estimatedSolAmount, tokenAmount: baseAmount };
    } else {
      // For sell: baseAmount is tokens to sell, quoteAmount is min SOL to receive
      let estimatedSolAmount = quoteAmount;
      
      // Similar logic for sells
      if (isBillionsRange) {
        // Divide by 1 billion for extreme values
        estimatedSolAmount = quoteAmount / BILLION;
        
        // Further adjust if still too high
        if (estimatedSolAmount > MAX_TYPICAL_SOL) {
          estimatedSolAmount = estimatedSolAmount / 1000n;
        }
      } else if (quoteAmount > MAX_TYPICAL_SOL) {
        // Divide by 100 for moderately high values
        estimatedSolAmount = quoteAmount / 100n;
      }
      
      // Ensure within reasonable bounds
      if (estimatedSolAmount > MAX_TYPICAL_SOL) {
        estimatedSolAmount = MAX_TYPICAL_SOL;
      }
      if (estimatedSolAmount < MIN_REASONABLE_SOL) {
        estimatedSolAmount = MIN_REASONABLE_SOL;
      }
      
      return { solAmount: estimatedSolAmount, tokenAmount: baseAmount };
    }
  }


  private findPoolAccount(accountStrs: string[], instructionAccounts: number[]): string | null {
    for (let i = 1; i < Math.min(instructionAccounts.length, 5); i++) {
      const accountIndex = instructionAccounts[i];
      if (accountIndex < accountStrs.length) {
        const account = accountStrs[accountIndex];
        if (account !== AMM_PROGRAM && account.length === 44) {
          return account;
        }
      }
    }
    return null;
  }

  private findTokenMint(accountStrs: string[], solMint: string): string | null {
    for (const account of accountStrs) {
      if (account !== solMint && 
          account !== AMM_PROGRAM && 
          account.length === 44 &&
          !account.includes('11111111') &&
          !account.includes('TokenkegQ') &&
          !account.includes('ATokenGPv') &&
          !account.includes('ComputeBudget')) {
        return account;
      }
    }
    return null;
  }

  private readUInt64LE(buffer: Buffer, offset: number): bigint {
    if (offset + 8 > buffer.length) return 0n;
    let value = 0n;
    for (let i = 0; i < 8; i++) {
      value += BigInt(buffer[offset + i]) << BigInt(i * 8);
    }
    return value;
  }
}