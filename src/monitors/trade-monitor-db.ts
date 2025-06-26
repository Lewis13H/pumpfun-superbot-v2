#!/usr/bin/env node
import 'dotenv/config';
import { SimpleSubscriptionHandler } from '../stream/subscription-simple';
import { SimpleTradeEventParser, ParsedTradeEvent } from '../utils/trade-event-parser-simple';
import { calculatePrice } from '../utils/price-calculator';
import { SolPriceService } from '../services/sol-price';
import { SolPriceUpdater } from '../services/sol-price-updater';
import { db } from '../database';
import { AutoEnricher } from '../services/auto-enricher';

const MARKET_CAP_THRESHOLD = 8888; // $8888 USD

interface TokenStats {
  buyCount: number;
  sellCount: number;
  totalBuyVolumeSol: bigint;
  totalSellVolumeSol: bigint;
  uniqueBuyers: Set<string>;
  uniqueSellers: Set<string>;
  lastPrice: number;
  lastProgress: number;
  firstSeenAt: Date;
  lastTradeAt: Date;
  isTracked: boolean; // Whether token is in database
  marketCapUsd: number;
}

class TradeMonitorWithDB {
  private parser = new SimpleTradeEventParser();
  private tokenStats = new Map<string, TokenStats>();
  private solPriceService = SolPriceService.getInstance();
  private trackedTokens = new Set<string>(); // Tokens in database
  
  async start() {
    console.log('🚀 Pump.fun Trade Monitor with Database Integration');
    console.log('📊 Tracking buy/sell activity for $8888+ tokens...');
    console.log('💾 Saving trade data to database');
    console.log('⌨️  Press Ctrl+C to stop\n');
    
    await this.solPriceService.initialize();
    await this.loadTrackedTokens();
    
    // Test database connection
    try {
      await db.query('SELECT 1');
      console.log('✅ Database connected successfully');
      console.log(`📊 Tracking ${this.trackedTokens.size} tokens from database\n`);
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      process.exit(1);
    }
    
    const handler = new SimpleSubscriptionHandler();
    
    // Override processTransaction to add our logic
    (handler as any).processTransaction = async (data: any) => {
      const events = this.parser.extractTradeData(data);
      
      for (const event of events) {
        await this.processTrade(event, data);
      }
    };
    
    // Display stats every 30 seconds
    setInterval(() => this.displayStats(), 30000);
    
    await handler.start();
  }
  
  private async loadTrackedTokens() {
    try {
      const result = await db.query('SELECT address FROM tokens');
      for (const row of result.rows) {
        this.trackedTokens.add(row.address);
      }
    } catch (error) {
      console.error('Error loading tracked tokens:', error);
    }
  }
  
  private async processTrade(event: ParsedTradeEvent, transaction: any) {
    try {
      const solPrice = await this.solPriceService.getPrice();
      const priceData = calculatePrice(
        event.virtualSolReserves,
        event.virtualTokenReserves,
        solPrice
      );
      
      const progress = this.calculateProgress(event.virtualSolReserves);
      const isTracked = this.trackedTokens.has(event.mint);
      
      // Update in-memory stats
      if (!this.tokenStats.has(event.mint)) {
        this.tokenStats.set(event.mint, {
          buyCount: 0,
          sellCount: 0,
          totalBuyVolumeSol: 0n,
          totalSellVolumeSol: 0n,
          uniqueBuyers: new Set(),
          uniqueSellers: new Set(),
          lastPrice: priceData.priceInUsd,
          lastProgress: progress,
          firstSeenAt: new Date(),
          lastTradeAt: new Date(),
          isTracked: isTracked,
          marketCapUsd: priceData.mcapUsd
        });
      }
      
      const stats = this.tokenStats.get(event.mint)!;
      
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
      
      stats.lastPrice = priceData.priceInUsd;
      stats.lastProgress = progress;
      stats.lastTradeAt = new Date();
      stats.marketCapUsd = priceData.mcapUsd;
      
      // Check if token meets threshold and isn't tracked yet
      if (!isTracked && priceData.mcapUsd >= MARKET_CAP_THRESHOLD) {
        await this.saveNewToken(event, priceData, progress);
        this.trackedTokens.add(event.mint);
        stats.isTracked = true;
      }
      
      // If token is tracked, save the trade
      if (this.trackedTokens.has(event.mint)) {
        await this.saveTrade(event, priceData, transaction);
        await this.updateTokenStats(event, priceData);
        await this.savePriceUpdate(event, priceData, progress);
      }
      
      // Display trade if tracked or high value
      if (isTracked || priceData.mcapUsd >= MARKET_CAP_THRESHOLD) {
        this.displayTrade(event, priceData, progress, isTracked);
      }
      
    } catch (error) {
      console.error('Error processing trade:', error);
    }
  }
  
  private async saveNewToken(event: ParsedTradeEvent, priceData: any, _progress: number) {
    console.log(`\n🎉 NEW TOKEN REACHED $${MARKET_CAP_THRESHOLD} THRESHOLD!`);
    console.log(`   Address: ${event.mint}`);
    console.log(`   Market Cap: $${priceData.mcapUsd.toFixed(2)}`);
    
    try {
      await db.query(`
        INSERT INTO tokens (
          address,
          bonding_curve,
          created_at,
          creator,
          graduated,
          last_price_usd,
          last_updated
        ) VALUES ($1, $2, NOW(), $3, $4, $5, NOW())
        ON CONFLICT (address) DO UPDATE SET
          last_price_usd = $5,
          last_updated = NOW()
      `, [
        event.mint,
        event.mint, // bonding_curve same as address for now
        event.user, // creator - using first trader for now
        false,
        priceData.priceInUsd
      ]);
      
      console.log(`✅ Token saved to database!`);
      
      // Add to auto-enrichment queue
      const enricher = AutoEnricher.getInstance();
      await enricher.addToken(event.mint);
      console.log(`📝 Added to enrichment queue\n`);
      
    } catch (error) {
      console.error('Error saving new token:', error);
    }
  }
  
  private async saveTrade(event: ParsedTradeEvent, priceData: any, transaction: any) {
    const signature = transaction.transaction?.signature || 'unknown';
    
    try {
      await db.query(`
        INSERT INTO trades (
          time,
          token,
          signature,
          is_buy,
          sol_amount,
          token_amount,
          price_sol,
          price_usd,
          volume_usd,
          trader,
          virtual_sol_reserves,
          virtual_token_reserves
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (signature) DO NOTHING
      `, [
        new Date(Number(event.timestamp) * 1000),
        event.mint,
        signature,
        event.isBuy,
        (Number(event.solAmount) / 1e9).toString(),
        (Number(event.tokenAmount) / 1e6).toString(),
        priceData.priceInSol,
        priceData.priceInUsd,
        (Number(event.solAmount) / 1e9) * (priceData.priceInUsd / priceData.priceInSol),
        event.user,
        (Number(event.virtualSolReserves) / 1e9).toString(),
        (Number(event.virtualTokenReserves) / 1e6).toString()
      ]);
    } catch (error) {
      // Ignore duplicate signature errors
      if (error instanceof Error && !error.message?.includes('duplicate key')) {
        console.error('Error saving trade:', error);
      }
    }
  }
  
  private async updateTokenStats(event: ParsedTradeEvent, priceData: any) {
    const stats = this.tokenStats.get(event.mint);
    if (!stats) return;
    
    try {
      // Calculate 24h volume from in-memory stats (rough estimate)
      const volume24hSol = Number(stats.totalBuyVolumeSol + stats.totalSellVolumeSol) / 1e9;
      const volume24hUsd = volume24hSol * (priceData.priceInUsd / priceData.priceInSol);
      
      await db.query(`
        UPDATE tokens SET
          volume_24h_sol = $1,
          volume_24h_usd = $2,
          trade_count_24h = $3,
          last_trade_at = NOW(),
          last_price_usd = $4,
          last_activity = NOW()
        WHERE address = $5
      `, [
        volume24hSol,
        volume24hUsd,
        stats.buyCount + stats.sellCount,
        priceData.priceInUsd,
        event.mint
      ]);
    } catch (error) {
      console.error('Error updating token stats:', error);
    }
  }
  
  private async savePriceUpdate(event: ParsedTradeEvent, priceData: any, progress: number) {
    try {
      const liquiditySol = Number(event.virtualSolReserves) / 1e9;
      const liquidityUsd = liquiditySol * (priceData.priceInUsd / priceData.priceInSol);
      
      await db.query(`
        INSERT INTO price_updates (
          time,
          token,
          price_sol,
          price_usd,
          liquidity_sol,
          liquidity_usd,
          market_cap_usd,
          bonding_complete,
          progress
        ) VALUES (
          NOW(),
          $1, $2, $3, $4, $5, $6, $7, $8
        )
      `, [
        event.mint,
        priceData.priceInSol,
        priceData.priceInUsd,
        liquiditySol,
        liquidityUsd,
        priceData.mcapUsd,
        progress >= 100,
        progress
      ]);
    } catch (error) {
      console.error('Error saving price update:', error);
    }
  }
  
  private displayTrade(event: ParsedTradeEvent, priceData: any, progress: number, isTracked: boolean) {
    const tradeType = event.isBuy ? '🟢 BUY' : '🔴 SELL';
    const solAmount = (Number(event.solAmount) / 1e9).toFixed(4);
    const tokenAmount = (Number(event.tokenAmount) / 1e6).toFixed(0);
    const trader = event.user.slice(0, 4) + '...' + event.user.slice(-4);
    const savedIndicator = isTracked ? '💾' : '  ';
    
    console.log(`\n${savedIndicator} ${tradeType} ${event.mint}`);
    console.log(`├─ Amount: ${solAmount} SOL → ${tokenAmount} tokens`);
    console.log(`├─ Price: $${priceData.priceInUsd.toFixed(8)} | Progress: ${progress.toFixed(1)}%`);
    console.log(`├─ Trader: ${trader}`);
    console.log(`└─ Market Cap: $${priceData.mcapUsd.toLocaleString()}`);
  }
  
  private displayStats() {
    console.log('\n' + '═'.repeat(80));
    console.log('📊 TRADE STATISTICS (Last 30s)');
    console.log('═'.repeat(80));
    
    // Filter for tracked tokens only
    const trackedStats = Array.from(this.tokenStats.entries())
      .filter(([mint, _]) => this.trackedTokens.has(mint))
      .sort((a, b) => {
        const aActivity = a[1].buyCount + a[1].sellCount;
        const bActivity = b[1].buyCount + b[1].sellCount;
        return bActivity - aActivity;
      })
      .slice(0, 10);
    
    if (trackedStats.length === 0) {
      console.log('\nNo tracked tokens with recent activity');
    } else {
      for (const [mint, stats] of trackedStats) {
        const totalTrades = stats.buyCount + stats.sellCount;
        const buyRatio = totalTrades > 0 ? (stats.buyCount / totalTrades * 100).toFixed(0) : '0';
        const totalVolume = Number(stats.totalBuyVolumeSol + stats.totalSellVolumeSol) / 1e9;
        
        console.log(`\n🪙 ${mint}`);
        console.log(`├─ Trades: ${stats.buyCount} buys / ${stats.sellCount} sells (${buyRatio}% buy ratio)`);
        console.log(`├─ Volume: ${totalVolume.toFixed(2)} SOL`);
        console.log(`├─ Unique: ${stats.uniqueBuyers.size} buyers / ${stats.uniqueSellers.size} sellers`);
        console.log(`├─ Price: $${stats.lastPrice.toFixed(8)}`);
        console.log(`├─ Market Cap: $${stats.marketCapUsd.toLocaleString()}`);
        console.log(`└─ Progress: ${stats.lastProgress.toFixed(1)}%`);
      }
    }
    
    console.log('\n' + '═'.repeat(80));
    console.log(`Total tracked tokens: ${this.trackedTokens.size}`);
    console.log(`Tokens seen this session: ${this.tokenStats.size}`);
  }
  
  private calculateProgress(virtualSolReserves: bigint): number {
    const startSol = 30;
    const targetSol = 115;
    const currentSol = Number(virtualSolReserves) / 1e9;
    
    if (currentSol <= startSol) return 0;
    if (currentSol >= targetSol) return 100;
    
    return ((currentSol - startSol) / (targetSol - startSol)) * 100;
  }
}

// Start services
async function startServices() {
  console.log('🚀 Starting SOL price updater service...');
  const priceUpdater = SolPriceUpdater.getInstance();
  await priceUpdater.start();
  
  // Start auto-enricher if Helius API key is available
  let enricher: AutoEnricher | null = null;
  if (process.env.HELIUS_API_KEY) {
    console.log('🤖 Starting auto-enrichment service...');
    enricher = AutoEnricher.getInstance();
    await enricher.start();
  } else {
    console.log('⚠️  Helius API key not found - auto-enrichment disabled');
  }
  
  console.log('🚀 Starting trade monitor...');
  const monitor = new TradeMonitorWithDB();
  await monitor.start();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n👋 Shutting down services...');
    priceUpdater.stop();
    if (enricher) enricher.stop();
    await db.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n\n👋 Shutting down services...');
    priceUpdater.stop();
    if (enricher) enricher.stop();
    await db.close();
    process.exit(0);
  });
}

// Start all services
startServices().catch(async (error) => {
  console.error('Fatal error:', error);
  await db.close();
  process.exit(1);
});