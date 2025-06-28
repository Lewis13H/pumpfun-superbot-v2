/**
 * Bonding Curve Event Parser - Phase 2
 * 
 * Extracts trade events from pump.fun transaction logs.
 * Uses simple log parsing to catch all events (more reliable than IDL parsing).
 */

import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { TRADE_EVENT_SIZE } from '../utils/constants';

/**
 * Trade event structure from pump.fun
 */
export interface BondingCurveTradeEvent {
  mint: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  solAmount?: bigint;
  tokenAmount?: bigint;
  isBuy?: boolean;
  user?: string;
}

/**
 * Parse a pump.fun trade event from Program data
 * 
 * Event structure (225 bytes as per TRADE_EVENT_SIZE):
 * - Discriminator: 8 bytes
 * - Mint: 32 bytes (offset 8)
 * - SOL amount: 8 bytes (offset 40)
 * - Token amount: 8 bytes (offset 48)
 * - User: 32 bytes (offset 56)
 * - Timestamp: 8 bytes (offset 88)
 * - Virtual SOL reserves: 8 bytes (offset 97)
 * - Virtual token reserves: 8 bytes (offset 105)
 * - Additional data
 */
export function parsePumpFunTradeEvent(data: Buffer): BondingCurveTradeEvent | null {
  // Validate event size - using TRADE_EVENT_SIZE from constants
  if (data.length !== TRADE_EVENT_SIZE) {
    return null;
  }
  
  try {
    // Extract mint address (32 bytes at offset 8)
    const mint = new PublicKey(data.slice(8, 40)).toString();
    
    // Extract amounts
    const solAmount = data.readBigUInt64LE(40);
    const tokenAmount = data.readBigUInt64LE(48);
    
    // Extract user address (32 bytes at offset 56)
    const user = new PublicKey(data.slice(56, 88)).toString();
    
    // Extract virtual reserves - updated offsets for 225 byte event
    const virtualSolReserves = data.readBigUInt64LE(97);
    const virtualTokenReserves = data.readBigUInt64LE(105);
    
    return { 
      mint, 
      virtualSolReserves, 
      virtualTokenReserves,
      solAmount,
      tokenAmount,
      user
    };
  } catch (error) {
    // Invalid event data
    return null;
  }
}

/**
 * Extract trade events from transaction logs
 */
export function extractTradeEventsFromLogs(logs: string[]): BondingCurveTradeEvent[] {
  const events: BondingCurveTradeEvent[] = [];
  
  for (const log of logs) {
    if (log.includes('Program data:')) {
      const match = log.match(/Program data: (.+)/);
      if (match?.[1]) {
        try {
          const eventData = Buffer.from(match[1], 'base64');
          
          // Debug: Log event sizes we're seeing
          if (eventData.length === TRADE_EVENT_SIZE || eventData.length === 113) {
            const event = parsePumpFunTradeEvent(eventData);
            
            if (event) {
              events.push(event);
            }
          }
        } catch {
          // Skip invalid data
        }
      }
    }
  }
  
  return events;
}

/**
 * Detect buy/sell from instruction names in logs
 */
export function detectTradeTypeFromLogs(logs: string[]): 'buy' | 'sell' | null {
  for (const log of logs) {
    // Look for instruction names
    if (log.includes('Instruction: Buy') || log.includes('Program log: Instruction: Buy')) {
      return 'buy';
    }
    if (log.includes('Instruction: Sell') || log.includes('Program log: Instruction: Sell')) {
      return 'sell';
    }
    
    // Alternative patterns
    if (log.toLowerCase().includes('invoke [2]') && logs.some(l => l.includes('buy'))) {
      return 'buy';
    }
    if (log.toLowerCase().includes('invoke [2]') && logs.some(l => l.includes('sell'))) {
      return 'sell';
    }
  }
  
  return null;
}

/**
 * Extract mint address from various log patterns
 * This is a fallback if event parsing fails
 */
export function extractMintFromLogs(logs: string[]): string | null {
  // Pattern 1: Look for mint in token account creation
  for (const log of logs) {
    if (log.includes('Create') && log.includes('account')) {
      // Extract all base58 addresses from the log
      const addresses = extractBase58Addresses(log);
      if (addresses.length >= 2) {
        // Usually the second address is the mint
        return addresses[1];
      }
    }
  }
  
  // Pattern 2: Look for mint in Program data events
  const events = extractTradeEventsFromLogs(logs);
  if (events.length > 0 && events[0].mint) {
    return events[0].mint;
  }
  
  return null;
}

/**
 * Extract all base58 addresses from a string
 */
function extractBase58Addresses(text: string): string[] {
  const addresses: string[] = [];
  // Match base58 addresses (44 characters, no 0, O, I, l)
  const regex = /[1-9A-HJ-NP-Za-km-z]{44}/g;
  const matches = text.match(regex);
  
  if (matches) {
    for (const match of matches) {
      try {
        // Validate it's a proper base58 address
        const decoded = bs58.decode(match);
        if (decoded.length === 32) {
          addresses.push(match);
        }
      } catch {
        // Not a valid base58 address
      }
    }
  }
  
  return addresses;
}

/**
 * Validate mint address format
 */
export function isValidMintAddress(address: string): boolean {
  if (!address || address.length !== 44) {
    return false;
  }
  
  try {
    const decoded = bs58.decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

/**
 * Extract user address from instruction accounts
 * Note: This requires access to the parsed instruction data
 */
export function extractUserFromInstruction(instruction: any): string | null {
  try {
    // Look for 'user' account in instruction
    const userAccount = instruction.accounts?.find((acc: any) => 
      acc.name === 'user' || acc.name === 'userAuthority'
    );
    
    if (userAccount?.pubkey) {
      return userAccount.pubkey.toString();
    }
    
    // Fallback: first account is often the user
    if (instruction.accounts?.length > 0) {
      return instruction.accounts[0].pubkey.toString();
    }
  } catch {
    // Unable to extract user
  }
  
  return null;
}