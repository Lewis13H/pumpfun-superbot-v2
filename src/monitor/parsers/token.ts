// src/monitor/parsers/token.ts

import { NewToken } from '../types';
import { FormattedTransaction } from '../types';
import { PUMP_PROGRAM, WSOL_MINT } from '../constants';

export class TokenParser {
  /**
   * Detect new token creation from transaction
   */
  static detectNewToken(tx: FormattedTransaction): NewToken | null {
    try {
      // Check if this is a token creation transaction
      if (tx.meta?.postTokenBalances?.length > 0 && 
          (!tx.meta?.preTokenBalances || tx.meta.preTokenBalances.length === 0)) {
        
        const mint = tx.meta.postTokenBalances[0].mint;
        
        // Skip wrapped SOL
        if (mint === WSOL_MINT) {
          return null;
        }
        
        // Extract bonding curve
        const bondingCurve = this.extractBondingCurve(tx);
        
        if (!bondingCurve) {
          console.error(`❌ No valid bonding curve found for token ${mint}`);
          return null;
        }

        console.log(`✅ New token ${mint.substring(0, 8)}... with bonding curve ${bondingCurve.substring(0, 8)}...`);

        return {
          address: mint,
          bondingCurve,
          creator: tx.message.accountKeys[0],
          signature: tx.signature,
          timestamp: new Date()
        };
      }

      return null;
    } catch (error) {
      console.error('Error detecting new token:', error);
      return null;
    }
  }

  /**
   * Extract bonding curve address from transaction
   */
  private static extractBondingCurve(tx: FormattedTransaction): string | null {
    // For pump.fun token creation, the structure is consistent:
    // Account 0: Creator/Signer
    // Account 1: Token mint (new token)
    // Account 2: Bonding curve PDA
    // Account 3: Associated bonding curve account
    // Account 4+: Other pump.fun accounts
    
    // Verify this is a pump.fun transaction
    const hasPumpProgram = tx.message.accountKeys.includes(PUMP_PROGRAM);
    if (!hasPumpProgram || tx.message.accountKeys.length < 3) {
      return null;
    }

    // The bonding curve is always at index 2 for pump.fun create transactions
    let bondingCurve = tx.message.accountKeys[2];
    
    // Validate it's not a system program or token program
    if (this.isValidBondingCurve(bondingCurve)) {
      return bondingCurve;
    }

    // If index 2 doesn't look right, try to find it via instruction parsing
    const instructions = tx.message.instructions || [];
    for (const ix of instructions) {
      const programId = tx.message.accountKeys[ix.programIdIndex];
      if (programId === PUMP_PROGRAM && ix.accounts && ix.accounts.length >= 3) {
        // Get the account at index 2 of the instruction accounts
        const bondingCurveIndex = ix.accounts[2];
        bondingCurve = tx.message.accountKeys[bondingCurveIndex];
        
        if (this.isValidBondingCurve(bondingCurve)) {
          console.log(`📍 Found bonding curve via instruction: ${bondingCurve}`);
          return bondingCurve;
        }
      }
    }

    return null;
  }

  /**
   * Validate bonding curve address
   */
  private static isValidBondingCurve(address: string): boolean {
    return !!(address && 
           !address.startsWith('11111') && 
           !address.startsWith('So111') &&
           !address.startsWith('TokenkegQ') &&
           address !== 'unknown' &&
           address !== 'undefined' &&
           address.length >= 44);
  }
}
