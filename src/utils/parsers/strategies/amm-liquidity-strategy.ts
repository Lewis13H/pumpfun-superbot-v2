/**
 * AMM Liquidity Event Parsing Strategy
 * Handles pump.fun AMM deposit/withdraw events using IDL parsing
 */

import { ParseStrategy, ParseContext, ParsedEvent, EventType } from '../types';
import { AMM_PROGRAM, PUMP_SWAP_PROGRAM } from '../../config/constants';
import { Logger } from '../../../core/logger';
import bs58 from 'bs58';

const logger = new Logger({ context: 'AmmLiquidityStrategy' });

// Instruction discriminators from IDL
const DEPOSIT_DISCRIMINATOR = [242, 35, 198, 137, 82, 225, 242, 182];
const WITHDRAW_DISCRIMINATOR = [183, 18, 70, 156, 148, 109, 161, 34];

export interface AmmLiquidityEvent {
  type: EventType.AMM_LIQUIDITY_ADD | EventType.AMM_LIQUIDITY_REMOVE;
  signature: string;
  slot: bigint;
  blockTime?: number;
  programId: string;
  poolAddress: string;
  userAddress: string;
  tokenMint: string;
  lpMint?: string;
  baseAmount: bigint;
  quoteAmount: bigint;
  lpAmount?: bigint;
  minBaseAmount?: bigint;
  minQuoteAmount?: bigint;
  maxBaseAmount?: bigint;
  maxQuoteAmount?: bigint;
}

export class AmmLiquidityStrategy implements ParseStrategy {
  name = 'AmmLiquidityStrategy';
  
  constructor() {
    // No initialization needed for manual parsing
  }

  canParse(context: ParseContext): boolean {
    // Check if it's from AMM programs
    const isAMMProgram = context.accounts.some(acc => 
      acc === AMM_PROGRAM || acc === PUMP_SWAP_PROGRAM || acc === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
    );
    if (!isAMMProgram) return false;

    // Check if logs contain "Program data:" pattern
    return context.logs.some(log => log.includes('Program data:'));
  }

  parse(context: ParseContext): ParsedEvent | null {
    try {
      // Find the Program data log
      const programDataLog = context.logs.find(log => log.includes('Program data:'));
      if (!programDataLog) return null;

      // Extract base64 data
      const match = programDataLog.match(/Program data:\s*(.+)/);
      if (!match || !match[1]) return null;

      // Decode base64 to buffer
      const instructionData = Buffer.from(match[1], 'base64');
      
      // Check discriminator (first 8 bytes)
      const discriminator = Array.from(instructionData.slice(0, 8));
      
      let eventType: EventType | null = null;
      let instructionName: string | null = null;
      
      if (this.arraysEqual(discriminator, DEPOSIT_DISCRIMINATOR)) {
        eventType = EventType.AMM_LIQUIDITY_ADD;
        instructionName = 'deposit';
      } else if (this.arraysEqual(discriminator, WITHDRAW_DISCRIMINATOR)) {
        eventType = EventType.AMM_LIQUIDITY_REMOVE;
        instructionName = 'withdraw';
      } else {
        // Not a liquidity instruction
        return null;
      }

      // Manually decode the instruction data
      // Skip discriminator (8 bytes) and read the amounts
      let decodedData: any = {};
      try {
        if (instructionName === 'deposit') {
          // Deposit structure: discriminator (8) + base_amount_in (8) + quote_amount_in (8) + min_base_amount_in (8) + min_quote_amount_in (8)
          if (instructionData.length >= 40) {
            decodedData = {
              baseAmountIn: this.readBigUInt64LE(instructionData, 8),
              quoteAmountIn: this.readBigUInt64LE(instructionData, 16),
              minBaseAmountIn: this.readBigUInt64LE(instructionData, 24),
              minQuoteAmountIn: this.readBigUInt64LE(instructionData, 32)
            };
          }
        } else if (instructionName === 'withdraw') {
          // Withdraw structure: discriminator (8) + lp_amount_in (8) + min_base_amount_out (8) + min_quote_amount_out (8)
          if (instructionData.length >= 32) {
            decodedData = {
              lpAmountIn: this.readBigUInt64LE(instructionData, 8),
              minBaseAmountOut: this.readBigUInt64LE(instructionData, 16),
              minQuoteAmountOut: this.readBigUInt64LE(instructionData, 24)
            };
          }
        }
      } catch (error) {
        logger.debug('Failed to decode instruction data', { error });
        return null;
      }

      // Extract accounts from context
      const accounts = this.extractAccounts(context);
      
      // Build the liquidity event
      const liquidityEvent: AmmLiquidityEvent = {
        type: eventType,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: accounts.programId || AMM_PROGRAM,
        poolAddress: accounts.pool || 'unknown',
        userAddress: accounts.user || context.userAddress || 'unknown',
        tokenMint: accounts.baseMint || '',
        lpMint: accounts.lpMint,
        baseAmount: BigInt(0),
        quoteAmount: BigInt(0),
        lpAmount: BigInt(0)
      };

      // Extract amounts based on instruction type
      if (instructionName === 'deposit' && decodedData) {
        // Deposit instruction structure
        liquidityEvent.baseAmount = decodedData.baseAmountIn || BigInt(0);
        liquidityEvent.quoteAmount = decodedData.quoteAmountIn || BigInt(0);
        liquidityEvent.minBaseAmount = decodedData.minBaseAmountIn;
        liquidityEvent.minQuoteAmount = decodedData.minQuoteAmountIn;
      } else if (instructionName === 'withdraw' && decodedData) {
        // Withdraw instruction structure
        liquidityEvent.lpAmount = decodedData.lpAmountIn || BigInt(0);
        liquidityEvent.minBaseAmount = decodedData.minBaseAmountOut;
        liquidityEvent.minQuoteAmount = decodedData.minQuoteAmountOut;
      }

      logger.info(`🎯 ${instructionName} instruction detected!`, {
        signature: context.signature,
        baseAmount: liquidityEvent.baseAmount.toString(),
        quoteAmount: liquidityEvent.quoteAmount.toString(),
        lpAmount: liquidityEvent.lpAmount?.toString()
      });
      
      return liquidityEvent as unknown as ParsedEvent;
    } catch (error) {
      logger.debug('Failed to parse AMM liquidity event', { error, signature: context.signature });
      return null;
    }
  }

  private arraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private readBigUInt64LE(buffer: Buffer, offset: number): bigint {
    try {
      return buffer.readBigUInt64LE(offset);
    } catch {
      // Fallback for older Node versions
      const low = buffer.readUInt32LE(offset);
      const high = buffer.readUInt32LE(offset + 4);
      return BigInt(low) + (BigInt(high) << 32n);
    }
  }

  private extractAccounts(context: ParseContext): any {
    const accounts: any = {};
    
    // Try to extract accounts from the transaction
    if (context.fullTransaction?.transaction?.transaction?.transaction) {
      const tx = context.fullTransaction.transaction.transaction.transaction;
      const message = tx.message;
      const accountKeys = message?.accountKeys || [];
      
      // Convert account keys to strings
      const accountStrs = accountKeys.map((key: any) => {
        if (typeof key === 'string') return key;
        if (Buffer.isBuffer(key)) return bs58.encode(key);
        return '';
      });

      // Based on AMM IDL account order for deposit/withdraw:
      // 0: pool, 1: user (signer), 2: global_config, 3: base_mint, 4: quote_mint
      // 5: lp_mint, 6: user_lp_token_account, 7: user_base_token_account, etc.
      
      if (accountStrs.length >= 6) {
        accounts.pool = accountStrs[0];
        accounts.user = accountStrs[1];
        accounts.baseMint = accountStrs[3];
        accounts.quoteMint = accountStrs[4];
        accounts.lpMint = accountStrs[5];
      }

      // Find program ID
      const instructions = message?.instructions || [];
      for (const ix of instructions) {
        const programIdIndex = ix.programIdIndex;
        if (programIdIndex !== undefined && programIdIndex < accountStrs.length) {
          const programId = accountStrs[programIdIndex];
          if (programId === AMM_PROGRAM || programId === PUMP_SWAP_PROGRAM || programId.includes('pAMM')) {
            accounts.programId = programId;
            break;
          }
        }
      }
    }
    
    return accounts;
  }
}