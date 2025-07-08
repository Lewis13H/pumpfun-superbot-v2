#!/usr/bin/env npx tsx
/**
 * Analyze Tokens with Complete Holder Data
 * 
 * Uses Helius getTokenAccounts to fetch ALL holders
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';
import { HeliusCompleteHolderFetcher } from '../services/holder-analysis/helius-complete-holder-fetcher';
import { HolderSnapshotModel } from '../models/holder-snapshot';
import { HolderScoreCalculator } from '../services/holder-analysis/holder-score-calculator';
import { DistributionMetricsCalculator } from '../services/holder-analysis/distribution-metrics-calculator';

async function analyzeTokenWithCompleteData(
  fetcher: HeliusCompleteHolderFetcher,
  token: any,
  pool: any
): Promise<boolean> {
  const symbol = token.symbol || 'Unknown';
  const marketCap = parseFloat(token.latest_market_cap_usd).toLocaleString();
  
  try {
    console.log(chalk.gray(`\n   Analyzing ${symbol} - $${marketCap}`));
    
    let progressShown = false;
    const holderData = await fetcher.fetchAllHolders(token.mint_address, {
      pageLimit: 10, // Max 10 pages (10,000 accounts)
      includeZeroBalances: false,
      progressCallback: (current, total) => {
        if (!progressShown && total > 1000) {
          console.log(chalk.gray(`     Fetching ${total} token accounts...`));
          progressShown = true;
        }
      }
    });
    
    if (!holderData) {
      console.log(chalk.red(`     Failed to fetch holder data`));
      return false;
    }
    
    console.log(chalk.gray(`     Found ${holderData.uniqueHolders} unique holders (${holderData.totalHolders} accounts)`));
    
    // Calculate distribution metrics
    const metricsCalculator = new DistributionMetricsCalculator();
    const metrics = metricsCalculator.calculateMetrics(holderData.holders);
    
    // Calculate score
    const scoreCalculator = new HolderScoreCalculator();
    const score = scoreCalculator.calculateScore({
      holders: holderData.holders,
      walletClassifications: [],
      tokenInfo: {
        supply: holderData.tokenInfo.supply,
        decimals: holderData.tokenInfo.decimals,
        creator: undefined
      }
    });
    
    // Determine whale/shrimp counts based on holdings
    const whaleThreshold = 1; // 1% or more
    const shrimpThreshold = 0.01; // 0.01% or less
    
    const whales = holderData.holders.filter(h => h.percentage >= whaleThreshold).length;
    const shrimp = holderData.holders.filter(h => h.percentage <= shrimpThreshold).length;
    const regular = holderData.holders.length - whales - shrimp;
    
    // Save to database
    const snapshotModel = new HolderSnapshotModel(pool);
    await snapshotModel.createSnapshot({
      mintAddress: token.mint_address,
      holderScore: score.totalScore,
      scoreBreakdown: score.breakdown,
      totalHolders: holderData.uniqueHolders,
      topHolders: holderData.holders.slice(0, 10),
      distributionMetrics: metrics,
      walletBreakdown: {
        regular: regular,
        bots: 0,
        snipers: 0,
        whales: whales,
        shrimp: shrimp,
        exchanges: 0,
        unknown: 0
      },
      distributionHealth: score.totalScore >= 200 ? 'healthy' : score.totalScore >= 150 ? 'moderate' : 'poor',
      riskFactors: [],
      recommendations: []
    });
    
    // Update token name/symbol if we got better data
    if (holderData.tokenInfo.name !== 'Unknown' || holderData.tokenInfo.symbol !== 'Unknown') {
      await db.query(
        `UPDATE tokens_unified 
         SET name = COALESCE($1, name), 
             symbol = COALESCE($2, symbol)
         WHERE mint_address = $3`,
        [holderData.tokenInfo.name, holderData.tokenInfo.symbol, token.mint_address]
      );
    }
    
    console.log(chalk.green(`     ✓ Score: ${score.totalScore} (${score.grade})`));
    console.log(chalk.gray(`     Distribution: Top 10 hold ${metrics.top10Percentage.toFixed(1)}%, Gini: ${metrics.giniCoefficient.toFixed(3)}`));
    console.log(chalk.gray(`     Breakdown: ${whales} whales, ${regular} regular, ${shrimp} shrimp`));
    
    return true;
  } catch (error: any) {
    console.log(chalk.red(`     Error: ${error.message}`));
    return false;
  }
}

async function analyzeTokensWithCompleteHolders() {
  console.log(chalk.cyan('\n🚀 Analyzing Tokens with Complete Holder Data\n'));
  
  try {
    const fetcher = new HeliusCompleteHolderFetcher();
    const pool = db.getPool();
    
    // Get tokens to analyze
    console.log(chalk.yellow('1. Finding eligible tokens...'));
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
        t.latest_market_cap_usd
      FROM tokens_unified t
      LEFT JOIN analyzed_tokens at ON at.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 50000 -- Higher threshold for complete analysis
        AND t.latest_market_cap_usd < 1000000000 -- Exclude wrong data
        AND (at.last_analyzed IS NULL OR at.last_analyzed < NOW() - INTERVAL '24 hours')
      ORDER BY t.latest_market_cap_usd DESC
      LIMIT 20 -- Limit due to API intensity
    `);
    
    console.log(chalk.gray(`   Found ${result.rows.length} tokens to analyze\n`));
    
    if (result.rows.length === 0) {
      console.log(chalk.green('   All eligible tokens have recent analysis!'));
      return;
    }
    
    // Process tokens
    console.log(chalk.yellow('2. Fetching complete holder data...\n'));
    
    let successful = 0;
    let failed = 0;
    const startTime = Date.now();
    
    for (const token of result.rows) {
      const success = await analyzeTokenWithCompleteData(fetcher, token, pool);
      
      if (success) {
        successful++;
      } else {
        failed++;
      }
      
      // Rate limiting - wait between tokens
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    }
    
    // Summary
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(chalk.gray(`   Total time: ${Math.ceil(totalTime / 60)} minutes`));
    console.log(chalk.green(`   Successful: ${successful}`));
    console.log(chalk.red(`   Failed: ${failed}`));
    
    // Show top tokens by holder count
    console.log(chalk.yellow('\n3. Top tokens by holder count:'));
    const topByHolders = await db.query(`
      SELECT 
        t.symbol,
        t.name,
        hs.total_holders,
        hs.holder_score,
        t.latest_market_cap_usd
      FROM tokens_unified t
      JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE hs.id IN (
        SELECT MAX(id) FROM holder_snapshots GROUP BY mint_address
      )
      ORDER BY hs.total_holders DESC
      LIMIT 10
    `);
    
    topByHolders.rows.forEach((token, index) => {
      const marketCap = parseFloat(token.latest_market_cap_usd).toLocaleString();
      console.log(chalk.gray(
        `   ${index + 1}. ${token.symbol || 'Unknown'} - ` +
        `${token.total_holders} holders - ` +
        `Score: ${token.holder_score} - ` +
        `MC: $${marketCap}`
      ));
    });
    
    console.log(chalk.green('\n✅ Complete holder analysis finished!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Analysis failed:'), error);
  } finally {
    await db.close();
  }
}

// Run analysis
analyzeTokensWithCompleteHolders().catch(console.error);