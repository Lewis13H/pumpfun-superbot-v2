import { PublicKey } from '@solana/web3.js';

// TradeEvent discriminator from IDL
const TRADE_EVENT_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);

export interface ParsedTradeEvent {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: bigint;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
}

export class SimpleTradeEventParser {
  /**
   * Parse trade events from transaction logs using manual decoding
   */
  parseTradeEvents(logs: string[]): ParsedTradeEvent[] {
    const events: ParsedTradeEvent[] = [];
    
    for (const log of logs) {
      if (log.includes('Program data:')) {
        const match = log.match(/Program data: (.+)/);
        if (match?.[1]) {
          try {
            const eventData = Buffer.from(match[1], 'base64');
            
            // Check if this is a TradeEvent by comparing discriminator
            if (eventData.length >= 8 && eventData.subarray(0, 8).equals(TRADE_EVENT_DISCRIMINATOR)) {
              const event = this.decodeTradeEvent(eventData);
              if (event) {
                events.push(event);
              }
            }
          } catch (error) {
            // Ignore parsing errors
          }
        }
      }
    }
    
    return events;
  }
  
  private decodeTradeEvent(data: Buffer): ParsedTradeEvent | null {
    try {
      // Based on IDL structure:
      // discriminator: 8 bytes
      // mint: 32 bytes (pubkey)
      // sol_amount: 8 bytes (u64)
      // token_amount: 8 bytes (u64)
      // is_buy: 1 byte (bool)
      // user: 32 bytes (pubkey)
      // timestamp: 8 bytes (i64)
      // virtual_sol_reserves: 8 bytes (u64)
      // virtual_token_reserves: 8 bytes (u64)
      // real_sol_reserves: 8 bytes (u64)
      // real_token_reserves: 8 bytes (u64)
      
      let offset = 8; // Skip discriminator
      
      const mint = new PublicKey(data.subarray(offset, offset + 32)).toString();
      offset += 32;
      
      const solAmount = data.readBigUInt64LE(offset);
      offset += 8;
      
      const tokenAmount = data.readBigUInt64LE(offset);
      offset += 8;
      
      const isBuy = data[offset] === 1;
      offset += 1;
      
      const user = new PublicKey(data.subarray(offset, offset + 32)).toString();
      offset += 32;
      
      const timestamp = data.readBigInt64LE(offset);
      offset += 8;
      
      const virtualSolReserves = data.readBigUInt64LE(offset);
      offset += 8;
      
      const virtualTokenReserves = data.readBigUInt64LE(offset);
      offset += 8;
      
      const realSolReserves = data.readBigUInt64LE(offset);
      offset += 8;
      
      const realTokenReserves = data.readBigUInt64LE(offset);
      offset += 8;
      
      return {
        mint,
        solAmount,
        tokenAmount,
        isBuy,
        user,
        timestamp,
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract trade data from a transaction
   */
  extractTradeData(transaction: any): ParsedTradeEvent[] {
    const logs = transaction.transaction?.transaction?.meta?.logMessages || [];
    return this.parseTradeEvents(logs);
  }
  
  /**
   * Get a summary of buy/sell activity from trade events
   */
  getTradesSummary(events: ParsedTradeEvent[]) {
    const buys = events.filter(e => e.isBuy);
    const sells = events.filter(e => !e.isBuy);
    
    return {
      totalTrades: events.length,
      buys: buys.length,
      sells: sells.length,
      totalBuyVolumeSol: buys.reduce((acc, e) => acc + e.solAmount, 0n),
      totalSellVolumeSol: sells.reduce((acc, e) => acc + e.solAmount, 0n),
      totalBuyVolumeTokens: buys.reduce((acc, e) => acc + e.tokenAmount, 0n),
      totalSellVolumeTokens: sells.reduce((acc, e) => acc + e.tokenAmount, 0n),
      uniqueBuyers: new Set(buys.map(e => e.user)).size,
      uniqueSellers: new Set(sells.map(e => e.user)).size
    };
  }
}