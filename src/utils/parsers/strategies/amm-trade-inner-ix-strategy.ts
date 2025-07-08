/**
 * AMM Trade Inner Instruction Parsing Strategy
 * Parses actual trade amounts from inner instructions instead of slippage parameters
 */

import { ParseStrategy, ParseContext, AMMTradeEvent, EventType, TradeType } from '../types';
import { AMM_PROGRAM } from '../../config/constants';
import { Logger } from '../../../core/logger';
import bs58 from 'bs58';

const logger = new Logger({ context: 'AMMTradeInnerIxStrategy' });

// Correct discriminators from IDL
const DISCRIMINATORS = {
  BUY: 102,   // Discriminator for buy instruction
  SELL: 51    // Discriminator for sell instruction
};

// Token program for transfer instructions
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export class AMMTradeInnerIxStrategy implements ParseStrategy {
  name = 'AMMTradeInnerIxStrategy';

  canParse(context: ParseContext): boolean {
    // Check if it's from pump.swap AMM program
    const isAMMProgram = context.accounts.some(acc => acc === AMM_PROGRAM);
    if (!isAMMProgram) return false;

    // Check if we have inner instructions in the context
    if (!context.innerInstructions || context.innerInstructions.length === 0) return false;

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
      
      // Find AMM instruction and its index
      let ammInstruction = null;
      let ammInstructionIndex = -1;
      
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        const programIdIndex = ix.programIdIndex;
        if (programIdIndex >= accountStrs.length) continue;
        
        const programId = accountStrs[programIdIndex];
        if (programId !== AMM_PROGRAM || !ix.data) continue;
        
        ammInstruction = ix;
        ammInstructionIndex = i;
        break;
      }
      
      if (!ammInstruction || ammInstructionIndex === -1) return null;
      
      const dataBuffer = Buffer.from(ammInstruction.data, 'base64');
      const discriminator = dataBuffer[0];
      
      // Check if it's buy or sell
      const isBuy = discriminator === DISCRIMINATORS.BUY;
      const isSell = discriminator === DISCRIMINATORS.SELL;
      
      if (!isBuy && !isSell) return null;
      
      // Get inner instructions for this AMM instruction
      const innerIxGroup = context.innerInstructions?.find((group: any) => 
        group.index === ammInstructionIndex
      );
      
      if (!innerIxGroup || !innerIxGroup.instructions) return null;
      
      // Get user address from AMM instruction accounts
      const instructionAccounts = ammInstruction.accounts || [];
      const userAddress = instructionAccounts.length > 0 ? accountStrs[instructionAccounts[0]] : accountStrs[0];
      
      // Extract actual amounts from inner instructions
      const actualAmounts = this.extractAmountsFromInnerInstructions(
        innerIxGroup.instructions,
        accountStrs,
        isBuy,
        userAddress
      );
      
      if (!actualAmounts) {
        logger.debug('Could not extract actual amounts from inner instructions');
        return null;
      }
      
      // Get pool address
      const poolAddress = this.findPoolAccount(accountStrs, instructionAccounts);
      
      // Find token mint
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const tokenMint = actualAmounts.tokenMint || this.findTokenMint(accountStrs, SOL_MINT);
      
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
        inAmount: isBuy ? actualAmounts.solAmount : actualAmounts.tokenAmount,
        outputMint: isBuy ? tokenMint || 'unknown' : SOL_MINT,
        outAmount: isBuy ? actualAmounts.tokenAmount : actualAmounts.solAmount,
        solAmount: actualAmounts.solAmount,
        tokenAmount: actualAmounts.tokenAmount
      };
    } catch (error) {
      logger.debug('Failed to parse AMM trade from inner instructions', { error, signature: context.signature });
      return null;
    }
  }

  private extractAmountsFromInnerInstructions(
    innerInstructions: any[],
    accountStrs: string[],
    isBuy: boolean,
    userAddress: string
  ): { solAmount: bigint, tokenAmount: bigint, tokenMint?: string } | null {
    try {
      const transfers: Array<{
        instructionType: string;
        mint?: string;
        amount: bigint;
        decimals?: number;
        from: string;
        to: string;
        accounts: number[];
      }> = [];
      
      // Extract all transfer instructions
      for (const innerIx of innerInstructions) {
        const programIdIndex = innerIx.programIdIndex;
        if (programIdIndex >= accountStrs.length) continue;
        
        const programId = accountStrs[programIdIndex];
        
        // Look for token program transfers
        if (programId === TOKEN_PROGRAM) {
          const data = Buffer.from(innerIx.data, 'base64');
          const instructionType = data[0];
          const accounts = innerIx.accounts || [];
          
          // transferChecked instruction (type 12)
          if (instructionType === 12 && data.length >= 10 && accounts.length >= 4) {
            const amount = this.readUInt64LE(data, 1);
            const decimals = data[9];
            
            // transferChecked accounts layout:
            // 0: source (from)
            // 1: mint
            // 2: destination (to)
            // 3: authority
            const from = accountStrs[accounts[0]] || '';
            const mint = accountStrs[accounts[1]] || '';
            const to = accountStrs[accounts[2]] || '';
            
            transfers.push({
              instructionType: 'transferChecked',
              mint,
              amount,
              decimals,
              from,
              to,
              accounts
            });
          }
          // transfer instruction (type 3)
          else if (instructionType === 3 && data.length >= 9 && accounts.length >= 3) {
            const amount = this.readUInt64LE(data, 1);
            
            // transfer accounts layout:
            // 0: source (from)
            // 1: destination (to)
            // 2: authority
            const from = accountStrs[accounts[0]] || '';
            const to = accountStrs[accounts[1]] || '';
            
            transfers.push({
              instructionType: 'transfer',
              amount,
              from,
              to,
              accounts
            });
          }
        }
      }
      
      if (transfers.length === 0) {
        logger.debug('No transfer instructions found in inner instructions');
        return null;
      }
      
      // Log transfers for debugging
      logger.debug('Found transfers in inner instructions', {
        count: transfers.length,
        transfers: transfers.map(t => ({
          type: t.instructionType,
          amount: t.amount.toString(),
          mint: t.mint?.substring(0, 8),
          from: t.from.substring(0, 8),
          to: t.to.substring(0, 8)
        }))
      });
      
      // Identify the main swap transfers (not fee transfers)
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const FEE_ACCOUNT = 'BcMgE1oPaKt4ptkpe4Y6B379Y5pKk8Qvh7GYE8WbLnPc'; // Pump.fun AMM fee account
      
      let solAmount = 0n;
      let tokenAmount = 0n;
      let tokenMint: string | undefined;
      
      // Filter out fee transfers
      const mainTransfers = transfers.filter(t => 
        t.to !== FEE_ACCOUNT && t.from !== FEE_ACCOUNT
      );
      
      // For AMM swaps, there are typically 2-3 main transfers:
      // BUY: 1) User sends SOL to pool, 2) Pool sends tokens to user
      // SELL: 1) User sends tokens to pool, 2) Pool sends SOL to user
      
      for (const transfer of mainTransfers) {
        if (transfer.instructionType === 'transferChecked' && transfer.mint) {
          if (transfer.mint === SOL_MINT) {
            // Wrapped SOL transfer
            solAmount = transfer.amount;
          } else {
            // Token transfer
            tokenAmount = transfer.amount;
            tokenMint = transfer.mint;
          }
        }
      }
      
      // If we didn't find wrapped SOL, look for the pattern based on transfer direction
      if (solAmount === 0n && mainTransfers.length >= 2) {
        // Look for transfers based on user address
        if (isBuy) {
          // For buy: first transfer is SOL from user, second is tokens to user
          // Look for transfers where user is the sender (SOL) and receiver (tokens)
          const userSends = mainTransfers.filter(t => 
            t.from === userAddress
          );
          const userReceives = mainTransfers.filter(t => 
            t.to === userAddress
          );
          
          if (userSends.length > 0) {
            solAmount = userSends[0].amount;
          }
          if (userReceives.length > 0) {
            tokenAmount = userReceives[0].amount;
            if (userReceives[0].mint) {
              tokenMint = userReceives[0].mint;
            }
          }
        } else {
          // For sell: first transfer is tokens from user, second is SOL to user
          const userSends = mainTransfers.filter(t => 
            t.from === userAddress
          );
          const userReceives = mainTransfers.filter(t => 
            t.to === userAddress
          );
          
          if (userSends.length > 0) {
            tokenAmount = userSends[0].amount;
            if (userSends[0].mint) {
              tokenMint = userSends[0].mint;
            }
          }
          if (userReceives.length > 0) {
            solAmount = userReceives[0].amount;
          }
        }
      }
      
      // Final validation
      if (solAmount === 0n || tokenAmount === 0n) {
        logger.debug('Could not determine SOL and token amounts', {
          solAmount: solAmount.toString(),
          tokenAmount: tokenAmount.toString(),
          transferCount: mainTransfers.length
        });
        return null;
      }
      
      // Sanity check: SOL amount should be reasonable (< 10000 SOL)
      const MAX_REASONABLE_SOL = 10000n * 1_000_000_000n;
      if (solAmount > MAX_REASONABLE_SOL) {
        logger.debug('SOL amount exceeds reasonable limit, may be parsing error', {
          solAmount: (Number(solAmount) / 1e9).toFixed(2)
        });
      }
      
      return {
        solAmount,
        tokenAmount,
        tokenMint
      };
    } catch (error) {
      logger.debug('Error extracting amounts from inner instructions', { error });
      return null;
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