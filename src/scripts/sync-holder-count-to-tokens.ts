#!/usr/bin/env node

/**
 * Sync Holder Count to Tokens
 * 
 * This script syncs holder_count from holder_snapshots to tokens_unified
 * for all tokens that have been analyzed but don't have holder_count set
 */

import { db } from '../database';
import chalk from 'chalk';

async function syncHolderCounts() {
  console.log(chalk.cyan('🔄 Starting holder count sync...'));
  
  try {
    // First, let's see how many tokens have holder analysis but no holder_count
    const checkResult = await db.query(`
      SELECT COUNT(DISTINCT hs.mint_address) as count
      FROM holder_snapshots hs
      INNER JOIN tokens_unified tu ON tu.mint_address = hs.mint_address
      WHERE tu.holder_count IS NULL OR tu.holder_count = 0
    `);
    
    const totalToSync = parseInt(checkResult.rows[0].count);
    console.log(chalk.yellow(`Found ${totalToSync} tokens to sync`));
    
    if (totalToSync === 0) {
      console.log(chalk.green('✅ All tokens already have holder counts synced'));
      return;
    }
    
    // Update tokens_unified with the latest holder count from holder_snapshots
    const updateResult = await db.query(`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (mint_address)
          mint_address,
          total_holders,
          holder_score,
          snapshot_time
        FROM holder_snapshots
        ORDER BY mint_address, snapshot_time DESC
      )
      UPDATE tokens_unified tu
      SET 
        holder_count = ls.total_holders,
        holder_score = ls.holder_score,
        holder_analysis_updated_at = ls.snapshot_time,
        updated_at = NOW()
      FROM latest_snapshots ls
      WHERE tu.mint_address = ls.mint_address
        AND (tu.holder_count IS NULL OR tu.holder_count = 0 OR tu.holder_count != ls.total_holders)
      RETURNING tu.mint_address, tu.symbol, tu.holder_count, tu.holder_score
    `);
    
    const updatedCount = updateResult.rowCount || 0;
    console.log(chalk.green(`✅ Updated ${updatedCount} tokens with holder counts`));
    
    // Show some examples
    if (updateResult.rows.length > 0) {
      console.log(chalk.cyan('\n📊 Sample of updated tokens:'));
      updateResult.rows.slice(0, 10).forEach(row => {
        console.log(
          chalk.white(`  ${row.symbol || 'Unknown'}`),
          chalk.gray(`(${row.mint_address.slice(0, 8)}...)`),
          chalk.green(`→ ${row.holder_count} holders`),
          chalk.blue(`(score: ${row.holder_score || 0})`)
        );
      });
    }
    
    // Also check if there are any tokens with holder_count but no snapshots (from metadata enrichment)
    const metadataOnlyResult = await db.query(`
      SELECT COUNT(*) as count
      FROM tokens_unified
      WHERE holder_count > 0
        AND NOT EXISTS (
          SELECT 1 FROM holder_snapshots hs 
          WHERE hs.mint_address = tokens_unified.mint_address
        )
    `);
    
    const metadataOnlyCount = parseInt(metadataOnlyResult.rows[0].count);
    if (metadataOnlyCount > 0) {
      console.log(chalk.blue(`\nℹ️  ${metadataOnlyCount} tokens have holder_count from metadata enrichment only (no full analysis)`));
    }
    
    // Show overall statistics
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE holder_count > 0) as with_holder_count,
        COUNT(*) FILTER (WHERE holder_score > 0) as with_holder_score,
        COUNT(*) as total_tokens
      FROM tokens_unified
    `);
    
    const stats = statsResult.rows[0];
    console.log(chalk.cyan('\n📈 Overall Statistics:'));
    console.log(chalk.white(`  Total tokens: ${stats.total_tokens}`));
    console.log(chalk.green(`  With holder count: ${stats.with_holder_count} (${((stats.with_holder_count / stats.total_tokens) * 100).toFixed(1)}%)`));
    console.log(chalk.blue(`  With holder score: ${stats.with_holder_score} (${((stats.with_holder_score / stats.total_tokens) * 100).toFixed(1)}%)`));
    
  } catch (error) {
    console.error(chalk.red('❌ Error syncing holder counts:'), error);
    process.exit(1);
  }
}

// Add the holder_analysis_updated_at column if it doesn't exist
async function ensureColumns() {
  try {
    await db.query(`
      ALTER TABLE tokens_unified 
      ADD COLUMN IF NOT EXISTS holder_score INTEGER,
      ADD COLUMN IF NOT EXISTS holder_analysis_updated_at TIMESTAMP WITH TIME ZONE
    `);
    console.log(chalk.green('✅ Ensured all required columns exist'));
  } catch (error) {
    console.error(chalk.yellow('⚠️  Error adding columns (they may already exist):'), error);
  }
}

// Main execution
async function main() {
  try {
    await ensureColumns();
    await syncHolderCounts();
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('❌ Fatal error:'), error);
    process.exit(1);
  }
}

main();