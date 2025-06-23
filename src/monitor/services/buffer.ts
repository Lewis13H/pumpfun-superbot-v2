// src/monitor/services/buffer.ts

import { PriceUpdate } from '../types';
import { db } from '../../database';
import { EventEmitter } from 'events';
import { DEFAULT_FLUSH_INTERVAL } from '../constants';

export class BufferService extends EventEmitter {
  private priceUpdateBuffer = new Map<string, PriceUpdate>();
  private flushTimer?: NodeJS.Timeout;
  private flushInterval: number;
  private isProcessing: boolean = false;

  constructor(flushInterval: number = DEFAULT_FLUSH_INTERVAL) {
    super();
    this.flushInterval = flushInterval;
  }

  start(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushInterval);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  addPriceUpdate(update: PriceUpdate): void {
    this.priceUpdateBuffer.set(update.token, update);
  }

  getBufferSize(): number {
    return this.priceUpdateBuffer.size;
  }

  async flush(): Promise<void> {
    if (this.isProcessing) {
      console.log('⏳ Flush already in progress, skipping...');
      return;
    }

    const updates = Array.from(this.priceUpdateBuffer.values());
    
    if (updates.length === 0) return;
    
    this.isProcessing = true;
    
    try {
      // First, ensure all tokens exist in the database
      const tokensToCheck = [...new Set(updates.map(u => u.token))];
      const existingTokens = new Set<string>();
      
      // Check which tokens exist
      for (const tokenAddress of tokensToCheck) {
        const exists = await db.checkTokenExists(tokenAddress);
        if (exists) {
          existingTokens.add(tokenAddress);
        } else {
          console.warn(`⚠️ Token ${tokenAddress.substring(0, 8)}... doesn't exist in DB, creating placeholder`);
          
          // Create a placeholder token entry to satisfy foreign key constraint
          try {
            await db.upsertToken({
              address: tokenAddress,
              bondingCurve: 'unknown',
              symbol: undefined,
              name: undefined,
              imageUri: undefined,
              vanityId: undefined
            }, new Date(), 'unknown', 'placeholder');
            
            existingTokens.add(tokenAddress);
          } catch (error) {
            console.error(`Failed to create placeholder for ${tokenAddress}:`, error);
          }
        }
      }
      
      // Filter updates to only include tokens that exist
      const validUpdates = updates.filter(u => existingTokens.has(u.token));
      
      if (validUpdates.length === 0) {
        console.warn('⚠️ No valid price updates to flush');
        this.priceUpdateBuffer.clear();
        return;
      }
      
      // Now safely insert price updates
      await db.bulkInsertPriceUpdates(validUpdates);
      console.log(`💾 Flushed ${validUpdates.length} price updates (${updates.length - validUpdates.length} skipped)`);
      
      // Emit flush event with the actual updates for WebSocket broadcasting
      this.emit('flush', { 
        count: validUpdates.length,
        updates: validUpdates.map(u => ({
          token: u.token,
          price_usd: u.price_usd,
          market_cap_usd: u.market_cap_usd,
          liquidity_usd: u.liquidity_usd
        }))
      });
      
      this.priceUpdateBuffer.clear();
    } catch (error) {
      console.error('Error flushing price updates:', error);
      // Don't clear buffer on error, will retry next flush
    } finally {
      this.isProcessing = false;
    }
  }

  // Force an immediate flush
  async forceFlush(): Promise<void> {
    await this.flush();
  }
}