import https from 'https';
import { db } from '../database';
import { SolPriceUpdater } from './sol-price-updater';

interface PriceCache {
  price: number;
  timestamp: number;
}

export class SolPriceService {
  private static instance: SolPriceService;
  private cache: PriceCache | null = null;
  private readonly CACHE_DURATION = 1500; // 1.5 second cache for DB reads
  private readonly FALLBACK_PRICE = 180; // Fallback price if all fails
  private readonly API_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
  
  private constructor() {}
  
  static getInstance(): SolPriceService {
    if (!SolPriceService.instance) {
      SolPriceService.instance = new SolPriceService();
    }
    return SolPriceService.instance;
  }
  
  private async fetchFromCoinGecko(): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = https.get(this.API_URL, (res) => {
        let data = '';
        
        // Check status code
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const price = json?.solana?.usd;
            
            if (typeof price === 'number' && price > 0) {
              resolve(price);
            } else {
              reject(new Error('Invalid price data'));
            }
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
      
      // Add timeout
      request.setTimeout(5000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }
  
  async getPrice(): Promise<number> {
    // Check cache first
    if (this.cache && (Date.now() - this.cache.timestamp) < this.CACHE_DURATION) {
      return this.cache.price;
    }
    
    try {
      // First, try to get price from database
      const updater = SolPriceUpdater.getInstance();
      const dbPrice = await updater.getLatestPrice();
      
      if (dbPrice && (Date.now() - dbPrice.timestamp.getTime()) < 120000) { // Less than 2 minutes old
        // Update cache
        this.cache = {
          price: dbPrice.price,
          timestamp: Date.now()
        };
        return dbPrice.price;
      }
      
      // If DB price is too old or missing, fetch directly
      const price = await this.fetchFromCoinGecko();
      
      // Update cache
      this.cache = {
        price,
        timestamp: Date.now()
      };
      
      // Save to database (non-blocking)
      this.savePriceToDatabase(price).catch(err => 
        console.error('Failed to save SOL price to database:', err)
      );
      
      return price;
    } catch (error) {
      // Return cached price if available, otherwise fallback
      if (this.cache) {
        return this.cache.price;
      } else {
        // Try to get any price from database
        try {
          const updater = SolPriceUpdater.getInstance();
          const dbPrice = await updater.getLatestPrice();
          if (dbPrice) {
            return dbPrice.price;
          }
        } catch (dbError) {
          // Ignore database errors
        }
        
        return this.FALLBACK_PRICE;
      }
    }
  }
  
  // Pre-fetch price on startup
  async initialize(): Promise<void> {
    try {
      await this.getPrice();
    } catch (error) {
      console.log('Initial price fetch failed, will retry on demand');
    }
  }
  
  private async savePriceToDatabase(price: number): Promise<void> {
    try {
      await db.query(
        'INSERT INTO sol_prices (price) VALUES ($1)',
        [price]
      );
    } catch (error) {
      throw error;
    }
  }
}

// Export a convenient function for getting SOL price
export async function getSolPrice(): Promise<number> {
  const service = SolPriceService.getInstance();
  return service.getPrice();
}