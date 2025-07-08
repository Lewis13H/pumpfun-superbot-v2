#!/usr/bin/env npx tsx
/**
 * Test Holder Analysis Integration
 * 
 * Tests the integration of holder analysis with the main application
 */

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';
import { EventBus, EVENTS } from '../core/event-bus';
import { HolderAnalysisIntegration } from '../services/holder-analysis/holder-analysis-integration';
import { createContainer } from '../core/container-factory';
import { TOKENS } from '../core/container';

async function testIntegration() {
  console.log(chalk.cyan('\n🧪 Testing Holder Analysis Integration\n'));
  
  let integration: HolderAnalysisIntegration | null = null;
  
  try {
    // Create container and get required services
    console.log(chalk.yellow('1. Setting up container and services...'));
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus' as any) as EventBus;
    const dbService = await container.resolve(TOKENS.DatabaseService);
    const pool = (dbService as any).pool as Pool;
    
    // Create integration instance
    console.log(chalk.yellow('2. Creating holder analysis integration...'));
    integration = new HolderAnalysisIntegration(pool, eventBus, {
      marketCapThreshold: 10000, // Lower threshold for testing
      solThreshold: 50,
      enableAutoAnalysis: true,
      maxConcurrentAnalyses: 2,
      analysisIntervalHours: 6
    });
    
    // Setup event listeners
    console.log(chalk.yellow('3. Setting up event listeners...'));
    
    integration.on('started', () => {
      console.log(chalk.green('✅ Integration started'));
    });
    
    integration.on('analysis:queued', (data) => {
      console.log(chalk.blue(`📋 Analysis queued: ${data.mintAddress} (priority: ${data.priority})`));
    });
    
    integration.on('analysis:completed', (data) => {
      console.log(chalk.green(`✅ Analysis completed: ${data.mintAddress} (score: ${data.score || 'N/A'})`));
    });
    
    integration.on('analysis:failed', (data) => {
      console.log(chalk.red(`❌ Analysis failed: ${data.mintAddress} - ${data.error}`));
    });
    
    // Start integration
    console.log(chalk.yellow('4. Starting integration...'));
    await integration.start();
    
    // Get initial stats
    const stats = integration.getStats();
    console.log(chalk.cyan('\n📊 Initial Stats:'));
    console.log(chalk.gray(`   Tokens analyzed: ${stats.tokensAnalyzed}`));
    console.log(chalk.gray(`   Analyses queued: ${stats.analysesQueued}`));
    console.log(chalk.gray(`   Average score: ${stats.averageScore}`));
    
    // Test event emission
    console.log(chalk.yellow('\n5. Testing event responses...'));
    
    // Simulate token discovery
    console.log(chalk.yellow('   - Simulating high-value token discovery...'));
    eventBus.emit(EVENTS.TOKEN_DISCOVERED, {
      mintAddress: 'TestMint123',
      symbol: 'TEST',
      currentMarketCapUsd: 25000,
      currentMarketCapSol: 150
    });
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate token graduation
    console.log(chalk.yellow('   - Simulating token graduation...'));
    eventBus.emit(EVENTS.TOKEN_GRADUATED, {
      mintAddress: 'GradMint456',
      symbol: 'GRAD'
    });
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get queue stats
    const queueStats = await integration.getQueueStats();
    console.log(chalk.cyan('\n📊 Queue Stats:'));
    console.log(chalk.gray(`   Pending: ${queueStats.pending}`));
    console.log(chalk.gray(`   Processing: ${queueStats.processing}`));
    console.log(chalk.gray(`   Completed: ${queueStats.completed}`));
    console.log(chalk.gray(`   Failed: ${queueStats.failed}`));
    
    // Get final stats
    const finalStats = integration.getStats();
    console.log(chalk.cyan('\n📊 Final Stats:'));
    console.log(chalk.gray(`   Tokens analyzed: ${finalStats.tokensAnalyzed}`));
    console.log(chalk.gray(`   Analyses queued: ${finalStats.analysesQueued}`));
    console.log(chalk.gray(`   Analyses completed: ${finalStats.analysesCompleted}`));
    console.log(chalk.gray(`   Analyses failed: ${finalStats.analysesFailed}`));
    
    // Test existing high-value tokens
    console.log(chalk.yellow('\n6. Checking existing high-value tokens...'));
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
      WHERE current_market_cap_usd >= $1
        AND graduated_to_amm = true
    `, [10000]);
    
    console.log(chalk.gray(`   Found ${result.rows[0].count} high-value tokens for analysis`));
    
    console.log(chalk.green('\n✅ Integration test completed successfully!'));
    
    // Let it run for a bit to see some activity
    console.log(chalk.yellow('\n7. Running for 30 seconds to observe activity...'));
    await new Promise(resolve => setTimeout(resolve, 30000));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
  } finally {
    // Cleanup
    if (integration) {
      console.log(chalk.yellow('\n8. Stopping integration...'));
      await integration.stop();
    }
    process.exit(0);
  }
}

// Run test
testIntegration().catch(console.error);