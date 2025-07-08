#!/usr/bin/env npx tsx
/**
 * Check Holder Analysis Data
 * 
 * Checks if any tokens have holder analysis data stored
 */

import 'dotenv/config';
import chalk from 'chalk';
import { db } from '../database';

async function checkHolderAnalysisData() {
  console.log(chalk.cyan('\n🔍 Checking Holder Analysis Data\n'));
  
  try {
    // Check holder_snapshots table
    console.log(chalk.yellow('1. Checking holder_snapshots table...'));
    const snapshotsResult = await db.query(`
      SELECT 
        COUNT(*) as total_snapshots,
        COUNT(DISTINCT mint_address) as unique_tokens,
        MIN(snapshot_time) as earliest_snapshot,
        MAX(snapshot_time) as latest_snapshot,
        AVG(holder_score) as avg_score
      FROM holder_snapshots
    `);
    
    const snapshotStats = snapshotsResult.rows[0];
    console.log(chalk.gray(`   Total snapshots: ${snapshotStats.total_snapshots}`));
    console.log(chalk.gray(`   Unique tokens analyzed: ${snapshotStats.unique_tokens}`));
    console.log(chalk.gray(`   Earliest snapshot: ${snapshotStats.earliest_snapshot || 'None'}`));
    console.log(chalk.gray(`   Latest snapshot: ${snapshotStats.latest_snapshot || 'None'}`));
    console.log(chalk.gray(`   Average holder score: ${snapshotStats.avg_score ? parseFloat(snapshotStats.avg_score).toFixed(2) : 'N/A'}`));
    
    // Check holder_analysis_metadata table
    console.log(chalk.yellow('\n2. Checking holder_analysis_metadata table...'));
    const metadataResult = await db.query(`
      SELECT 
        COUNT(*) as total_analyses,
        MIN(created_at) as first_analysis,
        MAX(created_at) as last_analysis,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
      FROM holder_analysis_metadata
    `);
    
    const metadataStats = metadataResult.rows[0];
    console.log(chalk.gray(`   Total analyses: ${metadataStats.total_analyses}`));
    console.log(chalk.gray(`   First analysis: ${metadataStats.first_analysis || 'None'}`));
    console.log(chalk.gray(`   Last analysis: ${metadataStats.last_analysis || 'None'}`));
    console.log(chalk.gray(`   Status breakdown:`));
    console.log(chalk.gray(`     - Completed: ${metadataStats.completed}`));
    console.log(chalk.gray(`     - Failed: ${metadataStats.failed}`));
    console.log(chalk.gray(`     - Processing: ${metadataStats.processing}`));
    console.log(chalk.gray(`     - Pending: ${metadataStats.pending}`));
    
    // Check wallet_classifications table
    console.log(chalk.yellow('\n3. Checking wallet_classifications table...'));
    const walletsResult = await db.query(`
      SELECT 
        COUNT(*) as total_wallets,
        classification,
        COUNT(*) as count
      FROM wallet_classifications
      GROUP BY classification
      ORDER BY count DESC
    `);
    
    console.log(chalk.gray(`   Total classified wallets: ${walletsResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0)}`));
    if (walletsResult.rows.length > 0) {
      console.log(chalk.gray('   Classifications:'));
      walletsResult.rows.forEach(row => {
        console.log(chalk.gray(`     - ${row.classification}: ${row.count}`));
      });
    }
    
    // Check token_holder_details table
    console.log(chalk.yellow('\n4. Checking token_holder_details table...'));
    const holderDetailsResult = await db.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT mint_address) as unique_tokens,
        COUNT(DISTINCT wallet_address) as unique_wallets
      FROM token_holder_details
    `);
    
    const holderDetailsStats = holderDetailsResult.rows[0];
    console.log(chalk.gray(`   Total holder records: ${holderDetailsStats.total_records}`));
    console.log(chalk.gray(`   Unique tokens: ${holderDetailsStats.unique_tokens}`));
    console.log(chalk.gray(`   Unique wallets: ${holderDetailsStats.unique_wallets}`));
    
    // Get top analyzed tokens
    if (parseInt(snapshotStats.unique_tokens) > 0) {
      console.log(chalk.yellow('\n5. Top analyzed tokens by holder score...'));
      const topTokensResult = await db.query(`
        SELECT 
          hs.mint_address,
          t.symbol,
          t.name,
          hs.holder_score,
          hs.total_holders,
          hs.gini_coefficient,
          hs.snapshot_time,
          t.latest_market_cap_usd
        FROM holder_snapshots hs
        JOIN tokens_unified t ON hs.mint_address = t.mint_address
        WHERE hs.snapshot_time = (
          SELECT MAX(snapshot_time) 
          FROM holder_snapshots hs2 
          WHERE hs2.mint_address = hs.mint_address
        )
        ORDER BY hs.holder_score DESC
        LIMIT 10
      `);
      
      if (topTokensResult.rows.length > 0) {
        console.log(chalk.gray('   Top tokens:'));
        topTokensResult.rows.forEach((token, index) => {
          const score = parseInt(token.holder_score);
          const scoreColor = score >= 250 ? chalk.green : score >= 200 ? chalk.yellow : score >= 150 ? chalk.cyan : chalk.red;
          console.log(chalk.gray(`   ${index + 1}. ${token.symbol || 'Unknown'} - ${scoreColor(score)} points`));
          console.log(chalk.gray(`      Address: ${token.mint_address.substring(0, 8)}...`));
          console.log(chalk.gray(`      Holders: ${token.total_holders}, Gini: ${parseFloat(token.gini_coefficient).toFixed(3)}`));
          console.log(chalk.gray(`      Market Cap: $${parseFloat(token.latest_market_cap_usd || 0).toLocaleString()}`));
        });
      }
    }
    
    // Check recent analysis activity
    console.log(chalk.yellow('\n6. Recent analysis activity (last 24 hours)...'));
    const recentActivityResult = await db.query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as analyses_count
      FROM holder_analysis_metadata
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
      LIMIT 10
    `);
    
    if (recentActivityResult.rows.length > 0) {
      console.log(chalk.gray('   Recent analyses by hour:'));
      recentActivityResult.rows.forEach(row => {
        console.log(chalk.gray(`     ${new Date(row.hour).toLocaleString()}: ${row.analyses_count} analyses`));
      });
    } else {
      console.log(chalk.gray('   No analyses in the last 24 hours'));
    }
    
    // Summary
    console.log(chalk.cyan('\n📊 Summary:'));
    if (parseInt(snapshotStats.unique_tokens) > 0) {
      console.log(chalk.green(`✅ Found holder analysis data for ${snapshotStats.unique_tokens} tokens`));
      console.log(chalk.green(`✅ Total of ${snapshotStats.total_snapshots} snapshots recorded`));
      console.log(chalk.green(`✅ ${walletsResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0)} wallets classified`));
    } else {
      console.log(chalk.yellow('⚠️  No holder analysis data found yet'));
      console.log(chalk.gray('   This is expected if the system just started'));
      console.log(chalk.gray('   Analyses will begin as high-value tokens are discovered'));
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error checking holder analysis data:'), error);
  } finally {
    await db.close();
  }
}

// Run check
checkHolderAnalysisData().catch(console.error);