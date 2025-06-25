import https from 'https';

interface PriceCache {
  price: number;
  timestamp: number;
}

export class SolPriceService {
  private static instance: SolPriceService;
  private cache: PriceCache | null = null;
  private readonly CACHE_DURATION = 60000; // 1 minute cache
  private readonly FALLBACK_PRICE = 180; // Fallback price if API fails
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
      https.get(this.API_URL, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const price = json?.solana?.usd;
            
            if (typeof price === 'number' && price > 0) {
              console.log(`Updated SOL price: $${price.toFixed(2)}`);
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
    });
  }
  
  async getPrice(): Promise<number> {
    // Check cache first
    if (this.cache && (Date.now() - this.cache.timestamp) < this.CACHE_DURATION) {
      return this.cache.price;
    }
    
    try {
      // Fetch new price
      const price = await this.fetchFromCoinGecko();
      
      // Update cache
      this.cache = {
        price,
        timestamp: Date.now()
      };
      
      return price;
    } catch (error) {
      console.error('Failed to fetch SOL price:', error);
      
      // Return cached price if available, otherwise fallback
      if (this.cache) {
        console.log('Using cached SOL price');
        return this.cache.price;
      } else {
        console.log(`Using fallback SOL price: $${this.FALLBACK_PRICE}`);
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
}