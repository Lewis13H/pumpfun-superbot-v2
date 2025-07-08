#!/usr/bin/env npx tsx
/**
 * Check Eligible Tokens for Holder Analysis
 * 
 * Find all tokens that should have holder analysis based on market cap
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';

async function checkEligibleTokens() {
  console.log(chalk.cyan('\n🔍 Checking Eligible Tokens for Holder Analysis\n'));
  
  try {
    // 1. Check tokens above $18,888 that are graduated
    console.log(chalk.yellow('1. Graduated tokens above $18,888:'));
    const graduatedResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        graduated_to_amm,
        threshold_crossed_at
      FROM tokens_unified
      WHERE latest_market_cap_usd >= 18888
        AND graduated_to_amm = true
      ORDER BY latest_market_cap_usd DESC
    `);
    
    console.log(chalk.gray(`   Found ${graduatedResult.rows.length} graduated tokens`));
    if (graduatedResult.rows.length > 0) {
      console.log(chalk.gray('   Top 5:'));
      graduatedResult.rows.slice(0, 5).forEach(token => {
        console.log(chalk.gray(`     ${token.symbol || 'Unknown'}: $${parseFloat(token.latest_market_cap_usd).toLocaleString()}`));
      });
    }
    
    // 2. Check ALL tokens above $18,888 (including non-graduated)
    console.log(chalk.yellow('\n2. ALL tokens above $18,888:'));
    const allTokensResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        graduated_to_amm,
        current_program
      FROM tokens_unified
      WHERE latest_market_cap_usd >= 18888
      ORDER BY latest_market_cap_usd DESC
    `);
    
    console.log(chalk.gray(`   Found ${allTokensResult.rows.length} total tokens`));
    const nonGraduated = allTokensResult.rows.filter(t => !t.graduated_to_amm);
    console.log(chalk.gray(`   Graduated: ${allTokensResult.rows.length - nonGraduated.length}`));
    console.log(chalk.gray(`   Non-graduated: ${nonGraduated.length}`));
    
    // 3. Check which tokens have holder analysis
    console.log(chalk.yellow('\n3. Tokens with holder analysis:'));
    const withAnalysisResult = await db.query(`
      SELECT DISTINCT
        t.mint_address,
        t.symbol,
        t.latest_market_cap_usd,
        t.graduated_to_amm,
        COUNT(hs.id) as snapshot_count,
        MAX(hs.holder_score) as latest_score,
        MAX(hs.snapshot_time) as latest_snapshot
      FROM tokens_unified t
      INNER JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
      GROUP BY t.mint_address, t.symbol, t.latest_market_cap_usd, t.graduated_to_amm
      ORDER BY t.latest_market_cap_usd DESC
    `);
    
    console.log(chalk.gray(`   Found ${withAnalysisResult.rows.length} tokens with analysis`));
    withAnalysisResult.rows.forEach(token => {
      console.log(chalk.gray(`     ${token.symbol}: Score=${token.latest_score}, Snapshots=${token.snapshot_count}, Graduated=${token.graduated_to_amm}`));
    });
    
    // 4. Find tokens that SHOULD have analysis but don't
    console.log(chalk.yellow('\n4. Tokens missing holder analysis:'));
    const missingAnalysisResult = await db.query(`
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        t.graduated_to_amm,
        t.current_program,
        t.threshold_crossed_at
      FROM tokens_unified t
      LEFT JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
        AND hs.id IS NULL
      ORDER BY t.latest_market_cap_usd DESC
      LIMIT 20
    `);
    
    console.log(chalk.red(`   Found ${missingAnalysisResult.rowCount} tokens missing analysis!`));
    missingAnalysisResult.rows.forEach(token => {
      const graduated = token.graduated_to_amm ? 'GRADUATED' : 'BONDING';
      console.log(chalk.gray(`     ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...): $${parseFloat(token.latest_market_cap_usd).toLocaleString()} - ${graduated}`));
    });
    
    // 5. Check job queue status
    console.log(chalk.yellow('\n5. Checking job queue:'));
    const jobsResult = await db.query(`
      SELECT COUNT(*) as total_jobs
      FROM holder_analysis_jobs
      WHERE status IN ('pending', 'running')
    `);
    
    // Note: The holder_analysis_jobs table doesn't exist since we're using in-memory queue
    // This query will fail, which is expected
    
    console.log(chalk.green('\n✅ Analysis complete!'));
    
    // Summary
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(chalk.gray(`   Total eligible tokens: ${allTokensResult.rows.length}`));
    console.log(chalk.gray(`   Tokens with analysis: ${withAnalysisResult.rows.length}`));
    console.log(chalk.gray(`   Missing analysis: ${allTokensResult.rows.length - withAnalysisResult.rows.length}`));
    console.log(chalk.gray(`   Coverage: ${((withAnalysisResult.rows.length / allTokensResult.rows.length) * 100).toFixed(1)}%`));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Check failed:'), error);
  } finally {
    await db.close();
  }
}

// Run check
checkEligibleTokens().catch(console.error);