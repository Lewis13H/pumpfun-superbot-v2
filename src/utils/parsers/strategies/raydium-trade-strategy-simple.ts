/**
 * Simplified Raydium Trade Parsing Strategy
 * Focuses on detecting swaps without complex parsing
 */

import { ParseStrategy } from '../types';
import { TradeEvent, EventType, TradeType } from '../types';
import { Logger } from '../../../core/logger';

export class SimpleRaydiumTradeStrategy implements ParseStrategy {
  name = 'SimpleRaydiumTrade';
  
  private readonly RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  // Instruction discriminators
  private readonly SWAP_BASE_IN = 9;
  private readonly SWAP_BASE_OUT = 11;
  
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ context: 'SimpleRaydiumStrategy' });
  }

  canParse(transaction: any): boolean {
    // Handle different transaction structures
    const message = transaction?.message || transaction?.transaction?.message;
    const instructions = message?.instructions || [];
    const accountKeys = message?.accountKeys || [];
    
    // Check if any instruction is from Raydium AMM
    return instructions.some((ix: any, idx: number) => {
      const programIdIndex = ix.programIdIndex;
      if (typeof programIdIndex === 'number' && accountKeys[programIdIndex]) {
        const programId = accountKeys[programIdIndex];
        const isRaydium = programId === this.RAYDIUM_PROGRAM_ID;
        if (isRaydium) {
          this.logger.debug(`Found Raydium instruction at index ${idx}`);
        }
        return isRaydium;
      }
      return false;
    });
  }

  async parse(transaction: any, enhancedData?: any): Promise<TradeEvent[]> {
    const events: TradeEvent[] = [];
    
    try {
      // Handle different transaction structures
      const message = transaction?.message || transaction?.transaction?.message;
      const instructions = message?.instructions || [];
      const accountKeys = message?.accountKeys || [];
      const logs = enhancedData?.meta?.logMessages || enhancedData?.logMessages || [];
      
      this.logger.debug('Parsing Raydium transaction', {
        instructionCount: instructions.length,
        logCount: logs.length,
        hasRayLog: logs.some((log: string) => log.includes('ray_log'))
      });
      
      // Find Raydium swap instructions
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        
        // Check if this is a Raydium instruction
        const programIdIndex = ix.programIdIndex;
        if (typeof programIdIndex !== 'number' || !accountKeys[programIdIndex]) continue;
        
        const programId = accountKeys[programIdIndex];
        if (programId !== this.RAYDIUM_PROGRAM_ID) continue;
        
        // Decode instruction type
        const data = ix.data;
        if (!data) continue;
        
        let instructionType: number;
        try {
          const decoded = Buffer.from(data, 'base64');
          instructionType = decoded[0];
        } catch (e) {
          this.logger.debug('Failed to decode instruction data');
          continue;
        }
        
        this.logger.debug(`Raydium instruction type: ${instructionType}`);
        
        // Process swap instructions
        if (instructionType === this.SWAP_BASE_IN || instructionType === this.SWAP_BASE_OUT) {
          // For now, create a simple trade event
          const event = this.createSimpleTradeEvent(
            ix,
            accountKeys,
            enhancedData,
            instructionType
          );
          
          if (event) {
            events.push(event);
            this.logger.info('Created Raydium swap event', {
              signature: event.signature.slice(0, 8) + '...',
              type: event.tradeType
            });
          }
        }
      }
      
    } catch (error) {
      this.logger.error('Error parsing Raydium transaction', error as Error);
    }
    
    return events;
  }

  private createSimpleTradeEvent(
    instruction: any,
    accountKeys: string[],
    enhancedData: any,
    instructionType: number
  ): TradeEvent | null {
    try {
      // Get account indices
      const accounts = instruction.accounts || [];
      if (accounts.length < 9) {
        this.logger.debug('Not enough accounts for Raydium swap');
        return null;
      }
      
      // Raydium swap account layout:
      // 0: Token Program
      // 1: AMM ID
      // 2: AMM Authority
      // 3: AMM Open Orders
      // 4: AMM Target Orders
      // 5: Pool Coin Vault
      // 6: Pool PC Vault
      // 7: Serum Program
      // 8: Serum Market
      // 9: Serum Bids
      // 10: Serum Asks
      // 11: Serum Event Queue
      // 12: Serum Coin Vault
      // 13: Serum PC Vault
      // 14: Serum Vault Signer
      // 15: User Source Token Account
      // 16: User Destination Token Account
      // 17: User Owner
      
      const ammId = accountKeys[accounts[1]] || '';
      const userOwner = accountKeys[accounts[17]] || '';
      
      // Get token mints from pre/post balances
      const preTokenBalances = enhancedData?.meta?.preTokenBalances || [];
      const postTokenBalances = enhancedData?.meta?.postTokenBalances || [];
      
      // Find the non-SOL token mint
      let tokenMint = '';
      for (const balance of [...preTokenBalances, ...postTokenBalances]) {
        if (balance.mint && balance.mint !== this.SOL_MINT) {
          tokenMint = balance.mint;
          break;
        }
      }
      
      if (!tokenMint) {
        this.logger.debug('Could not find token mint');
        return null;
      }
      
      // Simple buy/sell detection based on instruction type
      const isBuy = instructionType === this.SWAP_BASE_IN;
      
      return {
        type: EventType.RAYDIUM_SWAP,
        signature: enhancedData?.signature || '',
        slot: BigInt(enhancedData?.slot || 0),
        blockTime: enhancedData?.blockTime,
        programId: this.RAYDIUM_PROGRAM_ID,
        program: 'raydium_amm',
        mintAddress: tokenMint,
        poolAddress: ammId,
        userAddress: userOwner,
        tradeType: isBuy ? TradeType.BUY : TradeType.SELL,
        solAmount: BigInt(0), // Will be calculated by handler
        tokenAmount: BigInt(0), // Will be calculated by handler
        virtualSolReserves: BigInt(0), // Will be fetched by handler
        virtualTokenReserves: BigInt(0), // Will be fetched by handler
        priceUsd: 0,
        marketCapUsd: 0,
        volumeUsd: 0,
      };
      
    } catch (error) {
      this.logger.error('Error creating trade event', error as Error);
      return null;
    }
  }
}