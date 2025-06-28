import { PublicKey } from '@solana/web3.js';
import { TRADE_EVENT_SIZE } from '../utils/constants';
import bs58 from 'bs58';

/**
 * Validate if a string is a valid Solana address
 */
function isValidSolanaAddress(address: string): boolean {
  try {
    const decoded = bs58.decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export interface UnifiedTradeEvent {
  mint: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  program: 'bonding_curve' | 'amm_pool';
  isBuy?: boolean;
  user?: string;
  solAmount?: bigint;
  tokenAmount?: bigint;
}

// Buy/Sell discriminators for AMM
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

/**
 * Parse pump.fun trade event from Program data
 */
function parsePumpFunEvent(data: Buffer): UnifiedTradeEvent | null {
  if (data.length !== TRADE_EVENT_SIZE) return null;
  
  try {
    // Skip discriminator (8 bytes) and get mint (32 bytes)
    const mint = new PublicKey(data.slice(8, 40)).toString();
    
    // Get virtual reserves at specific offsets
    const virtualSolReserves = data.readBigUInt64LE(97);
    const virtualTokenReserves = data.readBigUInt64LE(105);
    
    return { 
      mint, 
      virtualSolReserves, 
      virtualTokenReserves,
      program: 'bonding_curve'
    };
  } catch {
    return null;
  }
}

/**
 * Extract pump.swap AMM events from transaction
 */
function extractAmmEvents(transaction: any, logs: string[]): UnifiedTradeEvent[] {
  const events: UnifiedTradeEvent[] = [];
  
  try {
    // Handle different transaction structures
    let message, meta, accountKeys, instructions;
    
    // The gRPC structure has transaction.transaction.transaction
    if (transaction?.transaction?.transaction) {
      const innerTx = transaction.transaction.transaction;
      message = innerTx.message;
      meta = transaction.transaction.meta; // meta is at transaction.transaction level
      
      // Also check for accountKeys in the meta
      if (!message && transaction.transaction.meta) {
        // Sometimes the structure is different
        const txData = transaction.transaction;
        message = txData.transaction?.message;
        meta = txData.meta;
      }
    }
    // Fallback structures
    else if (transaction?.transaction) {
      message = transaction.transaction.message;
      meta = transaction.transaction.meta;
    } 
    else if (transaction?.message) {
      message = transaction.message;
      meta = transaction.meta;
    }
    else {
      return events;
    }
    
    if (!message || !meta || meta.err) {
      return events;
    }
    
    // Get account keys - they might be in different places
    accountKeys = message?.accountKeys || message?.staticAccountKeys || [];
    
    // Convert Buffer account keys to base58 strings
    if (accountKeys.length > 0 && Buffer.isBuffer(accountKeys[0])) {
      accountKeys = accountKeys.map((key: Buffer) => {
        try {
          return bs58.encode(key);
        } catch {
          return '';
        }
      }).filter((key: string) => key.length > 0);
    }
    
    // If accountKeys is empty, try to reconstruct from logs or other sources
    if (accountKeys.length === 0 && logs.length > 0) {
      // Extract account keys from logs
      const uniqueKeys = new Set<string>();
      for (const log of logs) {
        const keyMatches = log.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/g);
        if (keyMatches) {
          keyMatches.forEach(key => uniqueKeys.add(key));
        }
      }
      accountKeys = Array.from(uniqueKeys);
    }
    
    instructions = message?.instructions || message?.compiledInstructions || [];
    
    // Look for AMM swap instructions
    for (let i = 0; i < instructions.length; i++) {
      const ix = instructions[i];
      const programIdIndex = ix.programIdIndex;
      if (programIdIndex >= accountKeys.length) continue;
      
      const programId = accountKeys[programIdIndex];
      
      // Check if this is pump.swap AMM
      if (programId !== 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA') continue;
      
      const ixData = ix.data;
      if (!ixData || typeof ixData !== 'string') continue;
      
      // Decode instruction data
      const dataBuffer = Buffer.from(ixData, 'base64');
      if (dataBuffer.length < 8) continue;
      
      // Check discriminator
      const discriminator = dataBuffer.slice(0, 8);
      let isBuy = false;
      
      if (discriminator.equals(BUY_DISCRIMINATOR)) {
        isBuy = true;
        // console.log('[AMM Parser] Found BUY instruction');
      } else if (discriminator.equals(SELL_DISCRIMINATOR)) {
        isBuy = false;
        // console.log('[AMM Parser] Found SELL instruction');
      } else {
        // console.log('[AMM Parser] Unknown discriminator:', discriminator.toString('hex'));
        continue;
      }
      
      // Get accounts
      const accounts = ix.accounts || [];
      if (accounts.length < 6) continue;
      
      // Get the mint address from accounts
      // For pump.swap AMM: accounts layout typically includes the token mint
      let mint: string | null = null;
      
      // Try to get mint from the accounts array
      if (accounts.length >= 6) {
        // Base mint is typically at index 5 or 6
        for (let idx of [5, 6, 7]) {
          if (idx < accounts.length && accounts[idx] < accountKeys.length) {
            const possibleMint = accountKeys[accounts[idx]];
            // Check if it looks like a mint (not a program or system account)
            if (possibleMint && 
                possibleMint !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' &&
                possibleMint !== 'So11111111111111111111111111111111111111112' &&
                possibleMint !== '11111111111111111111111111111111' &&
                possibleMint.length >= 43 &&
                isValidSolanaAddress(possibleMint)) {
              mint = possibleMint;
              break;
            }
          }
        }
      }
      
      if (!mint) continue;
      
      // Get user address (at index 1)
      const userIndex = accounts[1];
      const user = userIndex < accountKeys.length ? accountKeys[userIndex] : undefined;
      
      // If we still don't have a mint, try to get it from inner instructions
      if (!mint && meta.innerInstructions) {
        const innerIxs = meta.innerInstructions.find((inner: any) => inner.index === i);
        if (innerIxs && innerIxs.instructions) {
          // Look for token transfers which will have the mint
          for (const innerIx of innerIxs.instructions) {
            const innerAccounts = innerIx.accounts || [];
            // In token transfers, the mint is often the first account
            if (innerAccounts.length > 0 && innerAccounts[0] < accountKeys.length) {
              const possibleMint = accountKeys[innerAccounts[0]];
              if (possibleMint && 
                  possibleMint !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' &&
                  possibleMint !== 'So11111111111111111111111111111111111111112' &&
                  possibleMint.length >= 43 &&
                  isValidSolanaAddress(possibleMint)) {
                mint = possibleMint;
                break;
              }
            }
          }
        }
      }
      
      // Skip if we couldn't find a valid mint
      if (!mint || mint.length < 43) continue;
      
      // Create the event
      const event: UnifiedTradeEvent = {
        mint,
        virtualSolReserves: BigInt(1000000000), // 1 SOL placeholder
        virtualTokenReserves: BigInt(1000000000000), // 1M tokens placeholder
        program: 'amm_pool',
        isBuy,
        user
      };
      
      // Try to get amounts from inner instructions
      if (meta.innerInstructions) {
        const innerIxs = meta.innerInstructions.find((inner: any) => inner.index === i);
        if (innerIxs && innerIxs.instructions) {
          // Look for token transfers to determine amounts
          let solAmount = BigInt(0);
          let tokenAmount = BigInt(0);
          
          for (const innerIx of innerIxs.instructions) {
            const innerProgramIdIndex = innerIx.programIdIndex;
            if (innerProgramIdIndex >= accountKeys.length) continue;
            
            const innerProgramId = accountKeys[innerProgramIdIndex];
            
            // Check if this is a token program transfer
            if (innerProgramId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
                innerProgramId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') {
              
              if (innerIx.data && typeof innerIx.data === 'string') {
                const innerData = Buffer.from(innerIx.data, 'base64');
                
                // Token transfer instruction (3 = transfer, 12 = transferChecked)
                if (innerData.length >= 9 && (innerData[0] === 3 || innerData[0] === 12)) {
                  const amount = innerData.readBigUInt64LE(1);
                  
                  // Heuristic: smaller amounts are usually SOL (in lamports)
                  if (amount < BigInt(10000000000)) { // Less than 10 SOL
                    if (solAmount === BigInt(0)) solAmount = amount;
                  } else {
                    if (tokenAmount === BigInt(0)) tokenAmount = amount;
                  }
                }
              }
            }
          }
          
          if (solAmount > 0) event.solAmount = solAmount;
          if (tokenAmount > 0) event.tokenAmount = tokenAmount;
          
          // Update reserves based on amounts (rough approximation)
          if (solAmount > 0 && tokenAmount > 0) {
            // This is a very rough approximation - in reality we'd need pool state
            event.virtualSolReserves = solAmount * BigInt(100); // Assume pool has 100x the trade amount
            event.virtualTokenReserves = tokenAmount * BigInt(100);
          }
        }
      }
      
      events.push(event);
    }
  } catch (error) {
    // Silently ignore parsing errors
  }
  
  return events;
}

/**
 * Simple AMM detection from logs
 */
function detectAmmTradeFromLogs(logs: string[]): UnifiedTradeEvent | null {
  // Look for AMM-specific log patterns
  let isAmmTrade = false;
  let isBuy: boolean | undefined;
  
  for (const log of logs) {
    // Check for AMM program invocation with buy/sell
    if (log.includes('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')) {
      isAmmTrade = true;
    }
    
    // Look for buy/sell indicators in logs
    if (log.includes('Instruction: Buy')) {
      isBuy = true;
    } else if (log.includes('Instruction: Sell')) {
      isBuy = false;
    }
  }
  
  // Only process if we found a buy/sell instruction
  if (isAmmTrade && isBuy !== undefined) {
    // Extract mint from logs - look for token transfers
    let mint: string | null = null;
    
    // Strategy: Look for token mints in the logs
    // Start by collecting all unique pubkeys from the logs
    const allPubkeys = new Set<string>();
    
    for (const log of logs) {
      const pubkeyMatches = log.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/g);
      if (pubkeyMatches) {
        pubkeyMatches.forEach(key => allPubkeys.add(key));
      }
    }
    
    // Known program/system addresses to skip
    const skipAddresses = new Set([
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
      '11111111111111111111111111111111',
      'ComputeBudget111111111111111111111111111111',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      'So11111111111111111111111111111111111111112', // Wrapped SOL
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      'SysvarRent111111111111111111111111111111111',
      'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s' // Token metadata program
    ]);
    
    // Filter out known addresses and find the most likely mint
    // Mints often appear multiple times in logs
    const mintCandidates = Array.from(allPubkeys)
      .filter(key => !skipAddresses.has(key) && key.length >= 43 && isValidSolanaAddress(key));
    
    // Count occurrences of each candidate
    const mintCounts = new Map<string, number>();
    for (const candidate of mintCandidates) {
      let count = 0;
      for (const log of logs) {
        if (log.includes(candidate)) count++;
      }
      mintCounts.set(candidate, count);
    }
    
    // Pick the candidate that appears most often (likely the mint)
    if (mintCounts.size > 0) {
      const sorted = Array.from(mintCounts.entries())
        .sort((a, b) => b[1] - a[1]);
      mint = sorted[0][0];
    }
    
    // If we still don't have a mint, return null to skip this trade
    // We need valid mint addresses to properly track tokens
    if (!mint) {
      return null;
    }
    
    return {
      mint,
      virtualSolReserves: BigInt(1000000000), // 1 SOL placeholder
      virtualTokenReserves: BigInt(1000000000000), // 1M tokens placeholder
      program: 'amm_pool',
      isBuy
    };
  }
  
  return null;
}

/**
 * Extract trade events from logs - handles both pump.fun and pump.swap
 */
export function extractUnifiedTradeEvents(transaction: any, logs: string[]): UnifiedTradeEvent[] {
  const events: UnifiedTradeEvent[] = [];
  
  // First try to extract pump.fun events from Program data logs
  for (const log of logs) {
    if (log.includes('Program data:')) {
      const match = log.match(/Program data: (.+)/);
      if (match?.[1]) {
        const eventData = Buffer.from(match[1], 'base64');
        const event = parsePumpFunEvent(eventData);
        
        if (event) {
          events.push(event);
        }
      }
    }
  }
  
  // Try simple AMM detection from logs
  const ammEvent = detectAmmTradeFromLogs(logs);
  if (ammEvent) {
    events.push(ammEvent);
  } else {
    // Try the more complex parsing if simple detection fails
    const ammEvents = extractAmmEvents(transaction, logs);
    events.push(...ammEvents);
  }
  
  return events;
}