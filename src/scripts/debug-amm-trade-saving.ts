#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';
import { EventBus } from '../utils/event-bus';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { DIContainer } from '../utils/di-container';
import { TradeHandler } from '../handlers/trade-handler';
import { TokenRepository } from '../repositories/token-repository';
import { TradeRepository } from '../repositories/trade-repository';
import { PriceCalculator } from '../services/pricing/price-calculator';
import { RealtimePriceCache } from '../services/pricing/realtime-price-cache';
import { EventBus as CoreEventBus } from '../core/event-bus';
import { ConfigService } from '../core/config';
import { logger } from '../utils/logger';
import { Connection } from '@solana/web3.js';
import { EventType } from '../utils/parsers/types';
import process from 'process';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Add debug logging to trace method calls
const originalLog = logger.info.bind(logger);
const originalError = logger.error.bind(logger);
const originalWarn = logger.warn.bind(logger);

// Track method calls
const methodCalls: Record<string, number> = {};
const trackMethodCall = (method: string) => {
  methodCalls[method] = (methodCalls[method] || 0) + 1;
};

async function debugAMMTradeSaving() {
  logger.info('🔍 Starting AMM trade saving debug...');
  
  // Check environment variables
  logger.info('📋 Environment variables:', {
    AMM_SAVE_THRESHOLD: process.env.AMM_SAVE_THRESHOLD || 'NOT SET',
    BC_SAVE_THRESHOLD: process.env.BC_SAVE_THRESHOLD || 'NOT SET',
    SAVE_ALL_TOKENS: process.env.SAVE_ALL_TOKENS || 'NOT SET',
  });
  
  const stats = {
    ammTransactionsDetected: 0,
    ammTradesParsed: 0,
    ammTradeEventsEmitted: 0,
    processTradeCallsMade: 0,
    tradesSavedToQueue: 0,
    tradesSavedToDb: 0,
    tradesSkippedByThreshold: 0,
    marketCaps: [] as number[],
    errors: [] as string[],
    lastError: null as any,
  };

  try {
    // Initialize services
    const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
    const eventBus = DIContainer.resolve(EventBus);
    const coreEventBus = new CoreEventBus();
    const tokenRepo = new TokenRepository();
    const tradeRepo = new TradeRepository();
    const config = new ConfigService();
    const priceCalculator = DIContainer.resolve(PriceCalculator);
    const realtimePriceCache = DIContainer.resolve(RealtimePriceCache);

    // Check config values
    const monitorConfig = config.get('monitors');
    logger.info('📊 Monitor Configuration:', {
      ammSaveThreshold: monitorConfig.ammSaveThreshold,
      bcSaveThreshold: monitorConfig.bcSaveThreshold,
      saveAllTokens: monitorConfig.saveAllTokens,
    });

    // Create trade handler with debug logging
    const tradeHandler = new TradeHandler({
      tokenRepo,
      tradeRepo,
      priceCalculator,
      eventBus: coreEventBus,
      config,
    });

    // Patch handleTokenDiscovery to track threshold checks
    const originalHandleTokenDiscovery = (tradeHandler as any).handleTokenDiscovery?.bind(tradeHandler);
    if (originalHandleTokenDiscovery) {
      (tradeHandler as any).handleTokenDiscovery = async (event: any, priceInfo: any, solPriceUsd: number) => {
        // Log market cap and threshold check
        const threshold = event.type === EventType.AMM_TRADE ? monitorConfig.ammSaveThreshold : monitorConfig.bcSaveThreshold;
        const shouldSave = monitorConfig.saveAllTokens || priceInfo.marketCapUsd >= threshold;
        
        logger.info('💰 Market Cap Check:', {
          mintAddress: event.mintAddress.slice(0, 8),
          marketCapUsd: priceInfo.marketCapUsd,
          threshold,
          shouldSave,
          saveAllTokens: monitorConfig.saveAllTokens,
        });
        
        stats.marketCaps.push(priceInfo.marketCapUsd);
        if (!shouldSave) {
          stats.tradesSkippedByThreshold++;
        }
        
        return originalHandleTokenDiscovery(event, priceInfo, solPriceUsd);
      };
    }

    // Get current SOL price
    const solPrice = await realtimePriceCache.getCurrentPrice();
    logger.info('💲 Current SOL price:', solPrice);

    // Listen for AMM trade events
    eventBus.on('AMM_TRADE', async (event: any) => {
      stats.ammTradeEventsEmitted++;
      logger.info('📡 AMM_TRADE event received:', {
        signature: event.signature,
        mintAddress: event.mintAddress,
        userAddress: event.userAddress,
        virtualSolReserves: event.virtualSolReserves?.toString(),
        virtualTokenReserves: event.virtualTokenReserves?.toString(),
        eventCount: stats.ammTradeEventsEmitted,
      });
      
      // Ensure event has correct type
      event.type = EventType.AMM_TRADE;
      
      // Process the trade with current SOL price
      try {
        stats.processTradeCallsMade++;
        const result = await tradeHandler.processTrade(event, solPrice);
        if (result.saved) {
          stats.tradesSavedToDb++;
        }
        logger.info('🎯 Trade processing result:', result);
      } catch (error) {
        logger.error('Failed to process AMM trade:', error);
        stats.errors.push(`Event processing error: ${error}`);
      }
    });

    // Create stream manager
    const streamManager = new SmartStreamManager(
      eventBus,
      process.env.SHYFT_GRPC_ENDPOINT!,
      process.env.SHYFT_GRPC_TOKEN!
    );

    // Create and start trading monitor
    const tradingMonitor = new TradingActivityMonitor(
      streamManager,
      eventBus,
      connection
    );

    // Patch monitor's handleTransaction to track detections
    const originalHandleTransaction = (tradingMonitor as any).handleTransaction?.bind(tradingMonitor);
    if (originalHandleTransaction) {
      (tradingMonitor as any).handleTransaction = async (data: any) => {
        const programId = data.transaction?.transaction?.message?.accountKeys?.[0];
        if (programId === 'PumpkinsSwap11111111111111111111111111111111') {
          stats.ammTransactionsDetected++;
        }
        return originalHandleTransaction(data);
      };
    }

    // Track parsing
    eventBus.on('TRADING_ACTIVITY_PARSED', (event: any) => {
      if (event.venue === 'AMM') {
        stats.ammTradesParsed++;
        logger.info('🔄 AMM trade parsed:', {
          signature: event.signature,
          totalParsed: stats.ammTradesParsed,
        });
      }
    });

    logger.info('🚀 Starting trading monitor...');
    await tradingMonitor.start();

    // Check database periodically
    const checkInterval = setInterval(async () => {
      try {
        const result = await dbService.query(
          'SELECT COUNT(*) as count FROM trades_unified WHERE venue = $1 AND timestamp > NOW() - INTERVAL \'1 minute\'',
          ['AMM']
        );
        const dbCount = parseInt(result.rows[0].count);
        logger.info('📊 Database check - AMM trades in last minute:', dbCount);
      } catch (error) {
        logger.error('Database check failed:', error);
      }
    }, 5000);

    // Print stats every 5 seconds
    const statsInterval = setInterval(() => {
      logger.info('📈 Debug Stats:', {
        ammTransactionsDetected: stats.ammTransactionsDetected,
        ammTradesParsed: stats.ammTradesParsed,
        ammTradeEventsEmitted: stats.ammTradeEventsEmitted,
        processTradeCallsMade: stats.processTradeCallsMade,
        tradesSavedToDb: stats.tradesSavedToDb,
        tradesSkippedByThreshold: stats.tradesSkippedByThreshold,
        errorCount: stats.errors.length,
      });
      
      if (stats.marketCaps.length > 0) {
        const avgMarketCap = stats.marketCaps.reduce((a, b) => a + b, 0) / stats.marketCaps.length;
        const minMarketCap = Math.min(...stats.marketCaps);
        const maxMarketCap = Math.max(...stats.marketCaps);
        logger.info('💸 Market Cap Stats:', {
          average: `$${avgMarketCap.toFixed(2)}`,
          min: `$${minMarketCap.toFixed(2)}`,
          max: `$${maxMarketCap.toFixed(2)}`,
          belowThreshold: stats.marketCaps.filter(mc => mc < monitorConfig.ammSaveThreshold).length,
          aboveThreshold: stats.marketCaps.filter(mc => mc >= monitorConfig.ammSaveThreshold).length,
        });
      }
      
      if (stats.errors.length > 0) {
        logger.warn('⚠️ Errors encountered:', stats.errors.slice(-5)); // Last 5 errors
      }

      logger.info('📞 Method call counts:', methodCalls);
    }, 5000);

    // Run for 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Cleanup
    clearInterval(checkInterval);
    clearInterval(statsInterval);

    logger.info('🏁 Final Debug Report:');
    logger.info('=======================');
    logger.info('AMM Transactions Detected:', stats.ammTransactionsDetected);
    logger.info('AMM Trades Parsed:', stats.ammTradesParsed);
    logger.info('AMM Trade Events Emitted:', stats.ammTradeEventsEmitted);
    logger.info('processTrade Calls Made:', stats.processTradeCallsMade);
    logger.info('Trades Saved to DB:', stats.tradesSavedToDb);
    logger.info('Trades Skipped by Threshold:', stats.tradesSkippedByThreshold);
    logger.info('Total Errors:', stats.errors.length);
    
    if (stats.marketCaps.length > 0) {
      const avgMarketCap = stats.marketCaps.reduce((a, b) => a + b, 0) / stats.marketCaps.length;
      logger.info('');
      logger.info('💸 Market Cap Analysis:');
      logger.info(`Average Market Cap: $${avgMarketCap.toFixed(2)}`);
      logger.info(`Below $${monitorConfig.ammSaveThreshold} threshold: ${stats.marketCaps.filter(mc => mc < monitorConfig.ammSaveThreshold).length}`);
      logger.info(`Above $${monitorConfig.ammSaveThreshold} threshold: ${stats.marketCaps.filter(mc => mc >= monitorConfig.ammSaveThreshold).length}`);
      logger.info('');
      logger.info('🎯 LIKELY ISSUE: Most AMM trades are below the $1000 threshold!');
    }
    
    if (stats.lastError) {
      logger.error('Last Error Details:', stats.lastError);
    }

    // Check final database state
    const finalResult = await tokenRepo.query(
      'SELECT COUNT(*) as count FROM trades_unified WHERE venue = $1',
      ['AMM']
    );
    logger.info('Total AMM trades in database:', finalResult.rows[0].count);

    // Stop monitor
    await tradingMonitor.stop();
    await streamManager.stop();
    
    process.exit(0);
  } catch (error) {
    logger.error('Debug script failed:', error);
    process.exit(1);
  }
}

// Run the debug script
debugAMMTradeSaving().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});