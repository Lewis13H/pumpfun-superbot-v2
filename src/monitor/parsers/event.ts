// src/monitor/parsers/event.ts

import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { TradeEvent } from '../types';
import { TRADE_EVENT_SIZE } from '../constants';

export class EventParser {
  /**
   * Parse trade event data from buffer
   */
  static parseTradeEvent(eventData: Buffer): TradeEvent | null {
    try {
      if (eventData.length !== TRADE_EVENT_SIZE) {
        return null; // Not a trade event
      }

      let offset = 0;
      
      // Skip event discriminator (8 bytes)
      offset += 8;
      
      // Mint address (32 bytes)
      const mint = new PublicKey(eventData.slice(offset, offset + 32)).toBase58();
      offset += 32;
      
      // SOL amount for trade (8 bytes) - in lamports
      const solAmount = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Token amount for trade (8 bytes) - raw amount
      const tokenAmount = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Is buy (1 byte)
      const isBuy = eventData.readUInt8(offset) === 1;
      offset += 1;
      
      // User pubkey (32 bytes)
      const user = new PublicKey(eventData.slice(offset, offset + 32)).toBase58();
      offset += 32;
      
      // POST-TRADE RESERVES (current state after trade)
      // Virtual token reserves (8 bytes) - raw amount
      const virtualTokenReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Virtual SOL reserves (8 bytes) - in lamports
      const virtualSolReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Real token reserves (8 bytes) - raw amount
      const realTokenReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Real SOL reserves (8 bytes) - in lamports
      const realSolReserves = Number(eventData.readBigUInt64LE(offset));

      console.log(`✅ Parsed ${isBuy ? 'BUY' : 'SELL'} event for ${mint.substring(0, 8)}...`);

      return {
        mint,
        solAmount,
        tokenAmount,
        isBuy,
        user,
        virtual_token_reserves: virtualTokenReserves,
        virtual_sol_reserves: virtualSolReserves,
        real_token_reserves: realTokenReserves,
        real_sol_reserves: realSolReserves
      };
    } catch (e) {
      console.error('Error parsing trade event:', e);
      return null;
    }
  }

  /**
   * Parse events from transaction logs
   */
  static parseEventsFromLogs(logs: string[]): Array<{ name: string; data: TradeEvent }> {
    const events: Array<{ name: string; data: TradeEvent }> = [];

    for (const log of logs) {
      if (log.includes('Program data:')) {
        try {
          const dataStart = log.indexOf('Program data:') + 'Program data:'.length;
          const eventDataBase64 = log.substring(dataStart).trim();
          
          if (eventDataBase64.length > 50) {
            const eventData = Buffer.from(eventDataBase64, 'base64');
            
            // Only process valid trade events
            if (eventData.length === TRADE_EVENT_SIZE) {
              const parsedEventData = this.parseTradeEvent(eventData);
              if (parsedEventData) {
                events.push({
                  name: 'TradeEvent',
                  data: parsedEventData
                });
              }
            }
          }
        } catch (e) {
          // Silent fail
        }
      }
    }

    return events;
  }
}