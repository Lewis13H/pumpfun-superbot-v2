/**
 * IDL Parser Service
 * Centralized service for parsing transactions and events using Anchor IDLs
 */

import { Idl } from '@coral-xyz/anchor';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { Logger } from '../core/logger';
import { PublicKey } from '@solana/web3.js';
import pumpFunIdl from '../idls/pump_0.1.0.json';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';
import { PUMP_PROGRAM, PUMP_AMM_PROGRAM } from '../utils/constants';

export interface ParsedInstruction {
  programId: PublicKey;
  name: string;
  args: any;
  accounts: Array<{
    name: string;
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
}

export interface ParsedEvent {
  name: string;
  data: any;
}

export class IDLParserService {
  private static instance: IDLParserService;
  private logger: Logger;
  private bcParser: SolanaParser;
  private ammParser: SolanaParser;
  private parsers: Map<string, SolanaParser>;

  private constructor() {
    this.logger = new Logger({ context: 'IDLParserService' });
    this.parsers = new Map();
    
    // Initialize bonding curve parser
    this.bcParser = new SolanaParser([]);
    this.bcParser.addParserFromIdl(PUMP_PROGRAM, pumpFunIdl as any);
    this.parsers.set(PUMP_PROGRAM, this.bcParser);
    
    // Initialize AMM parser
    this.ammParser = new SolanaParser([]);
    this.ammParser.addParserFromIdl(PUMP_AMM_PROGRAM, pumpAmmIdl as any);
    this.parsers.set(PUMP_AMM_PROGRAM, this.ammParser);
    
    this.logger.info('IDL parsers initialized', {
      programs: [PUMP_PROGRAM, PUMP_AMM_PROGRAM]
    });
  }

  static getInstance(): IDLParserService {
    if (!IDLParserService.instance) {
      IDLParserService.instance = new IDLParserService();
    }
    return IDLParserService.instance;
  }

  /**
   * Parse a transaction's instructions using the appropriate IDL
   */
  parseInstructions(
    message: any,
    loadedAddresses?: any
  ): ParsedInstruction[] {
    const allParsedInstructions: ParsedInstruction[] = [];
    
    try {
      // Try parsing with each parser
      for (const [programId, parser] of this.parsers) {
        try {
          const parsed = parser.parseTransactionData(message, loadedAddresses);
          
          // Filter for instructions from this program
          const programInstructions = parsed.filter(
            ix => ix.programId.toBase58() === programId
          );
          
          if (programInstructions.length > 0) {
            // Convert to our ParsedInstruction type
            for (const ix of programInstructions) {
              allParsedInstructions.push({
                programId: ix.programId,
                name: ix.name,
                args: ix.args,
                accounts: ix.accounts.map(acc => ({
                  name: acc.name || 'unknown',
                  pubkey: acc.pubkey,
                  isSigner: acc.isSigner || false,
                  isWritable: acc.isWritable || false
                }))
              });
            }
          }
        } catch (err) {
          // Parser didn't match, continue
        }
      }
      
      return allParsedInstructions;
    } catch (error) {
      this.logger.debug('Failed to parse instructions', { error });
      return [];
    }
  }

  /**
   * Parse inner instructions
   */
  parseInnerInstructions(transaction: any): ParsedInstruction[] {
    const allInnerInstructions: ParsedInstruction[] = [];
    
    try {
      for (const [programId, parser] of this.parsers) {
        try {
          const parsed = parser.parseTransactionWithInnerInstructions(transaction);
          
          // Filter for instructions from this program
          const programInstructions = parsed.filter(
            ix => ix.programId.toBase58() === programId
          );
          
          if (programInstructions.length > 0) {
            // Convert to our ParsedInstruction type
            for (const ix of programInstructions) {
              allInnerInstructions.push({
                programId: ix.programId,
                name: ix.name,
                args: ix.args,
                accounts: ix.accounts.map(acc => ({
                  name: acc.name || 'unknown',
                  pubkey: acc.pubkey,
                  isSigner: acc.isSigner || false,
                  isWritable: acc.isWritable || false
                }))
              });
            }
          }
        } catch (err) {
          // Parser didn't match, continue
        }
      }
      
      return allInnerInstructions;
    } catch (error) {
      this.logger.debug('Failed to parse inner instructions', { error });
      return [];
    }
  }

  /**
   * Get parser for specific program
   */
  getParser(programId: string): SolanaParser | undefined {
    return this.parsers.get(programId);
  }

  /**
   * Add a new IDL parser
   */
  addParser(programId: string, idl: Idl): void {
    const parser = new SolanaParser([]);
    parser.addParserFromIdl(programId, idl as any);
    this.parsers.set(programId, parser);
    
    this.logger.info('Added new IDL parser', { programId });
  }

  /**
   * Check if instruction is from a known program
   */
  isKnownProgram(programId: string): boolean {
    return this.parsers.has(programId);
  }

  /**
   * Extract instruction name and type
   */
  getInstructionInfo(instruction: ParsedInstruction): {
    program: 'pump' | 'amm' | 'unknown';
    action: string;
    isTrade: boolean;
  } {
    const programId = instruction.programId.toBase58();
    
    if (programId === PUMP_PROGRAM) {
      const isTrade = ['buy', 'sell'].includes(instruction.name);
      return {
        program: 'pump',
        action: instruction.name,
        isTrade
      };
    } else if (programId === PUMP_AMM_PROGRAM) {
      const isTrade = ['buy', 'sell', 'swap'].includes(instruction.name);
      return {
        program: 'amm',
        action: instruction.name,
        isTrade
      };
    }
    
    return {
      program: 'unknown',
      action: instruction.name,
      isTrade: false
    };
  }
}

// Export singleton instance
export const idlParserService = IDLParserService.getInstance();