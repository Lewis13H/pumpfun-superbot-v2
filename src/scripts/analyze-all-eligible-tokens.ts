#!/usr/bin/env npx tsx
/**
 * Analyze All Eligible Tokens
 * 
 * Manually trigger holder analysis for all tokens above $18,888
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';
import { HolderAnalysisService } from '../services/holder-analysis/holder-analysis-service';

async function analyzeAllEligibleTokens() {
  console.log(chalk.cyan('\n🚀 Analyzing All Eligible Tokens\n'));
  
  try {
    // Get database pool
    const pool = db.getPool();
    
    // Create holder analysis service with pool
    const holderAnalysisService = new HolderAnalysisService(
      pool,
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );
    
    // Get all eligible tokens
    console.log(chalk.yellow('1. Finding eligible tokens...'));
    const result = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        t.graduated_to_amm,
        t.current_program,
        -- Check if already analyzed
        (SELECT COUNT(*) FROM holder_snapshots hs WHERE hs.mint_address = t.mint_address) as existing_snapshots
      FROM tokens_unified t
      WHERE t.latest_market_cap_usd >= 18888
      ORDER BY t.latest_market_cap_usd DESC
    `);
    
    console.log(chalk.gray(`   Found ${result.rows.length} eligible tokens`));
    
    const tokensToAnalyze = result.rows.filter(t => t.existing_snapshots === '0');
    console.log(chalk.gray(`   ${tokensToAnalyze.length} tokens need analysis`));
    
    if (tokensToAnalyze.length === 0) {
      console.log(chalk.green('   All tokens already analyzed!'));
      return;
    }
    
    // Analyze tokens in batches
    console.log(chalk.yellow('\n2. Starting analysis...'));
    const batchSize = 5;
    let analyzed = 0;
    let failed = 0;
    
    for (let i = 0; i < tokensToAnalyze.length; i += batchSize) {
      const batch = tokensToAnalyze.slice(i, i + batchSize);
      console.log(chalk.gray(`\n   Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tokensToAnalyze.length / batchSize)}`));
      
      // Process batch in parallel
      const promises = batch.map(async (token) => {
        try {
          console.log(chalk.gray(`     Analyzing ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)...`));
          
          const result = await holderAnalysisService.analyzeToken(token.mint_address, {
            forceRefresh: true,
            maxHolders: 1000,
            enableTrends: true,
            classifyWallets: true,
            saveSnapshot: true
          });
          
          if (result) {
            console.log(chalk.green(`     ✓ ${token.symbol || 'Unknown'}: Score=${result.score}, Holders=${result.totalHolders}`));
            analyzed++;
          } else {
            console.log(chalk.red(`     ✗ ${token.symbol || 'Unknown'}: No data returned`));
            failed++;
          }
        } catch (error) {
          console.log(chalk.red(`     ✗ ${token.symbol || 'Unknown'}: ${error.message}`));
          failed++;
        }
      });
      
      await Promise.all(promises);
      
      // Add delay between batches to avoid rate limits
      if (i + batchSize < tokensToAnalyze.length) {
        console.log(chalk.gray('   Waiting 2 seconds before next batch...'));
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Summary
    console.log(chalk.cyan('\n📊 Analysis Summary:'));
    console.log(chalk.gray(`   Total eligible tokens: ${result.rows.length}`));
    console.log(chalk.gray(`   Already analyzed: ${result.rows.length - tokensToAnalyze.length}`));
    console.log(chalk.gray(`   Newly analyzed: ${analyzed}`));
    console.log(chalk.gray(`   Failed: ${failed}`));
    
    // Check final status
    console.log(chalk.yellow('\n3. Verifying results...'));
    const finalCheck = await db.query(`
      SELECT 
        COUNT(DISTINCT t.mint_address) as total_tokens,
        COUNT(DISTINCT hs.mint_address) as analyzed_tokens
      FROM tokens_unified t
      LEFT JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
    `);
    
    const coverage = (finalCheck.rows[0].analyzed_tokens / finalCheck.rows[0].total_tokens * 100).toFixed(1);
    console.log(chalk.gray(`   Coverage: ${finalCheck.rows[0].analyzed_tokens}/${finalCheck.rows[0].total_tokens} (${coverage}%)`));
    
    console.log(chalk.green('\n✅ Analysis complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Analysis failed:'), error);
  } finally {
    await db.close();
  }
}

// Run analysis
analyzeAllEligibleTokens().catch(console.error);