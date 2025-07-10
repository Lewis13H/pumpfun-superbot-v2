/**
 * Inner Instruction Parser
 * Extracts token transfers and other operations from inner instructions
 */

import { ParseContext } from './types';
import { Logger } from '../../core/logger';
import bs58 from 'bs58';

const logger = new Logger({ context: 'InnerInstructionParser' });

// SPL Token program IDs
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_PROGRAM_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL_ADDRESS = 'So11111111111111111111111111111111111111112';

export interface TokenTransfer {
  source: string;
  destination: string;
  amount: bigint;
  mint?: string;
  decimals?: number;
}

export class InnerInstructionParser {
  /**
   * Extract token transfers from inner instructions
   */
  extractTokenTransfers(context: ParseContext): TokenTransfer[] {
    const transfers: TokenTransfer[] = [];
    
    if (!context.innerInstructions || context.innerInstructions.length === 0) {
      return transfers;
    }
    
    try {
      // Process each inner instruction
      for (const innerIxGroup of context.innerInstructions) {
        if (!innerIxGroup.instructions) continue;
        
        for (const ix of innerIxGroup.instructions) {
          const transfer = this.parseTransferInstruction(ix, context);
          if (transfer) {
            transfers.push(transfer);
          }
        }
      }
      
      // Also check for SOL transfers (system program)
      const solTransfers = this.extractSolTransfers(context);
      transfers.push(...solTransfers);
      
      logger.debug('Extracted transfers', {
        count: transfers.length,
        signature: context.signature
      });
      
      return transfers;
    } catch (error) {
      logger.debug('Failed to extract transfers', { error, signature: context.signature });
      return transfers;
    }
  }
  
  /**
   * Parse a single instruction to extract transfer details
   */
  private parseTransferInstruction(ix: any, context: ParseContext): TokenTransfer | null {
    try {
      // Check if it's a token program instruction
      const programId = this.getProgramId(ix, context);
      if (programId !== TOKEN_PROGRAM_ID && programId !== TOKEN_PROGRAM_2022) {
        return null;
      }
      
      // Parse instruction data
      const data = this.decodeInstructionData(ix.data);
      if (!data || data.length === 0) return null;
      
      // Check instruction type (transfer is type 3, transferChecked is type 12)
      const instructionType = data[0];
      
      if (instructionType === 3) {
        // Standard transfer
        return this.parseStandardTransfer(ix, data, context);
      } else if (instructionType === 12) {
        // Transfer checked (includes decimals)
        return this.parseTransferChecked(ix, data, context);
      }
      
      return null;
    } catch (error) {
      logger.debug('Failed to parse transfer instruction', { error });
      return null;
    }
  }
  
  /**
   * Parse standard SPL token transfer
   */
  private parseStandardTransfer(ix: any, data: Buffer, context: ParseContext): TokenTransfer | null {
    if (data.length < 9) return null;
    
    // Extract amount (8 bytes at offset 1)
    const amount = this.readUInt64LE(data, 1);
    
    // Get accounts
    const accounts = this.getInstructionAccounts(ix, context);
    if (accounts.length < 2) return null; // Transfer only needs source and destination
    
    return {
      source: accounts[0],
      destination: accounts[1],
      amount,
      mint: this.extractMintFromAccounts(accounts, context)
    };
  }
  
  /**
   * Parse SPL token transferChecked instruction
   */
  private parseTransferChecked(ix: any, data: Buffer, context: ParseContext): TokenTransfer | null {
    if (data.length < 10) return null;
    
    // Extract amount (8 bytes at offset 1)
    const amount = this.readUInt64LE(data, 1);
    
    // Extract decimals (1 byte at offset 9)
    const decimals = data[9];
    
    // Get accounts
    const accounts = this.getInstructionAccounts(ix, context);
    if (accounts.length < 4) return null;
    
    return {
      source: accounts[0],
      destination: accounts[1],
      amount,
      mint: accounts[2], // Mint is explicitly provided in transferChecked
      decimals
    };
  }
  
  /**
   * Extract SOL transfers from system program instructions
   */
  private extractSolTransfers(context: ParseContext): TokenTransfer[] {
    const transfers: TokenTransfer[] = [];
    
    if (!context.innerInstructions) return transfers;
    
    for (const innerIxGroup of context.innerInstructions) {
      if (!innerIxGroup.instructions) continue;
      
      for (const ix of innerIxGroup.instructions) {
        const programId = this.getProgramId(ix, context);
        
        // System program transfer
        if (programId === '11111111111111111111111111111111') {
          const data = this.decodeInstructionData(ix.data);
          if (data && data.length >= 12 && data.readUInt32LE(0) === 2) {
            // Transfer instruction (type 2)
            const amount = this.readUInt64LE(data, 4);
            const accounts = this.getInstructionAccounts(ix, context);
            
            if (accounts.length >= 2) {
              transfers.push({
                source: accounts[0],
                destination: accounts[1],
                amount,
                mint: 'SOL'
              });
            }
          }
        }
      }
    }
    
    return transfers;
  }
  
  /**
   * Get program ID from instruction
   */
  private getProgramId(ix: any, context: ParseContext): string {
    if (ix.programIdIndex !== undefined && context.accounts) {
      const index = ix.programIdIndex;
      if (index < context.accounts.length) {
        return context.accounts[index];
      }
    }
    return 'unknown';
  }
  
  /**
   * Get accounts referenced by instruction
   */
  private getInstructionAccounts(ix: any, context: ParseContext): string[] {
    const accounts: string[] = [];
    
    if (!ix.accounts || !context.accounts) return accounts;
    
    for (const accountIndex of ix.accounts) {
      if (accountIndex < context.accounts.length) {
        accounts.push(context.accounts[accountIndex]);
      }
    }
    
    return accounts;
  }
  
  /**
   * Decode instruction data from base64 or base58
   */
  private decodeInstructionData(data: any): Buffer | null {
    if (!data) return null;
    
    try {
      if (typeof data === 'string') {
        // Try base64 first
        try {
          return Buffer.from(data, 'base64');
        } catch {
          // Try base58
          return Buffer.from(bs58.decode(data));
        }
      } else if (Buffer.isBuffer(data)) {
        return data;
      } else if (Array.isArray(data)) {
        return Buffer.from(data);
      }
    } catch (error) {
      logger.debug('Failed to decode instruction data', { error });
    }
    
    return null;
  }
  
  /**
   * Try to extract mint from account list
   */
  private extractMintFromAccounts(accounts: string[], _context: ParseContext): string | undefined {
    // In standard transfer, mint might be in the account list
    // This is a heuristic - actual mint extraction would need more context
    for (const account of accounts) {
      // Skip known non-mint addresses
      if (account !== TOKEN_PROGRAM_ID && 
          account !== TOKEN_PROGRAM_2022 &&
          account !== '11111111111111111111111111111111' &&
          account.length === 44) {
        // Could be a mint
        return account;
      }
    }
    
    return undefined;
  }
  
  /**
   * Read 64-bit unsigned integer from buffer (little endian)
   */
  private readUInt64LE(buffer: Buffer, offset: number): bigint {
    if (offset + 8 > buffer.length) return 0n;
    
    const low = buffer.readUInt32LE(offset);
    const high = buffer.readUInt32LE(offset + 4);
    return BigInt(low) + (BigInt(high) << 32n);
  }
}