#!/usr/bin/env npx tsx
/**
 * Optimized Holder Analysis for All Tokens
 * 
 * Processes tokens more efficiently with adaptive rate limiting
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';
import { HolderAnalysisService } from '../services/holder-analysis/holder-analysis-service';

// Adaptive rate limiting configuration
const INITIAL_DELAY_MS = 500; // Start with 500ms
const MAX_DELAY_MS = 2000; // Max 2 seconds
const MIN_DELAY_MS = 200; // Min 200ms
const RATE_ADJUSTMENT = 1.5; // Multiplier for rate limiting
const BATCH_SIZE = 10; // Process 10 at a time
const CONCURRENT_ANALYSES = 3; // Run 3 analyses in parallel

interface ProcessingStats {
  successful: number;
  failed: number;
  rateErrors: number;
  currentDelay: number;
  startTime: number;
}

async function analyzeTokenBatch(
  tokens: any[],
  service: HolderAnalysisService,
  stats: ProcessingStats
): Promise<void> {
  const promises = tokens.map(async (token) => {
    const symbol = token.symbol || 'Unknown';
    const marketCap = parseFloat(token.latest_market_cap_usd).toLocaleString();
    
    try {
      console.log(chalk.gray(`   Analyzing ${symbol} (${token.mint_address.substring(0, 8)}...) - $${marketCap}`));
      
      const result = await service.analyzeToken(token.mint_address, {
        forceRefresh: true,
        maxHolders: 20, // RPC limit
        enableTrends: false,
        classifyWallets: false, // Skip for speed
        saveSnapshot: true
      });
      
      if (result.success && result.analysis) {
        stats.successful++;
        console.log(chalk.green(`   ✓ ${symbol}: Score ${result.analysis.holderScore}`));
        
        // Success - reduce delay slightly
        stats.currentDelay = Math.max(MIN_DELAY_MS, stats.currentDelay / 1.1);
      } else {
        stats.failed++;
        console.log(chalk.red(`   ✗ ${symbol}: ${result.error || 'Unknown error'}`));
      }
    } catch (error: any) {
      stats.failed++;
      
      // Check for rate limiting
      if (error.message?.includes('429') || error.message?.includes('rate')) {
        stats.rateErrors++;
        stats.currentDelay = Math.min(MAX_DELAY_MS, stats.currentDelay * RATE_ADJUSTMENT);
        console.log(chalk.yellow(`   ⚠ Rate limited, increasing delay to ${stats.currentDelay}ms`));
      } else {
        console.log(chalk.red(`   ✗ ${symbol}: ${error.message}`));
      }
    }
    
    // Apply adaptive delay
    await new Promise(resolve => setTimeout(resolve, stats.currentDelay));
  });
  
  await Promise.all(promises);
}

async function analyzeAllTokens() {
  console.log(chalk.cyan('\n🚀 Optimized Holder Analysis for All Eligible Tokens\n'));
  
  try {
    const pool = db.getPool();
    
    // Create service instance
    const holderAnalysisService = new HolderAnalysisService(
      pool,
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );
    
    // Get tokens to analyze
    console.log(chalk.yellow('1. Finding tokens to analyze...'));
    const result = await db.query(`
      WITH analyzed_tokens AS (
        SELECT DISTINCT mint_address, MAX(snapshot_time) as last_analyzed
        FROM holder_snapshots
        GROUP BY mint_address
      )
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        at.last_analyzed,
        CASE 
          WHEN at.last_analyzed IS NULL THEN 'never'
          WHEN at.last_analyzed < NOW() - INTERVAL '1 hour' THEN 'stale'
          ELSE 'fresh'
        END as analysis_status
      FROM tokens_unified t
      LEFT JOIN analyzed_tokens at ON at.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
      ORDER BY 
        CASE 
          WHEN at.last_analyzed IS NULL THEN 0
          ELSE 1
        END,
        t.latest_market_cap_usd DESC
    `);
    
    const needsAnalysis = result.rows.filter(t => 
      t.analysis_status === 'never' || t.analysis_status === 'stale'
    );
    
    console.log(chalk.gray(`   Total eligible tokens: ${result.rows.length}`));
    console.log(chalk.gray(`   Needs analysis: ${needsAnalysis.length}`));
    console.log(chalk.gray(`   Already analyzed (fresh): ${result.rows.length - needsAnalysis.length}\n`));
    
    if (needsAnalysis.length === 0) {
      console.log(chalk.green('   All tokens have recent analysis!'));
      return;
    }
    
    // Initialize stats
    const stats: ProcessingStats = {
      successful: 0,
      failed: 0,
      rateErrors: 0,
      currentDelay: INITIAL_DELAY_MS,
      startTime: Date.now()
    };
    
    // Process in batches
    console.log(chalk.yellow('2. Processing tokens in parallel batches...\n'));
    
    for (let i = 0; i < needsAnalysis.length; i += BATCH_SIZE) {
      const batch = needsAnalysis.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(needsAnalysis.length / BATCH_SIZE);
      
      console.log(chalk.cyan(`\nBatch ${batchNum}/${totalBatches}:`));
      
      // Process batch with concurrent analyses
      const concurrentBatches = [];
      for (let j = 0; j < batch.length; j += CONCURRENT_ANALYSES) {
        const concurrentTokens = batch.slice(j, j + CONCURRENT_ANALYSES);
        concurrentBatches.push(analyzeTokenBatch(concurrentTokens, holderAnalysisService, stats));
      }
      
      await Promise.all(concurrentBatches);
      
      // Progress update
      const elapsed = (Date.now() - stats.startTime) / 1000;
      const rate = (stats.successful + stats.failed) / elapsed;
      const eta = (needsAnalysis.length - i - batch.length) / rate;
      
      console.log(chalk.gray(`\n   Progress: ${stats.successful + stats.failed}/${needsAnalysis.length} tokens`));
      console.log(chalk.gray(`   Rate: ${rate.toFixed(1)} tokens/sec`));
      console.log(chalk.gray(`   ETA: ${Math.ceil(eta / 60)} minutes`));
      
      // Adaptive batch delay based on rate errors
      if (stats.rateErrors > 0) {
        const batchDelay = Math.min(5000, stats.currentDelay * 2);
        console.log(chalk.gray(`   Waiting ${batchDelay / 1000}s before next batch...`));
        await new Promise(resolve => setTimeout(resolve, batchDelay));
        stats.rateErrors = 0; // Reset for next batch
      }
    }
    
    // Final summary
    const totalTime = (Date.now() - stats.startTime) / 1000;
    console.log(chalk.cyan('\n📊 Analysis Complete:'));
    console.log(chalk.gray(`   Total time: ${Math.ceil(totalTime / 60)} minutes`));
    console.log(chalk.green(`   Successful: ${stats.successful}`));
    console.log(chalk.red(`   Failed: ${stats.failed}`));
    console.log(chalk.gray(`   Average rate: ${((stats.successful + stats.failed) / totalTime).toFixed(1)} tokens/sec`));
    
    // Verify final coverage
    console.log(chalk.yellow('\n3. Verifying final coverage...'));
    const coverageResult = await db.query(`
      SELECT 
        COUNT(DISTINCT t.mint_address) as total_eligible,
        COUNT(DISTINCT hs.mint_address) as analyzed,
        COUNT(DISTINCT CASE WHEN hs.snapshot_time > NOW() - INTERVAL '1 hour' THEN hs.mint_address END) as fresh
      FROM tokens_unified t
      LEFT JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
    `);
    
    const coverage = coverageResult.rows[0];
    const percentage = (coverage.analyzed / coverage.total_eligible * 100).toFixed(1);
    const freshPercentage = (coverage.fresh / coverage.total_eligible * 100).toFixed(1);
    
    console.log(chalk.gray(`   Total coverage: ${coverage.analyzed}/${coverage.total_eligible} (${percentage}%)`));
    console.log(chalk.gray(`   Fresh analysis: ${coverage.fresh}/${coverage.total_eligible} (${freshPercentage}%)`));
    
    // Show top tokens by holder score
    console.log(chalk.yellow('\n4. Top 10 tokens by holder score:'));
    const topTokens = await db.query(`
      SELECT 
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        hs.holder_score,
        hs.total_holders,
        hs.gini_coefficient
      FROM tokens_unified t
      JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
        AND hs.id IN (
          SELECT MAX(id) FROM holder_snapshots GROUP BY mint_address
        )
      ORDER BY hs.holder_score DESC
      LIMIT 10
    `);
    
    topTokens.rows.forEach((token, index) => {
      const grade = token.holder_score >= 250 ? 'A+' :
                    token.holder_score >= 200 ? 'A' :
                    token.holder_score >= 150 ? 'B' :
                    token.holder_score >= 100 ? 'C' : 'D';
      
      console.log(chalk.gray(
        `   ${index + 1}. ${token.symbol || 'Unknown'} - ` +
        `Score: ${token.holder_score} (${grade}) - ` +
        `Holders: ${token.total_holders} - ` +
        `Gini: ${token.gini_coefficient.toFixed(3)}`
      ));
    });
    
    console.log(chalk.green('\n✅ Optimized holder analysis complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Analysis failed:'), error);
  } finally {
    await db.close();
  }
}

// Run analysis
analyzeAllTokens().catch(console.error);