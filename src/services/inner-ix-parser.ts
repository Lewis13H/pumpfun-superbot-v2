/**
 * Inner Instruction Parser
 * Parses and analyzes inner instructions for deeper transaction understanding
 */

import { Logger } from '../core/logger';
import { PublicKey } from '@solana/web3.js';
import { IDLParserService, ParsedInstruction } from './idl-parser-service';

export interface InnerInstruction {
  index: number;
  instructions: ParsedInstruction[];
}

export interface TransactionFlow {
  mainInstructions: ParsedInstruction[];
  innerInstructions: InnerInstruction[];
  tokenTransfers: TokenTransfer[];
  programCalls: ProgramCall[];
}

export interface TokenTransfer {
  from: string;
  to: string;
  mint: string;
  amount: string;
  programId: string;
}

export interface ProgramCall {
  program: string;
  instruction: string;
  depth: number;
  accounts: string[];
}

export class InnerInstructionParser {
  private static instance: InnerInstructionParser;
  private logger: Logger;
  private idlParser: IDLParserService;

  private constructor() {
    this.logger = new Logger({ context: 'InnerInstructionParser' });
    this.idlParser = IDLParserService.getInstance();
  }

  static getInstance(): InnerInstructionParser {
    if (!InnerInstructionParser.instance) {
      InnerInstructionParser.instance = new InnerInstructionParser();
    }
    return InnerInstructionParser.instance;
  }

  /**
   * Parse complete transaction flow including inner instructions
   */
  parseTransactionFlow(tx: any): TransactionFlow {
    const flow: TransactionFlow = {
      mainInstructions: [],
      innerInstructions: [],
      tokenTransfers: [],
      programCalls: []
    };

    try {
      // Parse main instructions
      if (tx.transaction?.message) {
        flow.mainInstructions = this.idlParser.parseInstructions(
          tx.transaction.message,
          tx.meta?.loadedAddresses
        );
      }

      // Parse inner instructions
      if (tx.meta?.innerInstructions) {
        for (const innerIxGroup of tx.meta.innerInstructions) {
          const parsedInner: InnerInstruction = {
            index: innerIxGroup.index,
            instructions: []
          };

          // Parse each inner instruction
          for (const innerIx of innerIxGroup.instructions) {
            try {
              const parsed = this.parseInnerInstruction(innerIx, tx);
              if (parsed) {
                parsedInner.instructions.push(parsed);
                
                // Extract token transfers
                const transfer = this.extractTokenTransfer(parsed);
                if (transfer) {
                  flow.tokenTransfers.push(transfer);
                }
              }
            } catch (err) {
              // Continue parsing other instructions
            }
          }

          if (parsedInner.instructions.length > 0) {
            flow.innerInstructions.push(parsedInner);
          }
        }
      }

      // Build program call hierarchy
      flow.programCalls = this.buildProgramCallHierarchy(flow);

    } catch (error) {
      this.logger.debug('Failed to parse transaction flow', { error });
    }

    return flow;
  }

  /**
   * Parse a single inner instruction
   */
  private parseInnerInstruction(innerIx: any, tx: any): ParsedInstruction | null {
    try {
      const programId = tx.transaction.message.accountKeys[innerIx.programIdIndex];
      const programIdStr = typeof programId === 'string' ? programId : programId.toBase58();

      // Try to parse with IDL if available
      const parser = this.idlParser.getParser(programIdStr);
      if (parser) {
        // This would need proper inner instruction parsing
        // For now, return basic structure
        return {
          programId: new PublicKey(programIdStr),
          name: 'unknown',
          args: innerIx.data,
          accounts: this.extractAccounts(innerIx, tx)
        };
      }

      // Handle known programs without IDL
      return this.parseKnownProgram(programIdStr, innerIx, tx);

    } catch (error) {
      return null;
    }
  }

  /**
   * Parse known programs without IDL
   */
  private parseKnownProgram(
    programId: string, 
    innerIx: any, 
    tx: any
  ): ParsedInstruction | null {
    // Token Program
    if (programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
      return this.parseTokenProgramInstruction(innerIx, tx);
    }

    // System Program
    if (programId === '11111111111111111111111111111111') {
      return this.parseSystemProgramInstruction(innerIx, tx);
    }

    return null;
  }

  /**
   * Parse Token Program instructions
   */
  private parseTokenProgramInstruction(innerIx: any, tx: any): ParsedInstruction {
    const instruction = innerIx.data[0];
    let name = 'unknown';

    // Token Program instruction types
    switch (instruction) {
      case 3: name = 'transfer'; break;
      case 7: name = 'mintTo'; break;
      case 8: name = 'burn'; break;
      case 9: name = 'closeAccount'; break;
      case 12: name = 'transferChecked'; break;
      default: name = `instruction_${instruction}`;
    }

    return {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      name,
      args: innerIx.data,
      accounts: this.extractAccounts(innerIx, tx)
    };
  }

  /**
   * Parse System Program instructions
   */
  private parseSystemProgramInstruction(innerIx: any, tx: any): ParsedInstruction {
    const instruction = innerIx.data[0];
    let name = 'unknown';

    // System Program instruction types
    switch (instruction) {
      case 0: name = 'createAccount'; break;
      case 2: name = 'transfer'; break;
      case 3: name = 'createAccountWithSeed'; break;
      default: name = `instruction_${instruction}`;
    }

    return {
      programId: new PublicKey('11111111111111111111111111111111'),
      name,
      args: innerIx.data,
      accounts: this.extractAccounts(innerIx, tx)
    };
  }

  /**
   * Extract accounts from inner instruction
   */
  private extractAccounts(innerIx: any, tx: any): ParsedInstruction['accounts'] {
    const accounts: ParsedInstruction['accounts'] = [];
    const accountKeys = tx.transaction.message.accountKeys;

    if (innerIx.accounts) {
      for (let i = 0; i < innerIx.accounts.length; i++) {
        const accountIndex = innerIx.accounts[i];
        const pubkey = accountKeys[accountIndex];
        
        accounts.push({
          name: `account${i}`,
          pubkey: typeof pubkey === 'string' ? new PublicKey(pubkey) : pubkey,
          isSigner: false, // Would need to check signatures
          isWritable: false // Would need to check account flags
        });
      }
    }

    return accounts;
  }

  /**
   * Extract token transfer from instruction
   */
  private extractTokenTransfer(instruction: ParsedInstruction): TokenTransfer | null {
    if (instruction.name === 'transfer' || instruction.name === 'transferChecked') {
      const accounts = instruction.accounts;
      if (accounts.length >= 3) {
        return {
          from: accounts[0].pubkey.toBase58(),
          to: accounts[1].pubkey.toBase58(),
          mint: accounts[2]?.pubkey.toBase58() || 'unknown',
          amount: instruction.args.amount || '0',
          programId: instruction.programId.toBase58()
        };
      }
    }
    return null;
  }

  /**
   * Build program call hierarchy
   */
  private buildProgramCallHierarchy(flow: TransactionFlow): ProgramCall[] {
    const calls: ProgramCall[] = [];

    // Main instructions (depth 0)
    for (const instruction of flow.mainInstructions) {
      calls.push({
        program: instruction.programId.toBase58(),
        instruction: instruction.name,
        depth: 0,
        accounts: instruction.accounts.map(a => a.pubkey.toBase58())
      });
    }

    // Inner instructions (depth 1+)
    for (const innerGroup of flow.innerInstructions) {
      for (const instruction of innerGroup.instructions) {
        calls.push({
          program: instruction.programId.toBase58(),
          instruction: instruction.name,
          depth: 1,
          accounts: instruction.accounts.map(a => a.pubkey.toBase58())
        });
      }
    }

    return calls;
  }

  /**
   * Analyze transaction for specific patterns
   */
  analyzeTransaction(flow: TransactionFlow): {
    hasTokenCreation: boolean;
    hasPoolCreation: boolean;
    hasMigration: boolean;
    tokenMints: string[];
    totalTransfers: number;
  } {
    const analysis = {
      hasTokenCreation: false,
      hasPoolCreation: false,
      hasMigration: false,
      tokenMints: new Set<string>(),
      totalTransfers: 0
    };

    // Check for token creation
    analysis.hasTokenCreation = flow.programCalls.some(
      call => call.instruction === 'createAccount' && 
              flow.tokenTransfers.length > 0
    );

    // Check for pool creation
    analysis.hasPoolCreation = flow.mainInstructions.some(
      ix => ix.name === 'create_pool' || ix.name === 'initialize_pool'
    );

    // Check for migration
    analysis.hasMigration = flow.mainInstructions.some(
      ix => ix.name === 'withdraw' || ix.name === 'migrate'
    );

    // Collect token mints
    for (const transfer of flow.tokenTransfers) {
      analysis.tokenMints.add(transfer.mint);
    }

    analysis.totalTransfers = flow.tokenTransfers.length;

    return {
      ...analysis,
      tokenMints: Array.from(analysis.tokenMints)
    };
  }
}

// Export singleton instance
export const innerInstructionParser = InnerInstructionParser.getInstance();