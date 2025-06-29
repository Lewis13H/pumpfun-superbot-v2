#!/usr/bin/env tsx

/**
 * Batch Enrich Tokens Using GraphQL
 * Much more efficient than REST API - can process 50 tokens per query
 */

import chalk from 'chalk';
import { config } from 'dotenv';
import { graphqlMetadataEnricher } from '../src/services/graphql-metadata-enricher';
import { db } from '../src/database';

config();

async function batchEnrichWithGraphQL() {
  console.log(chalk.cyan.bold('\n🚀 GraphQL Batch Token Enrichment\n'));
  console.log(chalk.gray('Using Shyft GraphQL for efficient bulk metadata queries'));
  console.log(chalk.gray('Batch size: 50 tokens per query\n'));
  
  try {
    // Get tokens needing enrichment
    const tokens = await graphqlMetadataEnricher.getTokensNeedingEnrichment(5000);
    
    if (tokens.length === 0) {
      console.log(chalk.green('✨ All tokens above $8,888 are already enriched!'));
      
      // Show current status
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
    
    console.log(chalk.yellow(`📋 Found ${tokens.length} tokens to enrich\n`));
    
    // Show sample of tokens to be enriched
    const sampleResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        first_market_cap_usd,
        graduated_to_amm
      FROM tokens_unified
      WHERE mint_address = ANY($1)
      ORDER BY first_market_cap_usd DESC
      LIMIT 5
    `, [tokens.slice(0, 5)]);
    
    console.log(chalk.cyan('📦 Sample tokens to enrich:'));
    for (const token of sampleResult.rows) {
      const mcap = parseFloat(token.first_market_cap_usd).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      console.log(chalk.white(`   ${token.mint_address.slice(0, 8)}... | ${mcap} | ${token.graduated_to_amm ? '🎓 AMM' : '📈 BC'}`));
    }
    
    console.log(chalk.yellow('\n🔄 Starting GraphQL enrichment...\n'));
    
    const startTime = Date.now();
    const BATCH_SIZE = 50; // GraphQL batch size
    let totalSuccess = 0;
    let totalFailed = 0;
    
    // Process in batches
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(tokens.length / BATCH_SIZE);
      
      console.log(chalk.blue(`\n📡 Processing GraphQL batch ${batchNum}/${totalBatches} (${batch.length} tokens)...`));
      
      try {
        const result = await graphqlMetadataEnricher.enrichTokensInDatabase(batch);
        
        totalSuccess += result.success;
        totalFailed += result.failed;
        
        console.log(chalk.green(`   ✅ Success: ${result.success}`));
        console.log(chalk.red(`   ❌ Failed: ${result.failed}`));
        
        // Progress update
        const progress = ((i + batch.length) / tokens.length * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (totalSuccess / parseFloat(elapsed)).toFixed(1);
        
        console.log(chalk.gray(`   Progress: ${progress}% | Time: ${elapsed}s | Rate: ${rate} tokens/sec`));
        
      } catch (error) {
        console.error(chalk.red(`   Error in batch ${batchNum}:`), error);
        totalFailed += batch.length;
      }
      
      // Small delay between batches
      if (i + BATCH_SIZE < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Final statistics
    console.log(chalk.cyan.bold('\n\n📊 GraphQL Enrichment Complete!\n'));
    console.log(chalk.green(`✅ Successfully enriched: ${totalSuccess} tokens`));
    console.log(chalk.red(`❌ Failed to enrich: ${totalFailed} tokens`));
    console.log(chalk.white(`⏱️  Total time: ${totalTime} seconds`));
    console.log(chalk.white(`🚀 Average rate: ${(totalSuccess / parseFloat(totalTime)).toFixed(1)} tokens/sec`));
    console.log(chalk.white(`📈 Success rate: ${(totalSuccess / tokens.length * 100).toFixed(1)}%`));
    
    // Compare with API approach
    const apiTime = (tokens.length * 0.1); // Assuming 100ms per API call
    const timeSaved = ((apiTime - parseFloat(totalTime)) / 60).toFixed(1);
    console.log(chalk.green(`\n⚡ Time saved vs REST API: ${timeSaved} minutes`));
    
    // Show enrichment breakdown
    const breakdownResult = await db.query(`
      SELECT 
        metadata_source,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (metadata_updated_at - created_at))) as avg_enrichment_delay
      FROM tokens_unified
      WHERE 
        first_market_cap_usd >= 8888
        AND metadata_source IS NOT NULL
      GROUP BY metadata_source
      ORDER BY count DESC
    `);
    
    console.log(chalk.cyan('\n📊 Enrichment Source Breakdown:'));
    for (const row of breakdownResult.rows) {
      const avgDelay = row.avg_enrichment_delay 
        ? `(avg delay: ${(parseFloat(row.avg_enrichment_delay) / 60).toFixed(1)} min)`
        : '';
      console.log(chalk.white(`   ${row.metadata_source}: ${row.count} tokens ${avgDelay}`));
    }
    
    // Show some successfully enriched examples
    const examplesResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        first_market_cap_usd,
        metadata_source,
        creators
      FROM tokens_unified
      WHERE 
        first_market_cap_usd >= 8888
        AND metadata_source = 'graphql'
        AND metadata_updated_at > NOW() - INTERVAL '5 minutes'
      ORDER BY metadata_updated_at DESC
      LIMIT 5
    `);
    
    if (examplesResult.rows.length > 0) {
      console.log(chalk.cyan('\n🌟 Recently Enriched via GraphQL:'));
      for (const token of examplesResult.rows) {
        const mcap = parseFloat(token.first_market_cap_usd).toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        });
        const creatorCount = token.creators ? JSON.parse(token.creators).length : 0;
        console.log(chalk.white(`   ${token.symbol} - ${token.name}`));
        console.log(chalk.gray(`     ${token.mint_address}`));
        console.log(chalk.gray(`     Market Cap: ${mcap} | Creators: ${creatorCount}`));
      }
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error during GraphQL enrichment:'), error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the GraphQL batch enrichment
batchEnrichWithGraphQL().catch(console.error);