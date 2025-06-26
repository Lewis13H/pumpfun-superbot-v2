import { SolPriceService } from './sol-price';

export class BirdeyePriceService {
  private static instance: BirdeyePriceService;
  private solPriceService: SolPriceService;
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_DURATION_MS = 30000; // 30 seconds cache
  private readonly API_BASE_URL = 'https://public-api.birdeye.so/public';

  private constructor() {
    this.solPriceService = SolPriceService.getInstance();
  }

  static getInstance(): BirdeyePriceService {
    if (!BirdeyePriceService.instance) {
      BirdeyePriceService.instance = new BirdeyePriceService();
    }
    return BirdeyePriceService.instance;
  }

  /**
   * Get price for a single token using Birdeye's public API
   */
  async getTokenPrice(mintAddress: string): Promise<number | null> {
    // Check cache first
    const cached = this.priceCache.get(mintAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
      return cached.price;
    }

    try {
      const response = await fetch(`${this.API_BASE_URL}/price?address=${mintAddress}`);
      
      if (!response.ok) {
        console.log(`Birdeye API error: ${response.status}`);
        return null;
      }

      const data: any = await response.json();
      
      if (!data.success || !data.data?.value) {
        console.log(`No Birdeye price data for ${mintAddress}`);
        return null;
      }

      const usdPrice = data.data.value;
      
      // Cache the result
      this.priceCache.set(mintAddress, {
        price: usdPrice,
        timestamp: Date.now()
      });

      return usdPrice;
    } catch (error) {
      console.error(`Error fetching Birdeye price for ${mintAddress}:`, error);
      return null;
    }
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
}