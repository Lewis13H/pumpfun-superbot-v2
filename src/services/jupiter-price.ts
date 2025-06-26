import { SolPriceService } from './sol-price';

interface JupiterPriceData {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

export class JupiterPriceService {
  private static instance: JupiterPriceService;
  private solPriceService: SolPriceService;
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_DURATION_MS = 30000; // 30 seconds cache
  private readonly BATCH_SIZE = 100; // Jupiter API limit
  private readonly API_BASE_URL = 'https://price.jup.ag/v4';

  private constructor() {
    this.solPriceService = SolPriceService.getInstance();
  }

  static getInstance(): JupiterPriceService {
    if (!JupiterPriceService.instance) {
      JupiterPriceService.instance = new JupiterPriceService();
    }
    return JupiterPriceService.instance;
  }

  /**
   * Get price for a single token
   */
  async getTokenPrice(mintAddress: string): Promise<number | null> {
    // Check cache first
    const cached = this.priceCache.get(mintAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
      return cached.price;
    }

    try {
      const response = await fetch(`${this.API_BASE_URL}/price?ids=${mintAddress}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: any = await response.json();
      const priceData = data.data[mintAddress];

      if (!priceData) {
        console.log(`No price data found for ${mintAddress}`);
        return null;
      }

      // Jupiter returns price in USD
      const usdPrice = priceData.price;
      
      // Cache the result
      this.priceCache.set(mintAddress, {
        price: usdPrice,
        timestamp: Date.now()
      });

      return usdPrice;
    } catch (error) {
      console.error(`Error fetching Jupiter price for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Get prices for multiple tokens in batch
   */
  async getBatchTokenPrices(mintAddresses: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    
    // Process in batches
    for (let i = 0; i < mintAddresses.length; i += this.BATCH_SIZE) {
      const batch = mintAddresses.slice(i, i + this.BATCH_SIZE);
      
      try {
        const ids = batch.join(',');
        const response = await fetch(`${this.API_BASE_URL}/price?ids=${ids}`);
        
        if (!response.ok) {
          console.error(`HTTP error! status: ${response.status}`);
          continue;
        }

        const data: any = await response.json();
        
        for (const [mint, priceData] of Object.entries(data.data)) {
          if (priceData && typeof priceData === 'object' && 'price' in priceData) {
            const price = (priceData as JupiterPriceData).price;
            prices.set(mint, price);
            
            // Update cache
            this.priceCache.set(mint, {
              price,
              timestamp: Date.now()
            });
          }
        }
      } catch (error) {
        console.error(`Error fetching batch prices:`, error);
      }
    }

    return prices;
  }

  /**
   * Get token data including price and market cap
   */
  async getTokenData(mintAddress: string): Promise<{
    price: number;
    marketCap: number;
    priceInSol: number;
  } | null> {
    const usdPrice = await this.getTokenPrice(mintAddress);
    if (!usdPrice) return null;

    const solPrice = await this.solPriceService.getPrice();
    const priceInSol = usdPrice / solPrice;
    
    // Assume 1B token supply for market cap calculation (standard for Pump.fun)
    const marketCap = usdPrice * 1_000_000_000;

    return {
      price: usdPrice,
      marketCap,
      priceInSol
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }
}