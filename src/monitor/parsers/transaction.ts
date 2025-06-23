// src/monitor/parsers/transaction.ts

import { Buffer } from 'buffer';
import { 
  FormattedTransaction, 
  ParsedTransaction, 
  ParsedInstruction 
} from '../types';
import { 
  PUMP_PROGRAM, 
  DISCRIMINATORS 
} from '../constants';
import { decodeTransact, decodeInstructionData } from '../utils/decode';
import { bnLayoutFormatter } from '../utils/format';
import { EventParser } from './event';

export class TransactionParser {
  /**
   * Format raw transaction data from gRPC stream
   */
  static formatTransaction(data: any): FormattedTransaction | null {
    try {
      const dataTx = data.transaction?.transaction;
      if (!dataTx) return null;

      const signature = decodeTransact(dataTx.signature);
      const message = dataTx.transaction?.message;
      if (!message) return null;

      const header = message.header;
      const accountKeys = message.accountKeys?.map((key: any) => decodeTransact(key)) || [];
      const recentBlockhash = decodeTransact(message.recentBlockhash);
      const instructions = message.instructions || [];
      const meta = dataTx.meta;

      return {
        slot: data.slot || dataTx.slot,
        signature,
        message: {
          header,
          accountKeys,
          recentBlockhash,
          instructions
        },
        meta,
        version: message.versioned ? 0 : 'legacy'
      };
    } catch (error) {
      console.error('Error formatting transaction:', error);
      return null;
    }
  }

  /**
   * Parse pump.fun transaction to extract instructions and events
   */
  static parsePumpFunTransaction(tx: FormattedTransaction): ParsedTransaction | null {
    try {
      if (tx.meta?.err) return null;

      const pumpFunIxs: ParsedInstruction[] = [];
      const instructions = tx.message.instructions || [];
      
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        const programId = tx.message.accountKeys[ix.programIdIndex];
        
        if (programId === PUMP_PROGRAM) {
          const parsedIx = this.parseInstruction(ix, tx);
          if (parsedIx) {
            pumpFunIxs.push(parsedIx);
          }
        }
      }

      if (pumpFunIxs.length === 0) return null;

      // Parse events from logs
      const events = EventParser.parseEventsFromLogs(tx.meta?.logMessages || []);

      const result = { 
        instructions: { pumpFunIxs, events }, 
        transaction: tx 
      };
      
      bnLayoutFormatter(result);
      return result;
    } catch (error) {
      console.error('Error parsing pump.fun transaction:', error);
      return null;
    }
  }

  /**
   * Parse individual instruction
   */
  private static parseInstruction(ix: any, tx: FormattedTransaction): ParsedInstruction | null {
    try {
      const ixData = decodeInstructionData(ix.data);
      const discriminator = ixData.slice(0, 8);
      
      let parsedIx: ParsedInstruction = {
        programId: PUMP_PROGRAM,
        name: 'unknown',
        data: {},
        accounts: []
      };

      // Identify instruction type
      if (Buffer.from(discriminator).equals(DISCRIMINATORS.CREATE)) {
        parsedIx.name = 'create';
      } else if (Buffer.from(discriminator).equals(DISCRIMINATORS.BUY)) {
        parsedIx.name = 'buy';
      } else if (Buffer.from(discriminator).equals(DISCRIMINATORS.SELL)) {
        parsedIx.name = 'sell';
      }

      // Parse accounts
      if (ix.accounts && ix.accounts.length > 0) {
        if (Array.isArray(ix.accounts) && typeof ix.accounts[0] === 'number') {
          // Normal case: accounts are indices
          parsedIx.accounts = ix.accounts.map((accIndex: number, idx: number) => {
            const pubkey = tx.message.accountKeys[accIndex];
            let name = `account${idx}`;
            
            // Name specific accounts based on instruction type and position
            if (parsedIx.name === 'create' && idx === 2) name = 'bonding_curve';
            if ((parsedIx.name === 'buy' || parsedIx.name === 'sell') && idx === 3) name = 'bonding_curve';
            
            return { pubkey, name };
          });
        } else {
          // Raw data case: silently handle
          parsedIx.accounts = [];
        }
      }

      return parsedIx;
    } catch (e) {
      // Silent fail for parsing errors
      return null;
    }
  }
}