import https from 'https';
import { db } from '../../database';

interface PriceCache {
  price: number;
  timestamp: number;
}

interface PriceSource {
  name: string;
  fetchPrice: () => Promise<number>;
}

export class SolPriceService {
  private static instance: SolPriceService;
  private cache: PriceCache | null = null;
  private readonly CACHE_DURATION = 1500; // 1.5 second cache for DB reads
  private readonly FALLBACK_PRICE = 180; // Fallback price if all fails
  private readonly BINANCE_API_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT';
  
  // Updater properties
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_FREQUENCY = 5000; // 5 seconds (Binance has higher limits)
  private lastUpdateTime: Date | null = null;
  private isRunning = false;
  private callCount = 0;
  private callTimestamps: number[] = [];
  private consecutiveFailures = 0;
  private backoffMultiplier = 1;
  
  private constructor() {}
  
  static getInstance(): SolPriceService {
    if (!SolPriceService.instance) {
      SolPriceService.instance = new SolPriceService();
    }
    return SolPriceService.instance;
  }
  
  private async fetchFromBinance(): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = https.get(this.BINANCE_API_URL, (res) => {
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
            const price = parseFloat(json?.price);
            
            if (!isNaN(price) && price > 0) {
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
      const dbPrice = await this.getLatestPrice();
      
      if (dbPrice && (Date.now() - dbPrice.timestamp.getTime()) < 120000) { // Less than 2 minutes old
        // Update cache
        this.cache = {
          price: dbPrice.price,
          timestamp: Date.now()
        };
        return dbPrice.price;
      }
      
      // If DB price is too old or missing, fetch directly
      const price = await this.fetchFromBinance();
      
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
          const dbPrice = await this.getLatestPrice();
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
  
  // Updater methods
  private async ensureTable(): Promise<void> {
    // First check if table exists
    const tableExists = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'sol_prices'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      // Create new table
      await db.query(`
        CREATE TABLE sol_prices (
          id SERIAL PRIMARY KEY,
          price DECIMAL(10, 2) NOT NULL,
          source VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      // Check for missing columns and add them
      const columns = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'sol_prices'
      `);
      
      const existingColumns = columns.rows.map((row: any) => row.column_name);
      
      // Add missing columns
      if (!existingColumns.includes('source')) {
        await db.query(`ALTER TABLE sol_prices ADD COLUMN source VARCHAR(50) DEFAULT 'Binance'`);
      }
      
      if (!existingColumns.includes('created_at')) {
        await db.query(`ALTER TABLE sol_prices ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      }
    }
    
    // Create index for faster queries
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_sol_prices_created_at 
      ON sol_prices(created_at DESC)
    `);
  }
  
  private async savePrice(price: number, source: string): Promise<void> {
    try {
      await db.query(
        'INSERT INTO sol_prices (price, source, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [price, source]
      );
      this.lastUpdateTime = new Date();
    } catch (error) {
      // Fallback for tables without source column
      try {
        await db.query(
          'INSERT INTO sol_prices (price) VALUES ($1)',
          [price]
        );
        this.lastUpdateTime = new Date();
      } catch (fallbackError) {
        console.error('Failed to save price:', fallbackError);
        throw fallbackError;
      }
    }
  }
  
  async getLatestPrice(): Promise<{ price: number; source: string; timestamp: Date } | null> {
    try {
      // Try with all columns first
      const result = await db.query(
        'SELECT price, source, created_at FROM sol_prices ORDER BY created_at DESC LIMIT 1'
      );
      
      if (result.rows.length > 0) {
        return {
          price: parseFloat(result.rows[0].price),
          source: result.rows[0].source || 'Unknown',
          timestamp: result.rows[0].created_at || new Date()
        };
      }
    } catch (error) {
      // Fallback for old schema
      try {
        const result = await db.query(
          'SELECT price, timestamp FROM sol_prices ORDER BY timestamp DESC LIMIT 1'
        );
        
        if (result.rows.length > 0) {
          return {
            price: parseFloat(result.rows[0].price),
            source: 'Unknown',
            timestamp: result.rows[0].timestamp
          };
        }
      } catch (fallbackError) {
        console.error('Failed to get latest price:', fallbackError);
      }
    }
    
    return null;
  }
  
  private checkRateLimit(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Remove timestamps older than 1 minute
    this.callTimestamps = this.callTimestamps.filter(ts => ts > oneMinuteAgo);
    
    // Check if we're at the limit
    if (this.callTimestamps.length >= 30) {
      console.log('⚠️ Rate limit reached (30 calls/minute), skipping update');
      return false;
    }
    
    return true;
  }

  private async updatePrice(): Promise<void> {
    // Check rate limit
    if (!this.checkRateLimit()) {
      return;
    }
    
    const sources: PriceSource[] = [
      { name: 'Binance', fetchPrice: () => this.fetchFromBinance() }
    ];
    
    // Try each source in order
    for (const source of sources) {
      try {
        // Track API call
        this.callTimestamps.push(Date.now());
        this.callCount++;
        
        const price = await source.fetchPrice();
        await this.savePrice(price, source.name);
        console.log(`✅ SOL price updated: $${price.toFixed(2)} (${source.name}) [${this.callTimestamps.length}/30 calls]`);
        
        // Reset backoff on success
        this.consecutiveFailures = 0;
        this.backoffMultiplier = 1;
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`❌ ${source.name} failed: ${errorMsg}`);
        
        // Check for rate limit error
        if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
          this.consecutiveFailures++;
          this.backoffMultiplier = Math.min(this.backoffMultiplier * 2, 30); // Max 60 seconds
          console.log(`⚠️ Rate limited. Backing off for ${this.backoffMultiplier * 2} seconds`);
        }
      }
    }
    
    console.error('⚠️ All price sources failed');
  }
  
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('SOL price updater already running');
      return;
    }
    
    console.log('Starting SOL price updater...');
    
    // Ensure table exists
    await this.ensureTable();
    
    // Do initial update
    await this.updatePrice();
    
    // Set up periodic updates with dynamic interval
    const scheduleNextUpdate = () => {
      const delay = this.UPDATE_FREQUENCY * this.backoffMultiplier;
      this.updateInterval = setTimeout(async () => {
        try {
          await this.updatePrice();
        } catch (error) {
          console.error('Error updating SOL price:', error);
        }
        
        if (this.isRunning) {
          scheduleNextUpdate();
        }
      }, delay);
    };
    
    scheduleNextUpdate();
    
    this.isRunning = true;
    console.log('SOL price updater started (5s intervals using Binance API)');
  }
  
  stop(): void {
    if (this.updateInterval) {
      clearTimeout(this.updateInterval);
      this.updateInterval = null;
      this.isRunning = false;
      console.log('SOL price updater stopped');
    }
  }
  
  getStatus(): { running: boolean; lastUpdate: Date | null } {
    return {
      running: this.isRunning,
      lastUpdate: this.lastUpdateTime
    };
  }
  
  async cleanup(): Promise<void> {
    try {
      await db.query(
        "DELETE FROM sol_prices WHERE created_at < NOW() - INTERVAL '24 hours'"
      );
    } catch (error) {
      // Try with old schema
      try {
        await db.query(
          "DELETE FROM sol_prices WHERE timestamp < NOW() - INTERVAL '24 hours'"
        );
      } catch (fallbackError) {
        console.error('Failed to cleanup old prices:', fallbackError);
      }
    }
  }
}

// Export a convenient function for getting SOL price
export async function getSolPrice(): Promise<number> {
  const service = SolPriceService.getInstance();
  return service.getPrice();
}

// Export for backward compatibility
export const SolPriceUpdater = SolPriceService;