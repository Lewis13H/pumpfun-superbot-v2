#!/usr/bin/env npx tsx
/**
 * Check Holder Analysis Status
 * 
 * Quick overview of current holder analysis coverage
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';

async function checkStatus() {
  console.log(chalk.cyan('\n📊 Holder Analysis Status Report\n'));
  
  try {
    // Overall statistics
    const statsResult = await db.query(`
      WITH eligible_tokens AS (
        SELECT 
          t.mint_address,
          t.symbol,
          t.name,
          t.latest_market_cap_usd,
          t.graduated_to_amm
        FROM tokens_unified t
        WHERE t.latest_market_cap_usd >= 18888
      ),
      analyzed_tokens AS (
        SELECT 
          hs.mint_address,
          MAX(hs.snapshot_time) as last_analyzed,
          MAX(hs.holder_score) as latest_score
        FROM holder_snapshots hs
        GROUP BY hs.mint_address
      )
      SELECT 
        COUNT(DISTINCT et.mint_address) as total_eligible,
        COUNT(DISTINCT at.mint_address) as total_analyzed,
        COUNT(DISTINCT CASE WHEN at.last_analyzed > NOW() - INTERVAL '1 hour' THEN at.mint_address END) as fresh_analysis,
        COUNT(DISTINCT CASE WHEN at.last_analyzed <= NOW() - INTERVAL '1 hour' THEN at.mint_address END) as stale_analysis,
        COUNT(DISTINCT CASE WHEN at.mint_address IS NULL THEN et.mint_address END) as never_analyzed,
        COUNT(DISTINCT CASE WHEN et.graduated_to_amm = true THEN et.mint_address END) as graduated_tokens,
        COUNT(DISTINCT CASE WHEN et.graduated_to_amm = true AND at.mint_address IS NOT NULL THEN et.mint_address END) as graduated_analyzed
      FROM eligible_tokens et
      LEFT JOIN analyzed_tokens at ON at.mint_address = et.mint_address
    `);
    
    const stats = statsResult.rows[0];
    const coveragePercent = (stats.total_analyzed / stats.total_eligible * 100).toFixed(1);
    const freshPercent = (stats.fresh_analysis / stats.total_eligible * 100).toFixed(1);
    
    console.log(chalk.yellow('Overall Statistics:'));
    console.log(chalk.gray(`   Eligible tokens (≥$18,888): ${stats.total_eligible}`));
    console.log(chalk.gray(`   Total analyzed: ${stats.total_analyzed} (${coveragePercent}%)`));
    console.log(chalk.green(`   Fresh (<1hr): ${stats.fresh_analysis} (${freshPercent}%)`));
    console.log(chalk.yellow(`   Stale (>1hr): ${stats.stale_analysis}`));
    console.log(chalk.red(`   Never analyzed: ${stats.never_analyzed}`));
    console.log(chalk.gray(`   Graduated tokens: ${stats.graduated_tokens} (${stats.graduated_analyzed} analyzed)`));
    
    // Score distribution
    console.log(chalk.yellow('\n\nScore Distribution:'));
    const scoreDistResult = await db.query(`
      WITH latest_scores AS (
        SELECT DISTINCT ON (hs.mint_address)
          hs.mint_address,
          hs.holder_score,
          t.symbol
        FROM holder_snapshots hs
        JOIN tokens_unified t ON t.mint_address = hs.mint_address
        WHERE t.latest_market_cap_usd >= 18888
        ORDER BY hs.mint_address, hs.snapshot_time DESC
      )
      SELECT 
        CASE 
          WHEN holder_score >= 250 THEN 'A+ (250+)'
          WHEN holder_score >= 200 THEN 'A (200-249)'
          WHEN holder_score >= 150 THEN 'B (150-199)'
          WHEN holder_score >= 100 THEN 'C (100-149)'
          ELSE 'D (0-99)'
        END as grade,
        COUNT(*) as count,
        STRING_AGG(symbol, ', ' ORDER BY holder_score DESC) as example_tokens
      FROM latest_scores
      GROUP BY 
        CASE 
          WHEN holder_score >= 250 THEN 'A+ (250+)'
          WHEN holder_score >= 200 THEN 'A (200-249)'
          WHEN holder_score >= 150 THEN 'B (150-199)'
          WHEN holder_score >= 100 THEN 'C (100-149)'
          ELSE 'D (0-99)'
        END
      ORDER BY 
        MIN(holder_score) DESC
    `);
    
    scoreDistResult.rows.forEach(row => {
      const examples = row.example_tokens ? row.example_tokens.split(', ').slice(0, 3).join(', ') : '';
      console.log(chalk.gray(`   ${row.grade}: ${row.count} tokens (e.g., ${examples})`));
    });
    
    // Tokens needing analysis
    console.log(chalk.yellow('\n\nTop 10 Unanalyzed Tokens (by market cap):'));
    const unanalyzedResult = await db.query(`
      SELECT 
        t.symbol,
        t.name,
        t.mint_address,
        t.latest_market_cap_usd,
        t.graduated_to_amm
      FROM tokens_unified t
      LEFT JOIN holder_snapshots hs ON hs.mint_address = t.mint_address
      WHERE t.latest_market_cap_usd >= 18888
        AND hs.id IS NULL
      ORDER BY t.latest_market_cap_usd DESC
      LIMIT 10
    `);
    
    if (unanalyzedResult.rows.length === 0) {
      console.log(chalk.green('   All tokens have been analyzed!'));
    } else {
      unanalyzedResult.rows.forEach(token => {
        const marketCap = parseFloat(token.latest_market_cap_usd).toLocaleString();
        const graduated = token.graduated_to_amm ? ' (GRAD)' : '';
        console.log(chalk.gray(
          `   ${token.symbol || 'Unknown'} - $${marketCap}${graduated} - ${token.mint_address.substring(0, 8)}...`
        ));
      });
    }
    
    // Recent analysis activity
    console.log(chalk.yellow('\n\nRecent Analysis Activity:'));
    const recentResult = await db.query(`
      SELECT 
        DATE_TRUNC('hour', hs.snapshot_time) as hour,
        COUNT(*) as analyses_count
      FROM holder_snapshots hs
      WHERE hs.snapshot_time > NOW() - INTERVAL '24 hours'
      GROUP BY DATE_TRUNC('hour', hs.snapshot_time)
      ORDER BY hour DESC
      LIMIT 6
    `);
    
    if (recentResult.rows.length === 0) {
      console.log(chalk.gray('   No analysis activity in the last 24 hours'));
    } else {
      recentResult.rows.forEach(row => {
        const time = new Date(row.hour).toLocaleTimeString();
        console.log(chalk.gray(`   ${time}: ${row.analyses_count} analyses`));
      });
    }
    
    // API key status
    console.log(chalk.yellow('\n\nAPI Configuration:'));
    console.log(chalk.gray(`   Helius API Key: ${process.env.HELIUS_API_KEY ? '✓ Configured' : '✗ Missing'}`));
    console.log(chalk.gray(`   Shyft API Key: ${process.env.SHYFT_API_KEY ? '✓ Configured' : '✗ Missing'}`));
    console.log(chalk.gray(`   Custom RPC URL: ${process.env.SOLANA_RPC_URL ? '✓ Configured' : '✗ Using default'}`));
    
    console.log(chalk.green('\n✅ Status check complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Status check failed:'), error);
  } finally {
    await db.close();
  }
}

// Run status check
checkStatus().catch(console.error);