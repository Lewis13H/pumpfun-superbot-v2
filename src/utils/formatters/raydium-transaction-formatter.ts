import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

/**
 * Formats raw gRPC transaction data for Raydium parsers
 * The parsers expect the raw gRPC structure, not web3.js types
 */
export class RaydiumTransactionFormatter {
  /**
   * Minimal formatting to ensure parsers can access the data
   * Returns the transaction data in the format expected by the parsers
   */
  static formatTransaction(rawData: any): any {
    try {
      // The parsers expect either:
      // 1. transaction.transaction (from gRPC)
      // 2. transaction directly
      
      if (rawData?.transaction) {
        return rawData.transaction;
      }
      
      return rawData;
    } catch (error) {
      console.error('Error formatting Raydium transaction:', error);
      return null;
    }
  }

  /**
   * Extract program accounts from transaction
   */
  static extractProgramAccounts(
    tx: any,
    programId: string
  ): string[] {
    const accounts: string[] = [];
    
    try {
      const message = tx?.transaction?.message || tx?.message;
      if (!message) return accounts;
      
      const accountKeys = message.accountKeys || [];
      const instructions = message.instructions || [];
      
      // Find instructions for the specified program
      for (const inst of instructions) {
        const programIdIndex = inst.programIdIndex;
        if (typeof programIdIndex === 'number' && accountKeys[programIdIndex]) {
          const key = accountKeys[programIdIndex];
          let keyStr = '';
          
          // Handle different key formats
          if (typeof key === 'string') {
            keyStr = key;
          } else if (Buffer.isBuffer(key)) {
            try {
              keyStr = new PublicKey(key).toString();
            } catch {}
          } else if (key?.pubkey) {
            keyStr = key.pubkey;
          }
          
          if (keyStr === programId) {
            // Add all accounts used by this instruction
            for (const accountIndex of inst.accounts || []) {
              if (accountIndex < accountKeys.length) {
                const accKey = accountKeys[accountIndex];
                if (typeof accKey === 'string') {
                  accounts.push(accKey);
                } else if (Buffer.isBuffer(accKey)) {
                  try {
                    accounts.push(new PublicKey(accKey).toString());
                  } catch {}
                } else if (accKey?.pubkey) {
                  accounts.push(accKey.pubkey);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error extracting program accounts:', error);
    }
    
    return accounts;
  }

  /**
   * Decode instruction data from base64
   */
  static decodeInstructionData(data: string | Buffer): Buffer {
    try {
      if (Buffer.isBuffer(data)) {
        return data;
      }
      return Buffer.from(data, 'base64');
    } catch (error) {
      console.error('Failed to decode instruction data:', error);
      return Buffer.alloc(0);
    }
  }

  /**
   * Check if transaction contains Raydium swap
   */
  static isRaydiumSwap(tx: any, raydiumProgramId: string): boolean {
    try {
      const message = tx?.transaction?.message || tx?.message;
      if (!message) return false;
      
      const accountKeys = message.accountKeys || [];
      const instructions = message.instructions || [];
      
      // Check if any instruction is from Raydium
      for (const inst of instructions) {
        const programIdIndex = inst.programIdIndex;
        if (typeof programIdIndex === 'number' && accountKeys[programIdIndex]) {
          const key = accountKeys[programIdIndex];
          let keyStr = '';
          
          // Handle different key formats
          if (typeof key === 'string') {
            keyStr = key;
          } else if (Buffer.isBuffer(key)) {
            try {
              keyStr = new PublicKey(key).toString();
            } catch {}
          } else if (key?.pubkey) {
            keyStr = key.pubkey;
          }
          
          if (keyStr === raydiumProgramId) {
            // Decode the instruction data to check discriminator
            const data = this.decodeInstructionData(inst.data);
            if (data.length >= 8) {
              // Check for swap discriminators
              const discriminator = data.slice(0, 8).toString('hex');
              const swapDiscriminators = [
                'f8c69e91e17587c8', // swapBaseIn
                '8635d24b2f361d7f', // swapBaseOut
              ];
              
              if (swapDiscriminators.includes(discriminator)) {
                return true;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking Raydium swap:', error);
    }
    
    return false;
  }

  /**
   * Extract token mints from transaction
   */
  static extractTokenMints(tx: any): string[] {
    const mints = new Set<string>();
    
    try {
      // Get from token balances
      const preTokenBalances = tx?.meta?.preTokenBalances || [];
      const postTokenBalances = tx?.meta?.postTokenBalances || [];
      
      [...preTokenBalances, ...postTokenBalances].forEach(balance => {
        if (balance?.mint) {
          mints.add(balance.mint);
        }
      });
    } catch (error) {
      console.error('Error extracting token mints:', error);
    }
    
    return Array.from(mints);
  }
}