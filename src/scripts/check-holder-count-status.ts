#!/usr/bin/env node

/**
 * Check Holder Count Status
 * 
 * This script checks the current status of holder counts in the database
 */

import { db } from '../database';
import chalk from 'chalk';

async function checkHolderCountStatus() {
  console.log(chalk.cyan('🔍 Checking holder count status...\n'));
  
  try {
    // Overall statistics
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(*) FILTER (WHERE holder_count > 0) as with_holder_count,
        COUNT(*) FILTER (WHERE holder_score > 0) as with_holder_score,
        COUNT(*) FILTER (WHERE holder_count > 0 AND NOT EXISTS (
          SELECT 1 FROM holder_snapshots hs 
          WHERE hs.mint_address = tokens_unified.mint_address
        )) as metadata_only_count,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM holder_snapshots hs 
          WHERE hs.mint_address = tokens_unified.mint_address
        )) as with_full_analysis
      FROM tokens_unified
    `);
    
    const stats = statsResult.rows[0];
    
    console.log(chalk.cyan('📊 Overall Statistics:'));
    console.log(chalk.white(`  Total tokens: ${stats.total_tokens}`));
    console.log(chalk.green(`  With holder count: ${stats.with_holder_count} (${((stats.with_holder_count / stats.total_tokens) * 100).toFixed(1)}%)`));
    console.log(chalk.blue(`  With holder score: ${stats.with_holder_score} (${((stats.with_holder_score / stats.total_tokens) * 100).toFixed(1)}%)`));
    console.log(chalk.yellow(`  Metadata enrichment only: ${stats.metadata_only_count}`));
    console.log(chalk.magenta(`  Full holder analysis: ${stats.with_full_analysis}`));
    
    // Check for any out-of-sync tokens
    const outOfSyncResult = await db.query(`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (mint_address)
          mint_address,
          total_holders,
          holder_score,
          snapshot_time
        FROM holder_snapshots
        ORDER BY mint_address, snapshot_time DESC
      )
      SELECT COUNT(*) as out_of_sync
      FROM latest_snapshots ls
      INNER JOIN tokens_unified tu ON tu.mint_address = ls.mint_address
      WHERE tu.holder_count IS NULL 
        OR tu.holder_count != ls.total_holders
        OR tu.holder_score IS NULL
        OR tu.holder_score != ls.holder_score
    `);
    
    const outOfSync = parseInt(outOfSyncResult.rows[0].out_of_sync);
    if (outOfSync > 0) {
      console.log(chalk.red(`\n⚠️  ${outOfSync} tokens are out of sync and need holder count update`));
    } else {
      console.log(chalk.green('\n✅ All tokens with holder analysis are in sync'));
    }
    
    // Show sample of tokens with holder counts
    const sampleResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        holder_count,
        holder_score,
        latest_market_cap_usd,
        holder_analysis_updated_at,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM holder_snapshots hs 
            WHERE hs.mint_address = tokens_unified.mint_address
          ) THEN 'Full Analysis'
          ELSE 'Metadata Only'
        END as source
      FROM tokens_unified
      WHERE holder_count > 0
      ORDER BY holder_count DESC, latest_market_cap_usd DESC
      LIMIT 20
    `);
    
    if (sampleResult.rows.length > 0) {
      console.log(chalk.cyan('\n📋 Top tokens by holder count:'));
      console.log(chalk.gray('─'.repeat(120)));
      console.log(
        chalk.white('Symbol'.padEnd(15)),
        chalk.white('Holders'.padEnd(10)),
        chalk.white('Score'.padEnd(8)),
        chalk.white('Market Cap'.padEnd(15)),
        chalk.white('Source'.padEnd(15)),
        chalk.white('Updated')
      );
      console.log(chalk.gray('─'.repeat(120)));
      
      sampleResult.rows.forEach(row => {
        const symbol = (row.symbol || 'Unknown').slice(0, 14);
        const holders = row.holder_count.toString();
        const score = row.holder_score ? row.holder_score.toString() : '-';
        const marketCap = row.latest_market_cap_usd ? `$${Number(row.latest_market_cap_usd).toLocaleString()}` : '-';
        const updated = row.holder_analysis_updated_at 
          ? new Date(row.holder_analysis_updated_at).toLocaleString()
          : 'Never';
        
        const scoreColor = row.holder_score 
          ? row.holder_score >= 200 ? chalk.green 
          : row.holder_score >= 100 ? chalk.yellow 
          : chalk.red
          : chalk.gray;
        
        console.log(
          chalk.white(symbol.padEnd(15)),
          chalk.cyan(holders.padEnd(10)),
          scoreColor(score.padEnd(8)),
          chalk.green(marketCap.padEnd(15)),
          chalk.blue(row.source.padEnd(15)),
          chalk.gray(updated)
        );
      });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error checking holder count status:'), error);
    process.exit(1);
  }
}

// Main execution
async function main() {
  try {
    await checkHolderCountStatus();
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('❌ Fatal error:'), error);
    process.exit(1);
  }
}

main();