/**
 * IDL-based Bonding Curve Trade Parsing Strategy
 * Uses Anchor IDLs for accurate event extraction
 */

import { ParseContext, ParseStrategy } from '../types';
import { EventType, ParsedEvent, TradeType } from '../types';
import { IDLParserService } from '../../../services/core/idl-parser-service';
import { EventParserService } from '../../../services/core/event-parser-service';
import { InnerInstructionParser } from '../../../services/core/inner-ix-parser';
import { TransactionFormatter } from '../transaction-formatter';
import { PUMP_PROGRAM } from '../../config/constants';
import bs58 from 'bs58';

export class BCTradeIDLStrategy implements ParseStrategy {
  name = 'BCTradeIDL';
  
  private idlParser: IDLParserService;
  private eventParser: EventParserService;
  private innerIxParser: InnerInstructionParser;
  private txFormatter: TransactionFormatter;

  constructor() {
    this.idlParser = IDLParserService.getInstance();
    this.eventParser = EventParserService.getInstance();
    this.innerIxParser = InnerInstructionParser.getInstance();
    this.txFormatter = new TransactionFormatter();
  }

  canParse(context: ParseContext): boolean {
    // Check if this is a pump.fun transaction
    const accountKeys = context.accountKeys || [];
    return accountKeys.some(key => {
      const keyStr = typeof key === 'string' ? key : bs58.encode(key);
      return keyStr === PUMP_PROGRAM;
    });
  }

  parse(context: ParseContext): ParsedEvent | null {
    try {
      // Format transaction for parsing
      const formattedTx = this.txFormatter.formTransactionFromJson(
        { transaction: context.fullTransaction },
        Date.now()
      );

      // Parse events from transaction
      const events = this.eventParser.parseTransaction(formattedTx);
      
      // Extract trade event
      const tradeEvent = this.eventParser.extractTradeEvent(events);
      if (!tradeEvent) {
        // Fallback to instruction parsing
        return this.parseFromInstructions(context, formattedTx);
      }

      // Parse inner instructions for additional context
      const flow = this.innerIxParser.parseTransactionFlow({
        transaction: formattedTx.transaction,
        meta: formattedTx.meta
      });

      // Build parsed event
      return {
        type: EventType.BC_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: PUMP_PROGRAM,
        mintAddress: tradeEvent.mint,
        tradeType: tradeEvent.isBuy ? TradeType.BUY : TradeType.SELL,
        userAddress: tradeEvent.user,
        solAmount: BigInt(tradeEvent.solAmount),
        tokenAmount: BigInt(tradeEvent.tokenAmount),
        virtualSolReserves: BigInt(tradeEvent.virtualSolReserves),
        virtualTokenReserves: BigInt(tradeEvent.virtualTokenReserves),
        vSolInBondingCurve: BigInt(tradeEvent.virtualSolReserves),
        vTokenInBondingCurve: BigInt(tradeEvent.virtualTokenReserves),
        bondingCurveKey: tradeEvent.bondingCurveKey || this.extractBondingCurveKey(context) || '',
        creator: this.extractCreator(context, flow),
        innerInstructions: flow.innerInstructions.length,
        tokenTransfers: flow.tokenTransfers.length,
        hasPoolCreation: flow.mainInstructions.some(ix => ix.name === 'create')
      };

    } catch (error) {
      // Fallback to simple parsing
      return this.parseSimple(context);
    }
  }

  /**
   * Parse from instructions when events are not available
   */
  private parseFromInstructions(context: ParseContext, tx: any): ParsedEvent | null {
    try {
      const instructions = this.idlParser.parseInstructions(
        tx.transaction.message,
        tx.meta?.loadedAddresses
      );

      // Find trade instruction
      const tradeIx = instructions.find(ix => 
        ix.name === 'buy' || ix.name === 'sell'
      );

      if (!tradeIx) {
        return null;
      }

      // Extract trade data from instruction args
      const isBuy = tradeIx.name === 'buy';
      const args = tradeIx.args;

      // Extract account addresses
      const userAccount = tradeIx.accounts.find(a => a.name === 'user')?.pubkey.toBase58();
      const bondingCurve = tradeIx.accounts.find(a => a.name === 'bondingCurve')?.pubkey.toBase58();
      const mint = tradeIx.accounts.find(a => a.name === 'mint')?.pubkey.toBase58();

      if (!userAccount || !mint) {
        return null;
      }

      // Get reserves from logs or compute budget
      const reserves = this.extractReservesFromLogs(context.logs);

      // Calculate bonding curve progress based on token depletion
      const INITIAL_BC_TOKENS = 793_000_000; // ~793M tokens initially in BC
      const TOKEN_DECIMALS = 6;
      const tokensRemaining = Number(reserves.token) / Math.pow(10, TOKEN_DECIMALS);
      const tokensSold = INITIAL_BC_TOKENS - tokensRemaining;
      const bondingCurveProgress = Math.min(Math.max((tokensSold / INITIAL_BC_TOKENS) * 100, 0), 100);

      return {
        type: EventType.BC_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: PUMP_PROGRAM,
        mintAddress: mint,
        tradeType: isBuy ? TradeType.BUY : TradeType.SELL,
        userAddress: userAccount,
        solAmount: BigInt(args.amount || args.solAmount || '0'),
        tokenAmount: BigInt(args.tokenAmount || '0'),
        virtualSolReserves: reserves.sol,
        virtualTokenReserves: reserves.token,
        vSolInBondingCurve: reserves.sol,
        vTokenInBondingCurve: reserves.token,
        bondingCurveKey: bondingCurve || '',
        bondingCurveProgress,
        innerInstructions: tx.meta?.innerInstructions?.length || 0
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Simple parsing fallback
   */
  private parseSimple(context: ParseContext): ParsedEvent | null {
    const eventLog = context.logs.find(log => log.includes('ray_log'));
    if (!eventLog) return null;

    try {
      const data = this.extractDataFromLog(eventLog);
      if (!data || data.length < 200) return null;

      // Use simple byte extraction
      const discriminator = data.readBigUInt64LE(8);
      const isBuy = discriminator.toString() === '16927863322537952870';

      return {
        type: EventType.BC_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: PUMP_PROGRAM,
        mintAddress: bs58.encode(data.subarray(16, 48)),
        tradeType: isBuy ? TradeType.BUY : TradeType.SELL,
        userAddress: context.userAddress || 'unknown',
        solAmount: data.readBigUInt64LE(48),
        tokenAmount: data.readBigUInt64LE(56),
        virtualSolReserves: data.readBigUInt64LE(64),
        virtualTokenReserves: data.readBigUInt64LE(72),
        vSolInBondingCurve: data.readBigUInt64LE(64),
        vTokenInBondingCurve: data.readBigUInt64LE(72),
        bondingCurveKey: ''
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract bonding curve key from context
   */
  private extractBondingCurveKey(context: ParseContext): string | undefined {
    // Look for bonding curve account in logs
    const bcLog = context.logs.find(log => 
      log.includes('BondingCurve') || log.includes('bonding_curve')
    );
    
    if (bcLog) {
      const match = bcLog.match(/([A-Za-z0-9]{43,44})/);
      if (match) return match[1];
    }

    return undefined;
  }

  /**
   * Extract creator from transaction
   */
  private extractCreator(context: ParseContext, flow: any): string | undefined {
    // Check if this is a token creation transaction
    const hasCreate = flow.mainInstructions.some((ix: any) => ix.name === 'create');
    if (hasCreate) {
      // Creator is usually the fee payer (first signer)
      return context.accountKeys && context.accountKeys[0] ? 
        (typeof context.accountKeys[0] === 'string' ? 
          context.accountKeys[0] : 
          bs58.encode(context.accountKeys[0])) : 
        undefined;
    }
    return undefined;
  }

  /**
   * Extract reserves from logs
   */
  private extractReservesFromLogs(logs: string[]): { sol: bigint; token: bigint } {
    const reserves = { sol: BigInt(0), token: BigInt(0) };

    for (const log of logs) {
      // Look for reserve updates in logs
      if (log.includes('sol_reserves') || log.includes('virtual_sol')) {
        const match = log.match(/(\d+)/);
        if (match) reserves.sol = BigInt(match[1]);
      }
      if (log.includes('token_reserves') || log.includes('virtual_token')) {
        const match = log.match(/(\d+)/);
        if (match) reserves.token = BigInt(match[1]);
      }
    }

    return reserves;
  }

  /**
   * Extract data from log
   */
  private extractDataFromLog(log: string): Buffer | null {
    const match = log.match(/ray_log: (.+)/);
    if (!match) return null;

    try {
      return Buffer.from(bs58.decode(match[1]));
    } catch {
      return null;
    }
  }
}

export const bcTradeIDLStrategy = new BCTradeIDLStrategy();