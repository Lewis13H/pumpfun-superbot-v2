/**
 * Bonding Curve Event Parser V2 - Improved Version
 * 
 * Enhancements:
 * - Handles both 225-byte and 113-byte event formats
 * - Better error handling and logging
 * - More flexible parsing to reduce error rates
 */

import { PublicKey } from '@solana/web3.js';
import { TRADE_EVENT_SIZE } from '../utils/constants';

export interface BondingCurveTradeEvent {
  mint: string;
  solAmount?: bigint;
  tokenAmount?: bigint;
  user?: string;
  timestamp?: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  isBuy?: boolean;
  eventSize: number;  // Track which format we parsed
}

// Known event sizes we support
const SUPPORTED_EVENT_SIZES = [225, 113];

/**
 * Parse pump.fun trade event from buffer - supports multiple formats
 */
export function parsePumpFunTradeEventV2(data: Buffer): BondingCurveTradeEvent | null {
  // Check if this is a supported event size
  if (!SUPPORTED_EVENT_SIZES.includes(data.length)) {
    return null;
  }
  
  try {
    // Handle 225-byte format (full event)
    if (data.length === 225) {
      return parse225ByteEvent(data);
    }
    
    // Handle 113-byte format (compact event)
    if (data.length === 113) {
      return parse113ByteEvent(data);
    }
    
    return null;
  } catch (error) {
    // Log but don't throw - return null for unparseable events
    console.debug('Event parse error:', error.message, 'Size:', data.length);
    return null;
  }
}

/**
 * Parse 225-byte full trade event
 */
function parse225ByteEvent(data: Buffer): BondingCurveTradeEvent | null {
  try {
    // Extract mint address (32 bytes at offset 8)
    const mint = new PublicKey(data.slice(8, 40)).toString();
    
    // Extract amounts
    const solAmount = data.readBigUInt64LE(40);
    const tokenAmount = data.readBigUInt64LE(48);
    
    // Extract user address (32 bytes at offset 56)
    const user = new PublicKey(data.slice(56, 88)).toString();
    
    // Extract timestamp
    const timestamp = Number(data.readBigUInt64LE(88));
    
    // Extract virtual reserves at correct offsets for 225-byte format
    const virtualSolReserves = data.readBigUInt64LE(97);
    const virtualTokenReserves = data.readBigUInt64LE(105);
    
    return {
      mint,
      solAmount,
      tokenAmount,
      user,
      timestamp,
      virtualSolReserves,
      virtualTokenReserves,
      eventSize: 225
    };
  } catch {
    return null;
  }
}

/**
 * Parse 113-byte compact trade event
 * This format has fewer fields but still contains essential data
 */
function parse113ByteEvent(data: Buffer): BondingCurveTradeEvent | null {
  try {
    // Compact format has different offsets
    // Based on analysis, 113-byte events have:
    // - Mint at offset 8 (32 bytes)
    // - Virtual reserves at offsets 73 and 81 (8 bytes each)
    
    const mint = new PublicKey(data.slice(8, 40)).toString();
    
    // For 113-byte format, reserves are at different offsets
    const virtualSolReserves = data.readBigUInt64LE(73);
    const virtualTokenReserves = data.readBigUInt64LE(81);
    
    // Some fields may not be available in compact format
    return {
      mint,
      virtualSolReserves,
      virtualTokenReserves,
      eventSize: 113
    };
  } catch {
    return null;
  }
}

/**
 * Extract trade events from transaction logs - improved version
 */
export function extractTradeEventsFromLogsV2(
  logs: string[]
): { events: BondingCurveTradeEvent[], parseStats: { total: number, success: number, failed: number } } {
  const events: BondingCurveTradeEvent[] = [];
  const parseStats = { total: 0, success: 0, failed: 0 };
  
  for (const log of logs) {
    if (log.includes('Program data:')) {
      const match = log.match(/Program data: (.+)/);
      if (match?.[1]) {
        parseStats.total++;
        
        try {
          const eventData = Buffer.from(match[1], 'base64');
          const event = parsePumpFunTradeEventV2(eventData);
          
          if (event) {
            events.push(event);
            parseStats.success++;
          } else {
            parseStats.failed++;
          }
        } catch (error) {
          parseStats.failed++;
          console.debug('Failed to decode base64 data:', error.message);
        }
      }
    }
  }
  
  return { events, parseStats };
}

/**
 * Enhanced trade type detection with more patterns
 */
export function detectTradeTypeFromLogsV2(logs: string[]): 'buy' | 'sell' | null {
  // Direct instruction patterns
  const buyPatterns = [
    'Instruction: Buy',
    'Program log: Instruction: Buy',
    'ProcessBuy',
    'process_buy',
    'Buy instruction'
  ];
  
  const sellPatterns = [
    'Instruction: Sell',
    'Program log: Instruction: Sell',
    'ProcessSell',
    'process_sell',
    'Sell instruction'
  ];
  
  for (const log of logs) {
    const lowerLog = log.toLowerCase();
    
    // Check buy patterns
    if (buyPatterns.some(pattern => log.includes(pattern))) {
      return 'buy';
    }
    
    // Check sell patterns
    if (sellPatterns.some(pattern => log.includes(pattern))) {
      return 'sell';
    }
    
    // Check for indirect patterns
    if (lowerLog.includes('bought') || lowerLog.includes('purchase')) {
      return 'buy';
    }
    
    if (lowerLog.includes('sold') || lowerLog.includes('liquidate')) {
      return 'sell';
    }
  }
  
  // Fallback: check for swap direction indicators
  for (let i = 0; i < logs.length - 1; i++) {
    if (logs[i].includes('Transfer') && logs[i + 1].includes('Transfer')) {
      // If SOL is transferred TO the program, it's likely a buy
      if (logs[i].includes('Program 11111111111111111111111111111111')) {
        return 'buy';
      }
    }
  }
  
  return null;
}

/**
 * Validate mint address with better error handling
 */
export function isValidMintAddressV2(mint: string): boolean {
  if (!mint || typeof mint !== 'string') {
    return false;
  }
  
  // More flexible validation
  // Allow both 43-44 character base58 strings
  if (mint.length < 43 || mint.length > 44) {
    return false;
  }
  
  // Check if it's valid base58
  try {
    const decoded = new PublicKey(mint);
    return decoded.toBase58() === mint;
  } catch {
    return false;
  }
}

/**
 * Extract mint from logs as fallback when event parsing fails
 */
export function extractMintFromLogs(logs: string[]): string | null {
  // Common patterns where mint appears in logs
  const mintPatterns = [
    /mint[:\s]+([1-9A-HJ-NP-Za-km-z]{43,44})/i,
    /token[:\s]+([1-9A-HJ-NP-Za-km-z]{43,44})/i,
    /Token mint[:\s]+([1-9A-HJ-NP-Za-km-z]{43,44})/i,
    /Creating token[:\s]+([1-9A-HJ-NP-Za-km-z]{43,44})/i
  ];
  
  for (const log of logs) {
    for (const pattern of mintPatterns) {
      const match = log.match(pattern);
      if (match?.[1] && isValidMintAddressV2(match[1])) {
        return match[1];
      }
    }
  }
  
  return null;
}