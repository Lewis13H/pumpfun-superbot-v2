#!/usr/bin/env npx tsx
/**
 * Analyze Tokens with Proper Rate Limiting
 * 
 * Respects Helius and Shyft rate limits
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';
import { Connection, PublicKey } from '@solana/web3.js';
import { HolderSnapshotModel } from '../models/holder-snapshot';
import { HolderScoreCalculator } from '../services/holder-analysis/holder-score-calculator';
import { DistributionMetricsCalculator } from '../services/holder-analysis/distribution-metrics-calculator';

// Rate limiting configuration for APIs
const HELIUS_RATE_LIMIT = {
  requestsPerSecond: 10,  // Helius allows 10 req/s
  delayMs: 100           // 100ms between requests
};

const SHYFT_RATE_LIMIT = {
  requestsPerSecond: 5,   // Shyft is more restrictive
  delayMs: 200           // 200ms between requests
};

// Use Helius RPC for token holder data
async function analyzeTokenWithHeliusRPC(
  connection: Connection,
  mintAddress: string,
  symbol: string,
  pool: any
): Promise<boolean> {
  try {
    const mintPubkey = new PublicKey(mintAddress);
    
    // Get token supply
    const supply = await connection.getTokenSupply(mintPubkey);
    if (!supply.value) {
      console.log(chalk.red(`     Failed to get token supply`));
      return false;
    }
    
    const decimals = supply.value.decimals;
    const totalSupply = supply.value.uiAmount || 0;
    
    // Small delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, HELIUS_RATE_LIMIT.delayMs));
    
    // Get largest token accounts (top 20)
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    
    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      console.log(chalk.red(`     No token accounts found`));
      return false;
    }
    
    // Calculate holder metrics
    const holders = largestAccounts.value.map((account, index) => {
      const amount = parseInt(account.amount);
      const uiAmount = amount / Math.pow(10, decimals);
      const percentage = totalSupply > 0 ? (uiAmount / totalSupply) * 100 : 0;
      
      return {
        address: account.address.toBase58(),
        balance: account.amount,
        uiBalance: uiAmount,
        percentage,
        rank: index + 1
      };
    });
    
    // Calculate distribution metrics
    const metricsCalculator = new DistributionMetricsCalculator();
    const metrics = metricsCalculator.calculateMetrics(holders);
    
    // Calculate score
    const scoreCalculator = new HolderScoreCalculator();
    const score = scoreCalculator.calculateScore({
      holders,
      walletClassifications: [],
      tokenInfo: {
        supply: totalSupply.toString(),
        decimals,
        creator: undefined
      }
    });
    
    // Save to database
    const snapshotModel = new HolderSnapshotModel(pool);
    await snapshotModel.createSnapshot({
      mintAddress,
      holderScore: score.totalScore,
      scoreBreakdown: score.breakdown,
      totalHolders: holders.length,
      topHolders: holders.slice(0, 10),
      distributionMetrics: metrics,
      walletBreakdown: {
        regular: holders.length,
        bots: 0,
        snipers: 0,
        whales: 0,
        shrimp: 0,
        exchanges: 0,
        unknown: 0
      },
      distributionHealth: score.totalScore >= 200 ? 'healthy' : score.totalScore >= 150 ? 'moderate' : 'poor',
      riskFactors: [],
      recommendations: []
    });
    
    console.log(chalk.green(`   ✓ ${symbol}: Score ${score.totalScore} (${score.grade})`));
    console.log(chalk.gray(`     Holders: ${holders.length}, Top: ${holders[0]?.percentage.toFixed(1)}%, Gini: ${metrics.giniCoefficient.toFixed(3)}`));
    
    return true;
  } catch (error: any) {
    if (error.message?.includes('429')) {
      console.log(chalk.yellow(`   ⚠ Rate limited for ${symbol}`));
    } else {
      console.log(chalk.red(`   ✗ ${symbol}: ${error.message}`));
    }
    return false;
  }
}

async function analyzeTokensWithRateLimits() {
  console.log(chalk.cyan('\n🔧 Analyzing Tokens with Proper Rate Limits\n'));
  
  try {
    // Use Helius RPC
    const heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
    console.log(chalk.gray(`Using Helius RPC with rate limiting\n`));
    
    const connection = new Connection(heliusRpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000
    });
    
    const pool = db.getPool();
    
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
        at.last_analyzed
      FROM tokens_unified t
      LEFT JOIN analyzed_tokens at ON at.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
        AND t.latest_market_cap_usd < 1000000000 -- Exclude tokens with wrong market caps
        AND (at.last_analyzed IS NULL OR at.last_analyzed < NOW() - INTERVAL '2 hours')
      ORDER BY t.latest_market_cap_usd DESC
      LIMIT 50 -- Process top 50 tokens
    `);
    
    console.log(chalk.gray(`   Found ${result.rows.length} tokens to analyze\n`));
    
    if (result.rows.length === 0) {
      console.log(chalk.green('   All eligible tokens have recent analysis!'));
      return;
    }
    
    // Process tokens one by one with rate limiting
    console.log(chalk.yellow('2. Processing tokens with rate limiting...\n'));
    
    let successful = 0;
    let failed = 0;
    let rateErrors = 0;
    const startTime = Date.now();
    
    for (let i = 0; i < result.rows.length; i++) {
      const token = result.rows[i];
      const symbol = token.symbol || 'Unknown';
      const marketCap = parseFloat(token.latest_market_cap_usd).toLocaleString();
      
      console.log(chalk.gray(`${i + 1}/${result.rows.length}: ${symbol} - $${marketCap}`));
      
      const success = await analyzeTokenWithHeliusRPC(
        connection,
        token.mint_address,
        symbol,
        pool
      );
      
      if (success) {
        successful++;
      } else {
        failed++;
        // If we hit rate limits, wait longer
        if (failed > 2) {
          console.log(chalk.yellow(`   Waiting 5 seconds due to errors...`));
          await new Promise(resolve => setTimeout(resolve, 5000));
          failed = 0; // Reset counter
        }
      }
      
      // Progress update every 10 tokens
      if ((i + 1) % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (i + 1) / elapsed;
        const remaining = result.rows.length - i - 1;
        const eta = remaining / rate;
        
        console.log(chalk.cyan(`\n   Progress: ${i + 1}/${result.rows.length} (${rate.toFixed(1)} tokens/sec)`));
        console.log(chalk.cyan(`   ETA: ${Math.ceil(eta / 60)} minutes\n`));
      }
      
      // Add delay between tokens
      await new Promise(resolve => setTimeout(resolve, HELIUS_RATE_LIMIT.delayMs));
    }
    
    // Summary
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(chalk.gray(`   Total time: ${Math.ceil(totalTime / 60)} minutes`));
    console.log(chalk.green(`   Successful: ${successful}`));
    console.log(chalk.red(`   Failed: ${failed}`));
    console.log(chalk.gray(`   Average rate: ${(successful / totalTime).toFixed(2)} tokens/sec`));
    
    // Verify coverage
    console.log(chalk.yellow('\n3. Verifying coverage...'));
    const coverageResult = await db.query(`
      SELECT 
        COUNT(DISTINCT t.mint_address) as total_eligible,
        COUNT(DISTINCT hs.mint_address) as analyzed
      FROM tokens_unified t
      LEFT JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
        AND t.latest_market_cap_usd < 1000000000
    `);
    
    const coverage = coverageResult.rows[0];
    const percentage = (coverage.analyzed / coverage.total_eligible * 100).toFixed(1);
    console.log(chalk.gray(`   Coverage: ${coverage.analyzed}/${coverage.total_eligible} (${percentage}%)`));
    
    console.log(chalk.green('\n✅ Analysis complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Analysis failed:'), error);
  } finally {
    await db.close();
  }
}

// Run analysis
analyzeTokensWithRateLimits().catch(console.error);