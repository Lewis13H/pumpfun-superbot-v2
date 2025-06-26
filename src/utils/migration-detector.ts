import { BorshCoder, EventParser } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import pumpIdl from '../idls/pump_0.1.0.json';

const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export interface MigrationEvent {
  user: string;
  mint: string;
  mintAmount: bigint;
  solAmount: bigint;
  poolMigrationFee: bigint;
  bondingCurve: string;
  timestamp: bigint;
  pool: string;
}

export class MigrationDetector {
  private coder: BorshCoder;
  private eventParser: EventParser;

  constructor() {
    this.coder = new BorshCoder(pumpIdl as any);
    this.eventParser = new EventParser(new PublicKey(PUMP_PROGRAM_ID), this.coder);
  }

  /**
   * Check if a transaction contains a migration instruction
   */
  isMigrationTransaction(instructions: any[]): boolean {
    return instructions.some(ix => 
      ix.programId === PUMP_PROGRAM_ID && 
      ix.name === 'migrate'
    );
  }

  /**
   * Parse migration events from transaction logs
   */
  parseMigrationEvents(logs: string[]): MigrationEvent[] {
    const events: MigrationEvent[] = [];
    
    try {
      const parsedEvents = this.eventParser.parseLogs(logs);
      
      for (const event of parsedEvents) {
        if (event.name === 'CompletePumpAmmMigrationEvent') {
          const data = event.data as any;
          events.push({
            user: data.user.toString(),
            mint: data.mint.toString(),
            mintAmount: BigInt(data.mintAmount.toString()),
            solAmount: BigInt(data.solAmount.toString()),
            poolMigrationFee: BigInt(data.poolMigrationFee.toString()),
            bondingCurve: data.bondingCurve.toString(),
            timestamp: BigInt(data.timestamp.toString()),
            pool: data.pool.toString()
          });
        }
      }
    } catch (error) {
      console.error('Error parsing migration events:', error);
    }
    
    return events;
  }

  /**
   * Extract migration data from a transaction
   */
  extractMigrationData(transaction: any): MigrationEvent | null {
    const logs = transaction.transaction?.meta?.logMessages || [];
    const events = this.parseMigrationEvents(logs);
    
    return events.length > 0 ? events[0] : null;
  }
}