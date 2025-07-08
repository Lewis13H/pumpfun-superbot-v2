#!/usr/bin/env npx tsx
/**
 * Test RPC-based Holder Analysis
 * 
 * Test the updated holder analysis with RPC as primary source
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';
import { HolderAnalysisService } from '../services/holder-analysis/holder-analysis-service';

async function testRPCHolderAnalysis() {
  console.log(chalk.cyan('\n🚀 Testing RPC-based Holder Analysis\n'));
  
  try {
    const pool = db.getPool();
    
    // Create holder analysis service
    const holderAnalysisService = new HolderAnalysisService(
      pool,
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );
    
    // Listen to events
    holderAnalysisService.on('data_fetched', (data) => {
      console.log(chalk.gray(`   Data fetched: ${data.mintAddress} from ${data.source}`));
    });
    
    // Test tokens - mix of different types
    const testTokens = [
      { mint: 'CEVXFsZe9r2qzZfX7AJn9W9mWM5eu9jHaALo5NjBpump', symbol: 'MINTR' },
      { mint: 'B3pHPprgBgmPVkpQyJv3YfrLUTBrxxYYeJtfF5nrpump', symbol: 'ALPACU' },
      { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL' }, // Test with native SOL
      { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC' } // Test with well-known token
    ];
    
    console.log(chalk.yellow('Testing tokens with RPC-based analysis:\n'));
    
    for (const token of testTokens) {
      console.log(chalk.yellow(`\nAnalyzing ${token.symbol} (${token.mint.substring(0, 8)}...):`));
      
      try {
        const startTime = Date.now();
        const result = await holderAnalysisService.analyzeToken(token.mint, {
          forceRefresh: true,
          maxHolders: 100,
          enableTrends: false,
          classifyWallets: true,
          saveSnapshot: true
        });
        
        const duration = Date.now() - startTime;
        
        if (result) {
          console.log(chalk.green(`   ✓ Success in ${duration}ms`));
          console.log(chalk.gray(`     Score: ${result.score}/300`));
          console.log(chalk.gray(`     Grade: ${result.grade}`));
          console.log(chalk.gray(`     Holders: ${result.totalHolders}`));
          console.log(chalk.gray(`     Top Holder: ${result.metrics.topHolderPercentage.toFixed(2)}%`));
          console.log(chalk.gray(`     Gini: ${result.metrics.giniCoefficient.toFixed(3)}`));
          console.log(chalk.gray(`     HHI: ${result.metrics.hhi.toFixed(0)}`));
          
          // Show wallet types
          if (result.walletClassifications && result.walletClassifications.length > 0) {
            const typeCounts = result.walletClassifications.reduce((acc, wc) => {
              acc[wc.type] = (acc[wc.type] || 0) + 1;
              return acc;
            }, {} as Record<string, number>);
            
            console.log(chalk.gray('     Wallet Types:'));
            Object.entries(typeCounts).forEach(([type, count]) => {
              console.log(chalk.gray(`       ${type}: ${count}`));
            });
          }
        } else {
          console.log(chalk.red(`   ✗ Failed to analyze`));
        }
      } catch (error) {
        console.log(chalk.red(`   ✗ Error: ${error.message}`));
      }
    }
    
    // Test batch analysis
    console.log(chalk.yellow('\n\nTesting batch analysis of eligible tokens:'));
    const eligibleTokens = await db.query(`
      SELECT mint_address, symbol
      FROM tokens_unified
      WHERE latest_market_cap_usd >= 18888
        AND mint_address NOT IN (
          SELECT DISTINCT mint_address 
          FROM holder_snapshots
        )
      ORDER BY latest_market_cap_usd DESC
      LIMIT 5
    `);
    
    if (eligibleTokens.rows.length > 0) {
      console.log(chalk.gray(`   Found ${eligibleTokens.rows.length} tokens without analysis\n`));
      
      for (const token of eligibleTokens.rows) {
        console.log(chalk.gray(`   Analyzing ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)...`));
        
        try {
          const result = await holderAnalysisService.analyzeToken(token.mint_address, {
            forceRefresh: true,
            maxHolders: 20, // RPC only gives top 20
            enableTrends: false,
            classifyWallets: false, // Skip to save time
            saveSnapshot: true
          });
          
          if (result) {
            console.log(chalk.green(`   ✓ Score: ${result.score}, Grade: ${result.grade}`));
          } else {
            console.log(chalk.red(`   ✗ Failed`));
          }
        } catch (error) {
          console.log(chalk.red(`   ✗ Error: ${error.message}`));
        }
      }
    } else {
      console.log(chalk.gray('   All eligible tokens already have analysis!'));
    }
    
    console.log(chalk.green('\n✅ RPC holder analysis test complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
  } finally {
    await db.close();
  }
}

// Run test
testRPCHolderAnalysis().catch(console.error);