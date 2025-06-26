import 'dotenv/config';
import { SimpleSubscriptionHandler } from '../stream/subscription-simple';
import { SimpleTradeEventParser, ParsedTradeEvent } from '../utils/trade-event-parser-simple';
import { calculatePrice } from '../utils/price-calculator';
import { SolPriceService } from '../services/sol-price';
import { SolPriceUpdater } from '../services/sol-price-updater';

// Trade tracking for each token
interface TokenTradeStats {
  mint: string;
  buyCount: number;
  sellCount: number;
  totalBuyVolumeSol: bigint;
  totalSellVolumeSol: bigint;
  uniqueBuyers: Set<string>;
  uniqueSellers: Set<string>;
  lastPrice: number;
  lastProgress: number;
  recentTrades: Array<{
    type: 'buy' | 'sell';
    amount: number;
    timestamp: number;
  }>;
}

class TradeMonitor {
  private handler: SimpleSubscriptionHandler;
  private tradeEventParser: SimpleTradeEventParser;
  private solPriceService: SolPriceService;
  private tokenStats: Map<string, TokenTradeStats> = new Map();
  
  constructor() {
    this.handler = new SimpleSubscriptionHandler();
    this.tradeEventParser = new SimpleTradeEventParser();
    this.solPriceService = SolPriceService.getInstance();
  }
  
  async start() {
    console.log('🚀 Starting Pump.fun Trade Monitor with Buy/Sell Tracking');
    console.log('━'.repeat(80));
    
    // Override the processTransaction method to add trade tracking
    (this.handler as any).processTransaction = async (data: any) => {
      await this.processTransaction(data);
    };
    
    // Display stats periodically
    setInterval(() => this.displayStats(), 30000);
    
    // Start the handler with its robust reconnection logic
    await this.handler.start();
  }
  
  private async processTransaction(data: any) {
    const events = this.tradeEventParser.extractTradeData(data);
    
    for (const event of events) {
      await this.processTradeEvent(event);
    }
  }
  
  private async processTradeEvent(event: ParsedTradeEvent) {
    // Get or create token stats
    let stats = this.tokenStats.get(event.mint);
    if (!stats) {
      stats = {
        mint: event.mint,
        buyCount: 0,
        sellCount: 0,
        totalBuyVolumeSol: 0n,
        totalSellVolumeSol: 0n,
        uniqueBuyers: new Set(),
        uniqueSellers: new Set(),
        lastPrice: 0,
        lastProgress: 0,
        recentTrades: []
      };
      this.tokenStats.set(event.mint, stats);
    }
    
    // Update stats
    if (event.isBuy) {
      stats.buyCount++;
      stats.totalBuyVolumeSol += event.solAmount;
      stats.uniqueBuyers.add(event.user);
    } else {
      stats.sellCount++;
      stats.totalSellVolumeSol += event.solAmount;
      stats.uniqueSellers.add(event.user);
    }
    
    // Calculate price
    const solPrice = await this.solPriceService.getPrice();
    const priceData = calculatePrice(
      event.virtualSolReserves,
      event.virtualTokenReserves,
      solPrice
    );
    
    stats.lastPrice = priceData.priceInUsd;
    stats.lastProgress = this.calculateProgress(event.virtualSolReserves);
    
    // Add to recent trades (keep last 10)
    stats.recentTrades.push({
      type: event.isBuy ? 'buy' : 'sell',
      amount: Number(event.solAmount) / 1e9,
      timestamp: Date.now()
    });
    if (stats.recentTrades.length > 10) {
      stats.recentTrades.shift();
    }
    
    // Display trade
    this.displayTrade(event, priceData);
  }
  
  private displayTrade(event: ParsedTradeEvent, priceData: any) {
    const tradeType = event.isBuy ? '🟢 BUY' : '🔴 SELL';
    const solAmount = (Number(event.solAmount) / 1e9).toFixed(4);
    const tokenAmount = (Number(event.tokenAmount) / 1e6).toFixed(0);
    const trader = event.user.slice(0, 4) + '...' + event.user.slice(-4);
    
    const progress = this.calculateProgress(event.virtualSolReserves);
    
    console.log(`\n${tradeType} ${event.mint}`);
    console.log(`├─ Amount: ${solAmount} SOL → ${tokenAmount} tokens`);
    console.log(`├─ Price: $${priceData.priceInUsd.toFixed(8)} | Progress: ${progress.toFixed(1)}%`);
    console.log(`├─ Trader: ${trader}`);
    console.log(`└─ Market Cap: $${priceData.mcapUsd.toLocaleString()}`);
  }
  
  private displayStats() {
    console.log('\n' + '═'.repeat(80));
    console.log('📊 TRADE STATISTICS (Last 30s)');
    console.log('═'.repeat(80));
    
    // Sort by activity
    const sortedTokens = Array.from(this.tokenStats.entries())
      .sort((a, b) => {
        const aActivity = a[1].buyCount + a[1].sellCount;
        const bActivity = b[1].buyCount + b[1].sellCount;
        return bActivity - aActivity;
      })
      .slice(0, 10); // Top 10
    
    for (const [mint, stats] of sortedTokens) {
      const totalTrades = stats.buyCount + stats.sellCount;
      const buyRatio = totalTrades > 0 ? (stats.buyCount / totalTrades * 100).toFixed(0) : '0';
      const totalVolume = Number(stats.totalBuyVolumeSol + stats.totalSellVolumeSol) / 1e9;
      
      console.log(`\n🪙 ${mint}`);
      console.log(`├─ Trades: ${stats.buyCount} buys / ${stats.sellCount} sells (${buyRatio}% buy ratio)`);
      console.log(`├─ Volume: ${totalVolume.toFixed(2)} SOL`);
      console.log(`├─ Unique: ${stats.uniqueBuyers.size} buyers / ${stats.uniqueSellers.size} sellers`);
      console.log(`├─ Price: $${stats.lastPrice.toFixed(8)}`);
      console.log(`└─ Progress: ${stats.lastProgress.toFixed(1)}%`);
    }
    
    console.log('\n' + '═'.repeat(80));
  }
  
  private calculateProgress(virtualSolReserves: bigint): number {
    // Pump.fun starts with 30 SOL virtual, completes at ~115 SOL virtual
    const startSol = 30;
    const targetSol = 115;
    const currentSol = Number(virtualSolReserves) / 1e9;
    
    if (currentSol <= startSol) return 0;
    if (currentSol >= targetSol) return 100;
    
    return ((currentSol - startSol) / (targetSol - startSol)) * 100;
  }
}

// Start SOL price updater first
async function startServices() {
  console.log('🚀 Starting SOL price updater service...');
  const priceUpdater = SolPriceUpdater.getInstance();
  await priceUpdater.start();
  
  console.log('🚀 Starting trade monitor...');
  const monitor = new TradeMonitor();
  await monitor.start();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n👋 Shutting down services...');
    priceUpdater.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n\n👋 Shutting down services...');
    priceUpdater.stop();
    process.exit(0);
  });
}

// Start all services
startServices().catch(console.error);