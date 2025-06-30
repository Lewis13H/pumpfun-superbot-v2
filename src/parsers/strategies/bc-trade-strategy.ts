/**
 * Bonding Curve Trade Parsing Strategy
 * Handles both 225-byte and 113-byte events
 */

import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { ParseStrategy, ParseContext, BCTradeEvent, EventType, TradeType } from '../types';
import { PUMP_PROGRAM } from '../../utils/constants';
import { Logger } from '../../core/logger';

const logger = new Logger({ context: 'BCTradeStrategy' });

// Event signatures
const BUY_SIGNATURES = [
  'buy',
  'Buy',
  'User bought',
  'Program log: Instruction: Buy'
];

const SELL_SIGNATURES = [
  'sell',
  'Sell',
  'User sold',
  'Program log: Instruction: Sell'
];

export class BCTradeStrategy implements ParseStrategy {
  name = 'BCTradeStrategy';

  canParse(context: ParseContext): boolean {
    // Check if it's from pump.fun program
    const isPumpProgram = context.accounts.some(acc => acc === PUMP_PROGRAM);
    if (!isPumpProgram) return false;

    // Check if logs contain trade signatures
    const hasTradeLog = context.logs.some(log => 
      BUY_SIGNATURES.some(sig => log.includes(sig)) ||
      SELL_SIGNATURES.some(sig => log.includes(sig))
    );

    // Check data size if available
    if (context.data) {
      const validSize = context.data.length === 225 || context.data.length === 113;
      return hasTradeLog && validSize;
    }

    return hasTradeLog;
  }

  parse(context: ParseContext): BCTradeEvent | null {
    try {
      // Detect trade type from logs
      const tradeType = this.detectTradeType(context.logs);
      if (!tradeType) return null;

      // Extract mint address from logs
      const mintAddress = this.extractMintAddress(context.logs, context.accounts);
      if (!mintAddress) return null;

      // Parse event data
      if (context.data && context.data.length >= 113) {
        return this.parseEventData(context, mintAddress, tradeType);
      }

      // Fallback: parse from logs
      return this.parseFromLogs(context, mintAddress, tradeType);
    } catch (error) {
      logger.debug('Failed to parse BC trade', { error, signature: context.signature });
      return null;
    }
  }

  private detectTradeType(logs: string[]): TradeType | null {
    for (const log of logs) {
      if (BUY_SIGNATURES.some(sig => log.includes(sig))) {
        return TradeType.BUY;
      }
      if (SELL_SIGNATURES.some(sig => log.includes(sig))) {
        return TradeType.SELL;
      }
    }
    return null;
  }

  private extractMintAddress(logs: string[], accounts: string[]): string | null {
    // Try to extract from logs first
    for (const log of logs) {
      // Pattern: "mint: <address>"
      const mintMatch = log.match(/mint:\s*([A-HJ-NP-Za-km-z1-9]{32,44})/);
      if (mintMatch) {
        return mintMatch[1];
      }

      // Pattern: "Mint: <address>"
      const mintMatch2 = log.match(/Mint:\s*([A-HJ-NP-Za-km-z1-9]{32,44})/);
      if (mintMatch2) {
        return mintMatch2[1];
      }
    }

    // Fallback: derive from bonding curve if available
    const bondingCurve = this.findBondingCurveAccount(accounts);
    if (bondingCurve) {
      return this.deriveMintFromBondingCurve(bondingCurve);
    }

    return null;
  }

  private findBondingCurveAccount(accounts: string[]): string | null {
    // Bonding curve accounts are PDAs derived from pump program
    for (const account of accounts) {
      try {
        const pubkey = new PublicKey(account);
        // Check if it could be a bonding curve PDA
        if (pubkey.toBase58().length === 44) {
          return account;
        }
      } catch {}
    }
    return null;
  }

  private deriveMintFromBondingCurve(bondingCurve: string): string | null {
    try {
      // Bonding curve PDA is derived from [b"bonding-curve", mint.key()]
      // We need to reverse engineer the mint from the PDA
      // This is a simplified approach - in reality we might need to query the account
      return bondingCurve; // Placeholder - would need actual derivation logic
    } catch {
      return null;
    }
  }

  private parseEventData(
    context: ParseContext, 
    mintAddress: string, 
    tradeType: TradeType
  ): BCTradeEvent | null {
    const data = context.data!;
    
    try {
      let offset = 0;

      // Skip discriminator (8 bytes)
      offset += 8;

      // Read mint (32 bytes)
      const mint = bs58.encode(data.subarray(offset, offset + 32));
      offset += 32;

      // Read sol amount (8 bytes)
      const solAmount = this.readUInt64LE(data, offset);
      offset += 8;

      // Read token amount (8 bytes)
      const tokenAmount = this.readUInt64LE(data, offset);
      offset += 8;

      // Read user address (32 bytes)
      const userAddress = bs58.encode(data.subarray(offset, offset + 32));
      offset += 32;

      // Read bonding curve address (32 bytes)
      const bondingCurveKey = bs58.encode(data.subarray(offset, offset + 32));
      offset += 32;

      // Read virtual reserves (only in 225-byte events)
      let vSolInBondingCurve = 0n;
      let vTokenInBondingCurve = 0n;

      if (data.length >= 225) {
        // Skip to reserves section
        offset = 113; // Start of additional data
        vSolInBondingCurve = this.readUInt64LE(data, offset);
        offset += 8;
        vTokenInBondingCurve = this.readUInt64LE(data, offset);
      }

      return {
        type: EventType.BC_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: PUMP_PROGRAM,
        tradeType,
        mintAddress: mint,
        userAddress,
        solAmount,
        tokenAmount,
        bondingCurveKey,
        vSolInBondingCurve,
        vTokenInBondingCurve,
        virtualSolReserves: vSolInBondingCurve,
        virtualTokenReserves: vTokenInBondingCurve
      };
    } catch (error) {
      logger.debug('Failed to parse event data', { error, dataLength: data.length });
      return null;
    }
  }

  private parseFromLogs(
    context: ParseContext,
    mintAddress: string,
    tradeType: TradeType
  ): BCTradeEvent | null {
    // Extract what we can from logs
    const userAddress = context.accounts[0] || 'unknown';
    
    return {
      type: EventType.BC_TRADE,
      signature: context.signature,
      slot: context.slot,
      blockTime: context.blockTime,
      programId: PUMP_PROGRAM,
      tradeType,
      mintAddress,
      userAddress,
      solAmount: 0n,
      tokenAmount: 0n,
      bondingCurveKey: 'unknown',
      vSolInBondingCurve: 0n,
      vTokenInBondingCurve: 0n,
      virtualSolReserves: 0n,
      virtualTokenReserves: 0n
    };
  }

  private readUInt64LE(buffer: Buffer, offset: number): bigint {
    const low = buffer.readUInt32LE(offset);
    const high = buffer.readUInt32LE(offset + 4);
    return BigInt(low) + (BigInt(high) << 32n);
  }
}