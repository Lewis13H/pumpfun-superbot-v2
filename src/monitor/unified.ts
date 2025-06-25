import { SubscriptionHandler } from '../stream/subscription';
import { AccountSubscriptionHandler } from '../stream/account-subscription';
import { BondingCurveData } from '../types/bonding-curve';
import { PriceData } from '../utils/price-calculator';
import { SolPriceService } from '../services/sol-price';

interface TokenData {
  mint: string;
  price?: PriceData;
  bondingCurve?: BondingCurveData;
  lastUpdate: Date;
}

export class UnifiedMonitor {
  private transactionHandler: SubscriptionHandler;
  private accountHandler: AccountSubscriptionHandler;
  private solPriceService: SolPriceService;
  private tokenMap: Map<string, TokenData> = new Map();
  
  constructor() {
    this.solPriceService = SolPriceService.getInstance();
    this.transactionHandler = new SubscriptionHandler();
    this.accountHandler = new AccountSubscriptionHandler();
    
    // Set up callbacks to capture updates
    this.setupHandlers();
  }
  
  async start(): Promise<void> {
    console.log('🚀 Pump.fun Unified Monitor (Prices + Progress)');
    console.log('📊 Streaming live token data...');
    console.log('⌨️  Press Ctrl+C to stop\n');
    
    // Initialize SOL price service
    await this.solPriceService.initialize();
    
    // Start both streams in parallel
    await Promise.all([
      this.transactionHandler.start(),
      this.accountHandler.start()
    ]);
  }
  
  async stop(): Promise<void> {
    await Promise.all([
      this.transactionHandler.stop(),
      this.accountHandler.stop()
    ]);
  }
  
  private setupHandlers(): void {
    // Intercept price updates from transactions
    const originalProcessTransaction = (this.transactionHandler as any).processTransaction;
    (this.transactionHandler as any).processTransaction = async (data: any) => {
      // Call original method
      const result = await originalProcessTransaction.call(this.transactionHandler, data);
      
      // Extract trade events
      const logs = data.transaction?.transaction?.meta?.logMessages || [];
      const events = this.extractTradeEvents(logs);
      
      for (const event of events) {
        const tokenData = this.tokenMap.get(event.mint) || {
          mint: event.mint,
          lastUpdate: new Date()
        };
        
        // Store price data if we have priceData
        if ('priceData' in event && 'price' in tokenData) {
          tokenData.price = event.priceData;
        }
        tokenData.lastUpdate = new Date();
        this.tokenMap.set(event.mint, tokenData);
        
        // Display unified data
        this.displayUnifiedData(tokenData);
      }
      
      return result;
    };
    
    // Handle bonding curve updates
    this.accountHandler.onUpdate((bondingCurve: BondingCurveData) => {
      // Try to find associated token by matching addresses
      // Note: We might need additional logic to map bonding curve address to mint
      const tokenData = this.findOrCreateTokenData(bondingCurve);
      
      tokenData.bondingCurve = bondingCurve;
      tokenData.lastUpdate = new Date();
      
      this.displayUnifiedData(tokenData);
    });
  }
  
  private extractTradeEvents(_logs: string[]): any[] {
    // This is a simplified version - you'd need to implement the actual extraction
    return [];
  }
  
  private findOrCreateTokenData(bondingCurve: BondingCurveData): TokenData {
    // Try to find existing token data
    for (const [_, data] of this.tokenMap.entries()) {
      if (data.bondingCurve?.pubkey === bondingCurve.pubkey) {
        return data;
      }
    }
    
    // Create new token data
    const tokenData: TokenData = {
      mint: bondingCurve.mint || bondingCurve.pubkey,
      bondingCurve,
      lastUpdate: new Date()
    };
    
    this.tokenMap.set(tokenData.mint, tokenData);
    return tokenData;
  }
  
  private displayUnifiedData(tokenData: TokenData): void {
    const { mint, price, bondingCurve } = tokenData;
    
    console.log('\n' + '='.repeat(60));
    console.log(`🪙 Token: ${mint}`);
    
    if (price) {
      console.log(`💰 Price: $${price.priceInUsd.toFixed(8)} (${price.priceInSol.toFixed(8)} SOL)`);
      console.log(`📈 MCap: $${price.mcapUsd.toFixed(2)} (${price.mcapSol.toFixed(2)} SOL)`);
    }
    
    if (bondingCurve) {
      const progressBar = this.createProgressBar(bondingCurve.progress);
      console.log(`📊 Progress: ${progressBar} ${bondingCurve.progress.toFixed(1)}%`);
      console.log(`💧 Liquidity: ${bondingCurve.realSolInSol.toFixed(4)} SOL / ${BONDING_CURVE_TARGET_SOL} SOL`);
      console.log(`🏁 Status: ${bondingCurve.complete ? '✅ Migrated to Raydium' : '🔄 Active on Pump.fun'}`);
      
      if (!bondingCurve.complete && bondingCurve.progress > 90) {
        console.log(`⚠️  ALERT: Close to migration! (${(100 - bondingCurve.progress).toFixed(1)}% remaining)`);
      }
    }
    
    console.log('='.repeat(60));
  }
  
  private createProgressBar(progress: number): string {
    const filled = Math.floor(progress / 5);
    const empty = 20 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}

// Import the constant
const BONDING_CURVE_TARGET_SOL = 85;