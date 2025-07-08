#!/usr/bin/env npx tsx

import { Container } from 'typedi';
import { EventBus } from '../services/event-bus';
import { SmartStreamManager } from '../services/core/smart-stream-manager';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { LiquidityMonitor } from '../monitors/domain/liquidity-monitor';
import { UnifiedDBService } from '../services/unified-db-service';
import { DataPipeline } from '../services/pipeline/data-pipeline';
import { SolPriceService } from '../services/pricing/sol-price-service';
import { AMMPoolStateService } from '../services/amm/amm-pool-state-service';
import { RealtimePriceCache } from '../services/pricing/realtime-price-cache';
import { BondingCurveAccountHandler } from '../handlers/bonding-curve-account-handler';
import { performance } from 'perf_hooks';
import { Logger } from '../utils/logger';

const logger = new Logger({ name: 'test-amm-integration' });

interface TestStats {
  ammTradesDetected: number;
  tokensCreated: number;
  tokensWithReserves: number;
  graduatedTokens: number;
  priceCalculations: number;
  errors: string[];
  tokenSamples: Array<{
    symbol: string;
    mintAddress: string;
    hasReserves: boolean;
    isGraduated: boolean;
    marketCap?: number;
  }>;
}

async function testAMMIntegration() {
  logger.info('🧪 Starting AMM Integration Test');
  
  const stats: TestStats = {
    ammTradesDetected: 0,
    tokensCreated: 0,
    tokensWithReserves: 0,
    graduatedTokens: 0,
    priceCalculations: 0,
    errors: [],
    tokenSamples: []
  };

  const startTime = performance.now();
  const testDuration = 60000; // 60 seconds

  try {
    // Initialize services
    logger.info('Initializing services...');
    
    const eventBus = Container.get(EventBus);
    const dbService = Container.get(UnifiedDBService);
    const solPriceService = Container.get(SolPriceService);
    const ammPoolStateService = Container.get(AMMPoolStateService);
    const priceCache = Container.get(RealtimePriceCache);
    const pipeline = Container.get(DataPipeline);
    
    // Initialize SOL price
    await solPriceService.updatePrice();
    logger.info(`SOL Price: $${solPriceService.getCurrentPrice()}`);

    // Subscribe to events
    eventBus.on('AMM_TRADE', async (data) => {
      stats.ammTradesDetected++;
      
      try {
        // Check if token exists in database
        const tokenExists = await dbService.getToken(data.mint_address);
        
        if (!tokenExists) {
          logger.warn(`Token not found in DB: ${data.mint_address}`);
          return;
        }

        // Check reserves
        const poolState = await ammPoolStateService.getPoolState(data.mint_address);
        const hasReserves = poolState && poolState.virtual_sol_reserves > 0n;
        
        if (hasReserves) {
          stats.tokensWithReserves++;
        }

        // Check graduation status
        const isGraduated = tokenExists.graduated_to_amm || false;
        if (isGraduated) {
          stats.graduatedTokens++;
        }

        // Add to samples (first 5)
        if (stats.tokenSamples.length < 5) {
          stats.tokenSamples.push({
            symbol: tokenExists.symbol || 'Unknown',
            mintAddress: data.mint_address,
            hasReserves: hasReserves || false,
            isGraduated,
            marketCap: tokenExists.market_cap || undefined
          });
        }

        // Log every 10th trade
        if (stats.ammTradesDetected % 10 === 0) {
          logger.info(`AMM Trade #${stats.ammTradesDetected}: ${tokenExists.symbol || data.mint_address}`);
        }
      } catch (error) {
        stats.errors.push(`AMM_TRADE error: ${error.message}`);
      }
    });

    eventBus.on('TOKEN_CREATED', (data) => {
      stats.tokensCreated++;
      logger.info(`Token created: ${data.symbol || data.mint_address}`);
    });

    eventBus.on('TOKEN_GRADUATED', (data) => {
      logger.info(`🎓 Token graduated: ${data.mint_address}`);
      stats.graduatedTokens++;
    });

    eventBus.on('PRICE_UPDATE', (data) => {
      stats.priceCalculations++;
    });

    // Initialize monitors
    logger.info('Starting monitors...');
    
    const streamManager = Container.get(SmartStreamManager);
    const tokenLifecycleMonitor = Container.get(TokenLifecycleMonitor);
    const tradingMonitor = Container.get(TradingActivityMonitor);
    const liquidityMonitor = Container.get(LiquidityMonitor);
    const bcAccountHandler = Container.get(BondingCurveAccountHandler);

    // Start all monitors
    await Promise.all([
      tokenLifecycleMonitor.start(),
      tradingMonitor.start(),
      liquidityMonitor.start(),
      bcAccountHandler.start()
    ]);

    logger.info('✅ All monitors started successfully');

    // Run test for specified duration
    logger.info(`Running test for ${testDuration / 1000} seconds...`);
    
    // Update progress every 10 seconds
    const progressInterval = setInterval(() => {
      const elapsed = Math.floor((performance.now() - startTime) / 1000);
      logger.info(`Progress: ${elapsed}s elapsed - AMM trades: ${stats.ammTradesDetected}, Tokens with reserves: ${stats.tokensWithReserves}`);
    }, 10000);

    // Wait for test duration
    await new Promise(resolve => setTimeout(resolve, testDuration));
    clearInterval(progressInterval);

    // Stop monitors
    logger.info('Stopping monitors...');
    await Promise.all([
      tokenLifecycleMonitor.stop(),
      tradingMonitor.stop(),
      liquidityMonitor.stop(),
      bcAccountHandler.stop()
    ]);

    // Final analysis
    logger.info('\n📊 AMM Integration Test Results:');
    logger.info('=================================');
    logger.info(`Duration: ${Math.floor((performance.now() - startTime) / 1000)} seconds`);
    logger.info(`AMM Trades Detected: ${stats.ammTradesDetected}`);
    logger.info(`Tokens Created: ${stats.tokensCreated}`);
    logger.info(`Tokens with Reserves: ${stats.tokensWithReserves} (${Math.round(stats.tokensWithReserves / Math.max(stats.ammTradesDetected, 1) * 100)}%)`);
    logger.info(`Graduated Tokens: ${stats.graduatedTokens}`);
    logger.info(`Price Calculations: ${stats.priceCalculations}`);
    logger.info(`Errors: ${stats.errors.length}`);
    
    if (stats.tokenSamples.length > 0) {
      logger.info('\n📝 Token Samples:');
      stats.tokenSamples.forEach((sample, i) => {
        logger.info(`  ${i + 1}. ${sample.symbol}`);
        logger.info(`     Mint: ${sample.mintAddress}`);
        logger.info(`     Has Reserves: ${sample.hasReserves ? '✅' : '❌'}`);
        logger.info(`     Graduated: ${sample.isGraduated ? '✅' : '❌'}`);
        logger.info(`     Market Cap: ${sample.marketCap ? `$${sample.marketCap.toLocaleString()}` : 'N/A'}`);
      });
    }

    if (stats.errors.length > 0) {
      logger.error('\n❌ Errors encountered:');
      stats.errors.slice(0, 10).forEach((err, i) => {
        logger.error(`  ${i + 1}. ${err}`);
      });
    }

    // Analysis
    logger.info('\n🔍 Analysis:');
    
    if (stats.ammTradesDetected === 0) {
      logger.warn('⚠️  No AMM trades detected! Possible issues:');
      logger.warn('   - AMM monitors not receiving data');
      logger.warn('   - Trade parsing might be failing');
      logger.warn('   - No AMM activity during test period');
    } else {
      logger.info(`✅ AMM trades are being detected (${stats.ammTradesDetected} total)`);
    }

    if (stats.tokensWithReserves === 0) {
      logger.warn('⚠️  No tokens with reserves found! Possible issues:');
      logger.warn('   - Reserve fetching might be failing');
      logger.warn('   - Pool state service not working');
      logger.warn('   - Tokens not properly linked to pools');
    } else {
      const reserveRate = Math.round(stats.tokensWithReserves / stats.ammTradesDetected * 100);
      logger.info(`✅ ${reserveRate}% of AMM tokens have reserves data`);
    }

    if (stats.graduatedTokens === 0) {
      logger.warn('⚠️  No graduated tokens detected! Possible issues:');
      logger.warn('   - Graduation detection not working');
      logger.warn('   - Database not updating graduation status');
    } else {
      logger.info(`✅ ${stats.graduatedTokens} graduated tokens detected`);
    }

    // Exit process
    process.exit(0);
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testAMMIntegration().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});