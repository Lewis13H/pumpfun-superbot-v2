/**
 * Simplified Raydium Trade Parsing Strategy
 * Focuses on detecting swaps without complex parsing
 */

import { PublicKey } from '@solana/web3.js';
import { ParseStrategy } from '../types';
import { TradeEvent, EventType, TradeType } from '../types';
import { Logger } from '../../../core/logger';
import { struct, u8 } from '@solana/buffer-layout';
import { u64 } from '@solana/buffer-layout-utils';

// Log data layouts for Raydium swap events
interface SwapBaseInLog {
  logType: number;
  amountIn: bigint;
  minimumOut: bigint;
  direction: bigint;
  userSource: bigint;
  poolCoin: bigint;
  poolPc: bigint;
  outAmount: bigint;
}

const SwapBaseInLogLayout = struct<SwapBaseInLog>([
  u8('logType'),
  u64('amountIn'),
  u64('minimumOut'),
  u64('direction'),
  u64('userSource'),
  u64('poolCoin'),
  u64('poolPc'),
  u64('outAmount'),
]);

interface SwapBaseOutLog {
  logType: number;
  maxIn: bigint;
  amountOut: bigint;
  direction: bigint;
  userSource: bigint;
  poolCoin: bigint;
  poolPc: bigint;
  directIn: bigint;
}

const SwapBaseOutLogLayout = struct<SwapBaseOutLog>([
  u8('logType'),
  u64('maxIn'),
  u64('amountOut'),
  u64('direction'),
  u64('userSource'),
  u64('poolCoin'),
  u64('poolPc'),
  u64('directIn'),
]);

export class SimpleRaydiumTradeStrategy implements ParseStrategy {
  name = 'SimpleRaydiumTrade';
  
  private readonly RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  // Instruction discriminators (instruction type byte)
  private readonly SWAP_BASE_IN = 9;
  private readonly SWAP_BASE_OUT = 11;
  
  
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ context: 'SimpleRaydiumStrategy' });
  }

  canParse(transaction: any): boolean {
    try {
      // Handle the full transaction structure from gRPC
      const message = transaction?.transaction?.message || transaction?.message;
      if (!message) {
        this.logger.debug('No message found in transaction');
        return false;
      }
      
      const instructions = message.instructions || [];
      const accountKeys = message.accountKeys || [];
      
      // Check if any instruction is from Raydium AMM
      return instructions.some((ix: any, idx: number) => {
        const programIdIndex = ix.programIdIndex;
        if (typeof programIdIndex === 'number' && accountKeys[programIdIndex]) {
          // Handle different account key formats
          let programId: string;
          const key = accountKeys[programIdIndex];
          if (typeof key === 'string') {
            programId = key;
          } else if (Buffer.isBuffer(key) && key.length === 32) {
            try {
              programId = new PublicKey(key).toBase58();
            } catch {
              return false;
            }
          } else if (key?.pubkey) {
            programId = key.pubkey;
          } else if (key?.toString) {
            programId = key.toString();
          } else {
            return false;
          }
          
          const isRaydium = programId === this.RAYDIUM_PROGRAM_ID;
          if (isRaydium) {
            this.logger.debug(`Found Raydium instruction at index ${idx}`);
          }
          return isRaydium;
        }
        return false;
      });
    } catch (error) {
      this.logger.debug('Error in canParse:', error);
      return false;
    }
  }

  parse(transaction: any, enhancedData?: any): TradeEvent[] {
    const events: TradeEvent[] = [];
    
    try {
      // Handle the full transaction structure from gRPC
      const message = transaction?.transaction?.message || transaction?.message;
      if (!message) {
        this.logger.debug('No message found in transaction for parsing');
        return events;
      }
      
      const instructions = message.instructions || [];
      const accountKeys = message.accountKeys || [];
      
      // Get metadata - it could be in transaction.meta or enhancedData.meta
      const meta = transaction?.meta || enhancedData?.meta || {};
      const logs = meta.logMessages || [];
      
      // Convert account keys to strings
      const accountKeysStr = accountKeys.map((key: any) => {
        if (typeof key === 'string') return key;
        if (Buffer.isBuffer(key) && key.length === 32) {
          try {
            return new PublicKey(key).toBase58();
          } catch {
            return '';
          }
        }
        if (key?.pubkey) return key.pubkey;
        if (key?.toString) return key.toString();
        return '';
      });
      
      this.logger.debug('Parsing Raydium transaction', {
        instructionCount: instructions.length,
        logCount: logs.length,
        hasRayLog: logs.some((log: string) => log.includes('ray_log')),
        signature: transaction?.signature?.slice(0, 8) + '...'
      });
      
      // Find Raydium swap instructions
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        
        // Check if this is a Raydium instruction
        const programIdIndex = ix.programIdIndex;
        if (typeof programIdIndex !== 'number' || !accountKeysStr[programIdIndex]) continue;
        
        const programId = accountKeysStr[programIdIndex];
        if (programId !== this.RAYDIUM_PROGRAM_ID) continue;
        
        // Decode instruction type
        const data = ix.data;
        if (!data) continue;
        
        let instructionType: number;
        let decoded: Buffer;
        try {
          decoded = Buffer.from(data, 'base64');
          instructionType = decoded[0];
        } catch (e) {
          this.logger.debug('Failed to decode instruction data');
          continue;
        }
        
        // Log discriminator for debugging
        let discriminator: string | null = null;
        if (decoded.length >= 8) {
          discriminator = decoded.slice(0, 8).toString('hex');
        }
        
        this.logger.debug(`Raydium instruction:`, {
          type: instructionType,
          discriminator,
          dataLength: decoded.length,
          accountCount: ix.accounts?.length || 0
        });
        
        // Process swap instructions
        if (instructionType === this.SWAP_BASE_IN || instructionType === this.SWAP_BASE_OUT) {
          // Pass the decoded instruction data along
          const event = this.createSimpleTradeEvent(
            ix,
            accountKeysStr,
            transaction,
            instructionType,
            decoded,
            meta
          );
          
          if (event) {
            events.push(event);
            this.logger.info('Created Raydium swap event', {
              signature: event.signature.slice(0, 8) + '...',
              type: event.tradeType,
              solAmount: event.solAmount.toString(),
              tokenAmount: event.tokenAmount.toString()
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
    instructionType: number,
    instructionData?: Buffer,
    meta?: any
  ): TradeEvent | null {
    try {
      // Get account indices
      const accounts = instruction.accounts || [];
      if (accounts.length < 17) {
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
      const userSourceAccount = accountKeys[accounts[15]] || '';
      const userDestAccount = accountKeys[accounts[16]] || '';
      
      // Get token mints from pre/post balances - use meta parameter or fall back to enhancedData
      const preTokenBalances = meta?.preTokenBalances || enhancedData?.meta?.preTokenBalances || [];
      const postTokenBalances = meta?.postTokenBalances || enhancedData?.meta?.postTokenBalances || [];
      const logs = meta?.logMessages || enhancedData?.meta?.logMessages || [];
      
      // Find the non-SOL token mint
      let tokenMint = '';
      
      // First try to find from token balances
      for (const balance of [...preTokenBalances, ...postTokenBalances]) {
        if (balance.mint && 
            balance.mint !== this.SOL_MINT && 
            balance.mint !== 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' && // USDT
            balance.mint !== 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') { // USDC
          tokenMint = balance.mint;
          this.logger.debug('Found token mint from balances', { mint: tokenMint });
          break;
        }
      }
      
      // If not found, try to extract from logs
      if (!tokenMint) {
        // Look for mint address in logs (Raydium often logs the mint)
        for (const log of logs) {
          // Match common patterns for mint addresses in logs
          const mintMatch = log.match(/mint[:\s]+([1-9A-HJ-NP-Za-km-z]{32,44})/i);
          if (mintMatch && mintMatch[1] !== this.SOL_MINT) {
            tokenMint = mintMatch[1];
            this.logger.debug('Found mint in logs', { mint: tokenMint });
            break;
          }
        }
      }
      
      // If still not found, try to get from pool accounts
      if (!tokenMint && accounts.length >= 6) {
        // In Raydium, the pool coin vault (index 5) and pool PC vault (index 6) hold the tokens
        // We need to identify which token is in the coin vault
        // For now, we'll skip this transaction as we need additional RPC calls to determine the mint
        this.logger.debug('Token mint detection requires additional RPC calls - skipping for now');
        
        // As a last resort, check if we can find any token account that's not SOL
        for (let i = 0; i < accounts.length; i++) {
          const accountIndex = accounts[i];
          if (accountIndex >= accountKeys.length) continue;
          
          // Check token balances for this account
          const tokenBalance = [...preTokenBalances, ...postTokenBalances].find(b => 
            b.accountIndex === accountIndex && b.mint && b.mint !== this.SOL_MINT
          );
          
          if (tokenBalance) {
            tokenMint = tokenBalance.mint;
            this.logger.debug('Found mint from account token balance', { 
              mint: tokenMint, 
              accountIndex,
              account: accountKeys[accountIndex]
            });
            break;
          }
        }
      }
      
      if (!tokenMint) {
        this.logger.debug('Could not find token mint - transaction may be SOL-only or stable swap', {
          preBalances: preTokenBalances.length,
          postBalances: postTokenBalances.length,
          accounts: accounts.length
        });
        return null;
      }
      
      // Parse amounts from logs
      let solAmount = BigInt(0);
      let tokenAmount = BigInt(0);
      let isBuy = instructionType === this.SWAP_BASE_IN;
      
      // First, try to parse from instruction data
      if (instructionData && instructionData.length >= 25) {
        try {
          // Skip the discriminator (8 bytes) and instruction type (1 byte)
          // SwapBaseIn layout: amountIn (8 bytes), amountOut (8 bytes)
          // SwapBaseOut layout: amountOut (8 bytes), maxAmountIn (8 bytes)
          
          if (instructionType === this.SWAP_BASE_IN) {
            // Read amountIn and minAmountOut
            const amountIn = instructionData.readBigUInt64LE(9);
            const minAmountOut = instructionData.readBigUInt64LE(17);
            
            // We don't know the actual output amount from instruction data alone
            // But we can use amountIn
            this.logger.debug('Parsed SwapBaseIn instruction data', {
              amountIn: amountIn.toString(),
              minAmountOut: minAmountOut.toString()
            });
          } else if (instructionType === this.SWAP_BASE_OUT) {
            // Read amountOut and maxAmountIn
            const amountOut = instructionData.readBigUInt64LE(9);
            const maxAmountIn = instructionData.readBigUInt64LE(17);
            
            this.logger.debug('Parsed SwapBaseOut instruction data', {
              amountOut: amountOut.toString(),
              maxAmountIn: maxAmountIn.toString()
            });
          }
        } catch (error) {
          this.logger.debug('Failed to parse instruction data', error);
        }
      }
      
      // Try to parse from ray_log
      const rayLog = logs.find((log: string) => log.includes('ray_log:'));
      if (rayLog) {
        try {
          const base64Log = rayLog.split('ray_log: ')[1];
          const logData = Buffer.from(base64Log, 'base64');
          const logType = logData[0];
          
          if (logType === 3) { // SwapBaseIn
            const swapData = SwapBaseInLogLayout.decode(logData);
            // direction: 0 = coin to pc (sell), 1 = pc to coin (buy)
            if (swapData.direction === BigInt(0)) {
              // Selling token for SOL
              isBuy = false;
              tokenAmount = swapData.amountIn;
              solAmount = swapData.outAmount;
            } else {
              // Buying token with SOL
              isBuy = true;
              solAmount = swapData.amountIn;
              tokenAmount = swapData.outAmount;
            }
            
            this.logger.debug('Parsed SwapBaseIn log', {
              direction: swapData.direction.toString(),
              amountIn: swapData.amountIn.toString(),
              outAmount: swapData.outAmount.toString(),
              isBuy
            });
          } else if (logType === 4) { // SwapBaseOut
            const swapData = SwapBaseOutLogLayout.decode(logData);
            // direction: 0 = coin to pc (sell), 1 = pc to coin (buy)
            if (swapData.direction === BigInt(0)) {
              // Selling token for SOL
              isBuy = false;
              tokenAmount = swapData.directIn;
              solAmount = swapData.amountOut;
            } else {
              // Buying token with SOL
              isBuy = true;
              solAmount = swapData.directIn;
              tokenAmount = swapData.amountOut;
            }
            
            this.logger.debug('Parsed SwapBaseOut log', {
              direction: swapData.direction.toString(),
              directIn: swapData.directIn.toString(),
              amountOut: swapData.amountOut.toString(),
              isBuy
            });
          }
        } catch (error) {
          this.logger.debug('Failed to parse ray_log', error);
        }
      }
      
      // Fallback: Calculate from token balance changes if log parsing failed
      if (solAmount === BigInt(0) || tokenAmount === BigInt(0)) {
        const amounts = this.calculateAmountsFromBalances(
          preTokenBalances,
          postTokenBalances,
          userSourceAccount,
          userDestAccount,
          tokenMint
        );
        
        if (amounts) {
          solAmount = amounts.solAmount;
          tokenAmount = amounts.tokenAmount;
          isBuy = amounts.isBuy;
          
          this.logger.debug('Calculated amounts from balances', {
            solAmount: solAmount.toString(),
            tokenAmount: tokenAmount.toString(),
            isBuy
          });
        }
      }
      
      return {
        type: EventType.RAYDIUM_SWAP,
        signature: enhancedData?.signature || '',
        slot: BigInt(enhancedData?.slot || 0),
        blockTime: enhancedData?.blockTime || Math.floor(Date.now() / 1000),
        programId: this.RAYDIUM_PROGRAM_ID,
        program: 'raydium_amm',
        mintAddress: tokenMint,
        poolAddress: ammId,
        userAddress: userOwner,
        tradeType: isBuy ? TradeType.BUY : TradeType.SELL,
        solAmount,
        tokenAmount,
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
  
  private calculateAmountsFromBalances(
    preTokenBalances: any[],
    postTokenBalances: any[],
    userSourceAccount: string,
    userDestAccount: string,
    tokenMint: string
  ): { solAmount: bigint; tokenAmount: bigint; isBuy: boolean } | null {
    try {
      // Find balance changes for user accounts
      let solChange = BigInt(0);
      let tokenChange = BigInt(0);
      
      // Check all balance changes and match by owner
      for (const preBalance of preTokenBalances) {
        const owner = preBalance.owner;
        if (!owner) continue;
        
        // Find corresponding post balance
        const postBalance = postTokenBalances.find(pb => 
          pb.owner === owner && pb.mint === preBalance.mint
        );
        
        if (!postBalance) continue;
        
        // Calculate change
        const preAmount = BigInt(preBalance.uiTokenAmount?.amount || '0');
        const postAmount = BigInt(postBalance.uiTokenAmount?.amount || '0');
        const change = postAmount - preAmount;
        
        // Check if this is the user's account
        if (owner === userSourceAccount || owner === userDestAccount) {
          if (preBalance.mint === this.SOL_MINT) {
            solChange += change;
          } else if (preBalance.mint === tokenMint) {
            tokenChange += change;
          }
        }
      }
      
      // Also check for new balances in post that weren't in pre
      for (const postBalance of postTokenBalances) {
        const owner = postBalance.owner;
        if (!owner) continue;
        
        const wasInPre = preTokenBalances.some(pb => 
          pb.owner === owner && pb.mint === postBalance.mint
        );
        
        if (!wasInPre && (owner === userSourceAccount || owner === userDestAccount)) {
          const amount = BigInt(postBalance.uiTokenAmount?.amount || '0');
          if (postBalance.mint === this.SOL_MINT) {
            solChange += amount;
          } else if (postBalance.mint === tokenMint) {
            tokenChange += amount;
          }
        }
      }
      
      // If we couldn't find balance changes, return null
      if (solChange === BigInt(0) && tokenChange === BigInt(0)) {
        return null;
      }
      
      // Determine trade direction
      const isBuy = solChange < 0 && tokenChange > 0; // User spent SOL, received tokens
      
      return {
        solAmount: solChange < 0 ? -solChange : solChange,
        tokenAmount: tokenChange < 0 ? -tokenChange : tokenChange,
        isBuy
      };
    } catch (error) {
      this.logger.debug('Failed to calculate amounts from balances', error);
      return null;
    }
  }
}