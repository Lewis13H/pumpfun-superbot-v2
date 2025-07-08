/**
 * AMM Trade IDL-based Parsing Strategy
 * Uses the pump.swap IDL to correctly parse AMM trades
 */

import { ParseStrategy, ParseContext, AMMTradeEvent, EventType, TradeType } from '../types';
import { AMM_PROGRAM } from '../../config/constants';
import { Logger } from '../../../core/logger';
import bs58 from 'bs58';
import { BorshCoder } from '@coral-xyz/anchor';
import AMM_IDL from '../../../idls/pump_amm_0.1.0.json';

const logger = new Logger({ context: 'AMMTradeIDLStrategy' });

// Correct discriminators from IDL
const DISCRIMINATORS = {
  BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),  // 'buy' instruction
  SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]) // 'sell' instruction
};

export class AMMTradeIDLStrategy implements ParseStrategy {
  name = 'AMMTradeIDLStrategy';
  private coder: BorshCoder;

  constructor() {
    this.coder = new BorshCoder(AMM_IDL as any);
  }

  canParse(context: ParseContext): boolean {
    const isAMMProgram = context.accounts.some(acc => acc === AMM_PROGRAM);
    if (!isAMMProgram) return false;

    const fullTx = context.fullTransaction;
    if (!fullTx?.transaction?.transaction?.transaction) return false;

    const tx = fullTx.transaction.transaction.transaction;
    const instructions = tx.message?.instructions || [];
    
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
      const meta = tx.meta;
      
      // Convert account keys to strings
      const accountStrs = accountKeys.map((acc: any) => 
        typeof acc === 'string' ? acc : bs58.encode(acc)
      );
      
      // Find AMM instruction
      let ammInstruction = null;
      
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        const programIdIndex = ix.programIdIndex;
        if (programIdIndex >= accountStrs.length) continue;
        
        const programId = accountStrs[programIdIndex];
        if (programId !== AMM_PROGRAM || !ix.data) continue;
        
        ammInstruction = ix;
        break;
      }
      
      if (!ammInstruction) return null;
      
      const dataBuffer = Buffer.from(ammInstruction.data, 'base64');
      
      // Check discriminator to determine instruction type
      const isBuy = dataBuffer.subarray(0, 8).equals(DISCRIMINATORS.BUY);
      const isSell = dataBuffer.subarray(0, 8).equals(DISCRIMINATORS.SELL);
      
      if (!isBuy && !isSell) {
        logger.debug('Unknown AMM instruction discriminator', { 
          discriminator: dataBuffer.subarray(0, 8).toString('hex') 
        });
        return null;
      }
      
      // Parse instruction args
      let instructionData: any;
      try {
        if (isBuy) {
          instructionData = this.coder.instruction.decode(dataBuffer);
        } else {
          instructionData = this.coder.instruction.decode(dataBuffer);
        }
      } catch (e) {
        // Fallback to manual parsing if IDL decode fails
        instructionData = {
          data: {
            baseAmountOut: this.readUInt64LE(dataBuffer, 8),
            maxQuoteAmountIn: this.readUInt64LE(dataBuffer, 16)
          }
        };
      }
      
      // Get actual amounts from logs or events
      const actualAmounts = this.extractActualAmounts(context.logs, meta, isBuy);
      
      // Get accounts
      const instructionAccounts = ammInstruction.accounts || [];
      const userAddress = instructionAccounts.length > 0 ? accountStrs[instructionAccounts[0]] : accountStrs[0];
      const poolAddress = this.findPoolAccount(accountStrs, instructionAccounts);
      
      // Find token mint
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const tokenMint = this.findTokenMint(accountStrs, SOL_MINT);
      
      // Determine actual amounts
      let solAmount: bigint;
      let tokenAmount: bigint;
      
      if (actualAmounts) {
        solAmount = actualAmounts.solAmount;
        tokenAmount = actualAmounts.tokenAmount;
      } else {
        // Fallback to instruction data (less accurate)
        if (isBuy) {
          tokenAmount = instructionData.data?.baseAmountOut || 0n;
          solAmount = instructionData.data?.maxQuoteAmountIn || 0n;
        } else {
          tokenAmount = instructionData.data?.baseAmountIn || 0n;
          solAmount = instructionData.data?.minQuoteAmountOut || 0n;
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
        tokenAmount
      };
    } catch (error) {
      logger.debug('Failed to parse AMM trade with IDL', { error, signature: context.signature });
      return null;
    }
  }

  private extractActualAmounts(logs: string[], meta: any, isBuy: boolean): { solAmount: bigint, tokenAmount: bigint } | null {
    // Try to extract from ray_log first
    for (const log of logs) {
      if (log.includes('ray_log:')) {
        const match = log.match(/ray_log:\s*([A-Za-z0-9+/=]+)/);
        if (match) {
          try {
            const data = Buffer.from(match[1], 'base64');
            // Ray log format varies, but often contains actual amounts
            if (data.length >= 16) {
              const amount1 = this.readUInt64LE(data, 0);
              const amount2 = this.readUInt64LE(data, 8);
              
              // Heuristic: larger amount is usually token amount
              if (isBuy) {
                return {
                  solAmount: amount1 < amount2 ? amount1 : amount2,
                  tokenAmount: amount1 > amount2 ? amount1 : amount2
                };
              } else {
                return {
                  tokenAmount: amount1 > amount2 ? amount1 : amount2,
                  solAmount: amount1 < amount2 ? amount1 : amount2
                };
              }
            }
          } catch (e) {
            // Continue to next method
          }
        }
      }
    }
    
    // Try to extract from token balance changes
    if (meta?.preTokenBalances && meta?.postTokenBalances) {
      const changes = this.calculateTokenChanges(meta.preTokenBalances, meta.postTokenBalances);
      if (changes.length > 0) {
        const solChange = changes.find(c => c.mint === 'So11111111111111111111111111111111111111112');
        const tokenChange = changes.find(c => c.mint !== 'So11111111111111111111111111111111111111112');
        
        if (solChange && tokenChange) {
          return {
            solAmount: BigInt(Math.abs(solChange.change * 1e9)),
            tokenAmount: BigInt(Math.abs(tokenChange.change * Math.pow(10, tokenChange.decimals)))
          };
        }
      }
    }
    
    return null;
  }

  private calculateTokenChanges(preBalances: any[], postBalances: any[]): any[] {
    const changes = [];
    
    for (const pre of preBalances) {
      const post = postBalances.find((p: any) => p.accountIndex === pre.accountIndex);
      if (post && pre.uiTokenAmount.uiAmount !== post.uiTokenAmount.uiAmount) {
        changes.push({
          mint: pre.mint,
          change: post.uiTokenAmount.uiAmount - pre.uiTokenAmount.uiAmount,
          decimals: pre.uiTokenAmount.decimals
        });
      }
    }
    
    return changes;
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