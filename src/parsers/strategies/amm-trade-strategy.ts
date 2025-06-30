/**
 * AMM Trade Parsing Strategy
 * Handles pump.swap AMM trades
 */

import bs58 from 'bs58';
import { ParseStrategy, ParseContext, AMMTradeEvent, EventType, TradeType } from '../types';
import { AMM_PROGRAM } from '../../utils/constants';
import { Logger } from '../../core/logger';

const logger = new Logger({ context: 'AMMTradeStrategy' });

// AMM instruction signatures
const SWAP_SIGNATURES = [
  'Instruction: Swap',
  'Program log: Instruction: Swap',
  'ray_log: ',
  'SwapBaseIn',
  'SwapBaseOut'
];

export class AMMTradeStrategy implements ParseStrategy {
  name = 'AMMTradeStrategy';

  canParse(context: ParseContext): boolean {
    // Check if it's from pump.swap AMM program
    const isAMMProgram = context.accounts.some(acc => acc === AMM_PROGRAM);
    if (!isAMMProgram) return false;

    // Check if logs contain swap signatures
    return context.logs.some(log => 
      SWAP_SIGNATURES.some(sig => log.includes(sig))
    );
  }

  parse(context: ParseContext): AMMTradeEvent | null {
    try {
      // Extract swap details from logs
      const swapInfo = this.extractSwapInfo(context.logs);
      if (!swapInfo) return null;

      // Extract pool and user info
      const poolAddress = this.findPoolAccount(context.accounts);
      const userAddress = context.accounts[0]; // Usually the first account

      // Determine trade type based on swap direction
      const tradeType = this.determineTradeType(swapInfo, context.logs);

      return {
        type: EventType.AMM_TRADE,
        signature: context.signature,
        slot: context.slot,
        blockTime: context.blockTime,
        programId: AMM_PROGRAM,
        tradeType,
        mintAddress: swapInfo.tokenMint,
        userAddress,
        poolAddress: poolAddress || 'unknown',
        inputMint: swapInfo.inputMint,
        inAmount: swapInfo.inAmount,
        outputMint: swapInfo.outputMint,
        outAmount: swapInfo.outAmount,
        solAmount: swapInfo.solAmount,
        tokenAmount: swapInfo.tokenAmount,
        virtualSolReserves: swapInfo.poolSolBalance || 0n,
        virtualTokenReserves: swapInfo.poolTokenBalance || 0n
      };
    } catch (error) {
      logger.debug('Failed to parse AMM trade', { error, signature: context.signature });
      return null;
    }
  }

  private extractSwapInfo(logs: string[]): any {
    const info: any = {
      inAmount: 0n,
      outAmount: 0n,
      inputMint: '',
      outputMint: '',
      tokenMint: '',
      solAmount: 0n,
      tokenAmount: 0n
    };

    for (const log of logs) {
      // Parse ray_log format
      if (log.includes('ray_log:')) {
        const rayLogData = this.parseRayLog(log);
        if (rayLogData) {
          Object.assign(info, rayLogData);
        }
      }

      // Parse input/output amounts
      const inMatch = log.match(/in_amount:\s*(\d+)/);
      if (inMatch) {
        info.inAmount = BigInt(inMatch[1]);
      }

      const outMatch = log.match(/out_amount:\s*(\d+)/);
      if (outMatch) {
        info.outAmount = BigInt(outMatch[1]);
      }

      // Parse mints
      const inputMintMatch = log.match(/input_mint:\s*([A-HJ-NP-Za-km-z1-9]{32,44})/);
      if (inputMintMatch) {
        info.inputMint = inputMintMatch[1];
      }

      const outputMintMatch = log.match(/output_mint:\s*([A-HJ-NP-Za-km-z1-9]{32,44})/);
      if (outputMintMatch) {
        info.outputMint = outputMintMatch[1];
      }

      // Extract token mint (non-SOL mint)
      if (info.inputMint && info.outputMint) {
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        info.tokenMint = info.inputMint === SOL_MINT ? info.outputMint : info.inputMint;
        
        // Set SOL and token amounts based on which is SOL
        if (info.inputMint === SOL_MINT) {
          info.solAmount = info.inAmount;
          info.tokenAmount = info.outAmount;
        } else {
          info.solAmount = info.outAmount;
          info.tokenAmount = info.inAmount;
        }
      }
    }

    return info.tokenMint ? info : null;
  }

  private parseRayLog(log: string): any | null {
    try {
      // ray_log format: "ray_log: <base64_encoded_data>"
      const match = log.match(/ray_log:\s*([A-Za-z0-9+/=]+)/);
      if (!match) return null;

      const data = Buffer.from(match[1], 'base64');
      
      // Parse the ray log structure
      // This is a simplified version - actual structure may vary
      return {
        poolSolBalance: this.readUInt64LE(data, 0),
        poolTokenBalance: this.readUInt64LE(data, 8)
      };
    } catch {
      return null;
    }
  }

  private findPoolAccount(accounts: string[]): string | null {
    // Pool account is typically one of the first few accounts
    // Look for account that's not the user wallet or program
    for (let i = 1; i < Math.min(accounts.length, 5); i++) {
      const account = accounts[i];
      if (account !== AMM_PROGRAM && account.length === 44) {
        return account;
      }
    }
    return null;
  }

  private determineTradeType(swapInfo: any, logs: string[]): TradeType {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
    // Check instruction name in logs
    for (const log of logs) {
      if (log.includes('buy') || log.includes('Buy')) {
        return TradeType.BUY;
      }
      if (log.includes('sell') || log.includes('Sell')) {
        return TradeType.SELL;
      }
    }
    
    // Determine based on input/output mints
    // If input is SOL, user is buying tokens
    // If output is SOL, user is selling tokens
    if (swapInfo.inputMint === SOL_MINT) {
      return TradeType.BUY;
    } else if (swapInfo.outputMint === SOL_MINT) {
      return TradeType.SELL;
    }
    
    // Default to buy if unclear
    return TradeType.BUY;
  }

  private readUInt64LE(buffer: Buffer, offset: number): bigint {
    const low = buffer.readUInt32LE(offset);
    const high = buffer.readUInt32LE(offset + 4);
    return BigInt(low) + (BigInt(high) << 32n);
  }
}