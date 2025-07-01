/**
 * Bonding Curve Trade Parsing Strategy
 * Handles both 225-byte and 113-byte events
 */

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

    // Also check if we can extract data from logs
    const hasLogData = context.logs.some(log => log.includes('Program data:'));
    
    return hasTradeLog || hasLogData;
  }

  parse(context: ParseContext): BCTradeEvent | null {
    try {
      // Detect trade type from logs
      const tradeType = this.detectTradeType(context.logs);
      if (!tradeType) return null;

      // Extract mint address from logs
      const mintAddress = this.extractMintAddress(context.logs, context.accounts);
      if (!mintAddress) return null;

      // First, try to extract event data from logs (pump.fun stores data in logs)
      const eventDataFromLogs = this.extractEventDataFromLogs(context.logs);
      if (eventDataFromLogs) {
        return this.parseEventData(context, mintAddress, tradeType, eventDataFromLogs);
      }

      // Then try instruction data if available
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

  private extractEventDataFromLogs(logs: string[]): Buffer | null {
    for (const log of logs) {
      if (log.includes('Program data:')) {
        const match = log.match(/Program data: (.+)/);
        if (match?.[1]) {
          try {
            const buffer = Buffer.from(match[1], 'base64');
            logger.debug('Extracted event data from logs', { size: buffer.length });
            return buffer;
          } catch (error) {
            logger.debug('Failed to decode program data', { error });
          }
        }
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
    // Based on pump.fun IDL, bonding curve is at index 3 for both buy and sell instructions
    // Index 0: global (PDA)
    // Index 1: fee_recipient
    // Index 2: mint
    // Index 3: bonding_curve (PDA derived from mint)
    // Index 4: associated_bonding_curve
    // Index 5: associated_user
    // Index 6: user (signer)
    // Index 7: system_program
    // Index 8: token_program (buy) or creator_vault (sell)
    
    // The bonding curve should be at index 3
    if (accounts.length > 3) {
      const bondingCurve = accounts[3];
      // Validate it's not the system program or token program
      if (bondingCurve !== '11111111111111111111111111111111' && 
          bondingCurve !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        return bondingCurve;
      }
    }
    
    // If that fails, we shouldn't guess - return null
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
    _mintAddress: string, 
    tradeType: TradeType,
    dataOverride?: Buffer
  ): BCTradeEvent | null {
    const data = dataOverride || context.data!;
    
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

      // Skip the bonding curve in event data (32 bytes) - it's not accurate
      offset += 32;
      
      // Get bonding curve from accounts array instead
      const bondingCurveKey = this.findBondingCurveAccount(context.accounts) || 'unknown';
      
      // Debug: Log if we couldn't find bonding curve
      if (bondingCurveKey === 'unknown' || bondingCurveKey === null) {
        logger.warn('Could not find bonding curve in accounts', {
          signature: context.signature,
          mint,
          accountCount: context.accounts.length,
          accounts: context.accounts.slice(0, 5) // First 5 accounts for debugging
        });
      }

      // Read virtual reserves based on event size
      let vSolInBondingCurve = 0n;
      let vTokenInBondingCurve = 0n;
      let realSolReserves = 0n;
      let realTokenReserves = 0n;

      if (data.length === 225) {
        // 225-byte format: reserves at offsets 97 and 105
        vSolInBondingCurve = this.readUInt64LE(data, 97);
        vTokenInBondingCurve = this.readUInt64LE(data, 105);
        
        // NEW: Extract real reserves for 225-byte events
        // Real reserves are at offsets 145 and 153
        realSolReserves = this.readUInt64LE(data, 145);
        realTokenReserves = this.readUInt64LE(data, 153);
      } else if (data.length === 113) {
        // 113-byte format: reserves at offsets 73 and 81
        vSolInBondingCurve = this.readUInt64LE(data, 73);
        vTokenInBondingCurve = this.readUInt64LE(data, 81);
      }
      
      // Creator is not directly available in trade transactions
      // It's stored in the bonding curve account data, which requires a separate query
      // For now, we leave it undefined and it should be populated by enrichment services
      let creator: string | undefined;
      
      // Debug log
      if (vSolInBondingCurve > 0n || vTokenInBondingCurve > 0n) {
        logger.debug('Parsed reserves', {
          dataSize: data.length,
          solReserves: vSolInBondingCurve.toString(),
          tokenReserves: vTokenInBondingCurve.toString(),
          realSolReserves: realSolReserves.toString(),
          realTokenReserves: realTokenReserves.toString(),
          creator
        });
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
        virtualTokenReserves: vTokenInBondingCurve,
        realSolReserves,
        realTokenReserves,
        creator
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