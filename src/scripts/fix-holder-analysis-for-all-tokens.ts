#!/usr/bin/env npx tsx
/**
 * Fix Holder Analysis for All Eligible Tokens
 * 
 * Uses RPC with rate limiting to analyze all tokens above $18,888
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';
import { Connection, PublicKey } from '@solana/web3.js';
import { HolderSnapshotModel } from '../models/holder-snapshot';
import { HolderScoreCalculator } from '../services/holder-analysis/holder-score-calculator';
import { DistributionMetricsCalculator } from '../services/holder-analysis/distribution-metrics-calculator';

// Rate limiting configuration
const RPC_DELAY_MS = 1000; // 1 second between RPC calls
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 5000; // 5 seconds between batches

async function analyzeTokenWithRPC(
  connection: Connection,
  mintAddress: string,
  pool: any
): Promise<boolean> {
  try {
    // Get token supply
    const mintPubkey = new PublicKey(mintAddress);
    const supply = await connection.getTokenSupply(mintPubkey);
    
    if (!supply.value) {
      console.log(chalk.red(`     Failed to get token supply`));
      return false;
    }
    
    const decimals = supply.value.decimals;
    const totalSupply = supply.value.uiAmount || 0;
    
    // Add delay before next RPC call
    await new Promise(resolve => setTimeout(resolve, RPC_DELAY_MS));
    
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
      walletClassifications: [], // Skip wallet classification for speed
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
    
    console.log(chalk.green(`     ✓ Score: ${score.totalScore}, Grade: ${score.grade}`));
    console.log(chalk.gray(`       Holders: ${holders.length} (top 20 only)`));
    console.log(chalk.gray(`       Top holder: ${holders[0]?.percentage.toFixed(2)}%`));
    console.log(chalk.gray(`       Gini: ${metrics.giniCoefficient.toFixed(3)}`));
    
    return true;
  } catch (error) {
    console.log(chalk.red(`     Error: ${error.message}`));
    return false;
  }
}

async function fixHolderAnalysis() {
  console.log(chalk.cyan('\n🔧 Fixing Holder Analysis for All Eligible Tokens\n'));
  
  try {
    // Use custom RPC if available, otherwise use default
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    console.log(chalk.gray(`Using RPC: ${rpcUrl}\n`));
    
    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000
    });
    
    const pool = db.getPool();
    
    // Get all eligible tokens without holder analysis
    console.log(chalk.yellow('1. Finding tokens without holder analysis...'));
    const result = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd
      FROM tokens_unified t
      LEFT JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
        AND hs.id IS NULL
      ORDER BY t.latest_market_cap_usd DESC
    `);
    
    console.log(chalk.gray(`   Found ${result.rows.length} tokens to analyze\n`));
    
    if (result.rows.length === 0) {
      console.log(chalk.green('   All eligible tokens already have holder analysis!'));
      return;
    }
    
    // Process in batches with delays
    let successful = 0;
    let failed = 0;
    
    for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
      const batch = result.rows.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(result.rows.length / BATCH_SIZE);
      
      console.log(chalk.yellow(`\n2. Processing batch ${batchNum}/${totalBatches}:`));
      
      for (const token of batch) {
        const symbol = token.symbol || 'Unknown';
        const marketCap = parseFloat(token.latest_market_cap_usd).toLocaleString();
        console.log(chalk.gray(`   ${symbol} (${token.mint_address.substring(0, 8)}...) - $${marketCap}`));
        
        const success = await analyzeTokenWithRPC(connection, token.mint_address, pool);
        
        if (success) {
          successful++;
        } else {
          failed++;
        }
        
        // Add delay between tokens
        if (batch.indexOf(token) < batch.length - 1) {
          await new Promise(resolve => setTimeout(resolve, RPC_DELAY_MS));
        }
      }
      
      // Add longer delay between batches
      if (i + BATCH_SIZE < result.rows.length) {
        console.log(chalk.gray(`\n   Waiting ${BATCH_DELAY_MS / 1000} seconds before next batch...`));
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    
    // Summary
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(chalk.gray(`   Total tokens processed: ${successful + failed}`));
    console.log(chalk.green(`   Successful: ${successful}`));
    console.log(chalk.red(`   Failed: ${failed}`));
    
    // Verify coverage
    console.log(chalk.yellow('\n3. Verifying coverage...'));
    const coverageResult = await db.query(`
      SELECT 
        COUNT(DISTINCT t.mint_address) as total_eligible,
        COUNT(DISTINCT hs.mint_address) as analyzed
      FROM tokens_unified t
      LEFT JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
    `);
    
    const coverage = coverageResult.rows[0];
    const percentage = (coverage.analyzed / coverage.total_eligible * 100).toFixed(1);
    console.log(chalk.gray(`   Coverage: ${coverage.analyzed}/${coverage.total_eligible} (${percentage}%)`));
    
    console.log(chalk.green('\n✅ Holder analysis fix complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Fix failed:'), error);
  } finally {
    await db.close();
  }
}

// Run fix
fixHolderAnalysis().catch(console.error);