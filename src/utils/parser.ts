import { PublicKey } from '@solana/web3.js';
import { TRADE_EVENT_SIZE } from './constants';

export interface TradeEvent {
  mint: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
}

export function parseTradeEvent(data: Buffer): TradeEvent | null {
  if (data.length !== TRADE_EVENT_SIZE) return null;
  
  try {
    // Skip discriminator (8 bytes) and get mint (32 bytes)
    const mint = new PublicKey(data.slice(8, 40)).toString();
    
    // Get virtual reserves at specific offsets
    const virtualSolReserves = data.readBigUInt64LE(97);
    const virtualTokenReserves = data.readBigUInt64LE(105);
    
    return { mint, virtualSolReserves, virtualTokenReserves };
  } catch {
    return null;
  }
}

export function extractTradeEvents(logs: string[]): TradeEvent[] {
  const events: TradeEvent[] = [];
  
  for (const log of logs) {
    if (log.includes('Program data:')) {
      const match = log.match(/Program data: (.+)/);
      if (match?.[1]) {
        const eventData = Buffer.from(match[1], 'base64');
        const event = parseTradeEvent(eventData);
        
        if (event) {
          events.push(event);
        }
      }
    }
  }
  
  return events;
}