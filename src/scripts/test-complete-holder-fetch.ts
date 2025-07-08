#!/usr/bin/env npx tsx
/**
 * Test Complete Holder Fetching
 * 
 * Verifies that we can fetch ALL holders using Helius getTokenAccounts
 */

import 'dotenv/config';
import chalk from 'chalk';
import { HeliusCompleteHolderFetcher } from '../services/holder-analysis/helius-complete-holder-fetcher';

async function testCompleteHolderFetch() {
  console.log(chalk.cyan('\n🧪 Testing Complete Holder Fetching with Helius\n'));
  
  if (!process.env.HELIUS_API_KEY) {
    console.log(chalk.red('❌ HELIUS_API_KEY not found in environment'));
    return;
  }
  
  const fetcher = new HeliusCompleteHolderFetcher();
  
  // Test tokens - start with smaller ones
  const testTokens = [
    { 
      mint: 'CEVXFsZe9r2qzZfX7AJn9W9mWM5eu9jHaALo5NjBpump', 
      symbol: 'MINTR',
      description: 'Previously analyzed token'
    },
    { 
      mint: 'So11111111111111111111111111111111111111112', 
      symbol: 'SOL',
      description: 'Native SOL (should have many holders)'
    },
    { 
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 
      symbol: 'USDC',
      description: 'USDC stablecoin'
    }
  ];
  
  for (const token of testTokens) {
    console.log(chalk.yellow(`\nTesting ${token.symbol} - ${token.description}`));
    console.log(chalk.gray(`Mint: ${token.mint}`));
    
    try {
      const startTime = Date.now();
      let lastProgress = 0;
      
      // First test: Get top 100 holders only
      console.log(chalk.gray('\n1. Fetching top 100 holders...'));
      const topHolders = await fetcher.getTopHolders(token.mint, 100);
      
      if (topHolders) {
        console.log(chalk.green(`   ✓ Found ${topHolders.holders.length} top holders`));
        console.log(chalk.gray(`   Token: ${topHolders.tokenInfo.symbol} (${topHolders.tokenInfo.name})`));
        console.log(chalk.gray(`   Decimals: ${topHolders.tokenInfo.decimals}`));
        
        if (topHolders.holders.length > 0) {
          const top5 = topHolders.holders.slice(0, 5);
          console.log(chalk.gray('\n   Top 5 holders:'));
          top5.forEach((h, i) => {
            console.log(chalk.gray(
              `   ${i + 1}. ${h.address.substring(0, 8)}... - ${h.percentage.toFixed(2)}% (${h.uiBalance.toLocaleString()} tokens)`
            ));
          });
        }
      } else {
        console.log(chalk.red('   ✗ Failed to fetch top holders'));
      }
      
      // Second test: Get complete holder data (limit to 2 pages for testing)
      console.log(chalk.gray('\n2. Fetching complete holder data (max 2000 accounts)...'));
      
      const completeData = await fetcher.fetchAllHolders(token.mint, {
        pageLimit: 2, // Max 2 pages = 2000 accounts
        includeZeroBalances: false,
        progressCallback: (current, total) => {
          // Show progress every 500 accounts
          if (current - lastProgress >= 500 || current === total) {
            console.log(chalk.gray(`   Progress: ${current}/${total} accounts fetched`));
            lastProgress = current;
          }
        }
      });
      
      if (completeData) {
        const duration = Date.now() - startTime;
        console.log(chalk.green(`   ✓ Complete data fetched in ${(duration / 1000).toFixed(1)}s`));
        console.log(chalk.gray(`   Total accounts: ${completeData.totalHolders}`));
        console.log(chalk.gray(`   Unique holders: ${completeData.uniqueHolders}`));
        console.log(chalk.gray(`   Data fetched: ${completeData.holders.length} holders`));
        
        // Calculate distribution metrics
        if (completeData.holders.length > 0) {
          const top10 = completeData.holders.slice(0, 10);
          const top10Percentage = top10.reduce((sum, h) => sum + h.percentage, 0);
          const top100 = completeData.holders.slice(0, 100);
          const top100Percentage = top100.reduce((sum, h) => sum + h.percentage, 0);
          
          console.log(chalk.gray('\n   Distribution metrics:'));
          console.log(chalk.gray(`   Top holder: ${completeData.holders[0].percentage.toFixed(2)}%`));
          console.log(chalk.gray(`   Top 10 holders: ${top10Percentage.toFixed(2)}%`));
          console.log(chalk.gray(`   Top 100 holders: ${top100Percentage.toFixed(2)}%`));
          
          // Show holder size distribution
          const whales = completeData.holders.filter(h => h.percentage >= 1).length;
          const large = completeData.holders.filter(h => h.percentage >= 0.1 && h.percentage < 1).length;
          const medium = completeData.holders.filter(h => h.percentage >= 0.01 && h.percentage < 0.1).length;
          const small = completeData.holders.filter(h => h.percentage < 0.01).length;
          
          console.log(chalk.gray('\n   Holder categories:'));
          console.log(chalk.gray(`   Whales (≥1%): ${whales}`));
          console.log(chalk.gray(`   Large (0.1-1%): ${large}`));
          console.log(chalk.gray(`   Medium (0.01-0.1%): ${medium}`));
          console.log(chalk.gray(`   Small (<0.01%): ${small}`));
        }
      } else {
        console.log(chalk.red('   ✗ Failed to fetch complete data'));
      }
      
    } catch (error: any) {
      console.log(chalk.red(`   ✗ Error: ${error.message}`));
      if (error.response?.status === 429) {
        console.log(chalk.yellow('   Rate limited - waiting before next test...'));
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  
  console.log(chalk.green('\n✅ Complete holder fetch testing finished!\n'));
}

// Run test
testCompleteHolderFetch().catch(console.error);