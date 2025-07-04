/**
 * Raydium Trade Parsing Strategy
 * Parses Raydium AMM swap events from transaction logs
 */

import { ParseStrategy } from '../types';
import { TradeEvent, EventType } from '../types';
import { Logger } from '../../../core/logger';
import bs58 from 'bs58';

interface RaydiumSwapEvent {
  amountIn: bigint;
  amountOut: bigint;
  direction: number; // 0 = coin to PC, 1 = PC to coin
  poolCoin: bigint;
  poolPc: bigint;
  minimumAmountOut?: bigint;
  maxAmountIn?: bigint;
}

export class RaydiumTradeStrategy implements ParseStrategy {
  private readonly RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  // Instruction discriminators
  private readonly SWAP_BASE_IN = 9;
  private readonly SWAP_BASE_OUT = 11;
  
  // Event discriminators (in logs) - commented out as not currently used
  // private readonly SWAP_BASE_IN_EVENT_DISCRIMINATOR = 3;
  // private readonly SWAP_BASE_OUT_EVENT_DISCRIMINATOR = 4;
  
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ context: 'RaydiumTradeStrategy' });
  }

  canParse(transaction: any): boolean {
    // Handle different transaction structures
    const message = transaction?.message || transaction?.transaction?.message;
    const instructions = message?.instructions || [];
    
    // Check if any instruction is from Raydium AMM
    return instructions.some((ix: any) => {
      const programId = ix.programId || ix.program || ix.programIdIndex;
      // If programIdIndex is used, resolve from accountKeys
      if (typeof programId === 'number' && message?.accountKeys) {
        const programKey = message.accountKeys[programId];
        return programKey === this.RAYDIUM_PROGRAM_ID;
      }
      return programId === this.RAYDIUM_PROGRAM_ID;
    });
  }

  parse(transaction: any, enhancedData?: any): TradeEvent[] {
    const events: TradeEvent[] = [];
    
    try {
      // Debug log to understand structure
      if (!transaction) {
        this.logger.debug('No transaction provided to parser');
        return events;
      }
      
      // Handle different transaction structures
      const message = transaction?.message || transaction?.transaction?.message;
      const instructions = message?.instructions || [];
      const logs = enhancedData?.meta?.logMessages || enhancedData?.logMessages || [];
      const accountKeys = message?.accountKeys || [];
      
      if (instructions.length === 0) {
        this.logger.debug('No instructions found in transaction');
        return events;
      }
      
      // Find Raydium swap instructions
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        
        // Handle programIdIndex format
        let programId = ix.programId || ix.program;
        if (typeof ix.programIdIndex === 'number' && accountKeys.length > ix.programIdIndex) {
          programId = accountKeys[ix.programIdIndex];
        }
        
        if (programId !== this.RAYDIUM_PROGRAM_ID) continue;
        
        this.logger.debug('Found Raydium instruction', { index: i, programId });
        
        // Decode instruction type
        const data = ix.data;
        if (!data) {
          this.logger.debug('No data in Raydium instruction');
          continue;
        }
        
        let instructionData: Uint8Array;
        try {
          // Handle base58 or raw data
          if (typeof data === 'string') {
            instructionData = bs58.decode(data);
          } else if (data instanceof Uint8Array) {
            instructionData = data;
          } else if (Buffer.isBuffer(data)) {
            instructionData = new Uint8Array(data);
          } else {
            this.logger.debug('Unknown data format in instruction', { dataType: typeof data });
            continue;
          }
        } catch (error) {
          this.logger.debug('Failed to decode instruction data', { error: (error as Error).message });
          continue;
        }
        
        const instructionType = instructionData[0];
        this.logger.debug('Instruction type:', { type: instructionType, expected: [this.SWAP_BASE_IN, this.SWAP_BASE_OUT] });
        
        // Process swap instructions
        if (instructionType === this.SWAP_BASE_IN || instructionType === this.SWAP_BASE_OUT) {
          const swapEvent = this.parseSwapEvent(
            transaction,
            enhancedData,
            ix,
            instructionType,
            logs,
            accountKeys
          );
          
          if (swapEvent) {
            events.push(swapEvent);
          }
        }
      }
      
    } catch (error) {
      this.logger.error('Error parsing Raydium transaction', error as Error);
    }
    
    return events;
  }

  /**
   * Parse a swap event from instruction and logs
   */
  private parseSwapEvent(
    _transaction: any,
    enhancedData: any,
    instruction: any,
    instructionType: number,
    logs: string[],
    accountKeys: string[]
  ): TradeEvent | null {
    try {
      // Find the event log for this instruction
      const eventLog = this.findEventLog(logs, instructionType);
      if (!eventLog) {
        this.logger.debug('No event log found for Raydium swap');
        return null;
      }
      
      // Parse the event data
      const eventData = this.parseEventLog(eventLog, instructionType);
      if (!eventData) return null;
      
      // Extract pool info from instruction accounts
      const poolInfo = this.extractPoolInfo(instruction, accountKeys);
      if (!poolInfo) return null;
      
      // Determine trade details
      const tradeInfo = this.determineTradeInfo(
        eventData,
        poolInfo,
        enhancedData,
        instructionType
      );
      
      // Create trade event
      const tradeEvent: TradeEvent = {
        type: EventType.RAYDIUM_SWAP,
        signature: enhancedData?.signature || '',
        slot: BigInt(enhancedData?.slot || 0),
        blockTime: enhancedData?.blockTime,
        programId: this.RAYDIUM_PROGRAM_ID,
        program: 'raydium_amm',
        mintAddress: tradeInfo.mintAddress,
        poolAddress: poolInfo.poolAddress,
        userAddress: tradeInfo.userAddress,
        tradeType: tradeInfo.tradeType,
        solAmount: tradeInfo.solAmount,
        tokenAmount: tradeInfo.tokenAmount,
        virtualSolReserves: eventData.poolPc, // PC is usually SOL
        virtualTokenReserves: eventData.poolCoin,
        priceUsd: 0, // Will be calculated by handler
        marketCapUsd: 0, // Will be calculated by handler
        volumeUsd: 0, // Will be calculated by handler
      };
      
      return tradeEvent;
      
    } catch (error) {
      this.logger.error('Error parsing Raydium swap event', error as Error);
      return null;
    }
  }

  /**
   * Find event log in transaction logs
   */
  private findEventLog(logs: string[], _instructionType: number): string | null {
    // Raydium events use "ray_log:" prefix
    const rayLog = logs.find(log => log.includes('ray_log:'));
    if (!rayLog) {
      // Also check for "Program log: ray_log:" format
      const programLog = logs.find(log => log.includes('Program log: ray_log:'));
      if (!programLog) {
        this.logger.debug('No ray_log found in transaction logs');
        return null;
      }
      // Extract from "Program log: ray_log: <base64>"
      const match = programLog.match(/Program log: ray_log: (\S+)/);
      return match ? match[1] : null;
    }
    
    // Extract from "ray_log: <base64>"
    const match = rayLog.match(/ray_log: (\S+)/);
    return match ? match[1] : null;
  }

  /**
   * Parse event data from base64 log
   */
  private parseEventLog(eventLog: string, _instructionType: number): RaydiumSwapEvent | null {
    try {
      // Decode base64 to buffer
      const buffer = Buffer.from(eventLog, 'base64');
      
      // Ray logs don't have discriminators - parse the data directly
      if (buffer.length < 64) {
        this.logger.debug('Ray log buffer too small', { length: buffer.length });
        return null;
      }
      
      // Parse event data based on type
      if (_instructionType === this.SWAP_BASE_IN) {
        return {
          amountIn: buffer.readBigUInt64LE(1),
          minimumAmountOut: buffer.readBigUInt64LE(9),
          direction: buffer.readUInt8(17),
          poolCoin: buffer.readBigUInt64LE(18),
          poolPc: buffer.readBigUInt64LE(26),
          amountOut: buffer.readBigUInt64LE(34)
        };
      } else {
        return {
          maxAmountIn: buffer.readBigUInt64LE(1),
          amountOut: buffer.readBigUInt64LE(9),
          direction: buffer.readUInt8(17),
          poolCoin: buffer.readBigUInt64LE(18),
          poolPc: buffer.readBigUInt64LE(26),
          amountIn: buffer.readBigUInt64LE(34) // directIn
        };
      }
    } catch (error) {
      this.logger.error('Error parsing event log', error as Error);
      return null;
    }
  }

  /**
   * Extract pool information from instruction accounts
   */
  private extractPoolInfo(instruction: any, accountKeys: string[]): any {
    try {
      const accounts = instruction.accounts || [];
      
      // Raydium swap instruction account layout:
      // 0: Token Program
      // 1: AMM ID (pool address)
      // 2: AMM Authority
      // 3: AMM Open Orders
      // 4: AMM Target Orders
      // 5: Pool Coin Vault
      // 6: Pool PC Vault
      // 7: Serum Market
      // 8: User Source Token Account
      // 9: User Destination Token Account
      // 10: User Owner
      
      if (accounts.length < 11) return null;
      
      return {
        poolAddress: accountKeys[accounts[1]],
        poolCoinVault: accountKeys[accounts[5]],
        poolPcVault: accountKeys[accounts[6]],
        userSourceAccount: accountKeys[accounts[8]],
        userDestAccount: accountKeys[accounts[9]],
        userOwner: accountKeys[accounts[10]]
      };
    } catch (error) {
      this.logger.error('Error extracting pool info', error as Error);
      return null;
    }
  }

  /**
   * Determine trade details from event and pool info
   */
  private determineTradeInfo(
    eventData: RaydiumSwapEvent,
    poolInfo: any,
    enhancedData: any,
    _instructionType: number
  ): any {
    // Get token balances to determine mints
    const preTokenBalances = enhancedData?.meta?.preTokenBalances || [];
    const postTokenBalances = enhancedData?.meta?.postTokenBalances || [];
    
    // Find token mints from balance changes
    let tokenMint = '';
    let isBuy = false;
    
    // Check user's token balance changes
    const userPreBalances = preTokenBalances.filter((tb: any) => 
      tb.owner === poolInfo.userOwner && tb.mint !== this.SOL_MINT
    );
    const userPostBalances = postTokenBalances.filter((tb: any) => 
      tb.owner === poolInfo.userOwner && tb.mint !== this.SOL_MINT
    );
    
    if (userPreBalances.length > 0 || userPostBalances.length > 0) {
      // Get the non-SOL token mint
      tokenMint = userPreBalances[0]?.mint || userPostBalances[0]?.mint || '';
      
      // Determine buy/sell by balance change
      const preAmount = userPreBalances[0]?.uiTokenAmount?.uiAmount || 0;
      const postAmount = userPostBalances[0]?.uiTokenAmount?.uiAmount || 0;
      
      // If user's token balance increased, it's a buy
      isBuy = postAmount > preAmount;
    } else {
      // Fallback: use direction from event
      // direction: 0 = coin to PC (sell), 1 = PC to coin (buy)
      isBuy = eventData.direction === 1;
    }
    
    // Determine amounts based on direction
    let solAmount: bigint;
    let tokenAmount: bigint;
    
    if (isBuy) {
      // User is buying tokens with SOL
      solAmount = eventData.amountIn;
      tokenAmount = eventData.amountOut;
    } else {
      // User is selling tokens for SOL
      tokenAmount = eventData.amountIn;
      solAmount = eventData.amountOut;
    }
    
    return {
      mintAddress: tokenMint,
      userAddress: poolInfo.userOwner,
      tradeType: isBuy ? 'buy' : 'sell',
      solAmount,
      tokenAmount
    };
  }
}

// Register event type
export function registerRaydiumEventType() {
  // Add RAYDIUM_SWAP to EventType enum if not already present
  if (!EventType.RAYDIUM_SWAP) {
    (EventType as any).RAYDIUM_SWAP = 'RAYDIUM_SWAP';
  }
  if (!EventType.RAYDIUM_LIQUIDITY) {
    (EventType as any).RAYDIUM_LIQUIDITY = 'RAYDIUM_LIQUIDITY';
  }
}