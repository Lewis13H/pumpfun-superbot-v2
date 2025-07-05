/**
 * Liquidity Event Parsing Strategy
 * Handles AMM liquidity add/remove and fee collection events
 */

import { ParseStrategy, ParseContext, ParsedEvent, EventType } from '../types';
import { AMM_PROGRAM, PUMP_SWAP_PROGRAM } from '../../config/constants';
import { Logger } from '../../../core/logger';

const logger = new Logger({ context: 'LiquidityStrategy' });

// Liquidity instruction signatures
const LIQUIDITY_ADD_SIGNATURES = [
  'Instruction: AddLiquidity',
  'Program log: Instruction: AddLiquidity',
  'AddLiquidity',
  'add_liquidity',
  'mint_lp_tokens'
];

const LIQUIDITY_REMOVE_SIGNATURES = [
  'Instruction: RemoveLiquidity',
  'Program log: Instruction: RemoveLiquidity', 
  'RemoveLiquidity',
  'remove_liquidity',
  'burn_lp_tokens'
];

const FEE_COLLECTION_SIGNATURES = [
  'Instruction: CollectFees',
  'Program log: Instruction: CollectFees',
  'CollectFees',
  'collect_fees',
  'fee_collection'
];

export interface LiquidityEvent {
  type: EventType.AMM_LIQUIDITY_ADD | EventType.AMM_LIQUIDITY_REMOVE | EventType.AMM_FEE_COLLECT;
  signature: string;
  slot: bigint;
  blockTime?: number;
  programId: string;
  poolAddress: string;
  userAddress: string;
  tokenMint: string;
  lpMint?: string;
  tokenAmount?: bigint;
  solAmount?: bigint;
  lpAmount?: bigint;
  feeAmount?: bigint;
  virtualSolReserves?: bigint;
  virtualTokenReserves?: bigint;
}

export class LiquidityStrategy implements ParseStrategy {
  name = 'LiquidityStrategy';

  canParse(context: ParseContext): boolean {
    // Check if it's from AMM programs
    const isAMMProgram = context.accounts.some(acc => 
      acc === AMM_PROGRAM || acc === PUMP_SWAP_PROGRAM
    );
    if (!isAMMProgram) return false;

    // Check if logs contain liquidity signatures
    return context.logs.some(log => 
      [...LIQUIDITY_ADD_SIGNATURES, ...LIQUIDITY_REMOVE_SIGNATURES, ...FEE_COLLECTION_SIGNATURES]
        .some(sig => log.includes(sig))
    );
  }

  parse(context: ParseContext): ParsedEvent | null {
    try {
      // Determine event type
      const eventType = this.determineEventType(context.logs);
      if (!eventType) return null;

      // Extract liquidity details
      const liquidityInfo = this.extractLiquidityInfo(context.logs, eventType);
      if (!liquidityInfo) return null;

      // Find pool and user accounts
      const poolAddress = this.findPoolAccount(context.accounts);
      const userAddress = context.accounts[0]; // Usually the signer
      
      // Find token mint from accounts
      const tokenMint = this.findTokenMint(context.accounts);

      const liquidityEvent: LiquidityEvent = {
        type: eventType as any,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: context.accounts.find(acc => acc === AMM_PROGRAM || acc === PUMP_SWAP_PROGRAM) || '',
        poolAddress: poolAddress || 'unknown',
        userAddress,
        tokenMint: tokenMint || liquidityInfo.tokenMint || '',
        lpMint: liquidityInfo.lpMint,
        tokenAmount: liquidityInfo.tokenAmount,
        solAmount: liquidityInfo.solAmount,
        lpAmount: liquidityInfo.lpAmount,
        feeAmount: liquidityInfo.feeAmount,
        virtualSolReserves: liquidityInfo.solReserves,
        virtualTokenReserves: liquidityInfo.tokenReserves
      };
      
      return liquidityEvent as unknown as ParsedEvent;
    } catch (error) {
      logger.debug('Failed to parse liquidity event', { error, signature: context.signature });
      return null;
    }
  }

  private determineEventType(logs: string[]): EventType | null {
    for (const log of logs) {
      if (LIQUIDITY_ADD_SIGNATURES.some(sig => log.includes(sig))) {
        return EventType.AMM_LIQUIDITY_ADD;
      }
      if (LIQUIDITY_REMOVE_SIGNATURES.some(sig => log.includes(sig))) {
        return EventType.AMM_LIQUIDITY_REMOVE;
      }
      if (FEE_COLLECTION_SIGNATURES.some(sig => log.includes(sig))) {
        return EventType.AMM_FEE_COLLECT;
      }
    }
    return null;
  }

  private extractLiquidityInfo(logs: string[], _eventType: EventType): any {
    const info: any = {
      tokenAmount: 0n,
      solAmount: 0n,
      lpAmount: 0n,
      feeAmount: 0n,
      solReserves: 0n,
      tokenReserves: 0n,
      tokenMint: '',
      lpMint: ''
    };

    for (const log of logs) {
      // Parse token amount
      const tokenMatch = log.match(/token_amount:\s*(\d+)/i);
      if (tokenMatch) {
        info.tokenAmount = BigInt(tokenMatch[1]);
      }

      // Parse SOL amount
      const solMatch = log.match(/sol_amount:\s*(\d+)/i);
      if (solMatch) {
        info.solAmount = BigInt(solMatch[1]);
      }

      // Parse LP amount
      const lpMatch = log.match(/lp_(?:tokens|amount):\s*(\d+)/i);
      if (lpMatch) {
        info.lpAmount = BigInt(lpMatch[1]);
      }

      // Parse fee amount (for fee collection)
      const feeMatch = log.match(/fee_amount:\s*(\d+)/i);
      if (feeMatch) {
        info.feeAmount = BigInt(feeMatch[1]);
      }

      // Parse reserves
      const solReservesMatch = log.match(/sol_reserves?:\s*(\d+)/i);
      if (solReservesMatch) {
        info.solReserves = BigInt(solReservesMatch[1]);
      }

      const tokenReservesMatch = log.match(/token_reserves?:\s*(\d+)/i);
      if (tokenReservesMatch) {
        info.tokenReserves = BigInt(tokenReservesMatch[1]);
      }

      // Parse mints
      const tokenMintMatch = log.match(/token_mint:\s*([A-Za-z0-9]+)/);
      if (tokenMintMatch) {
        info.tokenMint = tokenMintMatch[1];
      }

      const lpMintMatch = log.match(/lp_mint:\s*([A-Za-z0-9]+)/);
      if (lpMintMatch) {
        info.lpMint = lpMintMatch[1];
      }
    }

    return info;
  }

  private findPoolAccount(accounts: string[]): string | null {
    // Pool account is typically after the program ID
    // Look for accounts that might be pools (usually have specific characteristics)
    for (let i = 1; i < accounts.length; i++) {
      const account = accounts[i];
      // Simple heuristic: pools often have certain patterns
      // In practice, you'd have more sophisticated logic
      if (account.length === 44) { // Base58 encoded 32-byte address
        return account;
      }
    }
    return null;
  }

  private findTokenMint(accounts: string[]): string | null {
    // Token mint is typically in the accounts array
    // Look for known token program or mint patterns
    for (const account of accounts) {
      // Check if it might be a mint (you could add more sophisticated checks)
      if (account.length === 44 && !account.startsWith('11111')) {
        return account;
      }
    }
    return null;
  }
}