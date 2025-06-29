#!/usr/bin/env tsx

/**
 * Batch Enrich All Tokens Above $8,888
 * Enriches all existing tokens in the database with metadata
 */

import chalk from 'chalk';
import { config } from 'dotenv';
import { EnhancedAutoEnricher } from '../src/services/enhanced-auto-enricher';
import { db } from '../src/database';

config();

async function batchEnrichTokens() {
  console.log(chalk.cyan.bold('\n🚀 Batch Token Enrichment Tool\n'));
  
  const enricher = EnhancedAutoEnricher.getInstance();
  
  try {
    // First, ensure we have all the necessary columns
    console.log(chalk.yellow('📊 Ensuring database schema is up to date...'));
    
    await db.query(`
      ALTER TABLE tokens_unified 
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS image_uri VARCHAR(500),
      ADD COLUMN IF NOT EXISTS uri VARCHAR(500),
      ADD COLUMN IF NOT EXISTS metadata_source VARCHAR(50),
      ADD COLUMN IF NOT EXISTS metadata_updated_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS creators JSONB,
      ADD COLUMN IF NOT EXISTS supply NUMERIC(40,0),
      ADD COLUMN IF NOT EXISTS decimals INTEGER,
      ADD COLUMN IF NOT EXISTS is_mutable BOOLEAN,
      ADD COLUMN IF NOT EXISTS mint_authority VARCHAR(64),
      ADD COLUMN IF NOT EXISTS freeze_authority VARCHAR(64),
      ADD COLUMN IF NOT EXISTS token_standard VARCHAR(50),
      ADD COLUMN IF NOT EXISTS compressed BOOLEAN
    `);
    
    console.log(chalk.green('✅ Database schema updated\n'));
    
    // Get count of tokens needing enrichment
    const countResult = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN first_market_cap_usd >= 8888 THEN 1 END) as above_threshold,
        COUNT(CASE WHEN graduated_to_amm = true THEN 1 END) as amm_tokens
      FROM tokens_unified 
      WHERE (
        symbol IS NULL OR 
        name IS NULL OR 
        symbol = 'Unknown' OR 
        name = 'Unknown' OR
        metadata_updated_at IS NULL
      )
    `);
    
    const stats = countResult.rows[0];
    console.log(chalk.cyan('📈 Tokens Needing Enrichment:'));
    console.log(chalk.white(`   Total: ${stats.total}`));
    console.log(chalk.yellow(`   Above $8,888: ${stats.above_threshold}`));
    console.log(chalk.blue(`   AMM tokens: ${stats.amm_tokens}\n`));
    
    if (parseInt(stats.above_threshold) === 0) {
      console.log(chalk.green('✨ All tokens above $8,888 are already enriched!'));
      
      // Show current enrichment status
      const statusResult = await db.query(`
        SELECT 
          metadata_source,
          COUNT(*) as count
        FROM tokens_unified
        WHERE first_market_cap_usd >= 8888
        GROUP BY metadata_source
        ORDER BY count DESC
      `);
      
      console.log(chalk.cyan('\n📊 Current Enrichment Status:'));
      for (const row of statusResult.rows) {
        console.log(chalk.white(`   ${row.metadata_source || 'Not enriched'}: ${row.count} tokens`));
      }
      
      await db.end();
      return;
    }
    
    // Get all tokens above threshold that need enrichment
    console.log(chalk.yellow('🔍 Fetching tokens to enrich...'));
    
    const tokensResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        first_market_cap_usd,
        graduated_to_amm,
        created_at
      FROM tokens_unified 
      WHERE 
        first_market_cap_usd >= 8888
        AND (
          symbol IS NULL OR 
          name IS NULL OR 
          symbol = 'Unknown' OR 
          name = 'Unknown' OR
          metadata_updated_at IS NULL
        )
      ORDER BY 
        graduated_to_amm DESC,  -- AMM tokens first
        first_market_cap_usd DESC
    `);
    
    const tokens = tokensResult.rows;
    console.log(chalk.green(`   Found ${tokens.length} tokens to enrich\n`));
    
    // Process in batches
    const BATCH_SIZE = 20;
    let successCount = 0;
    let failCount = 0;
    
    console.log(chalk.cyan('🔄 Starting batch enrichment...\n'));
    
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(tokens.length / BATCH_SIZE);
      
      console.log(chalk.blue(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} tokens)...`));
      
      // Add tokens to enrichment queue
      const mintAddresses = batch.map(t => t.mint_address);
      await enricher.addTokens(mintAddresses);
      
      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check results
      for (const token of batch) {
        const result = await db.query(`
          SELECT symbol, name, metadata_source, metadata_updated_at
          FROM tokens_unified
          WHERE mint_address = $1
        `, [token.mint_address]);
        
        if (result.rows.length > 0) {
          const updated = result.rows[0];
          if (updated.metadata_source && updated.symbol && updated.symbol !== 'Unknown') {
            successCount++;
            const mcap = parseFloat(token.first_market_cap_usd).toLocaleString('en-US', {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 0,
              maximumFractionDigits: 0
            });
            console.log(chalk.green(`   ✅ ${token.mint_address.slice(0, 8)}... | ${updated.symbol} | ${mcap} | ${updated.metadata_source}`));
          } else {
            failCount++;
            console.log(chalk.red(`   ❌ ${token.mint_address.slice(0, 8)}... | Failed to enrich`));
          }
        }
      }
      
      // Progress update
      const progress = ((i + batch.length) / tokens.length * 100).toFixed(1);
      console.log(chalk.gray(`\n   Progress: ${progress}% | Success: ${successCount} | Failed: ${failCount}`));
      
      // Rate limit between batches
      if (i + BATCH_SIZE < tokens.length) {
        console.log(chalk.gray('   Waiting before next batch...'));
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Final statistics
    console.log(chalk.cyan.bold('\n\n📊 Batch Enrichment Complete!\n'));
    console.log(chalk.green(`✅ Successfully enriched: ${successCount} tokens`));
    console.log(chalk.red(`❌ Failed to enrich: ${failCount} tokens`));
    console.log(chalk.white(`📈 Success rate: ${(successCount / tokens.length * 100).toFixed(1)}%`));
    
    // Get enrichment source breakdown
    const sourceResult = await db.query(`
      SELECT 
        metadata_source,
        COUNT(*) as count
      FROM tokens_unified
      WHERE 
        first_market_cap_usd >= 8888
        AND metadata_source IS NOT NULL
      GROUP BY metadata_source
      ORDER BY count DESC
    `);
    
    console.log(chalk.cyan('\n📊 Enrichment Sources:'));
    for (const row of sourceResult.rows) {
      console.log(chalk.white(`   ${row.metadata_source}: ${row.count} tokens`));
    }
    
    // Show some examples
    const examplesResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        first_market_cap_usd,
        metadata_source,
        metadata_updated_at
      FROM tokens_unified
      WHERE 
        first_market_cap_usd >= 8888
        AND metadata_source IS NOT NULL
      ORDER BY metadata_updated_at DESC
      LIMIT 5
    `);
    
    console.log(chalk.cyan('\n🌟 Recently Enriched Examples:'));
    for (const token of examplesResult.rows) {
      const mcap = parseFloat(token.first_market_cap_usd).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      console.log(chalk.white(`   ${token.symbol} - ${token.name}`));
      console.log(chalk.gray(`     ${token.mint_address}`));
      console.log(chalk.gray(`     Market Cap: ${mcap} | Source: ${token.metadata_source}`));
    }
    
    // Get enricher stats
    const enricherStats = enricher.getStats();
    console.log(chalk.cyan('\n📊 Enricher Session Statistics:'));
    console.log(chalk.white(`   Total processed: ${enricherStats.totalEnriched}`));
    console.log(chalk.green(`   Shyft success: ${enricherStats.shyftSuccess}`));
    console.log(chalk.blue(`   Helius success: ${enricherStats.heliusSuccess}`));
    console.log(chalk.gray(`   Fallback used: ${enricherStats.fallback}`));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error during batch enrichment:'), error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the batch enrichment
batchEnrichTokens().catch(console.error);