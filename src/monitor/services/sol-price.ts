// src/monitor/services/sol-price.ts

import fetch from 'node-fetch';
import { COINGECKO_API_URL, COINGECKO_TIMEOUT, DEFAULT_SOL_PRICE } from '../constants';

export class SolPriceService {
  private solPrice: number = DEFAULT_SOL_PRICE;
  private updateTimer?: NodeJS.Timeout;
  private lastUpdateTime: number = 0;
  private updateInterval: number = 30000; // 30 seconds

  constructor() {
    // Initialize with a price update
    this.updatePrice();
  }

  async start(): Promise<void> {
    await this.updatePrice();
    
    this.updateTimer = setInterval(() => {
      this.updatePrice().catch(console.error);
    }, this.updateInterval);
  }

  stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }
  }

  getPrice(): number {
    return this.solPrice;
  }

  getLastUpdateTime(): number {
    return this.lastUpdateTime;
  }

  async updatePrice(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), COINGECKO_TIMEOUT);

      const response = await fetch(COINGECKO_API_URL, {
        signal: controller.signal
      });

      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json() as { solana?: { usd?: number } };
      const newPrice = data.solana?.usd;
      
      if (newPrice && newPrice > 0) {
        const oldPrice = this.solPrice;
        this.solPrice = newPrice;
        this.lastUpdateTime = Date.now();
        
        if (Math.abs(oldPrice - newPrice) > 5) {
          console.log(`💵 SOL Price changed: $${oldPrice} → $${newPrice}`);
        }
      } else {
        throw new Error('Invalid price data');
      }
    } catch (error) {
      console.error('Failed to update SOL price:', error);
      
      // If we've never successfully updated, use default
      if (this.lastUpdateTime === 0) {
        this.solPrice = DEFAULT_SOL_PRICE;
        console.log(`💵 Using fallback SOL price: $${this.solPrice}`);
      }
      // Otherwise keep the last known price
    }
  }

  // Force a price update (useful for immediate updates)
  async forceUpdate(): Promise<void> {
    await this.updatePrice();
  }
}
