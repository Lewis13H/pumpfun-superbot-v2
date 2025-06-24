// src/monitor/index.ts

import { EventEmitter } from 'events';
import { db } from '../database';
import { 
  NewToken, 
  PriceUpdate, 
  MonitorStats,
  ProgressMilestone,
  GraduationEvent,
  FlushEvent,
  TradeEvent
} from './types';
import { StreamClient } from './stream/client';
import { SubscriptionBuilder } from './stream/subscription';
import { TransactionParser } from './parsers/transaction';
import { TokenParser } from './parsers/token';
import { PriceCalculator } from './calculators/price';
import { ProgressCalculator } from './calculators/progress';
import { MetadataCalculator } from './calculators/metadata';
import { SolPriceService } from './services/sol-price';
import { BufferService } from './services/buffer';
import { CacheService } from './services/cache';
import { config } from '../config';
import { formatTokenAddress, formatMarketCap } from './utils/format';

export class PumpMonitor extends EventEmitter {
  private streamClient: StreamClient;
  private solPriceService: SolPriceService;
  private bufferService: BufferService;
  private cacheService: CacheService;
  private tokenCreationQueue = new Set<string>();

  constructor() {
    super();
    this.streamClient = new StreamClient();
    this.solPriceService = new SolPriceService();
    this.bufferService = new BufferService(config.monitoring.flushInterval);
    this.cacheService = new CacheService();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Stream client events
    this.streamClient.on('data', (data) => {
      this.handleStreamData(data).catch(console.error);
    });

    this.streamClient.on('error', (error) => {
      this.emit('error', error);
    });

    this.streamClient.on('disconnect', () => {
      console.log('Monitor disconnected from stream');
      this.emit('disconnect');
    });

    // Buffer service events
    this.bufferService.on('flush', (data: FlushEvent) => {
      this.emit('flush', data);
    });
  }

  async start(): Promise<void> {
    console.log('🔄 Starting Pump.fun monitor...');
    console.log(`Program: ${config.shyft.endpoint}`);

    // Load existing tokens into cache
    await this.loadKnownTokens();

    // Start services
    await this.solPriceService.start();
    console.log(`💵 Initial SOL price: $${this.solPriceService.getPrice()}`);

    this.bufferService.start();

    // Connect to stream
    await this.streamClient.connect();

    // Subscribe to pump.fun transactions
    const subscription = SubscriptionBuilder.buildPumpFunSubscription();
    await this.streamClient.subscribe(subscription);

    console.log('✅ Monitor started');

    // Refresh known tokens cache every 5 minutes
    setInterval(() => this.loadKnownTokens(), 300000);
  }

  private async loadKnownTokens(): Promise<void> {
    try {
      const result = await db.query(
        'SELECT address FROM tokens WHERE NOT archived AND bonding_curve != $1',
        ['unknown']
      );
      
      const tokens = result.rows.map((row: any) => row.address);
      this.cacheService.setKnownTokens(tokens);
      console.log(`📊 Loaded ${tokens.length} known tokens`);
    } catch (error) {
      console.error('Error loading known tokens:', error);
    }
  }

  private async handleStreamData(data: any): Promise<void> {
    try {
      if (!data.transaction) return;

      const formattedTx = TransactionParser.formatTransaction(data);
      if (!formattedTx) return;

      // Check for new token creation
      const newToken = TokenParser.detectNewToken(formattedTx);
      if (newToken) {
        await this.handleNewToken(newToken);
      }

      // Parse transaction for price updates
      const parsedData = TransactionParser.parsePumpFunTransaction(formattedTx);
      if (parsedData) {
        const instructionNames = parsedData.instructions.pumpFunIxs
          .map(ix => ix.name)
          .join(', ');
        
        if (instructionNames && instructionNames !== 'unknown') {
          console.log(`📊 Pump.fun transaction: ${instructionNames} (${formatTokenAddress(formattedTx.signature)})`);
        }

        // Extract price update from parsed transaction
        const priceUpdate = await this.extractPriceUpdate(parsedData);
        if (priceUpdate) {
          await this.handlePriceUpdate(priceUpdate);
        }
      }
    } catch (error) {
      console.error('Error handling stream data:', error);
      this.emit('error', error);
    }
  }

  private async handleNewToken(newToken: NewToken): Promise<void> {
    console.log(`🚀 New token detected: ${newToken.address}`);
    
    try {
      // Save token immediately
      await db.upsertToken({
        address: newToken.address,
        bondingCurve: newToken.bondingCurve,
        symbol: undefined,
        name: undefined,
        imageUri: undefined,
        vanityId: undefined
      }, newToken.timestamp, newToken.creator, newToken.signature);
      
      console.log(`✅ Token ${formatTokenAddress(newToken.address)} saved to database`);
      
      // Update caches
      this.tokenCreationQueue.delete(newToken.address);
      this.cacheService.addKnownToken(newToken.address);
      
      // Emit event for metadata fetching
      this.emit('token:new', newToken);
    } catch (error) {
      console.error(`Failed to save new token ${newToken.address}:`, error);
      // Add to queue for retry
      this.tokenCreationQueue.add(newToken.address);
    }
  }

  private async extractPriceUpdate(parsedData: any): Promise<PriceUpdate | null> {
    try {
      const parsedEvent = parsedData.instructions.events[0]?.data as TradeEvent;
      if (!parsedEvent) return null;

      const { mint, virtual_sol_reserves, virtual_token_reserves, real_sol_reserves } = parsedEvent;

      if (!virtual_sol_reserves || !virtual_token_reserves || !mint) {
        return null;
      }

      // Get token metadata
      const cachedMetadata = this.cacheService.getTokenMetadata(mint);
      const tokenMetadata = cachedMetadata || await MetadataCalculator.getTokenMetadata(mint);
      
      // Calculate price
      const priceSol = PriceCalculator.calculatePrice(
        virtual_sol_reserves,
        virtual_token_reserves
      );
      
      const solPrice = this.solPriceService.getPrice();
      const priceUsd = priceSol * solPrice;
      const liquiditySol = real_sol_reserves / 1e9;
      const liquidityUsd = PriceCalculator.calculateLiquidityUsd(liquiditySol, solPrice);
      const marketCapUsd = PriceCalculator.calculateMarketCap(priceSol, solPrice, tokenMetadata.totalSupply);
      
      // Validate market cap
      if (!PriceCalculator.validateMarketCap(marketCapUsd)) {
        console.error(`🚨 BLOCKING: MCap ${formatMarketCap(marketCapUsd)} too high for ${formatTokenAddress(mint)}`);
        return null;
      }

      const progress = ProgressCalculator.calculateProgress(liquiditySol);
      const bondingComplete = ProgressCalculator.isComplete(progress);

      console.log(`💰 ${formatTokenAddress(mint)}: $${priceUsd.toFixed(8)} | MCap: ${formatMarketCap(marketCapUsd)} | Liq: ${liquiditySol.toFixed(2)} SOL`);

      return {
        token: mint,
        price_sol: priceSol,
        price_usd: priceUsd,
        liquidity_sol: liquiditySol,
        liquidity_usd: liquidityUsd,
        market_cap_usd: marketCapUsd,
        bonding_complete: bondingComplete,
        progress
      };
    } catch (error) {
      console.error('Error extracting price data:', error);
      return null;
    }
  }

  private async handlePriceUpdate(priceUpdate: PriceUpdate): Promise<void> {
    // Check if token is still being created
    if (this.tokenCreationQueue.has(priceUpdate.token)) {
      console.log(`⏳ Token ${formatTokenAddress(priceUpdate.token)} still being created, skipping price update`);
      return;
    }
    
    // Verify token exists
    const tokenExists = await db.checkTokenExists(priceUpdate.token);
    if (!tokenExists && !this.cacheService.isKnownToken(priceUpdate.token)) {
      console.warn(`⚠️ Token ${formatTokenAddress(priceUpdate.token)} not found in DB, creating placeholder`);
      
      try {
        await db.upsertToken({
          address: priceUpdate.token,
          bondingCurve: 'unknown',
          symbol: undefined,
          name: undefined,
          imageUri: undefined,
          vanityId: undefined
        }, new Date(), 'unknown', 'price-update-placeholder');
        
        this.cacheService.addKnownToken(priceUpdate.token);
        
        // Queue for metadata fetch
        this.emit('token:new', {
          address: priceUpdate.token,
          bondingCurve: 'unknown',
          creator: 'unknown',
          signature: 'price-update',
          timestamp: new Date()
        });
      } catch (error) {
        console.error(`Failed to create placeholder for ${priceUpdate.token}:`, error);
        return;
      }
    }

    // Add to buffer
    this.bufferService.addPriceUpdate(priceUpdate);
    console.log(`✅ Buffered price update for ${formatTokenAddress(priceUpdate.token)}`);

    // Handle progress milestones
    if (priceUpdate.progress !== undefined) {
      this.handleProgressMilestones(priceUpdate.token, priceUpdate.progress, priceUpdate.bonding_complete);
    }
  }

  private handleProgressMilestones(tokenMint: string, currentProgress: number, isComplete: boolean): void {
    const lastProgress = this.cacheService.getProgressMilestone(tokenMint);
    const passedMilestones = ProgressCalculator.getPassedMilestones(currentProgress, lastProgress);
    
    for (const milestone of passedMilestones) {
      console.log(`🎯 MILESTONE: ${formatTokenAddress(tokenMint)} reached ${milestone}% completion`);
      
      const milestoneEvent: ProgressMilestone = {
        token: tokenMint,
        milestone,
        progress: currentProgress,
        timestamp: new Date()
      };
      
      this.emit('milestone', milestoneEvent);
    }

    if (!this.cacheService.hasGraduated(tokenMint) && isComplete) {
      console.log(`🎓 GRADUATED: ${formatTokenAddress(tokenMint)} has completed bonding curve!`);
      
      const graduationEvent: GraduationEvent = {
        token: tokenMint,
        timestamp: new Date()
      };
      
      this.emit('graduated', graduationEvent);
      this.cacheService.markGraduated(tokenMint);
    }

    this.cacheService.setProgressMilestone(tokenMint, currentProgress);
  }

  getStats(): MonitorStats {
    return {
      priceBufferSize: this.bufferService.getBufferSize(),
      currentSolPrice: this.solPriceService.getPrice(),
      milestonesTracked: this.cacheService.getMilestonesCount(),
      knownTokens: this.cacheService.getKnownTokensCount(),
      cachedMetadata: this.cacheService.getMetadataCacheSize()
    };
  }

  async stop(): Promise<void> {
    console.log('Stopping monitor...');
    
    // Stop services
    this.solPriceService.stop();
    this.bufferService.stop();
    this.cacheService.stop();
    
    // Final flush
    await this.bufferService.forceFlush();
    
    // Disconnect stream
    this.streamClient.disconnect();
    
    this.emit('stopped');
  }
}

// Export everything from this module
export * from './types';
export * from './constants';
