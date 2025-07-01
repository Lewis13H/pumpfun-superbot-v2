/**
 * Migration Detection Strategy
 * Detects token migrations from bonding curve to AMM
 */

import { ParseContext, ParseStrategy } from './base-strategy';
import { EventType, ParsedEvent } from '../types';
import { IDLParserService } from '../../services/idl-parser-service';

export class MigrationDetectionStrategy implements ParseStrategy {
  name = 'MigrationDetection';
  
  private idlParser: IDLParserService;

  constructor() {
    this.idlParser = IDLParserService.getInstance();
  }

  canParse(context: ParseContext): boolean {
    // Check for migration-related instructions
    return context.logs.some(log => 
      log.includes('withdraw') || 
      log.includes('migrate') ||
      log.includes('graduation') ||
      log.includes('complete')
    );
  }

  parse(context: ParseContext): ParsedEvent | null {
    try {
      // Check if this is a graduation/migration transaction
      const graduationEvent = this.detectGraduation(context);
      if (graduationEvent) {
        return graduationEvent;
      }

      // Check for pool creation after graduation
      const poolCreation = this.detectPoolCreation(context);
      if (poolCreation) {
        return poolCreation;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Detect graduation/migration event
   */
  private detectGraduation(context: ParseContext): ParsedEvent | null {
    try {
      // Parse instructions
      const instructions = this.idlParser.parseInstructions(
        context.fullTransaction?.transaction?.message,
        context.fullTransaction?.meta?.loadedAddresses
      );

      // Find withdraw instruction (indicates graduation)
      const withdrawIx = instructions.find(ix => ix.name === 'withdraw');
      if (!withdrawIx) return null;

      // Extract key accounts
      const bondingCurve = withdrawIx.accounts.find(a => a.name === 'bondingCurve')?.pubkey.toBase58();
      const mint = withdrawIx.accounts.find(a => a.name === 'mint')?.pubkey.toBase58();
      
      if (!bondingCurve || !mint) return null;

      // Just detect graduation, don't worry about destination details for now

      // Return as GraduationEvent
      return {
        type: EventType.GRADUATION,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: withdrawIx.programId.toBase58(),
        mintAddress: mint,
        bondingCurveKey: bondingCurve,
        timestamp: Date.now()
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Detect pool creation event
   */
  private detectPoolCreation(context: ParseContext): ParsedEvent | null {
    try {
      // Parse instructions
      const instructions = this.idlParser.parseInstructions(
        context.fullTransaction?.transaction?.message,
        context.fullTransaction?.meta?.loadedAddresses
      );

      // Find create_pool instruction
      const createPoolIx = instructions.find(ix => 
        ix.name === 'create_pool' || ix.name === 'initialize_pool'
      );
      
      if (!createPoolIx) return null;

      const mint = createPoolIx.accounts.find(a => a.name === 'mint')?.pubkey.toBase58();
      const pool = createPoolIx.accounts.find(a => a.name === 'pool')?.pubkey.toBase58();
      
      if (!mint || !pool) return null;

      return {
        type: EventType.POOL_CREATED,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: createPoolIx.programId.toBase58(),
        poolAddress: pool,
        mintAddress: mint,
        lpMint: createPoolIx.accounts.find(a => a.name === 'lpMint')?.pubkey.toBase58() || '',
        virtualSolReserves: BigInt(0), // Would need to extract from event
        virtualTokenReserves: BigInt(0) // Would need to extract from event
      };

    } catch (error) {
      return null;
    }
  }


}

export const migrationDetectionStrategy = new MigrationDetectionStrategy();