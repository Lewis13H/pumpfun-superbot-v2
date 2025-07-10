#!/usr/bin/env npx tsx

/**
 * Test Pool State Coordinator Integration
 * Verifies that pool state tracking and trade enrichment work correctly
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Logger } from '../core/logger';
import { PoolStateCoordinator } from '../services/amm/pool-state-coordinator';
import { AmmTradeEnricher } from '../services/amm/amm-trade-enricher';

async function main() {
  const logger = new Logger({ context: 'PoolStateTest', color: chalk.magenta });
  
  console.log(chalk.cyan('\n🔍 Testing Pool State Coordinator Integration\n'));
  
  try {
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus') as EventBus;
    
    // Get services
    const poolStateCoordinator = PoolStateCoordinator.getInstance(eventBus);
    const ammTradeEnricher = new AmmTradeEnricher(eventBus);
    
    // Stats
    let poolUpdates = 0;
    let tradeEnrichments = 0;
    let enrichmentSources = new Map<string, number>();
    
    // Listen for pool state updates
    poolStateCoordinator.on('poolStateUpdated', (state) => {
      poolUpdates++;
      logger.info('Pool state updated', {
        poolAddress: state.poolAddress.substring(0, 8) + '...',
        mint: state.tokenMint?.substring(0, 8) + '...',
        vSol: (Number(state.virtualSolReserves) / 1e9).toFixed(2),
        vToken: state.virtualTokenReserves.toString()
      });
    });
    
    // Listen for trade enrichment events
    eventBus.on('AMM_TRADE_ENRICHED', (data) => {
      tradeEnrichments++;
      const source = data.source || 'unknown';
      enrichmentSources.set(source, (enrichmentSources.get(source) || 0) + 1);
      
      logger.info('Trade enriched', {
        mint: data.mintAddress?.substring(0, 8) + '...',
        source: data.source,
        hasReserves: data.hasReserves
      });
    });
    
    // Test 1: Register new pools
    console.log(chalk.yellow('\nTest 1: Registering Test Pools\n'));
    
    const testPools = [
      {
        poolAddress: 'Pool1111111111111111111111111111111111111111',
        mintAddress: 'Mint1111111111111111111111111111111111111111'
      },
      {
        poolAddress: 'Pool2222222222222222222222222222222222222222',
        mintAddress: 'Mint2222222222222222222222222222222222222222'
      }
    ];
    
    for (const pool of testPools) {
      poolStateCoordinator.registerNewPool(pool.poolAddress, pool.mintAddress);
      console.log(`Registered pool: ${pool.poolAddress.substring(0, 8)}...`);
    }
    
    // Test 2: Update pool states
    console.log(chalk.yellow('\nTest 2: Updating Pool States\n'));
    
    poolStateCoordinator.updatePoolState(testPools[0].poolAddress, {
      tokenMint: testPools[0].mintAddress,
      virtualSolReserves: BigInt(100 * 1e9), // 100 SOL
      virtualTokenReserves: BigInt(1_000_000 * 1e6), // 1M tokens
      realSolReserves: BigInt(95 * 1e9),
      realTokenReserves: BigInt(950_000 * 1e6),
      isInitialized: true
    });
    
    poolStateCoordinator.updatePoolState(testPools[1].poolAddress, {
      tokenMint: testPools[1].mintAddress,
      virtualSolReserves: BigInt(50 * 1e9), // 50 SOL
      virtualTokenReserves: BigInt(500_000 * 1e6), // 500K tokens
      realSolReserves: BigInt(48 * 1e9),
      realTokenReserves: BigInt(480_000 * 1e6),
      isInitialized: true
    });
    
    // Test 3: Retrieve pool states
    console.log(chalk.yellow('\nTest 3: Retrieving Pool States\n'));
    
    for (const pool of testPools) {
      const state = poolStateCoordinator.getPoolStateForMint(pool.mintAddress);
      if (state) {
        console.log(`Pool for ${pool.mintAddress.substring(0, 8)}...:`);
        console.log(`  Virtual SOL: ${(Number(state.virtualSolReserves) / 1e9).toFixed(2)} SOL`);
        console.log(`  Virtual Tokens: ${state.virtualTokenReserves.toString()}`);
        console.log(`  Last Update: ${new Date(state.lastUpdate).toISOString()}`);
      }
    }
    
    // Test 4: Get pool statistics
    console.log(chalk.yellow('\nTest 4: Pool State Statistics\n'));
    
    const stats = poolStateCoordinator.getStats();
    console.log('Pool State Coordinator Stats:');
    console.log(`  Total Pools: ${stats.totalPools}`);
    console.log(`  Pools with Reserves: ${stats.poolsWithReserves}`);
    console.log(`  Recently Updated: ${stats.recentlyUpdated}`);
    console.log(`  Mint Mappings: ${stats.mintMappings}`);
    
    // Test 5: Test trade enrichment
    console.log(chalk.yellow('\nTest 5: Trade Enrichment with Pool State\n'));
    
    // Simulate an AMM trade event
    const mockTrade = {
      type: 'amm_trade' as any,
      signature: 'mockSignature123',
      mintAddress: testPools[0].mintAddress,
      solAmount: BigInt(1 * 1e9), // 1 SOL
      tokenAmount: BigInt(10000 * 1e6), // 10K tokens
      tradeType: 'buy' as any,
      userAddress: 'User1111111111111111111111111111111111111111',
      poolAddress: testPools[0].poolAddress,
      timestamp: Date.now() / 1000,
      slot: BigInt(123456)
    };
    
    // Emit pre-process event to trigger enrichment
    eventBus.emit('PRE_PROCESS_TRADE', mockTrade);
    
    // Give it a moment to process
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if trade was enriched
    if (mockTrade.virtualSolReserves) {
      console.log(chalk.green('\n✅ Trade successfully enriched with pool state!'));
      console.log(`  Virtual SOL Reserves: ${(Number(mockTrade.virtualSolReserves) / 1e9).toFixed(2)} SOL`);
      console.log(`  Virtual Token Reserves: ${mockTrade.virtualTokenReserves}`);
    } else {
      console.log(chalk.red('\n❌ Trade enrichment failed'));
    }
    
    // Test 6: Monitor live data
    console.log(chalk.yellow('\n\nTest 6: Monitoring Live Pool State Updates (30 seconds)\n'));
    
    // Start the liquidity monitor to get real pool updates
    const { LiquidityMonitor } = await import('../monitors/domain/liquidity-monitor');
    const monitor = new LiquidityMonitor(container);
    await monitor.start();
    
    // Status interval
    const statusInterval = setInterval(() => {
      const liveStats = poolStateCoordinator.getStats();
      console.log(chalk.gray('\n─'.repeat(60)));
      console.log(chalk.cyan('📊 Live Pool State Stats:'));
      console.log(`Total Pools Tracked: ${liveStats.totalPools}`);
      console.log(`Pools with Reserves: ${liveStats.poolsWithReserves}`);
      console.log(`Pool Updates: ${poolUpdates}`);
      console.log(`Trade Enrichments: ${tradeEnrichments}`);
      
      if (enrichmentSources.size > 0) {
        console.log('\nEnrichment Sources:');
        for (const [source, count] of enrichmentSources) {
          console.log(`  ${source}: ${count}`);
        }
      }
      
      // Show recently updated pools
      const recentPools = poolStateCoordinator.getRecentlyUpdatedPools(60000); // Last minute
      if (recentPools.length > 0) {
        console.log(`\nRecently Updated Pools (${recentPools.length}):`);
        recentPools.slice(0, 3).forEach(pool => {
          console.log(`  ${pool.tokenMint?.substring(0, 8)}... - ${(Number(pool.virtualSolReserves) / 1e9).toFixed(2)} SOL`);
        });
      }
      
      console.log(chalk.gray('─'.repeat(60)));
    }, 10000);
    
    // Run for 30 seconds
    setTimeout(async () => {
      clearInterval(statusInterval);
      
      console.log(chalk.yellow('\n\n🏁 Test Complete!\n'));
      
      // Final summary
      const finalStats = poolStateCoordinator.getStats();
      console.log(chalk.cyan('Final Statistics:'));
      console.log(`Total Pools Tracked: ${finalStats.totalPools}`);
      console.log(`Pool State Updates: ${poolUpdates}`);
      console.log(`Trade Enrichments: ${tradeEnrichments}`);
      
      if (poolUpdates > 0) {
        console.log(chalk.green('\n✅ Pool State Coordinator is working correctly!'));
      } else {
        console.log(chalk.yellow('\n⚠️ No live pool updates detected during test period'));
      }
      
      await monitor.stop();
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);