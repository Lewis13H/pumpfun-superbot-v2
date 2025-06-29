#!/usr/bin/env tsx
/**
 * Test Enhanced Token Enrichment
 */

import 'dotenv/config';
import { db } from '../src/database';
import { EnhancedAutoEnricher } from '../src/services/enhanced-auto-enricher';
import { ShyftMetadataService } from '../src/services/shyft-metadata-service';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('🧪 Testing Enhanced Token Enrichment'));
  console.log(chalk.gray('─'.repeat(80)));
  
  // Get some tokens without metadata
  const tokensToTest = await db.query(`
    SELECT mint_address, symbol, name, latest_market_cap_usd
    FROM tokens_unified
    WHERE symbol IS NULL OR name IS NULL
    ORDER BY latest_market_cap_usd DESC NULLS LAST
    LIMIT 10
  `);
  
  if (tokensToTest.rows.length === 0) {
    console.log(chalk.yellow('No tokens needing enrichment found'));
    
    // Try to find any tokens for testing
    const anyTokens = await db.query(`
      SELECT mint_address, symbol, name, latest_market_cap_usd
      FROM tokens_unified
      WHERE graduated_to_amm = TRUE
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    if (anyTokens.rows.length > 0) {
      console.log(chalk.cyan('\nTesting with recent graduated tokens:'));
      tokensToTest.rows = anyTokens.rows;
    } else {
      console.log(chalk.red('No tokens found for testing'));
      await db.close();
      return;
    }
  }
  
  console.log(chalk.yellow(`\nFound ${tokensToTest.rows.length} tokens to test:\n`));
  
  // Test Shyft service directly first
  console.log(chalk.cyan('Testing Shyft Metadata Service...'));
  const shyftService = ShyftMetadataService.getInstance();
  
  for (const token of tokensToTest.rows.slice(0, 3)) {
    console.log(chalk.white(`\nTesting: ${token.mint_address}`));
    console.log(chalk.gray(`  Current: ${token.symbol || 'No symbol'} - ${token.name || 'No name'}`));
    console.log(chalk.gray(`  Market Cap: $${(token.latest_market_cap_usd / 1000).toFixed(1)}k`));
    
    try {
      const metadata = await shyftService.getTokenMetadata(token.mint_address);
      
      if (metadata) {
        console.log(chalk.green('  ✓ Shyft metadata found:'));
        console.log(chalk.cyan(`    Symbol: ${metadata.symbol || 'N/A'}`));
        console.log(chalk.cyan(`    Name: ${metadata.name || 'N/A'}`));
        console.log(chalk.cyan(`    Decimals: ${metadata.decimals}`));
        if (metadata.description) {
          console.log(chalk.cyan(`    Description: ${metadata.description.slice(0, 50)}...`));
        }
      } else {
        console.log(chalk.red('  ✗ No metadata found on Shyft'));
      }
    } catch (error) {
      console.log(chalk.red('  ✗ Error:'), error.message);
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Test enhanced enricher
  console.log(chalk.cyan('\n\nTesting Enhanced Auto Enricher...'));
  console.log(chalk.gray('─'.repeat(80)));
  
  const enricher = EnhancedAutoEnricher.getInstance();
  
  // Test manual enrichment
  const mintAddresses = tokensToTest.rows.map(t => t.mint_address);
  const results = await enricher.enrichTokens(mintAddresses);
  
  console.log(chalk.cyan('\n📊 Enrichment Results:'));
  console.log(chalk.gray('─'.repeat(80)));
  
  let successCount = 0;
  let shyftCount = 0;
  let heliusCount = 0;
  
  for (const [mint, result] of results) {
    const token = tokensToTest.rows.find(t => t.mint_address === mint);
    
    console.log(chalk.white(`\n${mint.slice(0, 12)}...`));
    console.log(chalk.gray(`  Market Cap: $${((token?.latest_market_cap_usd || 0) / 1000).toFixed(1)}k`));
    
    if (result.source !== 'none') {
      successCount++;
      if (result.source === 'shyft') shyftCount++;
      if (result.source === 'helius') heliusCount++;
      
      console.log(chalk.green('  ✓ Enriched successfully'));
      console.log(chalk.cyan(`    Source: ${result.source}`));
      console.log(chalk.cyan(`    Symbol: ${result.symbol || 'N/A'}`));
      console.log(chalk.cyan(`    Name: ${result.name || 'N/A'}`));
      if (result.description) {
        console.log(chalk.cyan(`    Description: ${result.description.slice(0, 50)}...`));
      }
    } else {
      console.log(chalk.red('  ✗ Enrichment failed'));
    }
  }
  
  console.log(chalk.gray('\n' + '─'.repeat(80)));
  console.log(chalk.cyan('Summary:'));
  console.log(chalk.white(`Tokens tested: ${results.size}`));
  console.log(chalk.green(`Successfully enriched: ${successCount}`));
  console.log(chalk.blue(`  - From Shyft: ${shyftCount}`));
  console.log(chalk.magenta(`  - From Helius: ${heliusCount}`));
  console.log(chalk.red(`Failed: ${results.size - successCount}`));
  
  // Get enricher stats
  const stats = enricher.getStats();
  console.log(chalk.cyan('\nEnricher Statistics:'));
  console.log(chalk.white(`Total enriched in session: ${stats.totalEnriched}`));
  console.log(chalk.white(`Queue size: ${stats.queueSize}`));
  
  await db.close();
}

main().catch(console.error);