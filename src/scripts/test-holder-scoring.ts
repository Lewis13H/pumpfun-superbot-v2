#!/usr/bin/env tsx
/**
 * Test Holder Scoring Implementation
 * 
 * This script demonstrates the holder scoring algorithm from the implementation plan
 * using mock data or real token data from the database.
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

interface TokenHolderAnalysis {
  mintAddress: string;
  holderCounts: {
    total: number;
    snipers: number;
    bots: number;
    bundlers: number;
    developers: number;
    whales: number;
    organic: number;
  };
  holdingPercentages: {
    snipers: number;
    bots: number;
    developers: number;
    whales: number;
    organic: number;
  };
  metrics: {
    top10Percentage: number;
    top25Percentage: number;
    giniCoefficient: number;
    averageHoldingDuration: number;
    holderGrowthRate24h: number;
    churnRate24h: number;
  };
}

interface ScoreBreakdown {
  base: number;
  distributionScore: number;
  decentralizationScore: number;
  organicGrowthScore: number;
  developerEthicsScore: number;
  sniperPenalty: number;
  botPenalty: number;
  bundlerPenalty: number;
  concentrationPenalty: number;
  total: number;
}

class HolderScoreCalculator {
  private readonly BASE_SCORE = 150;

  calculateScore(analysis: TokenHolderAnalysis): ScoreBreakdown {
    const breakdown: ScoreBreakdown = {
      base: this.BASE_SCORE,
      distributionScore: 0,
      decentralizationScore: 0,
      organicGrowthScore: 0,
      developerEthicsScore: 0,
      sniperPenalty: 0,
      botPenalty: 0,
      bundlerPenalty: 0,
      concentrationPenalty: 0,
      total: 0
    };

    // Calculate positive scores
    breakdown.distributionScore = this.calculateDistributionScore(analysis);
    breakdown.decentralizationScore = this.calculateDecentralizationScore(analysis);
    breakdown.organicGrowthScore = this.calculateOrganicGrowthScore(analysis);
    breakdown.developerEthicsScore = this.calculateDeveloperEthicsScore(analysis);

    // Calculate penalties (negative scores)
    breakdown.sniperPenalty = this.calculateSniperPenalty(analysis);
    breakdown.botPenalty = this.calculateBotPenalty(analysis);
    breakdown.bundlerPenalty = this.calculateBundlerPenalty(analysis);
    breakdown.concentrationPenalty = this.calculateConcentrationPenalty(analysis);

    // Calculate total
    breakdown.total = Math.max(0, Math.min(300,
      breakdown.base +
      breakdown.distributionScore +
      breakdown.decentralizationScore +
      breakdown.organicGrowthScore +
      breakdown.developerEthicsScore +
      breakdown.sniperPenalty +
      breakdown.botPenalty +
      breakdown.bundlerPenalty +
      breakdown.concentrationPenalty
    ));

    return breakdown;
  }

  private calculateDistributionScore(analysis: TokenHolderAnalysis): number {
    const holders = analysis.holderCounts.total;
    
    if (holders >= 1000) return 50;
    if (holders >= 500) return 35;
    if (holders >= 100) return 20;
    if (holders >= 50) return 10;
    return 5;
  }

  private calculateDecentralizationScore(analysis: TokenHolderAnalysis): number {
    const top10Pct = analysis.metrics.top10Percentage;
    
    // More strict thresholds - penalize concentration earlier
    if (top10Pct < 20) return 50;  // Excellent: top 10 own < 20%
    if (top10Pct < 30) return 35;  // Good: top 10 own < 30%
    if (top10Pct < 40) return 20;  // Fair: top 10 own < 40%
    if (top10Pct < 50) return 10;  // Poor: top 10 own < 50%
    return 0;  // Critical: top 10 own 50%+
  }

  private calculateOrganicGrowthScore(analysis: TokenHolderAnalysis): number {
    const botPct = (analysis.holderCounts.bots / analysis.holderCounts.total) * 100;
    
    if (botPct < 5) return 30;
    if (botPct < 15) return 15;
    return 0;
  }

  private calculateDeveloperEthicsScore(analysis: TokenHolderAnalysis): number {
    const devHoldingPct = analysis.holdingPercentages.developers;
    
    if (devHoldingPct < 5) return 20;
    if (devHoldingPct < 10) return 10;
    if (devHoldingPct < 15) return 5;
    return 0;
  }

  private calculateSniperPenalty(analysis: TokenHolderAnalysis): number {
    const sniperHoldingsPct = analysis.holdingPercentages.snipers;
    
    if (sniperHoldingsPct > 30) return -50;
    if (sniperHoldingsPct > 20) return -30;
    if (sniperHoldingsPct > 10) return -15;
    return 0;
  }

  private calculateBotPenalty(analysis: TokenHolderAnalysis): number {
    const botHoldingsPct = analysis.holdingPercentages.bots;
    
    if (botHoldingsPct > 25) return -30;
    if (botHoldingsPct > 15) return -20;
    if (botHoldingsPct > 5) return -10;
    return 0;
  }

  private calculateBundlerPenalty(analysis: TokenHolderAnalysis): number {
    const bundlerCount = analysis.holderCounts.bundlers;
    
    if (bundlerCount > 10) return -20;
    if (bundlerCount > 5) return -10;
    if (bundlerCount > 2) return -5;
    return 0;
  }

  private calculateConcentrationPenalty(analysis: TokenHolderAnalysis): number {
    const top10Pct = analysis.metrics.top10Percentage;
    const top25Pct = analysis.metrics.top25Percentage;
    
    // More aggressive penalties for concentration
    let penalty = 0;
    
    // Top 10 concentration penalties
    if (top10Pct > 70) penalty -= 50;      // Extreme concentration
    else if (top10Pct > 60) penalty -= 35; // Very high concentration
    else if (top10Pct > 50) penalty -= 25; // High concentration
    else if (top10Pct > 40) penalty -= 15; // Moderate concentration
    else if (top10Pct > 35) penalty -= 10; // Slight concentration
    
    // Additional penalty for top 25 concentration
    if (top25Pct > 85) penalty -= 20;      // Top 25 own almost everything
    else if (top25Pct > 75) penalty -= 15; // Very concentrated in top 25
    else if (top25Pct > 65) penalty -= 10; // Concentrated in top 25
    else if (top25Pct > 55) penalty -= 5;  // Moderate top 25 concentration
    
    return penalty;
  }
}

// Create mock scenarios for testing
function createMockScenarios(): { [key: string]: TokenHolderAnalysis } {
  return {
    'Excellent Token': {
      mintAddress: 'EXCELLENT123',
      holderCounts: {
        total: 1500,
        organic: 1350,
        snipers: 30,
        bots: 60,
        bundlers: 5,
        developers: 15,
        whales: 40
      },
      holdingPercentages: {
        organic: 75,
        snipers: 5,
        bots: 3,
        developers: 2,
        whales: 15
      },
      metrics: {
        top10Percentage: 22,
        top25Percentage: 35,
        giniCoefficient: 0.45,
        averageHoldingDuration: 72,
        holderGrowthRate24h: 5,
        churnRate24h: 2
      }
    },
    'Average Token': {
      mintAddress: 'AVERAGE123',
      holderCounts: {
        total: 250,
        organic: 150,
        snipers: 25,
        bots: 40,
        bundlers: 10,
        developers: 5,
        whales: 20
      },
      holdingPercentages: {
        organic: 45,
        snipers: 15,
        bots: 12,
        developers: 8,
        whales: 20
      },
      metrics: {
        top10Percentage: 55,
        top25Percentage: 70,
        giniCoefficient: 0.72,
        averageHoldingDuration: 24,
        holderGrowthRate24h: 2,
        churnRate24h: 10
      }
    },
    'Poor Token': {
      mintAddress: 'POOR123',
      holderCounts: {
        total: 45,
        organic: 10,
        snipers: 15,
        bots: 12,
        bundlers: 3,
        developers: 2,
        whales: 3
      },
      holdingPercentages: {
        organic: 15,
        snipers: 35,
        bots: 28,
        developers: 12,
        whales: 10
      },
      metrics: {
        top10Percentage: 85,
        top25Percentage: 95,
        giniCoefficient: 0.91,
        averageHoldingDuration: 6,
        holderGrowthRate24h: -5,
        churnRate24h: 25
      }
    }
  };
}

// Function to estimate holder analysis from real token data
async function estimateFromRealToken(pool: Pool, mintAddress: string): Promise<TokenHolderAnalysis | null> {
  try {
    // Get token data
    const tokenResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        total_trades,
        unique_traders_24h,
        graduated_to_amm,
        creator
      FROM tokens_unified
      WHERE mint_address = $1
    `, [mintAddress]);

    if (tokenResult.rows.length === 0) {
      console.log('Token not found');
      return null;
    }

    const token = tokenResult.rows[0];
    console.log(`\nAnalyzing token: ${token.symbol} (${token.name})`);
    console.log(`Market Cap: $${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`);

    // Get trade distribution to estimate holder types
    const tradeStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT user_address) as unique_traders,
        COUNT(*) as total_trades,
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade
      FROM trades_unified
      WHERE mint_address = $1
    `, [mintAddress]);

    // Get early traders (potential snipers)
    const earlyTraders = await pool.query(`
      SELECT 
        user_address,
        COUNT(*) as trade_count,
        MIN(block_time) as first_trade
      FROM trades_unified
      WHERE mint_address = $1
      GROUP BY user_address
      ORDER BY MIN(block_time)
      LIMIT 20
    `, [mintAddress]);

    // Create estimated analysis based on available data
    const uniqueTraders = parseInt(tradeStats.rows[0]?.unique_traders || 0);
    const totalTrades = parseInt(tradeStats.rows[0]?.total_trades || 0);
    
    // Estimate holder distribution (mock calculations)
    const estimatedHolders = Math.max(uniqueTraders, 50); // Assume at least 50 holders
    const sniperCount = earlyTraders.rows.length; // Top 20 early buyers
    const botEstimate = Math.floor(uniqueTraders * 0.15); // Assume 15% are bots
    const whaleEstimate = Math.floor(estimatedHolders * 0.05); // Top 5% are whales
    const developerCount = token.creator ? 3 : 1; // Creator + team
    const bundlerEstimate = Math.floor(uniqueTraders * 0.02); // 2% bundlers
    const organicCount = estimatedHolders - sniperCount - botEstimate - whaleEstimate - developerCount - bundlerEstimate;

    return {
      mintAddress: token.mint_address,
      holderCounts: {
        total: estimatedHolders,
        organic: Math.max(organicCount, 10),
        snipers: sniperCount,
        bots: botEstimate,
        bundlers: bundlerEstimate,
        developers: developerCount,
        whales: whaleEstimate
      },
      holdingPercentages: {
        organic: 40, // Mock estimate
        snipers: 20, // Mock estimate
        bots: 15, // Mock estimate
        developers: 10, // Mock estimate
        whales: 15 // Mock estimate
      },
      metrics: {
        top10Percentage: token.graduated_to_amm ? 45 : 65, // Better distribution if graduated
        top25Percentage: token.graduated_to_amm ? 65 : 80,
        giniCoefficient: 0.75, // Mock estimate
        averageHoldingDuration: 24, // Mock estimate
        holderGrowthRate24h: 3, // Mock estimate
        churnRate24h: 5 // Mock estimate
      }
    };
  } catch (error) {
    console.error('Error estimating from real token:', error);
    return null;
  }
}

function displayScoreBreakdown(analysis: TokenHolderAnalysis, breakdown: ScoreBreakdown) {
  console.log('\n========================================');
  console.log(`Token: ${analysis.mintAddress}`);
  console.log(`Total Holders: ${analysis.holderCounts.total}`);
  console.log('========================================\n');

  console.log('📊 Score Breakdown:');
  console.log(`   Base Score:           ${breakdown.base}`);
  console.log(`   Distribution:        +${breakdown.distributionScore}`);
  console.log(`   Decentralization:    +${breakdown.decentralizationScore}`);
  console.log(`   Organic Growth:      +${breakdown.organicGrowthScore}`);
  console.log(`   Developer Ethics:    +${breakdown.developerEthicsScore}`);
  
  if (breakdown.sniperPenalty < 0) console.log(`   Sniper Penalty:      ${breakdown.sniperPenalty}`);
  if (breakdown.botPenalty < 0) console.log(`   Bot Penalty:         ${breakdown.botPenalty}`);
  if (breakdown.bundlerPenalty < 0) console.log(`   Bundler Penalty:     ${breakdown.bundlerPenalty}`);
  if (breakdown.concentrationPenalty < 0) console.log(`   Concentration Penalty: ${breakdown.concentrationPenalty}`);
  
  console.log('   ────────────────────────────');
  console.log(`   TOTAL SCORE:         ${breakdown.total}/300`);
  
  // Rating
  let rating = '';
  let emoji = '';
  if (breakdown.total >= 250) { rating = 'Excellent'; emoji = '🟢'; }
  else if (breakdown.total >= 200) { rating = 'Good'; emoji = '🟢'; }
  else if (breakdown.total >= 150) { rating = 'Fair'; emoji = '🟡'; }
  else if (breakdown.total >= 100) { rating = 'Poor'; emoji = '🟠'; }
  else { rating = 'Critical'; emoji = '🔴'; }
  
  console.log(`\n   Rating: ${emoji} ${rating}`);
  
  console.log('\n📈 Holder Distribution:');
  console.log(`   Organic:    ${analysis.holderCounts.organic} (${analysis.holdingPercentages.organic}% of supply)`);
  console.log(`   Snipers:    ${analysis.holderCounts.snipers} (${analysis.holdingPercentages.snipers}% of supply)`);
  console.log(`   Bots:       ${analysis.holderCounts.bots} (${analysis.holdingPercentages.bots}% of supply)`);
  console.log(`   Developers: ${analysis.holderCounts.developers} (${analysis.holdingPercentages.developers}% of supply)`);
  console.log(`   Whales:     ${analysis.holderCounts.whales} (${analysis.holdingPercentages.whales}% of supply)`);
  
  console.log('\n📊 Key Metrics:');
  console.log(`   Top 10 holders own: ${analysis.metrics.top10Percentage}%`);
  console.log(`   Top 25 holders own: ${analysis.metrics.top25Percentage}%`);
  console.log(`   Gini coefficient:   ${analysis.metrics.giniCoefficient}`);
}

async function main() {
  const calculator = new HolderScoreCalculator();
  
  console.log('🎯 Token Holder Score Testing\n');
  
  // Test with mock scenarios
  console.log('=== MOCK SCENARIOS ===');
  const scenarios = createMockScenarios();
  
  for (const [name, analysis] of Object.entries(scenarios)) {
    const score = calculator.calculateScore(analysis);
    displayScoreBreakdown(analysis, score);
    console.log('\n');
  }
  
  // Test with real token if requested
  const testMintAddress = process.argv[2];
  if (testMintAddress) {
    console.log('\n=== REAL TOKEN ANALYSIS ===');
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    
    try {
      const analysis = await estimateFromRealToken(pool, testMintAddress);
      if (analysis) {
        const score = calculator.calculateScore(analysis);
        displayScoreBreakdown(analysis, score);
      }
    } finally {
      await pool.end();
    }
  } else {
    console.log('\n💡 Tip: Run with a mint address to analyze a real token:');
    console.log('   npx tsx src/scripts/test-holder-scoring.ts <MINT_ADDRESS>');
  }
}

main().catch(console.error);