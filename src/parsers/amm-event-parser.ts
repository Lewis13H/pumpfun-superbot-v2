import { BorshCoder, Idl } from '@coral-xyz/anchor';
import pumpAmmIdl from '../idls/pump_amm_0.1.0.json';
import bs58 from 'bs58';

export interface AmmSwapEvent {
  type: 'Buy' | 'Sell';
  programId: string;
  user: string;
  tokenMint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  signature: string;
  slot: bigint;
  timestamp: Date;
  instructionName: string;
  poolAccount?: string;
}

// Simple transaction interface to avoid import issues
interface SimpleTransaction {
  getTransaction: () => any;
  getSignature: () => Uint8Array;
  getSlot: () => string;
  getBlockTime: () => string;
}

export class AmmEventParser {
  private coder: BorshCoder;
  private idl: Idl;

  constructor() {
    // Fix IDL to include required fields
    this.idl = {
      ...pumpAmmIdl,
      version: pumpAmmIdl.metadata.version,
      name: pumpAmmIdl.metadata.name
    } as unknown as Idl;
    this.coder = new BorshCoder(this.idl);
  }

  parseTransaction(transaction: SimpleTransaction): AmmSwapEvent | null {
    try {
      const tx = transaction.getTransaction();
      if (!tx) return null;

      const meta = tx.getMeta();
      if (!meta || meta.getErr()) return null;

      const instructions = tx.getMessage()?.getInstructionsList();
      if (!instructions) return null;

      // Find pump AMM instruction
      for (const ix of instructions) {
        const programIdIndex = ix.getProgramIdIndex();
        const accountKeys = tx.getMessage()?.getAccountKeysList();
        if (!accountKeys) continue;

        const programId = accountKeys[programIdIndex];
        const programIdStr = bs58.encode(programId as unknown as Uint8Array);

        // Check if this is a pump AMM instruction
        if (programIdStr !== pumpAmmIdl.address) continue;

        const ixData = ix.getData() as unknown as Uint8Array;
        
        // Try to decode the instruction
        let decoded: any;
        try {
          decoded = this.coder.instruction.decode(Buffer.from(ixData));
          if (!decoded) continue;
        } catch (e) {
          continue;
        }

        // Parse based on instruction name
        const instructionName = decoded.name;
        if (instructionName !== 'buy' && instructionName !== 'sell') continue;

        // Extract accounts
        const accountIndexes = ix.getAccountsList();
        const accounts = accountIndexes.map((idx: number) => 
          bs58.encode(accountKeys[idx] as unknown as Uint8Array)
        );

        // Common fields for both buy and sell
        const user = accounts[1]; // user account is typically second
        const poolAccount = accounts[0]; // pool account is first

        // Parse amounts based on instruction type
        let solAmount: bigint;
        let tokenAmount: bigint;
        let tokenMint: string;
        let eventType: 'Buy' | 'Sell';

        if (instructionName === 'buy') {
          // For buy: user sends SOL, receives tokens
          solAmount = BigInt(decoded.data.exactInputAmount || decoded.data.minInputAmount || 0);
          tokenAmount = BigInt(decoded.data.minOutputAmount || 0);
          eventType = 'Buy';
          // Token mint is typically in the pool account data or instruction accounts
          tokenMint = accounts[3] || ''; // Adjust based on actual IDL structure
        } else {
          // For sell: user sends tokens, receives SOL
          tokenAmount = BigInt(decoded.data.exactInputAmount || decoded.data.minInputAmount || 0);
          solAmount = BigInt(decoded.data.minOutputAmount || 0);
          eventType = 'Sell';
          tokenMint = accounts[3] || ''; // Adjust based on actual IDL structure
        }

        return {
          type: eventType,
          programId: programIdStr,
          user,
          tokenMint,
          solAmount,
          tokenAmount,
          signature: bs58.encode(transaction.getSignature() as unknown as Uint8Array),
          slot: BigInt(transaction.getSlot()),
          timestamp: new Date(Number(transaction.getBlockTime()) * 1000),
          instructionName,
          poolAccount,
        };
      }

      return null;
    } catch (error) {
      console.error('Error parsing AMM transaction:', error);
      return null;
    }
  }
}