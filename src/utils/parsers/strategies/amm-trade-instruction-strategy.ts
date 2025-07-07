/**
 * AMM Trade Instruction Parsing Strategy
 * Handles pump.swap AMM trades by parsing instruction data
 */

import { ParseStrategy, ParseContext, AMMTradeEvent, EventType, TradeType } from '../types';
import { AMM_PROGRAM } from '../../config/constants';
import { Logger } from '../../../core/logger';
import bs58 from 'bs58';

const logger = new Logger({ context: 'AMMTradeInstructionStrategy' });

// AMM instruction discriminators (from IDL)
const DISCRIMINATORS = {
  BUY: 102,   // Discriminator for buy instruction [102, 6, 61, 18, 1, 218, 235, 234]
  SELL: 51    // Discriminator for sell instruction [51, 230, 133, 164, 1, 127, 131, 173]
};

export class AMMTradeInstructionStrategy implements ParseStrategy {
  name = 'AMMTradeInstructionStrategy';

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
      
      // Find AMM instructions
      let buyInstruction = null;
      let sellInstruction = null;
      
      for (const ix of instructions) {
        const programIdIndex = ix.programIdIndex;
        if (programIdIndex >= accountStrs.length) continue;
        
        const programId = accountStrs[programIdIndex];
        if (programId !== AMM_PROGRAM || !ix.data) continue;
        
        const dataBuffer = Buffer.from(ix.data, 'base64');
        const discriminator = dataBuffer[0];
        
        if (discriminator === DISCRIMINATORS.BUY) {
          buyInstruction = { ix, dataBuffer };
        } else if (discriminator === DISCRIMINATORS.SELL) {
          sellInstruction = { ix, dataBuffer };
        }
      }
      
      // Use whichever instruction we found (prefer buy for user perspective)
      const instruction = buyInstruction || sellInstruction;
      if (!instruction) return null;
      
      const { ix, dataBuffer } = instruction;
      const isBuy = dataBuffer[0] === DISCRIMINATORS.BUY;
      
      // Parse amounts from instruction data
      // AMM instruction data format (17 bytes):
      // - 1 byte: discriminator
      // - 8 bytes: base_amount_out/base_amount_in
      // - 8 bytes: max_quote_amount_in/min_quote_amount_out
      const baseAmount = this.readUInt64LE(dataBuffer, 1);
      const quoteAmount = this.readUInt64LE(dataBuffer, 9);
      
      // Get accounts involved
      const instructionAccounts = ix.accounts || [];
      const userAddress = instructionAccounts.length > 0 ? accountStrs[instructionAccounts[0]] : accountStrs[0];
      const poolAddress = this.findPoolAccount(accountStrs, instructionAccounts);
      
      // Find token mint
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const tokenMint = this.findTokenMint(accountStrs, SOL_MINT);
      
      // Try to get actual amounts from logs first
      const actualAmounts = this.extractActualAmounts(context.logs, isBuy);
      
      // For AMM trades, we need to determine SOL and token amounts
      let solAmount: bigint;
      let tokenAmount: bigint;
      
      if (actualAmounts) {
        // Use actual amounts from logs
        solAmount = actualAmounts.solAmount;
        tokenAmount = actualAmounts.tokenAmount;
      } else {
        // Fallback to instruction data (these are desired/limit amounts, not actual)
        if (isBuy) {
          // User is buying tokens with SOL
          // baseAmount = base_amount_out (tokens desired)
          // quoteAmount = max_quote_amount_in (max SOL to spend)
          tokenAmount = baseAmount;
          solAmount = quoteAmount; // This is max, not actual
        } else {
          // User is selling tokens for SOL
          // baseAmount = base_amount_in (tokens to sell)
          // quoteAmount = min_quote_amount_out (min SOL to receive)
          tokenAmount = baseAmount;
          solAmount = quoteAmount; // This is min, not actual
        }
      }
      
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
        tokenAmount,
        virtualSolReserves: 0n, // Not available from instruction data
        virtualTokenReserves: 0n // Not available from instruction data
      };
    } catch (error) {
      logger.debug('Failed to parse AMM trade from instruction', { error, signature: context.signature });
      return null;
    }
  }

  private findPoolAccount(accountStrs: string[], instructionAccounts: number[]): string | null {
    // Pool is typically one of the instruction accounts (not first which is user)
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
    // Token mint is typically a non-SOL, non-program account
    for (const account of accountStrs) {
      if (account !== solMint && 
          account !== AMM_PROGRAM && 
          account.length === 44 &&
          !account.includes('11111111') && // Not system program
          !account.includes('TokenkegQ') && // Not token program
          !account.includes('ATokenGPv') && // Not associated token program
          !account.includes('ComputeBudget')) { // Not compute budget
        return account;
      }
    }
    return null;
  }

  private readUInt64LE(buffer: Buffer, offset: number): bigint {
    if (offset + 8 > buffer.length) return 0n;
    const low = buffer.readUInt32LE(offset);
    const high = buffer.readUInt32LE(offset + 4);
    return BigInt(low) + (BigInt(high) << 32n);
  }

  private extractActualAmounts(logs: string[], isBuy: boolean): { solAmount: bigint, tokenAmount: bigint } | null {
    // Try to extract from ray_log
    for (const log of logs) {
      if (log.includes('ray_log:')) {
        const match = log.match(/ray_log:\s*([A-Za-z0-9+/=]+)/);
        if (match) {
          try {
            const data = Buffer.from(match[1], 'base64');
            // Ray log often contains actual swap amounts
            if (data.length >= 16) {
              const amount1 = this.readUInt64LE(data, 0);
              const amount2 = this.readUInt64LE(data, 8);
              
              // For pump.swap, typically:
              // - First amount is SOL amount
              // - Second amount is token amount
              // But this might vary, so we use a heuristic
              
              // Reasonable SOL amount is typically < 1000 SOL
              const MAX_REASONABLE_SOL = 1000n * 1_000_000_000n;
              
              if (amount1 < MAX_REASONABLE_SOL && amount2 > amount1) {
                // amount1 is likely SOL, amount2 is likely tokens
                return { solAmount: amount1, tokenAmount: amount2 };
              } else if (amount2 < MAX_REASONABLE_SOL && amount1 > amount2) {
                // amount2 is likely SOL, amount1 is likely tokens
                return { solAmount: amount2, tokenAmount: amount1 };
              }
            }
          } catch (e) {
            // Continue to next log
          }
        }
      }
    }
    
    return null;
  }
}